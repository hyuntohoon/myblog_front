import type { BoardAlbum, BoardBucket } from '@lib/buckets'
import type { LivePlayback } from '@components/member/lyrics/playback.api'
import type { PlayerCommand } from '@lib/spotifyPlayback'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bucketStore } from '@lib/pocketBuckit/bucketStore'
import { __resetProviderState, getActiveProvider } from './provider'
import { playbackSession } from './session'

const mocks = vi.hoisted(() => ({
  spotifyPlay: vi.fn(),
  spotifyCommand: vi.fn(),
  youtubePlay: vi.fn(),
  youtubeCommand: vi.fn(),
  setHost: vi.fn(),
  youtubeLive: { videoId: 'abcdefghijk', playing: true, positionMs: 0, durationMs: 180_000 },
  resolve: vi.fn(),
  resolveTail: vi.fn(),
  prefetch: vi.fn(),
  live: vi.fn(),
  deleteItem: vi.fn(),
  addItem: vi.fn(),
  expandAlbum: vi.fn(),
  listBuckets: vi.fn(),
  ownership: { tabId: 'yt-test', ownerTabId: 'yt-test', isOwner: true, ownerPresent: true },
  ownershipListeners: new Set<() => void>(),
}))
vi.mock('@lib/buckets', async original => ({
  ...await original<typeof import('@lib/buckets')>(),
  listBuckets: mocks.listBuckets,
  deleteBucketItem: mocks.deleteItem,
  addBucketPlayback: mocks.addItem,
  expandAlbumTracks: mocks.expandAlbum,
}))
vi.mock('@lib/spotifyPlayback', () => ({
  IN_PAGE_MESSAGE: '이 브라우저에서 재생 중 (음질 제한)',
  MYBLOG_PLAYBACK_CHANGED: 'myblog:playback-changed',
  play: mocks.spotifyPlay,
  sendPlayerCommand: mocks.spotifyCommand,
  getStreamingToken: vi.fn(async () => ({ ok: true, token: 'test', expiresAt: Date.now() + 60_000 })),
  getTrackLiked: vi.fn(async () => ({ ok: true, liked: false })),
  setTrackLiked: vi.fn(async () => ({ ok: true })),
  listDevices: vi.fn(async () => ({ ok: true, devices: [] })),
  transferPlayback: vi.fn(async () => ({ ok: true })),
  sendPlaybackMode: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@lib/youtubePlayback', () => ({
  loadIframeApi: () => new Promise(resolve => setTimeout(resolve, 20)),
  play: mocks.youtubePlay,
  sendPlayerCommand: mocks.youtubeCommand,
  getNowPlaying: () => mocks.youtubeLive,
  getYouTubeHost: () => document.body,
  setYouTubeHost: mocks.setHost,
  videoIdFromUri: (uri: string) => uri.startsWith('youtube:video:') ? uri.slice(14) : null,
  sendPlaybackMode: vi.fn(async () => ({ ok: false, reason: 'no-capability' })),
  getTrackLiked: vi.fn(async () => ({ ok: false, reason: 'no-capability' })),
  setTrackLiked: vi.fn(async () => ({ ok: false, reason: 'no-capability' })),
  listDevices: vi.fn(async () => ({ ok: true, devices: [] })),
  transferPlayback: vi.fn(async () => ({ ok: false, reason: 'no-capability' })),
}))
vi.mock('@lib/playback/uris', () => ({
  resolveUriDetailed: mocks.resolve,
  resolveTail: mocks.resolveTail,
  prefetchUris: mocks.prefetch,
  cachedUri: (trackId: string) => `spotify:track:${trackId}`,
}))
vi.mock('@components/member/lyrics/playback.api', () => ({ readLivePlayback: mocks.live }))
vi.mock('@lib/spotifyCapability', () => ({ rememberSpotifyLibraryProbe: vi.fn(), rememberSpotifyTransportProbe: vi.fn() }))
vi.mock('@lib/playback/ownership', () => ({
  playbackOwnership: {
    getSnapshot: () => mocks.ownership,
    getServerSnapshot: () => mocks.ownership,
    ensureOwner: vi.fn(async () => true),
    subscribe: (listener: () => void) => {
      mocks.ownershipListeners.add(listener)
      return () => mocks.ownershipListeners.delete(listener)
    },
    onMessage: () => () => {},
    post: vi.fn(),
  },
}))

const SPOTIFY_OK = { ok: true, rung: 'remote', degraded: false, message: 'Spotify 재생' } as const
const YOUTUBE_OK = { ok: true, rung: 'in-page', degraded: false, message: 'YouTube 재생' } as const
const TRACK = { kind: 'track', trackId: 'mapped-track', title: 'Come Back to Earth' } as const

/** The adapter awaits asynchronous IFrame readiness; no same-tick success stub. */
function afterDelay<T>(ms: number, apply: () => T): Promise<T> {
  return new Promise(resolve => setTimeout(() => resolve(apply()), ms))
}
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
    title: `Track ${id}`,
    artist: 'Artist',
    cover: null,
    year: null,
    alreadyReviewed: false,
    postId: null,
    researchSelected: false,
  }
}
function bucket(items: BoardAlbum[]): BoardBucket {
  return {
    id: 'queue',
    name: 'Playback',
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
function spotifyLive(trackId: string, progressMs = 20_000): LivePlayback {
  return {
    state: 'playing',
    trackId,
    progressMs,
    readAtMs: performance.now(),
    durationMs: 180_000,
    track: `Spotify ${trackId}`,
    artist: 'Artist',
    artists: [],
    album: 'Album',
    albumSpotifyId: null,
    albumCoverUrl: null,
    deviceName: 'Speaker',
    deviceId: 'speaker-device',
    shuffle: false,
    repeat: 'off',
    volumePercent: 50,
    contextUri: null,
    contextType: null,
  }
}
async function finish<T>(pending: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(1000)
  return pending
}
async function startYouTube(): Promise<void> {
  const result = await finish(playbackSession.replaceQueueAndPlay(TRACK))
  expect(result.ok).toBe(true)
  expect(getActiveProvider()).toBe('youtube')
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.ownership.isOwner = true
  mocks.ownership.ownerPresent = true
  mocks.ownership.ownerTabId = 'yt-test'
  playbackSession.__reset()
  __resetProviderState()
  bucketStore.setTree([bucket([row('a'), row('b')])])
  Object.assign(mocks.youtubeLive, { videoId: 'abcdefghijk', playing: true, positionMs: 0, durationMs: 180_000 })
  mocks.resolve.mockImplementation(() => afterDelay(100, () => ({ kind: 'uri', uri: 'youtube:video:abcdefghijk' })))
  mocks.resolveTail.mockImplementation((rows: Array<{ itemId: string, trackId: string }>) => afterDelay(50, () => ({
    resolved: rows.map(item => ({ ...item, uri: `spotify:track:${item.trackId}` })),
failed: [],
  })))
  mocks.prefetch.mockImplementation(() => afterDelay(20, () => undefined))
  mocks.spotifyPlay.mockImplementation(() => afterDelay(100, () => SPOTIFY_OK))
  mocks.spotifyCommand.mockImplementation(() => afterDelay(100, () => ({ ok: true })))
  mocks.youtubePlay.mockImplementation(() => afterDelay(400, () => YOUTUBE_OK))
  mocks.youtubeCommand.mockImplementation((command: PlayerCommand) => afterDelay(100, () => {
    if (command.kind === 'pause')
      mocks.youtubeLive.playing = false
    if (command.kind === 'play')
      mocks.youtubeLive.playing = true
    if (command.kind === 'seek')
      mocks.youtubeLive.positionMs = command.positionMs
    return { ok: true }
  }))
  mocks.live.mockImplementation(() => afterDelay(50, () => ({ state: 'unavailable' })))
  mocks.listBuckets.mockImplementation(() => afterDelay(50, () => [bucket([row('a'), row('b')])]))
  mocks.deleteItem.mockImplementation(() => afterDelay(50, () => undefined))
})
afterEach(async () => {
  playbackSession.__reset()
  __resetProviderState()
  await vi.runOnlyPendingTimersAsync()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('mapped single-track session playback', () => {
  it('waits for IFrame readiness and preserves the existing Spotify queue', async () => {
    const original = bucketStore.getTree()
    const pending = playbackSession.replaceQueueAndPlay(TRACK)
    await vi.advanceTimersByTimeAsync(300)
    expect(playbackSession.getSnapshot().busy).toBe(true)
    expect(mocks.youtubePlay).toHaveBeenCalledOnce()

    const result = await finish(pending)

    expect(result).toMatchObject({ ok: true, undo: null })
    expect(playbackSession.getSnapshot()).toMatchObject({
      currentItemId: null,
      external: { title: TRACK.title, deviceName: 'YouTube' },
      playing: true,
      busy: false,
      degraded: false,
    })
    expect(bucketStore.getTree()).toEqual(original)
    expect(mocks.listBuckets).not.toHaveBeenCalled()
    expect(mocks.addItem).not.toHaveBeenCalled()
    expect(mocks.deleteItem).not.toHaveBeenCalled()
    expect(mocks.resolveTail).not.toHaveBeenCalled()
    expect(mocks.spotifyPlay).not.toHaveBeenCalled()
  })

  it('preserves the queue when a mapped video reports a delayed playback error', async () => {
    const original = bucketStore.getTree()
    mocks.youtubePlay.mockImplementationOnce(() => afterDelay(400, () => ({
      ok: false,
reason: 'unavailable',
message: '다른 영상을 골라주세요',
    })))

    const result = await finish(playbackSession.replaceQueueAndPlay(TRACK))

    expect(result).toMatchObject({ ok: false, undo: null })
    expect(playbackSession.getSnapshot().notice).toMatchObject({ tone: 'error', message: '다른 영상을 골라주세요' })
    expect(bucketStore.getTree()).toEqual(original)
    expect(mocks.addItem).not.toHaveBeenCalled()
    expect(mocks.deleteItem).not.toHaveBeenCalled()
    expect(mocks.spotifyPlay).not.toHaveBeenCalled()
  })

  it('reads YouTube position without reading Spotify or removing queue rows', async () => {
    await startYouTube()
    mocks.live.mockClear()
    mocks.prefetch.mockClear()
    Object.assign(mocks.youtubeLive, { positionMs: 75_000, playing: false })

    await finish(playbackSession.syncFromLive())
    window.dispatchEvent(new Event('myblog:playback-changed'))
    await vi.advanceTimersByTimeAsync(100)

    expect(playbackSession.getSnapshot()).toMatchObject({ playing: false, anchor: { ms: 75_000 }, external: { deviceName: 'YouTube' } })
    expect(mocks.live).not.toHaveBeenCalled()
    expect(mocks.prefetch).not.toHaveBeenCalled()
    expect(mocks.deleteItem).not.toHaveBeenCalled()
  })

  it('discards a Spotify read that arrives after YouTube selection but before IFrame readiness', async () => {
    await finish(playbackSession.playAt('a'))
    mocks.live.mockImplementationOnce(() => afterDelay(50, () => spotifyLive('track-a', 180_000)))
    await finish(playbackSession.syncFromLive())
    expect(playbackSession.getSnapshot().currentItemId).toBe('a')
    mocks.live.mockImplementationOnce(() => afterDelay(300, () => spotifyLive('track-b')))
    const stale = playbackSession.syncFromLive()
    const selection = playbackSession.replaceQueueAndPlay(TRACK)

    await vi.advanceTimersByTimeAsync(350)
    await stale

    expect(getActiveProvider()).toBe('youtube')
    expect(playbackSession.getSnapshot()).toMatchObject({ busy: true, currentItemId: 'a' })
    expect(mocks.deleteItem).not.toHaveBeenCalled()
    expect(bucketStore.getTree()?.[0].albums.map(item => item.itemId)).toEqual(['a', 'b'])
    await finish(selection)
    expect(playbackSession.getSnapshot().external?.deviceName).toBe('YouTube')
  })

  it('routes pause, resume and seek to YouTube while keeping Spotify paused', async () => {
    await startYouTube()
    mocks.spotifyCommand.mockClear()

    await finish(playbackSession.togglePlay())
    expect(playbackSession.getSnapshot().playing).toBe(false)
    await finish(playbackSession.seekTo(42_000))
    expect(playbackSession.getSnapshot().anchor?.ms).toBe(42_000)
    await finish(playbackSession.togglePlay())

    expect(mocks.youtubeCommand.mock.calls.map(([command]) => command)).toEqual([
      { kind: 'pause' },
      { kind: 'seek', positionMs: 42_000 },
      { kind: 'play' },
    ])
    expect(playbackSession.getSnapshot().playing).toBe(true)
    expect(mocks.spotifyCommand).not.toHaveBeenCalled()
    expect(mocks.live).not.toHaveBeenCalled()
  })

  it.each(['next', 'previous'] as const)('keeps YouTube controls available when unsupported %s is pressed', async (command) => {
    await startYouTube()
    mocks.spotifyCommand.mockClear()
    mocks.youtubeCommand.mockClear()

    await finish(playbackSession[command]())

    expect(mocks.spotifyCommand).not.toHaveBeenCalled()
    expect(mocks.youtubeCommand).not.toHaveBeenCalled()
    expect(mocks.live).not.toHaveBeenCalled()
    expect(mocks.deleteItem).not.toHaveBeenCalled()
    expect(playbackSession.getSnapshot()).toMatchObject({ external: { title: TRACK.title }, notice: null, capabilityTier: 'full' })
  })

  it('closes YouTube and starts the Spotify tail when a queue row is selected', async () => {
    await startYouTube()
    mocks.resolve.mockClear()
    mocks.setHost.mockClear()

    await finish(playbackSession.playAt('b'))

    expect(mocks.setHost).toHaveBeenCalledWith(null)
    expect(mocks.spotifyPlay).toHaveBeenCalledWith({ kind: 'uris', uris: ['spotify:track:track-b'] })
    expect(mocks.resolve).not.toHaveBeenCalled()
    expect(getActiveProvider()).toBe('spotify')
    expect(playbackSession.getSnapshot().currentItemId).toBe('b')
  })

  it('stops video audio when this tab loses playback ownership', async () => {
    await startYouTube()
    mocks.setHost.mockClear()

    mocks.ownership.isOwner = false
    mocks.ownership.ownerTabId = 'other-tab'
    for (const notify of mocks.ownershipListeners) notify()

    expect(mocks.setHost).toHaveBeenCalledWith(null)
    expect(getActiveProvider()).toBe('spotify')
    expect(playbackSession.getSnapshot()).toMatchObject({ playing: false, external: null, isOwner: false })
  })
})
