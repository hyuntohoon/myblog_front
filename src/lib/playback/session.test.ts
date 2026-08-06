import type { BoardAlbum, BoardBucket } from '@lib/buckets'
import type { OwnershipMessage, PlaybackOwnershipState } from '@lib/playback/ownership'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bucketStore } from '@lib/pocketBuckit/bucketStore'
import { playbackQueue } from './queue'
import { playbackSession } from './session'

const mocks = vi.hoisted(() => ({
  deleteBucketItem: vi.fn(),
  addBucketPlayback: vi.fn(),
  expandAlbumTracks: vi.fn(),
  listBuckets: vi.fn(),
  play: vi.fn(),
  sendPlayerCommand: vi.fn(),
  resolveTail: vi.fn(),
  prefetchUris: vi.fn(),
  cachedUri: vi.fn(),
  readLivePlayback: vi.fn(),
  ownershipState: {
    tabId: 'test-tab',
    isOwner: true,
    ownerTabId: 'test-tab',
    ownerPresent: true,
  } as PlaybackOwnershipState,
  ownershipListeners: new Set<() => void>(),
  ownershipMessageListeners: new Set<(message: OwnershipMessage) => void>(),
  ownershipPost: vi.fn(),
  ensureOwner: vi.fn(),
}))

vi.mock('@components/member/lyrics/playback.api', () => ({
  readLivePlayback: mocks.readLivePlayback,
}))

vi.mock('@lib/buckets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lib/buckets')>()
  return {
    ...actual,
    deleteBucketItem: mocks.deleteBucketItem,
    addBucketPlayback: mocks.addBucketPlayback,
    expandAlbumTracks: mocks.expandAlbumTracks,
    listBuckets: mocks.listBuckets,
  }
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

vi.mock('@lib/playback/ownership', () => ({
  playbackOwnership: {
    subscribe: (cb: () => void) => {
      mocks.ownershipListeners.add(cb)
      return () => mocks.ownershipListeners.delete(cb)
    },
    getSnapshot: () => mocks.ownershipState,
    getServerSnapshot: () => mocks.ownershipState,
    ensureOwner: mocks.ensureOwner,
    post: mocks.ownershipPost,
    onMessage: (cb: (message: OwnershipMessage) => void) => {
      mocks.ownershipMessageListeners.add(cb)
      return () => mocks.ownershipMessageListeners.delete(cb)
    },
  },
}))

const PLAYBACK_LAG_MS = 1_200
const WRITE_LAG_MS = 200

/** albumId → the track ids its expansion appends, in album order. */
let albumTracks: Record<string, string[]> = {}

function afterWriteLag<T>(apply: () => T): Promise<T> {
  return new Promise<T>(resolve => window.setTimeout(() => resolve(apply()), WRITE_LAG_MS))
}
const OK = { ok: true, rung: 'remote', degraded: false, message: '재생을 시작했어요.' } as const
const IN_PAGE_OK = { ok: true, rung: 'in-page', degraded: true, message: '이 브라우저에서 재생 중 (음질 제한)' } as const
const FAILURE = {
  ok: false,
  reason: 'transient',
  message: '재생 토큰을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.',
} as const

let nextPlayOutcome: typeof OK | typeof IN_PAGE_OK | typeof FAILURE

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

// Replacing the queue is the first path here that WRITES, so these tests need a
// server to write to: the store re-reads the tree after every append, and the whole
// question ("can this end with a half-erased queue?") only exists because the rows
// live server-side. `server` is that list; `listBuckets` serves it.
let server: BoardAlbum[] = []
let serverSeq = 0

/** Rows land server-side APPENDED, in call order — `position` is append order. */
function appendServerRow(trackId: string): BoardAlbum {
  serverSeq += 1
  const created = { ...row(`srv-${serverSeq}`), trackId }
  server = [...server, created]
  return created
}

function setQueue(items: BoardAlbum[]): void {
  server = [...items]
  bucketStore.setTree([bucket(server)])
}

/** A `readLivePlayback()` result naming a live/held track, shared across describes. */
function liveTrack(trackId: string, state: 'playing' | 'paused' = 'playing') {
  return {
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
  }
}

function queueTrackIds(): (string | null)[] {
  return playbackQueue().items.map(item => item.trackId)
}

/** Drain every modelled lag — the writes, the deletes, and Spotify's apply window. */
async function settleAll(): Promise<void> {
  await vi.advanceTimersByTimeAsync(30_000)
}

function setOwnership(patch: Partial<PlaybackOwnershipState>): void {
  Object.assign(mocks.ownershipState, patch)
  for (const cb of mocks.ownershipListeners) cb()
}

function receiveOwnership(message: OwnershipMessage): void {
  for (const cb of mocks.ownershipMessageListeners) cb(message)
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
  Object.assign(mocks.ownershipState, {
    tabId: 'test-tab',
    isOwner: true,
    ownerTabId: 'test-tab',
    ownerPresent: true,
  })
  mocks.ensureOwner.mockImplementation(async () => {
    setOwnership({ isOwner: true, ownerTabId: 'test-tab', ownerPresent: true })
    return true
  })
  nextPlayOutcome = OK
  serverSeq = 0
  server = []
  albumTracks = {}
  mocks.listBuckets.mockImplementation(async () => [bucket(server)])
  // Writes lag too, and shorter than playback's apply window on purpose: it is the
  // gap between "the rows changed" and "the player caught up" that a same-tick stub
  // erases, and the half-erased-queue question lives exactly in that gap.
  mocks.expandAlbumTracks.mockImplementation(async (_bucketId: string, albumId: string) =>
    afterWriteLag(() => (albumTracks[albumId] ?? []).map(trackId => appendServerRow(trackId))))
  mocks.addBucketPlayback.mockImplementation(async (_bucketId: string, trackId: string) =>
    afterWriteLag(() => ({ item: appendServerRow(trackId), conflict: false })))
  // DELETE resolves on a microtask, unlike the appends: the transitions that shipped
  // before this step (completion, remove-current) drive it with microtask flushes and
  // are asserting playback ordering, not write latency.
  mocks.deleteBucketItem.mockImplementation(async (_bucketId: string, itemId: string) => {
    server = server.filter(item => item.itemId !== itemId)
  })
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

  it('appends without interrupting while external playback is sounding (BUG-29)', async () => {
    mocks.readLivePlayback.mockResolvedValue(liveTrack('SPOT-EXTERNAL'))
    await playbackSession.syncFromLive()
    expect(playbackSession.getSnapshot()).toMatchObject({ currentItemId: null, external: expect.objectContaining({ spotifyTrackId: 'SPOT-EXTERNAL' }) })

    setQueue([row('a')])
    await playbackSession.onDropped()

    expect(mocks.play).not.toHaveBeenCalled()
    expect(playbackSession.getSnapshot().currentItemId).toBeNull()
    expect(playbackSession.getSnapshot().external?.spotifyTrackId).toBe('SPOT-EXTERNAL')
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
      spotifyAlbumId: null,
      deviceName: '거실 스피커',
    })
    expect(state.playing).toBe(true)
  })

  it('carries the Spotify album id through so 앨범 정보 works for playback outside the queue', async () => {
    setQueue([])
    mocks.readLivePlayback.mockResolvedValue({ ...liveTrack('SPOT-UNKNOWN'), albumSpotifyId: 'ALBUM-XYZ' })

    await playbackSession.syncFromLive()

    expect(playbackSession.getSnapshot().external?.spotifyAlbumId).toBe('ALBUM-XYZ')
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

  it.each(['next', 'previous'] as const)('%s sends a raw transport command during external playback instead of no-oping (BUG-27)', async (kind) => {
    setQueue([])
    mocks.readLivePlayback.mockResolvedValue(liveTrack('SPOT-X'))
    await playbackSession.syncFromLive()
    expect(playbackSession.getSnapshot()).toMatchObject({ currentItemId: null, external: expect.objectContaining({ spotifyTrackId: 'SPOT-X' }) })

    const pending = kind === 'next' ? playbackSession.next() : playbackSession.previous()
    await vi.advanceTimersByTimeAsync(PLAYBACK_LAG_MS)
    await pending

    expect(mocks.sendPlayerCommand).toHaveBeenCalledWith({ kind })
    expect(playbackSession.getSnapshot().busy).toBe(false)
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

// ARCH-entity-interaction-domain-audit Step 3c — the reverse lookup a consumer
// (the lyrics viewer) uses to confirm the session's anchor is for the SAME
// track before trusting it.
describe('currentSpotifyTrackId', () => {
  it('returns null when nothing is playing', () => {
    setQueue([])
    expect(playbackSession.currentSpotifyTrackId()).toBeNull()
  })

  it('reads straight off `external` when playback matched no queue row', async () => {
    setQueue([])
    mocks.cachedUri.mockReturnValue(null)
    mocks.readLivePlayback.mockResolvedValue(liveTrack('SPOT-UNKNOWN'))
    await playbackSession.syncFromLive()

    expect(playbackSession.currentSpotifyTrackId()).toBe('SPOT-UNKNOWN')
  })

  it('reverse-looks-up a queue-matched row through the SAME cache rowForSpotifyTrack used forward', async () => {
    setQueue([row('a'), row('b')])
    mocks.cachedUri.mockImplementation((t: string) => (t === 'track-b' ? 'spotify:track:SPOT-B' : null))
    mocks.readLivePlayback.mockResolvedValue(liveTrack('SPOT-B'))
    await playbackSession.syncFromLive()
    expect(playbackSession.getSnapshot().currentItemId).toBe('b') // matched, not external

    expect(playbackSession.currentSpotifyTrackId()).toBe('SPOT-B')
  })

  it('is null, not a request, when the matched row\'s URI is not cached yet', async () => {
    setQueue([row('a')])
    // Matches via a DIFFERENT mechanism than the URI cache (readLivePlayback's
    // own trackId), so the row can be "current" while its cache entry is cold —
    // exactly the case `cachedUri` (never `resolveUri`) is built to just miss.
    mocks.cachedUri.mockImplementation((t: string) => (t === 'track-a' ? 'spotify:track:SPOT-A' : null))
    mocks.readLivePlayback.mockResolvedValue(liveTrack('SPOT-A'))
    await playbackSession.syncFromLive()
    expect(playbackSession.getSnapshot().currentItemId).toBe('a')

    mocks.cachedUri.mockReturnValue(undefined) // cache evicted/never warmed
    expect(playbackSession.currentSpotifyTrackId()).toBeNull()
  })
})

// Playback Step 8 preflight audit — the RFC's own Step 6b decisions log left this
// open ("our own transport races its own adoption... owner decision pending"):
// `MYBLOG_PLAYBACK_CHANGED` fires the instant a command is ACKNOWLEDGED, and the
// `adoptLive()` read it triggers can land inside Spotify's ack→apply window with
// the PREVIOUS state — overwriting a fresher local write with a staler one.
describe('self-triggered adoption cannot overwrite a newer local write', () => {
  it('discards a stale adoptLive() read that resolves after a newer togglePlay()', async () => {
    setQueue([row('a')])
    mocks.cachedUri.mockImplementation((t: string) => (t === 'track-a' ? 'spotify:track:SPOT-A' : null))
    await startAt('a')
    expect(playbackSession.getSnapshot().playing).toBe(true)

    // A read that will not resolve until this test says so — modelling exactly the
    // window where our own command has already been acted on locally but the read
    // it triggered is still in flight.
    let resolveRead!: (v: unknown) => void
    mocks.readLivePlayback.mockReturnValue(new Promise((resolve) => {
      resolveRead = resolve
    }))
    const staleAdoption = playbackSession.syncFromLive()

    // A NEWER authoritative local write lands while that read is still pending.
    const pausing = playbackSession.togglePlay()
    await finishPlayback(pausing)
    expect(playbackSession.getSnapshot().playing).toBe(false)

    // NOW the stale read resolves, reporting the track as still playing — exactly
    // the RFC's recorded bug ("pause it and it snaps back to Ⅱ").
    resolveRead({ state: 'playing', trackId: 'SPOT-A', progressMs: 1000, readAtMs: 1000, durationMs: 180_000, track: 't', artist: 'a', artists: [], album: null, albumSpotifyId: null, albumCoverUrl: null, deviceName: null, shuffle: null, repeat: null, volumePercent: null, contextUri: null, contextType: null })
    await staleAdoption

    expect(playbackSession.getSnapshot().playing).toBe(false)
  })
})

// A track finishing naturally (rung 1: no push signal exists — see the
// `scheduleBoundaryCheck` boundary-check in session.ts; rung 2: the SDK's
// `player_state_changed`) both funnel into the SAME re-adoption `adoptLive()`
// already runs on any trigger. This pins the piece that actually removes the
// finished row — `onCompleted()` alone was never called from anywhere shipped.
describe('a confirmed track change away from the current row completes it', () => {
  it('deletes the finished row once its own elapsed position actually reached the end, and adopts whatever is live now, without replaying it', async () => {
    setQueue([row('a'), row('b')])
    mocks.cachedUri.mockImplementation((t: string) =>
      t === 'track-a' ? 'spotify:track:SPOT-A' : t === 'track-b' ? 'spotify:track:SPOT-B' : null)
    await startAt('a')
    const playCallsBeforeAdoption = mocks.play.mock.calls.length

    // 'a' (180s, from `row()`'s durationSec) genuinely played to the end before
    // Spotify moved on — no command of ours caused it.
    await vi.advanceTimersByTimeAsync(179_000)
    mocks.readLivePlayback.mockResolvedValue({
      state: 'playing',
      trackId: 'SPOT-B',
      progressMs: 500,
      readAtMs: 2_000,
      durationMs: 180_000,
      track: 'Title b',
      artist: 'Artist b',
      artists: [],
      album: null,
      albumSpotifyId: null,
      albumCoverUrl: null,
      deviceName: null,
      shuffle: null,
      repeat: null,
      volumePercent: null,
      contextUri: null,
      contextType: null,
    })

    await playbackSession.syncFromLive()

    expect(mocks.deleteBucketItem).toHaveBeenCalledWith('playback-bucket', 'a')
    expect(queueIds()).toEqual(['b'])
    expect(playbackSession.getSnapshot().currentItemId).toBe('b')
    // Spotify was ALREADY playing 'b' — re-issuing play() would be a redundant,
    // audible restart of a track that is already correctly playing.
    expect(mocks.play.mock.calls.length).toBe(playCallsBeforeAdoption)
  })

  // BUG-26(b): the row above pins the correct case (genuine completion). This pins
  // the one the shipped fix was over-broad on: a URI mismatch that happens WITHOUT
  // the previous row having actually reached its end — e.g. a phone/native-client
  // skip mid-song. That is not "completion", and the shipped `adoptLive()` deleted
  // the row anyway on URI mismatch alone, silently and with no Undo.
  it('does NOT delete the previous row when the live track changes far from its own completion (BUG-26b)', async () => {
    setQueue([row('a'), row('b')])
    mocks.cachedUri.mockImplementation((t: string) =>
      t === 'track-a' ? 'spotify:track:SPOT-A' : t === 'track-b' ? 'spotify:track:SPOT-B' : null)
    await startAt('a')

    // Barely any time has passed — 'a' (180s) is nowhere near its end when the
    // live track jumps to 'b', e.g. skipped from a phone.
    mocks.readLivePlayback.mockResolvedValue({
      state: 'playing',
      trackId: 'SPOT-B',
      progressMs: 500,
      readAtMs: 2_000,
      durationMs: 180_000,
      track: 'Title b',
      artist: 'Artist b',
      artists: [],
      album: null,
      albumSpotifyId: null,
      albumCoverUrl: null,
      deviceName: null,
      shuffle: null,
      repeat: null,
      volumePercent: null,
      contextUri: null,
      contextType: null,
    })

    await playbackSession.syncFromLive()

    expect(mocks.deleteBucketItem).not.toHaveBeenCalled()
    expect(queueIds()).toEqual(['a', 'b'])
    // The panel still honestly reports whatever is now live.
    expect(playbackSession.getSnapshot().currentItemId).toBe('b')
  })

  // BUG-26(a): the queue intentionally allows duplicate tracks (D8). With no prior
  // anchor to disambiguate, the live-track matcher falls back to a first-match
  // guess — the SECOND occurrence may actually be the one playing. Because that
  // guess is only ever a display best-effort, it must not later be deleted as if
  // it were a confirmed completion — that would destroy a never-played row while
  // the one that actually played lingers, uncounted, in the queue.
  it('does NOT delete an ambiguously-matched duplicate-track row on the next live-track change', async () => {
    setQueue([row('a1'), row('b'), row('a2')])
    mocks.cachedUri.mockImplementation((t: string) =>
      (t === 'track-a1' || t === 'track-a2') ? 'spotify:track:SPOT-A' : t === 'track-b' ? 'spotify:track:SPOT-B' : null)

    // Fresh mount: nothing in this tab has a prior anchor, and Spotify is already
    // mid-playback of SPOT-A — could be either 'a1' or 'a2', no signal says which.
    mocks.readLivePlayback.mockResolvedValue({
      state: 'playing',
      trackId: 'SPOT-A',
      progressMs: 42_000,
      readAtMs: 1_000,
      durationMs: 180_000,
      track: 'Title a',
      artist: 'Artist a',
      artists: [],
      album: null,
      albumSpotifyId: null,
      albumCoverUrl: null,
      deviceName: null,
      shuffle: null,
      repeat: null,
      volumePercent: null,
      contextUri: null,
      contextType: null,
    })
    await playbackSession.syncFromLive()
    expect(playbackSession.getSnapshot().currentItemId).toBe('a1') // best-effort guess, not a claim of certainty

    // Even letting a full track's worth of time pass, a change to a genuinely
    // different track must not delete the guessed row.
    await vi.advanceTimersByTimeAsync(179_000)
    mocks.readLivePlayback.mockResolvedValue(liveTrack('SPOT-B'))
    await playbackSession.syncFromLive()

    expect(mocks.deleteBucketItem).not.toHaveBeenCalled()
    expect(queueIds()).toEqual(['a1', 'b', 'a2'])
    expect(playbackSession.getSnapshot().currentItemId).toBe('b')
  })

  // BUG-26(a): once a row IS anchored (certain, via `playAt`/`playFrom`), a read
  // confirming the SAME track is still live must not re-derive via first-match and
  // flap back to the other duplicate occurrence.
  it('keeps a certainly-anchored duplicate-track row anchored across repeated live reads instead of flapping to the other occurrence', async () => {
    setQueue([row('a1'), row('a2')])
    mocks.cachedUri.mockImplementation((t: string) =>
      (t === 'track-a1' || t === 'track-a2') ? 'spotify:track:SPOT-A' : null)
    await startAt('a2')
    expect(playbackSession.getSnapshot().currentItemId).toBe('a2')

    mocks.readLivePlayback.mockResolvedValue(liveTrack('SPOT-A'))
    await playbackSession.syncFromLive()

    expect(playbackSession.getSnapshot().currentItemId).toBe('a2')
    expect(mocks.deleteBucketItem).not.toHaveBeenCalled()
  })

  it('does not delete anything when the live track still matches the current row', async () => {
    setQueue([row('a')])
    mocks.cachedUri.mockImplementation((t: string) => (t === 'track-a' ? 'spotify:track:SPOT-A' : null))
    await startAt('a')

    mocks.readLivePlayback.mockResolvedValue({
      state: 'playing',
      trackId: 'SPOT-A',
      progressMs: 42_000,
      readAtMs: 1_000,
      durationMs: 180_000,
      track: 'Title a',
      artist: 'Artist a',
      artists: [],
      album: null,
      albumSpotifyId: null,
      albumCoverUrl: null,
      deviceName: null,
      shuffle: null,
      repeat: null,
      volumePercent: null,
      contextUri: null,
      contextType: null,
    })
    await playbackSession.syncFromLive()

    expect(mocks.deleteBucketItem).not.toHaveBeenCalled()
    expect(queueIds()).toEqual(['a'])
    expect(playbackSession.getSnapshot().currentItemId).toBe('a')
  })
})

// FEAT-playback-bucket-player Step 6b (second half) — ▶ REPLACES the queue.
//
// The owner's finding after using Step 6: playing an album had no relationship to
// the queue, and a track had no ▶ at all. Both because every ▶ in the product went
// straight to `play()`, behind the session's back.
describe('▶ replaces the queue', () => {
  it('makes the album the queue and plays it from the top', async () => {
    setQueue([row('a'), row('b')])
    albumTracks = { 'alb-1': ['t1', 't2', 't3'] }

    const pending = playbackSession.replaceQueueAndPlay({ kind: 'album', albumId: 'alb-1' })
    await settleAll()
    const outcome = await pending

    expect(queueTrackIds()).toEqual(['t1', 't2', 't3'])
    // The WHOLE tail, and only the new rows — `uris` replaces Spotify's context, so
    // a short send would silently drop everything after it.
    expect(mocks.play).toHaveBeenLastCalledWith({
      kind: 'uris',
      uris: ['provider:track:t1', 'provider:track:t2', 'provider:track:t3'],
    })
    expect(playbackSession.getSnapshot()).toMatchObject({ playing: true, busy: false })
    expect(playbackSession.currentRow()?.trackId).toBe('t1')
    // The displaced rows are gone from the server, not just from the screen.
    expect(mocks.deleteBucketItem.mock.calls.map(call => call[1])).toEqual(['a', 'b'])
    expect(server.map(item => item.trackId)).toEqual(['t1', 't2', 't3'])
    expect(outcome).toMatchObject({ ok: true, message: '재생 대기열을 이 앨범 3곡으로 바꿨어요' })
    expect(outcome.undo).toBeTypeOf('function')
  })

  it('makes a single track the queue and plays it', async () => {
    setQueue([row('a'), row('b')])

    const pending = playbackSession.replaceQueueAndPlay({ kind: 'track', trackId: 't9' })
    await settleAll()
    const outcome = await pending

    expect(queueTrackIds()).toEqual(['t9'])
    expect(mocks.play).toHaveBeenLastCalledWith({ kind: 'uris', uris: ['provider:track:t9'] })
    expect(outcome).toMatchObject({ ok: true, message: '재생 대기열을 이 곡으로 바꿨어요' })
  })

  it('plays through the ladder without writing when the user has no Playback Bucket', async () => {
    bucketStore.setTree([{ ...bucket([]), kind: 'general' }])

    const pending = playbackSession.replaceQueueAndPlay({ kind: 'album', albumId: 'alb-1' })
    await settleAll()
    const outcome = await pending

    // Falls back to the intent itself — still the one shipped play path, no queue.
    expect(mocks.play).toHaveBeenLastCalledWith({ kind: 'album', albumId: 'alb-1' })
    expect(mocks.expandAlbumTracks).not.toHaveBeenCalled()
    expect(mocks.deleteBucketItem).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ ok: true, undo: null })
  })

  it('never leaves a half-erased queue while the replacement is in flight', async () => {
    setQueue([row('a'), row('b'), row('c')])
    albumTracks = { 'alb-1': ['t1', 't2'] }
    const before = new Set<string | null>(['track-a', 'track-b', 'track-c'])
    const seen: (string | null)[][] = []
    const stop = bucketStore.subscribe(() => seen.push(queueTrackIds()))

    const pending = playbackSession.replaceQueueAndPlay({ kind: 'album', albumId: 'alb-1' })
    await settleAll()
    await pending
    stop()

    // Every intermediate the store ever published either still holds all three old
    // rows, or holds the replacement. What must never appear is a state that has
    // lost old rows without having gained new ones — deleting first would produce
    // exactly that, and it is unplayable and un-undoable.
    expect(seen.length).toBeGreaterThan(0)
    for (const state of seen) {
      const keptOld = state.filter(id => before.has(id)).length
      const gainedNew = state.some(id => !before.has(id))
      expect(keptOld === before.size || gainedNew).toBe(true)
    }
    expect(queueTrackIds()).toEqual(['t1', 't2'])
  })

  it('serializes overlapping presses so the second replace is not corrupted by the first (BUG-23)', async () => {
    setQueue([row('a')])
    albumTracks = { 'alb-1': ['t1', 't2'] }

    const first = playbackSession.replaceQueueAndPlay({ kind: 'album', albumId: 'alb-1' })
    await flushPlaybackStart()
    const second = playbackSession.replaceQueueAndPlay({ kind: 'track', trackId: 't9' })
    await settleAll()
    await Promise.all([first, second])

    // The second press is what the member actually meant to land on. Before the
    // fix, both presses snapshotted `rewriteQueue`'s `beforeIds` off the SAME
    // pre-press tree, so the second press's own diff wrongly folded in the first
    // press's rows too — the queue ended up holding all three tracks and
    // `playFrom(0)` named the FIRST press's track as current regardless of which
    // press actually landed last.
    expect(queueTrackIds()).toEqual(['t9'])
    expect(playbackSession.currentRow()?.trackId).toBe('t9')
    expect(playbackSession.getSnapshot()).toMatchObject({ playing: true, busy: false })
  })
})

describe('▶ replace — failures preserve', () => {
  it('leaves the queue untouched and deletes nothing when the write fails', async () => {
    setQueue([row('a'), row('b')])
    mocks.expandAlbumTracks.mockRejectedValue(new Error('500'))

    const pending = playbackSession.replaceQueueAndPlay({ kind: 'album', albumId: 'alb-1' })
    await settleAll()
    const outcome = await pending

    expect(queueTrackIds()).toEqual(['track-a', 'track-b'])
    expect(mocks.deleteBucketItem).not.toHaveBeenCalled()
    expect(mocks.play).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ ok: false, message: '재생 대기열을 바꾸지 못했어요', undo: null })
    expect(playbackSession.getSnapshot().busy).toBe(false)
  })

  it('leaves the queue untouched when the album expands to nothing', async () => {
    setQueue([row('a'), row('b')])
    albumTracks = { 'alb-empty': [] }

    const pending = playbackSession.replaceQueueAndPlay({ kind: 'album', albumId: 'alb-empty' })
    await settleAll()
    const outcome = await pending

    expect(queueTrackIds()).toEqual(['track-a', 'track-b'])
    expect(mocks.deleteBucketItem).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ ok: false, message: '이 앨범은 아직 트랙 정보가 없어요', undo: null })
  })

  it('keeps the replaced queue and still offers Undo when the play fails', async () => {
    setQueue([row('a')])
    albumTracks = { 'alb-1': ['t1', 't2'] }
    nextPlayOutcome = FAILURE

    const pending = playbackSession.replaceQueueAndPlay({ kind: 'album', albumId: 'alb-1' })
    await settleAll()
    const outcome = await pending

    // The WRITE succeeded and stands; only the play failed. So the member gets the
    // shipped sentence for that failure — and an Undo, because their old queue is
    // gone either way.
    expect(queueTrackIds()).toEqual(['t1', 't2'])
    expect(outcome).toMatchObject({ ok: false, message: FAILURE.message })
    expect(outcome.undo).toBeTypeOf('function')
    expect(playbackSession.getSnapshot().notice).toMatchObject({ tone: 'error', reason: 'transient' })
  })

  it('re-reads the truth and says so when a displaced row cannot be deleted', async () => {
    setQueue([row('a'), row('b')])
    albumTracks = { 'alb-1': ['t1'] }
    mocks.deleteBucketItem.mockImplementation(async (_bucketId: string, itemId: string) => {
      if (itemId === 'b')
        return Promise.reject(new Error('500'))
      server = server.filter(item => item.itemId !== itemId)
      return undefined
    })

    const pending = playbackSession.replaceQueueAndPlay({ kind: 'album', albumId: 'alb-1' })
    await settleAll()
    const outcome = await pending

    // The optimistic prune had already hidden 'b'; the forced re-read puts it back,
    // because a queue that lies is worse than one that is briefly ugly.
    expect(queueTrackIds()).toEqual(['track-b', 't1'])
    expect(outcome.message).toContain('이전 1곡은 지우지 못했어요')
  })
})

describe('▶ replace — Undo', () => {
  it('restores the displaced queue, in order, and clears the stale current row', async () => {
    setQueue([row('a'), row('b')])
    albumTracks = { 'alb-1': ['t1', 't2'] }

    const replacing = playbackSession.replaceQueueAndPlay({ kind: 'album', albumId: 'alb-1' })
    await settleAll()
    const outcome = await replacing
    expect(queueTrackIds()).toEqual(['t1', 't2'])

    const undoing = outcome.undo?.()
    await settleAll()
    const undone = await undoing

    expect(queueTrackIds()).toEqual(['track-a', 'track-b'])
    expect(server.map(item => item.trackId)).toEqual(['track-a', 'track-b'])
    expect(undone).toMatchObject({ ok: true, message: '이전 재생 대기열로 되돌렸어요' })
    // The restored rows are NEW memberships, so the id the session held addresses a
    // row that no longer exists. It must not keep pointing at it.
    expect(playbackSession.getSnapshot().currentItemId).toBeNull()
  })

  it('offers no Undo when there was no queue to displace', async () => {
    setQueue([])
    albumTracks = { 'alb-1': ['t1'] }

    const pending = playbackSession.replaceQueueAndPlay({ kind: 'album', albumId: 'alb-1' })
    await settleAll()
    const outcome = await pending

    expect(outcome).toMatchObject({ ok: true, undo: null })
    expect(queueTrackIds()).toEqual(['t1'])
  })

  it('reports failure and keeps the replacement when the restore write fails', async () => {
    setQueue([row('a')])
    albumTracks = { 'alb-1': ['t1'] }
    const replacing = playbackSession.replaceQueueAndPlay({ kind: 'album', albumId: 'alb-1' })
    await settleAll()
    const outcome = await replacing

    mocks.addBucketPlayback.mockRejectedValue(new Error('500'))
    const undoing = outcome.undo?.()
    await settleAll()
    const undone = await undoing

    expect(undone).toMatchObject({ ok: false, message: '이전 대기열을 되돌리지 못했어요' })
    expect(queueTrackIds()).toEqual(['t1'])
  })
})

describe('single-tab ownership', () => {
  it('forwards transport from a remote-rung mirror without executing locally', async () => {
    setQueue([row('a'), row('b')])
    await startAt('a')
    setOwnership({ isOwner: false, ownerTabId: 'owner-tab', ownerPresent: true })
    expect(playbackSession.getSnapshot().ownerRung).toBe('remote')
    mocks.sendPlayerCommand.mockClear()
    mocks.ownershipPost.mockClear()

    await playbackSession.togglePlay()

    expect(mocks.sendPlayerCommand).not.toHaveBeenCalled()
    expect(mocks.ownershipPost).toHaveBeenCalledWith({
      type: 'command',
      cmd: { kind: 'toggle-play' },
    })
  })

  it('blocks an in-page mirror until takeover, then resumes from the current row', async () => {
    nextPlayOutcome = IN_PAGE_OK
    setQueue([row('a'), row('b')])
    await startAt('a')
    setOwnership({ isOwner: false, ownerTabId: 'owner-tab', ownerPresent: true })
    expect(playbackSession.getSnapshot().ownerRung).toBe('in-page')
    mocks.play.mockClear()
    mocks.sendPlayerCommand.mockClear()
    mocks.ownershipPost.mockClear()

    await playbackSession.togglePlay()
    await playbackSession.playAt('b')

    // The invariant is that a mirror never produces sound itself — never that it
    // stays silent. Asking the tab that already holds the SDK device to act is
    // exactly what ownership is for, so the presses are forwarded, not dropped.
    expect(mocks.play).not.toHaveBeenCalled()
    expect(mocks.sendPlayerCommand).not.toHaveBeenCalled()
    expect(mocks.ownershipPost).toHaveBeenCalledWith({ type: 'command', cmd: { kind: 'toggle-play' } })
    expect(mocks.ownershipPost).toHaveBeenCalledWith({ type: 'command', cmd: { kind: 'play-at', itemId: 'b' } })

    const takingOver = playbackSession.takeOver()
    await flushPlaybackStart()
    expect(mocks.ensureOwner).toHaveBeenCalledOnce()
    expect(mocks.play).toHaveBeenCalledWith({
      kind: 'uris',
      uris: ['provider:track:track-a', 'provider:track:track-b'],
    })
    await finishPlayback(takingOver)
    expect(playbackSession.getSnapshot()).toMatchObject({ isOwner: true, currentItemId: 'a', playing: true })
  })

  it('forwards a drop-start to a present owner whose rung is not yet known', async () => {
    // The state that made this worth a test: `advance()` resets `rung` to null when
    // the queue empties, so an owner that has played and stopped advertises
    // ownerRung === null. A forward gated on rung === 'remote' drops the command
    // here, and the dropped row then plays in neither tab.
    setQueue([])
    setOwnership({ isOwner: false, ownerTabId: 'owner-tab', ownerPresent: true })
    expect(playbackSession.getSnapshot().ownerRung).toBeNull()
    mocks.play.mockClear()
    mocks.ownershipPost.mockClear()

    setQueue([row('a')])
    await playbackSession.onDropped()

    expect(mocks.play).not.toHaveBeenCalled()
    expect(mocks.ownershipPost).toHaveBeenCalledWith({ type: 'command', cmd: { kind: 'play-at', itemId: 'a' } })
  })

  // ── where ownership meets the adoption that landed in #348 ─────────────────
  it('does not read live playback in a mirror — the owner is the only adopter', async () => {
    // Two tabs adopting independently are two writers over one state, each
    // overwriting the other with a slightly older read. The mirror gets the same
    // information from the owner's broadcast, so the read is not just redundant.
    setQueue([row('a')])
    setOwnership({ isOwner: false, ownerTabId: 'owner-tab', ownerPresent: true })
    mocks.readLivePlayback.mockClear()

    await playbackSession.syncFromLive()

    expect(mocks.readLivePlayback).not.toHaveBeenCalled()
  })

  it('still adopts when no tab owns playback', async () => {
    setQueue([row('a')])
    setOwnership({ isOwner: false, ownerTabId: null, ownerPresent: false })
    mocks.readLivePlayback.mockClear()

    await playbackSession.syncFromLive()

    expect(mocks.readLivePlayback).toHaveBeenCalledOnce()
  })

  it('carries external now-playing across the tab boundary', async () => {
    // Without `external` on the wire a mirror renders "nothing is playing" while
    // the owner shows a track — confidently wrong, which is worse than blank.
    setQueue([row('a')])
    mocks.cachedUri.mockReturnValue('spotify:track:SOMETHING-ELSE')
    mocks.readLivePlayback.mockResolvedValue({
      state: 'playing',
      trackId: 'SPOT-UNKNOWN',
      progressMs: 1_000,
      readAtMs: 10,
      durationMs: 200_000,
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
    await playbackSession.syncFromLive()

    const posted = mocks.ownershipPost.mock.calls
      .map(([m]) => m as { type: string, state?: { external?: unknown } })
      .filter(m => m.type === 'state')
      .at(-1)
    expect(posted?.state?.external).toMatchObject({ title: 'Paranoid Android', deviceName: '거실 스피커' })
  })

  it('takes the lease before ▶ replaces the queue, because ▶ can raise this tab as the device', async () => {
    setQueue([])
    albumTracks = { 'album-x': ['t1'] }
    setOwnership({ isOwner: false, ownerTabId: 'owner-tab', ownerPresent: true })
    mocks.ensureOwner.mockClear()

    const pending = playbackSession.replaceQueueAndPlay({ kind: 'album', albumId: 'album-x' })
    await settleAll()
    await pending

    expect(mocks.ensureOwner).toHaveBeenCalledOnce()
  })

  it('translates an owner anchor through epoch time into the mirror timeline', async () => {
    setQueue([row('a')])
    await startAt('a')
    const ownerAnchor = playbackSession.getSnapshot().anchor
    const statePosts = mocks.ownershipPost.mock.calls
      .map(([message]) => message as { type: string, state?: unknown })
      .filter(message => message.type === 'state')
    const payload = statePosts.at(-1)?.state as { anchor: { ms: number, anchorEpochMs: number } }
    expect(payload.anchor).toHaveProperty('anchorEpochMs')
    expect(payload.anchor).not.toHaveProperty('wallMs')

    await vi.advanceTimersByTimeAsync(37)
    const ownerElapsed = ownerAnchor ?
      ownerAnchor.ms + (performance.now() - ownerAnchor.wallMs) :
      0
    setOwnership({ isOwner: false, ownerTabId: 'owner-tab', ownerPresent: true })
    receiveOwnership({ type: 'state', from: 'owner-tab', state: payload })

    const mirrorAnchor = playbackSession.getSnapshot().anchor
    const mirrorElapsed = mirrorAnchor ?
      mirrorAnchor.ms + (performance.now() - mirrorAnchor.wallMs) :
      0
    expect(Math.abs(mirrorElapsed - ownerElapsed)).toBeLessThan(5)
  })
})
