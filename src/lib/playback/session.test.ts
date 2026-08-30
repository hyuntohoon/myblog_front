import type { BoardAlbum, BoardBucket } from '@lib/buckets'
import type { OwnershipMessage, PlaybackOwnershipState } from '@lib/playback/ownership'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bucketStore } from '@lib/pocketBuckit/bucketStore'
import { MYBLOG_PLAYBACK_CHANGED } from '@lib/spotifyPlayback'
import { playbackQueue } from './queue'
import { playbackSession } from './session'

const mocks = vi.hoisted(() => ({
  deleteBucketItem: vi.fn(),
  addBucketPlayback: vi.fn(),
  expandAlbumTracks: vi.fn(),
  listBuckets: vi.fn(),
  play: vi.fn(),
  sendPlayerCommand: vi.fn(),
  sendPlaybackMode: vi.fn(),
  getStreamingToken: vi.fn(),
  getTrackLiked: vi.fn(),
  setTrackLiked: vi.fn(),
  listDevices: vi.fn(),
  transferPlayback: vi.fn(),
  rememberSpotifyLibraryProbe: vi.fn(),
  rememberSpotifyTransportProbe: vi.fn(),
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
  sendPlaybackMode: mocks.sendPlaybackMode,
  getStreamingToken: mocks.getStreamingToken,
  getTrackLiked: mocks.getTrackLiked,
  setTrackLiked: mocks.setTrackLiked,
  listDevices: mocks.listDevices,
  transferPlayback: mocks.transferPlayback,
}))

vi.mock('@lib/spotifyCapability', () => ({
  rememberSpotifyLibraryProbe: mocks.rememberSpotifyLibraryProbe,
  rememberSpotifyTransportProbe: mocks.rememberSpotifyTransportProbe,
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
  mocks.resolveTail.mockImplementation(async (rows: Array<{ itemId: string, trackId: string }>) => ({
    resolved: rows.map(r => ({ ...r, uri: `provider:track:${r.trackId}` })),
    failed: [],
  }))
  mocks.prefetchUris.mockResolvedValue(undefined)
  mocks.cachedUri.mockImplementation((trackId: string) => `provider:track:${trackId}`)
  mocks.readLivePlayback.mockResolvedValue({ state: 'idle' })
  // Spotify acknowledges the write before the player applies it. Every playback
  // stub keeps that stale-read window alive; fake timers keep the suite fast.
  mocks.play.mockImplementation(() => new Promise(resolve => window.setTimeout(() => resolve(nextPlayOutcome), PLAYBACK_LAG_MS)))
  mocks.sendPlayerCommand.mockImplementation(() => new Promise(resolve => window.setTimeout(() => resolve({ ok: true }), PLAYBACK_LAG_MS)))
  mocks.sendPlaybackMode.mockResolvedValue({ ok: true })
  mocks.getStreamingToken.mockResolvedValue({ ok: true, token: 'tok', expiresAt: Date.now() + 60_000 })
  mocks.getTrackLiked.mockResolvedValue({ ok: true, liked: false })
  mocks.setTrackLiked.mockResolvedValue({ ok: true })
  mocks.listDevices.mockResolvedValue({ ok: true, devices: [] })
  mocks.transferPlayback.mockResolvedValue({ ok: true })
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

    // `onDropped` itself still never interrupts: the drop does not seize playback
    // and does not move the current row.
    expect(queueIds()).toEqual(['a', 'b'])
    expect(mocks.play).toHaveBeenCalledTimes(calls)
    expect(playbackSession.getSnapshot().currentItemId).toBe('a')

    // But the append IS a future-tail mutation, and since ARCH Step 2 (OQ1 (a))
    // those apply live. Draining the coalescing window is what separates the two
    // claims — without it this test would keep asserting "no play ever" and would
    // be passing by timing accident rather than by design.
    // (`unavailable` so the reissue's own confirmation read cannot fold the session
    // into `idle` and erase the state under assertion.)
    mocks.readLivePlayback.mockResolvedValue({ state: 'unavailable' })
    await vi.advanceTimersByTimeAsync(300 + PLAYBACK_LAG_MS)
    await vi.advanceTimersByTimeAsync(PLAYBACK_LAG_MS)
    if (mode === 'playing') {
      expect(mocks.play).toHaveBeenLastCalledWith({
        kind: 'uris',
        uris: ['provider:track:track-a', 'provider:track:track-b'],
      })
    }
    else {
      // Paused stays silent — the reissue is deferred to the next resume.
      expect(mocks.play).toHaveBeenCalledTimes(calls)
    }
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
      albumCoverUrl: null,
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

  it('forwards seek from a mirror and executes it only in the owner', async () => {
    mocks.readLivePlayback.mockResolvedValueOnce(liveTrack('SPOT-X', 'paused'))
    await playbackSession.syncFromLive()
    setOwnership({ isOwner: false, ownerTabId: 'owner-tab', ownerPresent: true })
    mocks.sendPlayerCommand.mockClear()
    mocks.ownershipPost.mockClear()

    await playbackSession.seekTo(32_100)

    expect(mocks.sendPlayerCommand).not.toHaveBeenCalled()
    expect(mocks.ownershipPost).toHaveBeenCalledWith({
      type: 'command',
      cmd: { kind: 'seek', positionMs: 32_100 },
    })

    setOwnership({ isOwner: true, ownerTabId: 'test-tab', ownerPresent: true })
    receiveOwnership({ type: 'command', from: 'mirror-tab', cmd: { kind: 'seek', positionMs: 47_000 } })
    await vi.advanceTimersByTimeAsync(PLAYBACK_LAG_MS)

    expect(mocks.sendPlayerCommand).toHaveBeenCalledWith({ kind: 'seek', positionMs: 47_000 })
    expect(playbackSession.getSnapshot().anchor?.ms).toBe(47_000)
  })

  it('blocks an in-page mirror until takeover, then MOVES the audio here before taking the lease', async () => {
    nextPlayOutcome = IN_PAGE_OK
    setQueue([row('a'), row('b')])
    await startAt('a')
    setOwnership({ isOwner: false, ownerTabId: 'owner-tab', ownerPresent: true })
    expect(playbackSession.getSnapshot().ownerRung).toBe('in-page')
    mocks.play.mockClear()
    mocks.sendPlayerCommand.mockClear()
    mocks.ownershipPost.mockClear()
    mocks.ensureOwner.mockClear()

    await playbackSession.togglePlay()
    await playbackSession.playAt('b')

    // The invariant is that a mirror never produces sound itself — never that it
    // stays silent. Asking the tab that already holds the SDK device to act is
    // exactly what ownership is for, so the presses are forwarded, not dropped.
    expect(mocks.play).not.toHaveBeenCalled()
    expect(mocks.sendPlayerCommand).not.toHaveBeenCalled()
    expect(mocks.ownershipPost).toHaveBeenCalledWith({ type: 'command', cmd: { kind: 'toggle-play' } })
    expect(mocks.ownershipPost).toHaveBeenCalledWith({ type: 'command', cmd: { kind: 'play-at', itemId: 'b' } })

    mocks.readLivePlayback.mockResolvedValue({ ...liveTrack('SPOT-A'), progressMs: 61_000 })
    mocks.cachedUri.mockImplementation((t: string) => (t === 'track-a' ? 'spotify:track:SPOT-A' : null))
    await playbackSession.takeOver()

    // ARCH-playback-authority-convergence Step 2. The banner that offers this
    // action renders ONLY while the owner holds the in-page device, so this is the
    // common case, not the exotic one: the sound is inside the other TAB and has to
    // come here. A device transfer is what moves it — re-issuing our tail would
    // send a `play` with no `device_id`, which targets the active Connect device,
    // i.e. the very tab being deposed.
    expect(mocks.transferPlayback).toHaveBeenCalledWith('', { raiseInPageFirst: true })
    expect(mocks.play).not.toHaveBeenCalled()
    // And the lease follows the move rather than preceding it.
    expect(mocks.ensureOwner).toHaveBeenCalledOnce()
    expect(playbackSession.getSnapshot().isOwner).toBe(true)
  })

  it('keeps the playhead, and never forwards its restore to the tab being deposed', async () => {
    nextPlayOutcome = IN_PAGE_OK
    setQueue([row('a'), row('b')])
    await startAt('a')
    setOwnership({ isOwner: false, ownerTabId: 'owner-tab', ownerPresent: true })
    mocks.sendPlayerCommand.mockClear()
    mocks.ownershipPost.mockClear()
    mocks.readLivePlayback.mockResolvedValue({ ...liveTrack('SPOT-A'), progressMs: 61_000 })
    mocks.cachedUri.mockImplementation((t: string) => (t === 'track-a' ? 'spotify:track:SPOT-A' : null))

    await playbackSession.takeOver()

    // A transfer carries the context and the playhead with it, so there is nothing
    // to seek. The shape this pins is the one a reissue-based takeover produced:
    // `seekTo` is ownership-gated, and running it while this tab is still a mirror
    // POSTS the position to the outgoing owner — which then drops it, because
    // `executeCommand` refuses to act once it is no longer the owner. The member's
    // track silently restarted at 0:00 and the progress bar believed it.
    expect(mocks.ownershipPost).not.toHaveBeenCalledWith(
      expect.objectContaining({ cmd: expect.objectContaining({ kind: 'seek' }) }),
    )
    expect(mocks.sendPlayerCommand).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'seek' }))
    expect(playbackSession.getSnapshot().anchor?.ms).toBe(61_000)
  })

  it('leaves the previous owner in place when the takeover transfer fails', async () => {
    nextPlayOutcome = IN_PAGE_OK
    setQueue([row('a'), row('b')])
    await startAt('a')
    setOwnership({ isOwner: false, ownerTabId: 'owner-tab', ownerPresent: true })
    mocks.ensureOwner.mockClear()
    mocks.transferPlayback.mockResolvedValueOnce({ ok: false, reason: 'transient' })

    await playbackSession.takeOver()

    expect(mocks.ensureOwner).not.toHaveBeenCalled()
    expect(playbackSession.getSnapshot().isOwner).toBe(false)
    expect(playbackSession.getSnapshot().notice).toMatchObject({ tone: 'error' })
  })

  it('does not drag Connect playback into this tab — only the lease moves', async () => {
    // `ownerRung` stays 'remote': the sound is on a speaker or a phone, so it
    // belongs to the account rather than to any tab.
    setQueue([row('a'), row('b')])
    await startAt('a')
    setOwnership({ isOwner: false, ownerTabId: 'owner-tab', ownerPresent: true })
    expect(playbackSession.getSnapshot().ownerRung).toBe('remote')
    mocks.ensureOwner.mockClear()
    mocks.play.mockClear()
    mocks.readLivePlayback.mockResolvedValue({ ...liveTrack('SPOT-A'), progressMs: 5_000 })
    mocks.cachedUri.mockImplementation((t: string) => (t === 'track-a' ? 'spotify:track:SPOT-A' : null))

    await playbackSession.takeOver()

    // Raising a quality-limited browser device, or re-issuing the live track as a
    // one-URI list (which would discard the album context), would each take
    // something away to gain nothing.
    expect(mocks.transferPlayback).not.toHaveBeenCalled()
    expect(mocks.play).not.toHaveBeenCalled()
    expect(mocks.ensureOwner).toHaveBeenCalledOnce()
    expect(playbackSession.getSnapshot().isOwner).toBe(true)
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
      albumCoverUrl: 'https://example.com/ok-computer.jpg',
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
    expect(posted?.state?.external).toMatchObject({
      title: 'Paranoid Android',
      albumCoverUrl: 'https://example.com/ok-computer.jpg',
      deviceName: '거실 스피커',
    })
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

describe('session-owned seek', () => {
  it('drains the real pre-authoritative event read before starting a fresh playing confirmation', async () => {
    mocks.readLivePlayback.mockResolvedValueOnce(liveTrack('SPOT-X'))
    await playbackSession.syncFromLive()
    mocks.readLivePlayback.mockClear()

    let resolvePreAckRead!: (value: ReturnType<typeof liveTrack>) => void
    const preAckRead = new Promise<ReturnType<typeof liveTrack>>((resolve) => {
      resolvePreAckRead = resolve
    })
    let resolveConfirmation!: (value: ReturnType<typeof liveTrack>) => void
    const confirmation = new Promise<ReturnType<typeof liveTrack>>((resolve) => {
      resolveConfirmation = resolve
    })
    mocks.readLivePlayback
      .mockReturnValueOnce(preAckRead)
      .mockReturnValueOnce(confirmation)
    // Production ordering: the successful command dispatches the event before
    // its promise resolves back to playbackSession.seekTo().
    mocks.sendPlayerCommand.mockImplementationOnce(async () => {
      window.dispatchEvent(new CustomEvent(MYBLOG_PLAYBACK_CHANGED))
      return { ok: true }
    })

    const pending = playbackSession.seekTo(90_000)
    await flushPlaybackStart()

    expect(playbackSession.getSnapshot().anchor?.ms).toBe(90_000)
    expect(mocks.readLivePlayback).toHaveBeenCalledOnce()

    // The pre-ack read says the old position. It must be discarded and merely
    // unlock the genuinely fresh confirmation read.
    resolvePreAckRead({ ...liveTrack('SPOT-X'), progressMs: 12_000 })
    await vi.waitFor(() => expect(mocks.readLivePlayback).toHaveBeenCalledTimes(2))
    expect(playbackSession.getSnapshot().anchor?.ms).toBe(90_000)

    resolveConfirmation({ ...liveTrack('SPOT-X'), progressMs: 91_250 })
    await pending
    expect(playbackSession.getSnapshot().anchor).toEqual({ ms: 91_250, wallMs: 1_000 })
  })

  it('re-anchors optimistically before a playing confirmation resolves', async () => {
    mocks.readLivePlayback.mockResolvedValueOnce(liveTrack('SPOT-X'))
    await playbackSession.syncFromLive()
    mocks.readLivePlayback.mockClear()

    let resolveConfirmation!: (value: ReturnType<typeof liveTrack>) => void
    mocks.readLivePlayback.mockReturnValueOnce(new Promise((resolve) => {
      resolveConfirmation = resolve
    }))

    const pending = playbackSession.seekTo(90_000)
    await vi.advanceTimersByTimeAsync(PLAYBACK_LAG_MS)

    expect(playbackSession.getSnapshot().anchor?.ms).toBe(90_000)
    expect(mocks.readLivePlayback).toHaveBeenCalledOnce()

    resolveConfirmation({ ...liveTrack('SPOT-X'), progressMs: 91_250 })
    await pending
    expect(playbackSession.getSnapshot().anchor).toEqual({ ms: 91_250, wallMs: 1_000 })
  })

  it('keeps the optimistic paused anchor exact without a confirmation read', async () => {
    mocks.readLivePlayback.mockResolvedValueOnce(liveTrack('SPOT-X', 'paused'))
    await playbackSession.syncFromLive()
    mocks.readLivePlayback.mockClear()

    const pending = playbackSession.seekTo(75_432.4)
    await vi.advanceTimersByTimeAsync(PLAYBACK_LAG_MS)
    await pending

    expect(playbackSession.getSnapshot().anchor?.ms).toBe(75_432)
    expect(playbackSession.getSnapshot().playing).toBe(false)
    expect(mocks.readLivePlayback).not.toHaveBeenCalled()
  })

  it('discards a stale confirmation read after a newer authoritative write', async () => {
    mocks.readLivePlayback.mockResolvedValueOnce(liveTrack('SPOT-X'))
    await playbackSession.syncFromLive()

    let resolveConfirmation!: (value: ReturnType<typeof liveTrack>) => void
    mocks.readLivePlayback.mockReturnValueOnce(new Promise((resolve) => {
      resolveConfirmation = resolve
    }))
    const pending = playbackSession.seekTo(80_000)
    await vi.advanceTimersByTimeAsync(PLAYBACK_LAG_MS)
    expect(playbackSession.getSnapshot().anchor?.ms).toBe(80_000)

    await playbackSession.setMode({ kind: 'shuffle', on: true })
    resolveConfirmation({ ...liveTrack('SPOT-X'), progressMs: 12_000 })
    await pending

    expect(playbackSession.getSnapshot().anchor?.ms).toBe(80_000)
    expect(playbackSession.getSnapshot().shuffle).toBe(true)
  })
})

describe('session-owned playback experience axes', () => {
  it('re-resolves capability after a settled transient failure while sharing only overlapping calls', async () => {
    let resolveFirst!: (value: { ok: false, status: 'error' }) => void
    mocks.getStreamingToken.mockReturnValueOnce(new Promise((resolve) => {
      resolveFirst = resolve
    }))

    const first = playbackSession.resolveCapability()
    const overlapping = playbackSession.resolveCapability()
    expect(mocks.getStreamingToken).toHaveBeenCalledOnce()
    resolveFirst({ ok: false, status: 'error' })
    await Promise.all([first, overlapping])
    expect(playbackSession.getSnapshot().capabilityTier).toBe('fallback')

    mocks.getStreamingToken.mockResolvedValueOnce({ ok: true, token: 'tok', expiresAt: Date.now() + 60_000 })
    await playbackSession.resolveCapability()
    expect(mocks.getStreamingToken).toHaveBeenCalledTimes(2)
    expect(playbackSession.getSnapshot().capabilityTier).toBe('full')
  })

  it('publishes an optimistic shuffle change directly from setMode', async () => {
    let resolveMode!: (value: { ok: true }) => void
    mocks.sendPlaybackMode.mockReturnValueOnce(new Promise((resolve) => {
      resolveMode = resolve
    }))

    const pending = playbackSession.setMode({ kind: 'shuffle', on: true })
    expect(playbackSession.getSnapshot().shuffle).toBe(true)
    expect(mocks.readLivePlayback).not.toHaveBeenCalled()

    resolveMode({ ok: true })
    await pending
    expect(playbackSession.getSnapshot().shuffle).toBe(true)
  })

  it('rolls unsupported volume back to its exact pre-write value', async () => {
    mocks.readLivePlayback.mockResolvedValue({ ...liveTrack('SPOT-X'), volumePercent: 37 })
    await playbackSession.syncFromLive()
    mocks.sendPlaybackMode.mockResolvedValueOnce({ ok: false, reason: 'unsupported-on-device' })

    await playbackSession.setMode({ kind: 'volume', percent: 80 })

    expect(playbackSession.getSnapshot().volumePercent).toBe(37)
    expect(mocks.rememberSpotifyTransportProbe).not.toHaveBeenCalled()
  })

  it('publishes the active device immediately after a successful transfer', async () => {
    mocks.listDevices.mockResolvedValueOnce({
      ok: true,
      devices: [
        { id: 'phone', name: 'Phone', type: 'Smartphone', isActive: true, isInPage: false },
        { id: 'speaker', name: 'Speaker', type: 'Speaker', isActive: false, isInPage: false },
      ],
    })
    await playbackSession.refreshDevices()

    await playbackSession.transferTo('speaker')

    expect(playbackSession.getSnapshot().activeDeviceId).toBe('speaker')
    expect(playbackSession.getSnapshot().devices?.find(device => device.id === 'speaker')?.isActive).toBe(true)
  })
})

// ── ARCH-playback-authority-convergence Step 1 ──────────────────────────────
// The session is now the ONLY writer of playback truth, so these are its
// regressions rather than the lyrics viewer's. Each one is a bug that shipped.
describe('reconciliation the session owns', () => {
  /** Identity matching is cache-only; the default harness prefix deliberately never matches. */
  function matchQueueRowsToLiveTracks(): void {
    mocks.cachedUri.mockImplementation((trackId: string) => `spotify:track:${trackId}`)
  }

  /** Past the end of a 180s row plus the boundary buffer, with room for one burst gap. */
  const PAST_BOUNDARY_MS = 180_000 + 1_500 + 100

  /**
   * Answer reads in order, each stamped with the CURRENT wall instant.
   *
   * `liveTrack`'s fixed `readAtMs` is fine for tests that never move the clock, and
   * wrong for these: the session ages its anchor by `performance.now() - wallMs` to
   * decide when the next boundary is, so a wall instant from 180 seconds of fake
   * time ago makes it think every track is already over and re-arm instantly.
   */
  function answerReads(...reads: Array<ReturnType<typeof liveTrack>>): void {
    let i = 0
    mocks.readLivePlayback.mockImplementation(async () => {
      const r = reads[Math.min(i, reads.length - 1)]
      i += 1
      return { ...r, readAtMs: performance.now() }
    })
  }

  it('keeps asking at a natural boundary until Spotify stops naming the old track', async () => {
    matchQueueRowsToLiveTracks()
    setQueue([row('a'), row('b')])
    await startAt('a')
    mocks.readLivePlayback.mockClear()
    // The race the single read used to lose: Connect still answers with the track
    // that just ended, and that stale answer is indistinguishable from a real
    // same-track read — so the one-shot re-anchored to the finished track and
    // nothing ever asked again.
    answerReads(
      { ...liveTrack('track-a'), progressMs: 180_000 },
      { ...liveTrack('track-b'), progressMs: 900 },
    )

    await vi.advanceTimersByTimeAsync(PAST_BOUNDARY_MS + 600)

    expect(mocks.readLivePlayback.mock.calls.length).toBeGreaterThan(1)
    expect(playbackSession.getSnapshot().currentItemId).toBe('b')
  })

  it('treats a same-track restart near zero as a new epoch (repeat-one)', async () => {
    matchQueueRowsToLiveTracks()
    setQueue([row('a')])
    await startAt('a')
    mocks.readLivePlayback.mockClear()
    // Repeat `track`: identity never changes, so nothing but the rewound playhead
    // says the song started again.
    answerReads({ ...liveTrack('track-a'), progressMs: 400 })

    // Well past the first burst GAP as well as the boundary: a restart that is not
    // recognised as an answer keeps retrying, and this window is what makes the
    // call-count assertion below able to see that. (It could not, at first — the
    // window ended 100ms after the boundary, so a non-settling burst still managed
    // exactly one read and the test passed against a mutant that had the epoch
    // rule deleted.)
    await vi.advanceTimersByTimeAsync(PAST_BOUNDARY_MS + 2_000)

    expect(playbackSession.getSnapshot().anchor?.ms).toBe(400)
    // Settled on the FIRST read — a restart is an answer, not a reason to retry.
    expect(mocks.readLivePlayback).toHaveBeenCalledTimes(1)
  })

  it('spends one more read after a burst so the LAST change is never the dropped one', async () => {
    const pending: Array<(value: unknown) => void> = []
    mocks.readLivePlayback.mockImplementation(() => new Promise((resolve) => {
      pending.push(resolve)
    }))

    // A → ⏭ B → ⏭ C, all inside one round trip.
    window.dispatchEvent(new CustomEvent(MYBLOG_PLAYBACK_CHANGED))
    window.dispatchEvent(new CustomEvent(MYBLOG_PLAYBACK_CHANGED))
    window.dispatchEvent(new CustomEvent(MYBLOG_PLAYBACK_CHANGED))
    expect(pending).toHaveLength(1)

    pending[0](liveTrack('track-a'))
    await vi.advanceTimersByTimeAsync(0)

    // The trailing read — the whole point. Without it the session settles on A.
    expect(pending).toHaveLength(2)
    pending[1](liveTrack('track-c'))
    await vi.advanceTimersByTimeAsync(0)

    expect(playbackSession.getSnapshot().external?.spotifyTrackId).toBe('track-c')
  })
})

describe('identity follows what actually started', () => {
  // The bug: `resolveTail` filtered unresolvable rows out of a bare string[], so a
  // head with no Spotify id made Spotify start at row 2 while the session recorded
  // row 1 as current — audio and identity disagreeing from the first note, with
  // nothing anywhere able to notice.
  it('adopts the first PLAYABLE row when the pressed row cannot be resolved', async () => {
    setQueue([row('a'), row('b'), row('c')])
    mocks.resolveTail.mockImplementation(async (rows: Array<{ itemId: string, trackId: string }>) => ({
      resolved: rows.filter(r => r.itemId !== 'a').map(r => ({ ...r, uri: `provider:track:${r.trackId}` })),
      failed: rows.filter(r => r.itemId === 'a'),
    }))

    await startAt('a')

    expect(mocks.play).toHaveBeenCalledWith({
      kind: 'uris',
      uris: ['provider:track:track-b', 'provider:track:track-c'],
    })
    expect(playbackSession.getSnapshot().currentItemId).toBe('b')
    // And it SAYS so — a skipped row must not be a mysterious one.
    expect(playbackSession.getSnapshot().notice?.message).toContain('재생할 수 없어')
  })

  it('still names the pressed row when everything resolves', async () => {
    setQueue([row('a'), row('b')])

    await startAt('a')

    expect(playbackSession.getSnapshot().currentItemId).toBe('a')
    expect(playbackSession.getSnapshot().notice).toBeNull()
  })
})

describe('spotify queue jump', () => {
  const items = [
    { id: 'now', uri: 'spotify:track:now', name: 'Now', artist: null },
    { id: 'target', uri: 'spotify:track:target', name: 'Target', artist: null },
  ]

  it('reports the jump once Spotify names the target track', async () => {
    mocks.readLivePlayback.mockResolvedValue(liveTrack('target'))

    const pending = playbackSession.jumpToSpotifyQueue(items, 1, null)
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(pending).resolves.toEqual({ ok: true })
    expect(mocks.play).toHaveBeenCalledWith({ kind: 'uris', uris: ['spotify:track:target'] })
  })

  // The bug this replaces: `confirmJump` discarded confirmTransport's boolean, so a
  // spent budget left the viewer showing the target track forever while Spotify
  // played something else.
  it('reconciles to what is really playing when the confirmation budget runs out', async () => {
    mocks.readLivePlayback.mockResolvedValue(liveTrack('now'))

    const pending = playbackSession.jumpToSpotifyQueue(items, 1, null)
    await vi.advanceTimersByTimeAsync(10_000)

    await expect(pending).resolves.toEqual({ ok: false, reason: 'unconfirmed' })
    // Not left on the optimistic target — the session believes the truth.
    expect(playbackSession.getSnapshot().external?.spotifyTrackId).toBe('now')
    expect(playbackSession.getSnapshot().notice?.message).toContain('넘어가지 못했어요')
  })

  // Found by the Step 1 browser clickthrough, not by this suite: on a cold start
  // (`NO_ACTIVE_DEVICE`) the ladder falls to rung 2 and raises THIS tab as the SDK
  // device, but `JumpOutcome` dropped `rung`/`degraded` on the floor. The session
  // therefore stayed on `rung: null` — no 음질 제한 notice, and every mirror tab
  // read `ownerRung: null` and kept a live transport over audio it does not hold.
  it('adopts the rung the jump actually landed on, so mirrors see the in-page owner', async () => {
    nextPlayOutcome = IN_PAGE_OK
    mocks.readLivePlayback.mockResolvedValue(liveTrack('target'))

    const pending = playbackSession.jumpToSpotifyQueue(items, 1, null)
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(pending).resolves.toEqual({ ok: true })

    expect(playbackSession.getSnapshot().rung).toBe('in-page')
    expect(playbackSession.getSnapshot().degraded).toBe(true)
    expect(playbackSession.getSnapshot().notice?.message).toContain('음질 제한')

    // The half of the gate the RFC's A3 is about: a mirror of this owner must be
    // told the audio is inside another tab.
    setOwnership({ isOwner: false, ownerTabId: 'owner-tab', ownerPresent: true })
    expect(playbackSession.getSnapshot().ownerRung).toBe('in-page')
  })

  it('leaves a remote jump undegraded and mirrors in control', async () => {
    nextPlayOutcome = OK
    mocks.readLivePlayback.mockResolvedValue(liveTrack('target'))

    const pending = playbackSession.jumpToSpotifyQueue(items, 1, null)
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(pending).resolves.toEqual({ ok: true })

    expect(playbackSession.getSnapshot().rung).toBe('remote')
    expect(playbackSession.getSnapshot().degraded).toBe(false)
    expect(playbackSession.getSnapshot().notice).toBeNull()
  })

  it('forwards to the owning tab instead of acting from a mirror', async () => {
    setOwnership({ isOwner: false, ownerTabId: 'other-tab', ownerPresent: true })

    await expect(playbackSession.jumpToSpotifyQueue(items, 1, null)).resolves.toEqual({ ok: false, reason: 'forwarded' })

    expect(mocks.play).not.toHaveBeenCalled()
    expect(mocks.ownershipPost).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command', cmd: expect.objectContaining({ kind: 'queue-jump', index: 1 }) }),
    )
  })
})

describe('every mutation passes the same ownership gate', () => {
  beforeEach(() => {
    setOwnership({ isOwner: false, ownerTabId: 'other-tab', ownerPresent: true })
  })

  it('forwards shuffle/repeat/volume rather than writing from a mirror', async () => {
    await expect(playbackSession.setMode({ kind: 'volume', percent: 70 })).resolves.toBeNull()

    expect(mocks.sendPlaybackMode).not.toHaveBeenCalled()
    expect(mocks.ownershipPost).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command', cmd: { kind: 'mode', cmd: { kind: 'volume', percent: 70 } } }),
    )
  })

  it('forwards a device transfer rather than moving playback from a mirror', async () => {
    await playbackSession.transferTo('speaker')

    expect(mocks.transferPlayback).not.toHaveBeenCalled()
    expect(mocks.ownershipPost).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command', cmd: { kind: 'transfer', deviceId: 'speaker' } }),
    )
  })

  // "이 브라우저" raises an SDK device in THIS tab, so forwarding it would raise the
  // wrong one. It claims the lease instead — which is what stops a mirror ending up
  // as a second SDK device while the lease sits elsewhere.
  it('claims the lease before raising this tab as the in-page device', async () => {
    await playbackSession.transferTo('', { raiseInPageFirst: true })

    expect(mocks.ensureOwner).toHaveBeenCalled()
    expect(mocks.transferPlayback).toHaveBeenCalledWith('', { raiseInPageFirst: true })
    expect(playbackSession.getSnapshot().isOwner).toBe(true)
  })

  it('does not raise a device when the lease cannot be taken', async () => {
    mocks.ensureOwner.mockResolvedValueOnce(false)

    await expect(playbackSession.transferTo('', { raiseInPageFirst: true })).resolves.toMatchObject({ ok: false })
    expect(mocks.transferPlayback).not.toHaveBeenCalled()
  })
})

// ── ARCH-playback-authority-convergence Step 2 ────────────────────────────────
// One invariant, asserted the same way in every case below: the URI list Spotify
// was last told to execute equals the visible order from the current row onward.
// Asserting the ISSUED LIST rather than "a play happened" is the point — the whole
// defect class was a session that believed an order it had never sent.
describe('queue execution invariant', () => {
  const REISSUE_MS = 300

  /** The `uris` of the most recent `play()` — what Spotify is actually executing. */
  function issuedUris(): string[] | null {
    const calls = mocks.play.mock.calls
    const last = calls[calls.length - 1]?.[0]
    return last && last.kind === 'uris' ? last.uris : null
  }

  /** The visible order from the current row onward, as URIs. */
  function visibleFromCurrent(): string[] {
    const items = playbackQueue().items
    const i = items.findIndex(item => item.itemId === playbackSession.getSnapshot().currentItemId)
    return items.slice(i < 0 ? 0 : i).map(item => `provider:track:${item.trackId}`)
  }

  function expectInvariant(): void {
    expect(issuedUris()).toEqual(visibleFromCurrent())
  }

  /** Let the coalescing window close and the reissue's own round trip land. */
  async function settleReissue(): Promise<void> {
    await vi.advanceTimersByTimeAsync(REISSUE_MS + PLAYBACK_LAG_MS)
    await vi.advanceTimersByTimeAsync(PLAYBACK_LAG_MS)
  }

  beforeEach(() => {
    // The reissue's `seekTo` performs a confirmation read while playing; leaving the
    // default `idle` in place would make adoption clear the current row and hide the
    // very state these tests assert.
    mocks.readLivePlayback.mockResolvedValue({ state: 'unavailable' })
  })

  it('reorders the future tail into the player, not just the screen (D1)', async () => {
    setQueue([row('a'), row('b'), row('c')])
    await startAt('a')
    expect(issuedUris()).toEqual(['provider:track:track-a', 'provider:track:track-b', 'provider:track:track-c'])
    mocks.play.mockClear()

    setQueue([row('a'), row('c'), row('b')])
    await settleReissue()

    expect(issuedUris()).toEqual(['provider:track:track-a', 'provider:track:track-c', 'provider:track:track-b'])
    expectInvariant()
  })

  it('restores the playhead across the reissue instead of restarting the track', async () => {
    setQueue([row('a'), row('b'), row('c')])
    mocks.cachedUri.mockImplementation((t: string) => (t === 'track-a' ? 'spotify:track:SPOT-A' : null))
    await startAt('a')
    // One live read so the session actually knows the track's duration; the assert
    // at the end is that the reissue does not throw that away.
    // `readAtMs` is an ABSOLUTE performance timestamp, and `liveTrack` pins it to
    // 1_000 — fine at the top of the file, order-dependent anywhere else, because
    // `positionNow()` then measures from the start of the whole run. Anchor it to
    // the clock this test is actually on.
    mocks.readLivePlayback.mockResolvedValueOnce({ ...liveTrack('SPOT-A'), progressMs: 0, readAtMs: performance.now() })
    await playbackSession.syncFromLive()
    expect(playbackSession.getSnapshot().durationMs).toBe(240_000)
    mocks.readLivePlayback.mockResolvedValue({ state: 'unavailable' })
    await vi.advanceTimersByTimeAsync(60_000)
    mocks.sendPlayerCommand.mockClear()

    setQueue([row('a'), row('c'), row('b')])
    await settleReissue()

    // Captured immediately before the write, so it is the coalescing window past
    // the mutation — early by the round trip, never late.
    expect(mocks.sendPlayerCommand).toHaveBeenCalledWith({ kind: 'seek', positionMs: 60_300 })
    expect(playbackSession.getSnapshot().anchor?.ms).toBe(60_300)
    // The track did not change, so the duration we already knew is still right —
    // nulling it (as a fresh `playFrom` does) would drop `adoptLive`'s completion
    // gate onto the row's coarser fallback at exactly the moment the playhead is
    // being restored near the end.
    expect(playbackSession.getSnapshot().durationMs).toBe(240_000)
  })

  it('sends a deleted future row out of the player (C2)', async () => {
    setQueue([row('a'), row('b'), row('c')])
    await startAt('a')
    mocks.play.mockClear()

    setQueue([row('a'), row('c')])
    await settleReissue()

    expect(issuedUris()).toEqual(['provider:track:track-a', 'provider:track:track-c'])
    expectInvariant()
  })

  it('sends an appended row out of the player while it is still playing', async () => {
    setQueue([row('a'), row('b')])
    await startAt('a')
    mocks.play.mockClear()

    setQueue([row('a'), row('b'), row('d')])
    await settleReissue()

    expect(issuedUris()).toEqual(['provider:track:track-a', 'provider:track:track-b', 'provider:track:track-d'])
    expectInvariant()
  })

  it('appends after the current row was originally LAST — the tail that did not exist when the play was issued', async () => {
    setQueue([row('a')])
    await startAt('a')
    expect(issuedUris()).toEqual(['provider:track:track-a'])
    mocks.play.mockClear()

    setQueue([row('a'), row('b')])
    await settleReissue()

    // Before this step the appended row was unreachable: Spotify's frozen list was
    // one track long and simply ended.
    expect(issuedUris()).toEqual(['provider:track:track-a', 'provider:track:track-b'])
    expectInvariant()
  })

  it('leaves the player alone when only rows BEFORE the current one change', async () => {
    setQueue([row('a'), row('b'), row('c')])
    await startAt('b')
    mocks.play.mockClear()

    setQueue([row('x'), row('a'), row('b'), row('c')])
    await settleReissue()

    // Nothing that plays next changed, so the member is charged no restart.
    expect(mocks.play).not.toHaveBeenCalled()
    expect(playbackSession.getSnapshot().currentItemId).toBe('b')
  })

  it('defers a reissue while PAUSED and pays it with the resume, in the visible order', async () => {
    setQueue([row('a'), row('b'), row('c')])
    await startAt('a')
    await vi.advanceTimersByTimeAsync(30_000)
    await finishPlayback(playbackSession.togglePlay())
    expect(playbackSession.getSnapshot().playing).toBe(false)
    mocks.play.mockClear()
    mocks.sendPlayerCommand.mockClear()

    setQueue([row('a'), row('c'), row('b')])
    await settleReissue()
    // Starting audio nobody asked for is the worse failure — nothing is issued yet.
    expect(mocks.play).not.toHaveBeenCalled()

    const resuming = playbackSession.togglePlay()
    // The resume pays for two round trips — the reissued play, then the seek that
    // puts the playhead back — so one lag is not enough to drain it.
    await vi.advanceTimersByTimeAsync(PLAYBACK_LAG_MS * 3)
    await resuming

    // The resume IS the reissue: no plain `play` transport command was needed.
    expect(mocks.sendPlayerCommand).not.toHaveBeenCalledWith({ kind: 'play' })
    expect(issuedUris()).toEqual(['provider:track:track-a', 'provider:track:track-c', 'provider:track:track-b'])
    expect(playbackSession.getSnapshot().playing).toBe(true)
    expectInvariant()
  })

  it('defers an APPEND made while paused too, and resumes into the grown tail', async () => {
    // Named separately from the reorder case above because the RFC's verification
    // list names it separately: an append is the mutation a member is most likely
    // to make with the music stopped, and it is also the one where "the row is
    // simply there when I press play" is the whole expectation.
    setQueue([row('a'), row('b')])
    await startAt('a')
    await finishPlayback(playbackSession.togglePlay())
    expect(playbackSession.getSnapshot().playing).toBe(false)
    mocks.play.mockClear()

    setQueue([row('a'), row('b'), row('d')])
    await settleReissue()
    expect(mocks.play).not.toHaveBeenCalled()

    const resuming = playbackSession.togglePlay()
    await vi.advanceTimersByTimeAsync(PLAYBACK_LAG_MS * 3)
    await resuming

    expect(issuedUris()).toEqual(['provider:track:track-a', 'provider:track:track-b', 'provider:track:track-d'])
    expect(playbackSession.getSnapshot().playing).toBe(true)
    expectInvariant()
  })

  it('coalesces a burst of edits into ONE reissue, so a drag costs one restart', async () => {
    setQueue([row('a'), row('b'), row('c'), row('d')])
    await startAt('a')
    mocks.play.mockClear()

    setQueue([row('a'), row('c'), row('b'), row('d')])
    await vi.advanceTimersByTimeAsync(50)
    setQueue([row('a'), row('c'), row('d'), row('b')])
    await vi.advanceTimersByTimeAsync(50)
    setQueue([row('a'), row('d'), row('c'), row('b')])
    await settleReissue()

    expect(mocks.play).toHaveBeenCalledTimes(1)
    expect(issuedUris()).toEqual([
      'provider:track:track-a',
      'provider:track:track-d',
      'provider:track:track-c',
      'provider:track:track-b',
    ])
    expectInvariant()
  })

  it('holds the invariant across a natural completion without reissuing for the finished row', async () => {
    setQueue([row('a'), row('b'), row('c')])
    await startAt('a')
    mocks.play.mockClear()

    await finishPlayback(playbackSession.onCompleted())
    await settleReissue()

    // The completion's own DELETE is a store write like any other. It must NOT read
    // as a member edit: the advance already issued the correct list, and a second
    // reissue on top of it would be an audible restart of the track that just began.
    expect(mocks.play).toHaveBeenCalledTimes(1)
    expect(playbackSession.getSnapshot().currentItemId).toBe('b')
    expect(issuedUris()).toEqual(['provider:track:track-b', 'provider:track:track-c'])
    expectInvariant()
  })

  it('holds the invariant when the CURRENT row is deleted', async () => {
    setQueue([row('a'), row('b'), row('c')])
    await startAt('a')
    mocks.play.mockClear()

    const removing = playbackSession.onRemoved('a')
    await flushPlaybackStart()
    await finishPlayback(removing)
    await settleReissue()

    expect(playbackSession.getSnapshot().currentItemId).toBe('b')
    expect(issuedUris()).toEqual(['provider:track:track-b', 'provider:track:track-c'])
    expectInvariant()
  })

  it('keeps duplicate tracks distinct by ROW, so reordering one occurrence moves only it (D8)', async () => {
    const dupe = { ...row('b'), trackId: 'track-a' }
    setQueue([row('a'), dupe, row('c')])
    await startAt('a')
    mocks.play.mockClear()

    setQueue([row('a'), row('c'), dupe])
    await settleReissue()

    expect(issuedUris()).toEqual(['provider:track:track-a', 'provider:track:track-c', 'provider:track:track-a'])
    expectInvariant()
  })

  it('keeps a pending reissue owed across a track change we did not issue', async () => {
    setQueue([row('a'), row('b'), row('c')])
    mocks.cachedUri.mockImplementation((t: string) =>
      t === 'track-a' ? 'spotify:track:SPOT-A' : t === 'track-b' ? 'spotify:track:SPOT-B' : null)
    await startAt('a')
    mocks.play.mockClear()

    // The member appends a row, then — inside the coalescing window, before the
    // reissue goes out — skips from their phone. The row changes without any play
    // of ours, so Spotify is still executing the list issued for the OLD row: the
    // append is still owed, and re-basing the signature on the row change alone
    // would quietly write the debt off and strand the appended track forever.
    setQueue([row('a'), row('b'), row('c'), row('d')])
    await vi.advanceTimersByTimeAsync(100)
    mocks.readLivePlayback.mockResolvedValue({ ...liveTrack('SPOT-B'), progressMs: 3_000 })
    await playbackSession.syncFromLive()
    expect(playbackSession.getSnapshot().currentItemId).toBe('b')

    await settleReissue()

    expect(issuedUris()).toEqual(['provider:track:track-b', 'provider:track:track-c', 'provider:track:track-d'])
    expectInvariant()
  })

  it('keeps a FAILED reissue owed, so a later track change cannot write it off', async () => {
    setQueue([row('a'), row('b'), row('c'), row('d')])
    mocks.cachedUri.mockImplementation((t: string) =>
      t === 'track-a' ? 'spotify:track:SPOT-A' : t === 'track-b' ? 'spotify:track:SPOT-B' : null)
    await startAt('a')

    nextPlayOutcome = FAILURE
    setQueue([row('a'), row('c'), row('b'), row('d')])
    await settleReissue()
    expect(playbackSession.getSnapshot().notice).toMatchObject({ tone: 'error' })
    nextPlayOutcome = OK
    mocks.play.mockClear()

    // Spotify advances on its own — no play of ours, so its frozen list is still
    // the pre-reorder one and the debt is still real.
    mocks.readLivePlayback.mockResolvedValue({ ...liveTrack('SPOT-B'), progressMs: 3_000 })
    await playbackSession.syncFromLive()
    expect(playbackSession.getSnapshot().currentItemId).toBe('b')

    // Now an edit that touches only a row the member has ALREADY heard. It cannot
    // change what plays next, so it is invisible to a signature that was re-based
    // at the track change — and that is the whole point: if the failure had cleared
    // the debt, `patch` would have re-based here, this write would compare equal,
    // and the member's reorder would be lost with the error notice long since
    // replaced. The debt standing is what makes this reissue.
    setQueue([row('c'), row('b'), row('d')])
    await settleReissue()
    expect(issuedUris()).toEqual(['provider:track:track-b', 'provider:track:track-d'])
    expectInvariant()
  })

  it('does not trust, after promotion, the baseline it kept while a mirror', async () => {
    setQueue([row('a'), row('b'), row('c')])
    await startAt('a')
    setOwnership({ isOwner: false, ownerTabId: 'owner-tab', ownerPresent: true })
    mocks.play.mockClear()

    // As a mirror this tab watched an edit go by and kept its baseline level with
    // it — it never writes playback, and it has no way to learn what the OWNER
    // actually issued.
    setQueue([row('a'), row('c'), row('b')])
    await settleReissue()
    expect(mocks.play).not.toHaveBeenCalled()

    // The owner tab goes away and this one is promoted.
    setOwnership({ isOwner: true, ownerTabId: 'test-tab', ownerPresent: true })

    // A write that leaves the visible order exactly where the mirror last saw it —
    // a revalidate, or an edit to a row already heard. Carrying the mirror-era
    // baseline forward makes this compare EQUAL and issue nothing, leaving Spotify
    // executing whatever the dead tab left behind with nothing tracking the
    // divergence. The baseline a mirror kept is a guess, not a fact: it never wrote
    // playback and never learned what the owner actually issued.
    setQueue([row('a'), row('c'), row('b')])
    await settleReissue()

    expect(issuedUris()).toEqual(['provider:track:track-a', 'provider:track:track-c', 'provider:track:track-b'])
    expectInvariant()
  })

  it('does not let a transient un-anchoring write off a debt owed while paused', async () => {
    setQueue([row('a'), row('b'), row('c')])
    mocks.cachedUri.mockImplementation((t: string) => (t === 'track-a' ? 'spotify:track:SPOT-A' : null))
    await startAt('a')
    await finishPlayback(playbackSession.togglePlay())
    expect(playbackSession.getSnapshot().playing).toBe(false)

    // Edited while paused → owed, not issued.
    setQueue([row('a'), row('c'), row('b')])
    await settleReissue()
    mocks.play.mockClear()

    // A live read that matches no row un-anchors the session. A store write landing
    // in that window sees a null signature — and must not take it as licence to
    // forget what the member did, because the row comes straight back.
    mocks.readLivePlayback.mockResolvedValue({ ...liveTrack('SPOT-ELSEWHERE', 'paused'), progressMs: 1_000 })
    await playbackSession.syncFromLive()
    expect(playbackSession.getSnapshot().currentItemId).toBeNull()
    setQueue([row('a'), row('c'), row('b'), row('d')])
    await settleReissue()

    mocks.readLivePlayback.mockResolvedValue({ ...liveTrack('SPOT-A', 'paused'), progressMs: 1_000 })
    await playbackSession.syncFromLive()
    expect(playbackSession.getSnapshot().currentItemId).toBe('a')

    const resuming = playbackSession.togglePlay()
    await vi.advanceTimersByTimeAsync(PLAYBACK_LAG_MS * 3)
    await resuming

    expect(issuedUris()).toEqual([
      'provider:track:track-a',
      'provider:track:track-c',
      'provider:track:track-b',
      'provider:track:track-d',
    ])
    expectInvariant()
  })

  it('never reissues from a MIRROR — only the owner writes playback', async () => {
    setQueue([row('a'), row('b'), row('c')])
    await startAt('a')
    setOwnership({ isOwner: false, ownerTabId: 'owner-tab', ownerPresent: true })
    mocks.play.mockClear()

    setQueue([row('a'), row('c'), row('b')])
    await settleReissue()

    expect(mocks.play).not.toHaveBeenCalled()
  })

  it('does not reissue for a queue edit while playback is EXTERNAL', async () => {
    setQueue([row('a'), row('b')])
    mocks.readLivePlayback.mockResolvedValue(liveTrack('SPOT-OUTSIDE'))
    mocks.cachedUri.mockImplementation(() => 'provider:track:something-else')
    await playbackSession.syncFromLive()
    expect(playbackSession.getSnapshot().external).not.toBeNull()
    mocks.play.mockClear()

    setQueue([row('a'), row('b'), row('c')])
    await settleReissue()

    // Our list is not driving that audio, so there is no order to be authoritative
    // about — reissuing would seize playback the member started somewhere else.
    expect(mocks.play).not.toHaveBeenCalled()
  })

  it('says so, and leaves audio alone, when the sounding row cannot head the reissue', async () => {
    setQueue([row('a'), row('b'), row('c')])
    await startAt('a')
    mocks.play.mockClear()
    mocks.resolveTail.mockImplementationOnce(async (rows: Array<{ itemId: string, trackId: string }>) => ({
      resolved: rows.slice(1).map(r => ({ ...r, uri: `provider:track:${r.trackId}` })),
      failed: [rows[0]],
    }))

    setQueue([row('a'), row('c'), row('b')])
    await settleReissue()

    expect(mocks.play).not.toHaveBeenCalled()
    expect(playbackSession.getSnapshot()).toMatchObject({
      currentItemId: 'a',
      playing: true,
      notice: { tone: 'error', message: '대기열 순서를 재생기에 반영하지 못했어요. 잠시 후 다시 시도해 주세요' },
    })

    // And the debt stands, exactly as on the play-failed branch: a later track
    // change must not be able to re-base the discrepancy away and leave the queue
    // lying with the notice long since replaced.
    mocks.readLivePlayback.mockResolvedValue({ ...liveTrack('SPOT-B'), progressMs: 3_000, readAtMs: performance.now() })
    mocks.cachedUri.mockImplementation((t: string) => (t === 'track-b' ? 'spotify:track:SPOT-B' : null))
    await playbackSession.syncFromLive()
    expect(playbackSession.getSnapshot().currentItemId).toBe('b')
    setQueue([row('c'), row('b')])
    await settleReissue()

    expect(issuedUris()).toEqual(['provider:track:track-b'])
    expectInvariant()
  })

  it('stops re-arming after a bounded number of busy waits', async () => {
    setQueue([row('a'), row('b'), row('c')])
    await startAt('a')
    mocks.play.mockClear()
    // A transport call that never settles. `play()` and `sendPlayerCommand()` carry
    // no abort signal, so `busy` can stay set with nothing left to clear it — and a
    // reissue that steps aside for a busy session would otherwise re-arm forever in
    // a tab nobody is looking at. A seek is used rather than a play because a play
    // settles the debt itself on the way out, which would hide the difference.
    let releaseHang!: () => void
    mocks.sendPlayerCommand.mockImplementationOnce(() => new Promise((resolve) => {
      releaseHang = () => resolve({ ok: true })
    }))
    void playbackSession.seekTo(1_000)
    await flushPlaybackStart()
    expect(playbackSession.getSnapshot().busy).toBe(true)

    setQueue([row('a'), row('c'), row('b')])
    await vi.advanceTimersByTimeAsync(300 * 40)
    releaseHang()
    await vi.advanceTimersByTimeAsync(300 * 4 + PLAYBACK_LAG_MS * 2)

    // The attempt was abandoned, not left pending: nothing fires once the session
    // frees up.
    expect(mocks.play).not.toHaveBeenCalled()

    // The DEBT still stands, though — the member's next edit pays it.
    setQueue([row('a'), row('c'), row('b'), row('d')])
    await settleReissue()
    expect(issuedUris()).toEqual([
      'provider:track:track-a',
      'provider:track:track-c',
      'provider:track:track-b',
      'provider:track:track-d',
    ])
    expectInvariant()
  })
})
