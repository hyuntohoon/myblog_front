import type { BoardAlbum, BoardBucket } from '@lib/buckets'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bucketStore } from '@lib/pocketBuckit/bucketStore'
import { playbackQueue } from './queue'
import { playbackSession } from './session'

const mocks = vi.hoisted(() => ({
  deleteBucketItem: vi.fn(),
  play: vi.fn(),
  sendPlayerCommand: vi.fn(),
  resolveTail: vi.fn(),
  prefetchUris: vi.fn(),
  cachedUri: vi.fn(),
  readLivePlayback: vi.fn(),
}))

vi.mock('@components/member/lyrics/playback.api', () => ({
  readLivePlayback: mocks.readLivePlayback,
}))

vi.mock('@lib/buckets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lib/buckets')>()
  return { ...actual, deleteBucketItem: mocks.deleteBucketItem }
})

vi.mock('@lib/spotifyPlayback', () => ({
  IN_PAGE_MESSAGE: '이 브라우저에서 재생 중 (음질 제한)',
  MYBLOG_PLAYBACK_CHANGED: 'myblog:playback-changed',
  play: mocks.play,
  sendPlayerCommand: mocks.sendPlayerCommand,
}))

vi.mock('@lib/playback/uris', () => ({
  resolveTail: mocks.resolveTail,
  prefetchUris: mocks.prefetchUris,
  cachedUri: mocks.cachedUri,
}))

const PLAYBACK_LAG_MS = 1_200
const OK = { ok: true, rung: 'remote', degraded: false, message: '재생을 시작했어요.' } as const
const FAILURE = {
  ok: false,
  reason: 'transient',
  message: '재생 토큰을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.',
} as const

let nextPlayOutcome: typeof OK | typeof FAILURE

function row(id: string): BoardAlbum {
  return {
    itemId: id,
    itemType: 'playback',
    albumId: null,
    trackId: `track-${id}`,
    trackAlbumId: `album-${id}`,
    durationSec: 180,
    reviewTargetId: null,
    artistId: null,
    title: `Title ${id}`,
    artist: `Artist ${id}`,
    cover: null,
    year: null,
    alreadyReviewed: false,
    postId: null,
    researchSelected: false,
  }
}

function bucket(items: BoardAlbum[]): BoardBucket {
  return {
    id: 'playback-bucket',
    name: 'Playback Bucket',
    color: null,
    isDone: false,
    kind: 'playback_queue',
    type: 'general',
    isPublic: false,
    researchMode: 'off',
    albums: items,
    children: [],
  }
}

function setQueue(items: BoardAlbum[]): void {
  bucketStore.setTree([bucket(items)])
}

function queueIds(): string[] {
  return playbackQueue().items.map(item => item.itemId)
}

async function flushPlaybackStart(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function finishPlayback<T>(pending: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(PLAYBACK_LAG_MS)
  return pending
}

async function startAt(itemId: string): Promise<void> {
  const pending = playbackSession.playAt(itemId)
  await flushPlaybackStart()
  expect(playbackSession.getSnapshot().busy).toBe(true)
  await finishPlayback(pending)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  nextPlayOutcome = OK
  mocks.deleteBucketItem.mockResolvedValue(undefined)
  mocks.resolveTail.mockImplementation(async (ids: string[]) => ids.map(id => `provider:track:${id}`))
  mocks.prefetchUris.mockResolvedValue(undefined)
  mocks.cachedUri.mockImplementation((trackId: string) => `provider:track:${trackId}`)
  mocks.readLivePlayback.mockResolvedValue({ state: 'idle' })
  // Spotify acknowledges the write before the player applies it. Every playback
  // stub keeps that stale-read window alive; fake timers keep the suite fast.
  mocks.play.mockImplementation(() => new Promise(resolve => window.setTimeout(() => resolve(nextPlayOutcome), PLAYBACK_LAG_MS)))
  mocks.sendPlayerCommand.mockImplementation(() => new Promise(resolve => window.setTimeout(() => resolve({ ok: true }), PLAYBACK_LAG_MS)))
  playbackSession.__reset()
  setQueue([])
})

describe('drop semantics', () => {
  it('starts the first track when a drop lands in an empty queue', async () => {
    setQueue([row('a')])

    const pending = playbackSession.onDropped()
    await flushPlaybackStart()

    expect(mocks.play).toHaveBeenCalledWith({ kind: 'uris', uris: ['provider:track:track-a'] })
    expect(playbackSession.getSnapshot()).toMatchObject({ busy: true, currentItemId: null, playing: false })
    await vi.advanceTimersByTimeAsync(PLAYBACK_LAG_MS - 1)
    expect(playbackSession.getSnapshot().currentItemId).toBeNull()

    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(playbackSession.getSnapshot()).toMatchObject({ busy: false, currentItemId: 'a', playing: true })
  })

  it.each(['playing', 'paused'] as const)('appends without interrupting while %s', async (mode) => {
    setQueue([row('a')])
    await startAt('a')
    if (mode === 'paused') {
      const pausing = playbackSession.togglePlay()
      expect(playbackSession.getSnapshot().busy).toBe(true)
      await vi.advanceTimersByTimeAsync(PLAYBACK_LAG_MS - 1)
      expect(playbackSession.getSnapshot()).toMatchObject({ busy: true, playing: true })
      await vi.advanceTimersByTimeAsync(1)
      await pausing
      expect(playbackSession.getSnapshot().playing).toBe(false)
    }
    const calls = mocks.play.mock.calls.length
    setQueue([row('a'), row('b')])

    await playbackSession.onDropped()

    expect(queueIds()).toEqual(['a', 'b'])
    expect(mocks.play).toHaveBeenCalledTimes(calls)
    expect(playbackSession.getSnapshot().currentItemId).toBe('a')
  })
})

describe('queue-preserving transitions', () => {
  it('preserves every row and surfaces the shipped sentence when play fails', async () => {
    nextPlayOutcome = FAILURE
    setQueue([row('a'), row('b'), row('c')])

    const pending = playbackSession.playAt('b')
    await flushPlaybackStart()
    expect(queueIds()).toEqual(['a', 'b', 'c'])
    expect(playbackSession.getSnapshot().busy).toBe(true)
    await vi.advanceTimersByTimeAsync(PLAYBACK_LAG_MS - 1)
    expect(playbackSession.getSnapshot().notice).toBeNull()

    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(queueIds()).toEqual(['a', 'b', 'c'])
    expect(playbackSession.getSnapshot().notice).toEqual({
      tone: 'error',
      reason: 'transient',
      message: FAILURE.message,
    })
  })

  it('deletes a completed row and advances to the row that takes its position', async () => {
    setQueue([row('a'), row('b'), row('c')])
    await startAt('a')

    const completing = playbackSession.onCompleted()
    await flushPlaybackStart()

    expect(mocks.deleteBucketItem).toHaveBeenCalledWith('playback-bucket', 'a')
    expect(queueIds()).toEqual(['b', 'c'])
    expect(playbackSession.getSnapshot()).toMatchObject({ busy: true, currentItemId: 'a' })
    await vi.advanceTimersByTimeAsync(PLAYBACK_LAG_MS - 1)
    expect(playbackSession.getSnapshot().currentItemId).toBe('a')

    await vi.advanceTimersByTimeAsync(1)
    await completing
    expect(playbackSession.getSnapshot()).toMatchObject({ busy: false, currentItemId: 'b', playing: true })
  })

  it('removing the current row advances from its old position', async () => {
    setQueue([row('a'), row('b'), row('c')])
    await startAt('b')

    const removing = playbackSession.onRemoved('b')
    await flushPlaybackStart()

    expect(queueIds()).toEqual(['a', 'c'])
    expect(mocks.play).toHaveBeenLastCalledWith({ kind: 'uris', uris: ['provider:track:track-c'] })
    expect(playbackSession.getSnapshot()).toMatchObject({ busy: true, currentItemId: 'b' })
    await vi.advanceTimersByTimeAsync(PLAYBACK_LAG_MS - 1)
    expect(playbackSession.getSnapshot().currentItemId).toBe('b')

    await vi.advanceTimersByTimeAsync(1)
    await removing
    expect(playbackSession.getSnapshot()).toMatchObject({ busy: false, currentItemId: 'c', playing: true })
  })

  it('play-from-n sends the whole tail and keeps the pre-ack state intermediate', async () => {
    setQueue([row('a'), row('b'), row('c'), row('d')])

    const pending = playbackSession.playAt('b')
    await flushPlaybackStart()

    expect(mocks.play).toHaveBeenCalledWith({
      kind: 'uris',
      uris: [
        'provider:track:track-b',
        'provider:track:track-c',
        'provider:track:track-d',
      ],
    })
    expect(playbackSession.getSnapshot()).toMatchObject({ busy: true, currentItemId: null })
    await finishPlayback(pending)
    expect(playbackSession.getSnapshot().currentItemId).toBe('b')
  })
})

// ── adopting playback we did not start ───────────────────────────────────────
// The shipped Step 6 session could only ever describe playback it had started
// itself, so an album played from anywhere else was invisible here and the
// transport beside it was dead. These cover the fix.
describe('external playback adoption', () => {
  const liveTrack = (trackId: string, state: 'playing' | 'paused' = 'playing') => ({
    state,
    trackId,
    progressMs: 42_000,
    readAtMs: 1_000,
    durationMs: 240_000,
    track: 'Paranoid Android',
    artist: 'Radiohead',
    artists: [],
    album: 'OK Computer',
    albumSpotifyId: null,
    albumCoverUrl: null,
    deviceName: '거실 스피커',
    shuffle: null,
    repeat: null,
    volumePercent: null,
    contextUri: null,
    contextType: null,
  })

  it('matches live playback to a queue row when the track is ours', async () => {
    setQueue([row('a'), row('b')])
    // `cachedUri` is what the matcher consults — mirror how uris.ts would have it.
    mocks.cachedUri.mockImplementation((t: string) => (t === 'track-b' ? 'spotify:track:SPOT-B' : null))
    mocks.readLivePlayback.mockResolvedValue(liveTrack('SPOT-B'))

    await playbackSession.syncFromLive()

    const state = playbackSession.getSnapshot()
    expect(state.currentItemId).toBe('b')
    expect(state.external).toBeNull()
    expect(state.playing).toBe(true)
    // Anchored on the READ instant, not "now" — otherwise the progress line drifts
    // by however long the request took.
    expect(state.anchor).toEqual({ ms: 42_000, wallMs: 1_000 })
  })

  it('reports playback outside the queue instead of going blind', async () => {
    setQueue([row('a')])
    mocks.cachedUri.mockReturnValue('spotify:track:SOMETHING-ELSE')
    mocks.readLivePlayback.mockResolvedValue(liveTrack('SPOT-UNKNOWN'))

    await playbackSession.syncFromLive()

    const state = playbackSession.getSnapshot()
    expect(state.currentItemId).toBeNull()
    expect(state.external).toEqual({
      title: 'Paranoid Android',
      artist: 'Radiohead',
      spotifyTrackId: 'SPOT-UNKNOWN',
      deviceName: '거실 스피커',
    })
    expect(state.playing).toBe(true)
  })

  it('adopts a track PAUSED elsewhere rather than folding it into idle', async () => {
    setQueue([])
    mocks.readLivePlayback.mockResolvedValue(liveTrack('SPOT-X', 'paused'))

    await playbackSession.syncFromLive()

    const state = playbackSession.getSnapshot()
    expect(state.external?.title).toBe('Paranoid Android')
    expect(state.playing).toBe(false)
  })

  it('controls external playback — the bug the owner reported', async () => {
    setQueue([])
    mocks.readLivePlayback.mockResolvedValue(liveTrack('SPOT-X'))
    await playbackSession.syncFromLive()
    expect(playbackSession.getSnapshot().playing).toBe(true)

    const pausing = playbackSession.togglePlay()
    // 204 is acceptance, not application: mid-flight nothing has changed yet.
    await vi.advanceTimersByTimeAsync(PLAYBACK_LAG_MS - 1)
    expect(playbackSession.getSnapshot().playing).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    await pausing

    expect(mocks.sendPlayerCommand).toHaveBeenCalledWith({ kind: 'pause' })
    expect(playbackSession.getSnapshot().playing).toBe(false)
  })

  it('keeps the current track when the read is unavailable (transient, not silence)', async () => {
    setQueue([])
    mocks.readLivePlayback.mockResolvedValue(liveTrack('SPOT-X'))
    await playbackSession.syncFromLive()

    mocks.readLivePlayback.mockResolvedValue({ state: 'unavailable' })
    await playbackSession.syncFromLive()

    expect(playbackSession.getSnapshot().external?.spotifyTrackId).toBe('SPOT-X')
    expect(playbackSession.getSnapshot().playing).toBe(true)
  })
})
