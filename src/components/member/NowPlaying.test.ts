// ARCH-entity-interaction-domain-audit Step 3a — `controlBusyRef`'s old blanket
// "ignore every MYBLOG_PLAYBACK_CHANGED while ANY control call is in flight"
// dropped not just the echo of our own command but a genuinely external change
// landing in the same window (someone pausing from their phone the instant this
// tab's own pause request is still in flight). The fix ports `session.ts`'s
// `localWriteSeq` pattern: discard a read only if a NEWER local write raced
// ahead of it, never a blanket "was busy" flag. These two tests pin both halves
// — the external read must land, and our own echo must still self-discard —
// with explicit deferred promises (per `feedback-stub-must-model-async-lag`:
// an instantly-resolving stub would erase the exact race being tested).
import type { BoardAlbum } from '@lib/buckets'
import type { PlaybackSessionState } from '@lib/playback/session'
import type { LivePlayback } from './lyrics/playback.api'
import { createElement } from 'react'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as sessionModule from '@lib/playback/session'
import * as playbackApi from './lyrics/playback.api'
import { NowPlaying, useNowPlaying } from './NowPlaying'
import * as spotifyApi from './spotify.api'
import * as spotifyPlayback from '@lib/spotifyPlayback'

const EVT = 'myblog:playback-changed'

vi.mock('./spotify.api', () => ({
  getNowPlayingData: vi.fn(),
  listRecentlyListened: vi.fn(),
  listRecentTracks: vi.fn(),
}))
vi.mock('./integrations.api', () => ({
  getIntegrations: vi.fn(),
  spotifyScopeGeneration: vi.fn(),
}))
vi.mock('./lyrics/playback.api', () => ({
  readLivePlayback: vi.fn(),
}))
vi.mock('@lib/spotifyPlayback', () => ({
  MYBLOG_PLAYBACK_CHANGED: 'myblog:playback-changed',
  getActiveRung: vi.fn(() => null),
  getStreamingToken: vi.fn(),
  getTrackLiked: vi.fn(),
  listDevices: vi.fn(),
  play: vi.fn(),
  sendPlaybackMode: vi.fn(),
  sendPlayerCommand: vi.fn(),
  setTrackLiked: vi.fn(),
  transferPlayback: vi.fn(),
}))
vi.mock('@lib/spotifyCapability', () => ({
  readSpotifyCapabilityStanding: vi.fn(),
  rememberSpotifyLibraryProbe: vi.fn(),
  rememberSpotifyTransportProbe: vi.fn(),
}))
vi.mock('@lib/mediaSession', () => ({
  bindMediaSessionHandlers: vi.fn(() => () => {}),
  publishNowPlaying: vi.fn(),
  publishPlaybackState: vi.fn(),
  publishPosition: vi.fn(),
}))
// Step 3b — NowPlaying now subscribes to `playbackSession` read-only. Mocked
// here (rather than pulling in the real module and its own dependency graph
// of ownership/buckets/bucketStore/queue/uris) so this file stays scoped to
// NowPlaying's own race behaviour; the session subscription itself is a
// no-op by default (`subscribe` never fires) so the existing Step 3a tests
// below are unaffected — `syncFromLive` resolves immediately to a stable
// empty snapshot, exercising the convergence effect's harmless idle no-op
// exactly once per mount, same as if no play had ever started anywhere.
const EMPTY_SESSION_STATE: PlaybackSessionState = {
  currentItemId: null,
  external: null,
  playing: false,
  anchor: null,
  durationMs: null,
  rung: null,
  degraded: false,
  device: null,
  capabilityTier: 'fallback',
  devices: null,
  activeDeviceId: null,
  shuffle: null,
  repeat: null,
  volumePercent: null,
  liked: 'unknown',
  reconnect: false,
  notice: null,
  busy: false,
  isOwner: false,
  ownerPresent: false,
  ownerRung: null,
}
vi.mock('@lib/playback/session', () => {
  const empty = {
    currentItemId: null,
    external: null,
    playing: false,
    anchor: null,
    durationMs: null,
    rung: null,
    degraded: false,
    device: null,
    capabilityTier: 'fallback',
    devices: null,
    activeDeviceId: null,
    shuffle: null,
    repeat: null,
    volumePercent: null,
    liked: 'unknown',
    reconnect: false,
    notice: null,
    busy: false,
    isOwner: false,
    ownerPresent: false,
    ownerRung: null,
  }
  return {
    playbackSession: {
      subscribe: vi.fn(() => () => {}),
      getSnapshot: vi.fn(() => empty),
      getServerSnapshot: vi.fn(() => empty),
      currentRow: vi.fn(() => null),
      // CHORE-nowplaying-trackid-namespace: the Step 3b effect now reads
      // identity through this cache-only resolver (mirrors the real module's
      // `rowForSpotifyTrack` direction) rather than a raw `BoardAlbum.trackId`
      // (a DB catalog UUID, not a Spotify id). Default null — tests that need
      // a converged identity set it explicitly, same as `currentRow`.
      currentSpotifyTrackId: vi.fn(() => null),
      syncFromLive: vi.fn(() => Promise.resolve()),
      resolveCapability: vi.fn(() => Promise.resolve()),
      recordControlFailure: vi.fn(),
      loadLiked: vi.fn(),
      toggleLiked: vi.fn(() => Promise.resolve(null)),
      setMode: vi.fn(() => Promise.resolve({ ok: true })),
      seekTo: vi.fn((_ms: number, onReanchored?: () => void) => {
        onReanchored?.()
        return Promise.resolve({ ok: true })
      }),
      refreshDevices: vi.fn(() => Promise.resolve({ ok: true, devices: [] })),
      transferTo: vi.fn(() => Promise.resolve({ ok: true })),
    },
  }
})

const spotify = vi.mocked(spotifyApi)
const playback = vi.mocked(playbackApi)
const player = vi.mocked(spotifyPlayback)
const session = vi.mocked(sessionModule.playbackSession)

function livePlaying(trackId: string, over: Record<string, unknown> = {}): LivePlayback {
  return {
    state: 'playing',
    trackId,
    progressMs: 0,
    readAtMs: performance.now(),
    durationMs: 200_000,
    track: `track-${trackId}`,
    artist: 'artist',
    artists: [],
    album: 'album',
    albumSpotifyId: null,
    albumCoverUrl: null,
    deviceName: null,
    shuffle: null,
    repeat: null,
    volumePercent: null,
    ...over,
  } as unknown as LivePlayback
}

async function mountReady() {
  spotify.getNowPlayingData.mockResolvedValue(null as never)
  playback.readLivePlayback.mockResolvedValueOnce({ state: 'idle' })
  player.getStreamingToken.mockResolvedValue({ ok: true, token: 'tok' } as never)
  player.getTrackLiked.mockResolvedValue({ ok: true, liked: false } as never)

  const { result } = renderHook(() => useNowPlaying())
  await waitFor(() => expect(result.current.state).toBe('ready'))
  return result
}

afterEach(() => {
  vi.clearAllMocks()
  // `vi.clearAllMocks()` clears call history, not `mockReturnValue`
  // implementations — without resetting these explicitly, a test that sets
  // `session.currentSpotifyTrackId`/`currentRow`/`getSnapshot` (Step 3b tests)
  // would leak its value into the next test. Previously invisible because
  // nothing outside the Step 3b effect itself consulted these; now `applyLive`
  // (BUG-28's guard) reads `currentSpotifyTrackId()` too, on every EVT
  // dispatch, so leakage into an unrelated Step 3a-style test is now directly
  // observable rather than silently ignored.
  session.currentRow.mockReturnValue(null)
  session.currentSpotifyTrackId.mockReturnValue(null)
  session.getSnapshot.mockReturnValue(EMPTY_SESSION_STATE)
})

describe('useNowPlaying — onPlaybackChanged race (Step 3a)', () => {
  it('does not drop a genuinely external change landing while our own command is in flight', async () => {
    const result = await mountReady()

    let resolveCommand: (v: { ok: true }) => void = () => {}
    const commandPromise = new Promise<{ ok: true }>((res) => {
      resolveCommand = res
    })
    player.sendPlayerCommand.mockReturnValueOnce(commandPromise as never)
    playback.readLivePlayback.mockResolvedValueOnce(livePlaying('external-track'))

    // our own pause, held open — mimics its network call still being in flight
    act(() => {
      void result.current.playPause()
    })

    // a genuinely external change arrives on a totally separate channel
    // (another surface / device) while our command has not resolved yet
    act(() => {
      window.dispatchEvent(new CustomEvent(EVT))
    })
    await waitFor(() => expect(result.current.moment?.trackId).toBe('external-track'))

    // now let our own command land — its optimistic pause must still apply
    act(() => {
      resolveCommand({ ok: true })
    })
    await waitFor(() => expect(result.current.paused).toBe(true))
  })

  it('still discards its own command\'s echo once the authoritative write lands', async () => {
    const result = await mountReady()

    let resolveEcho: (v: LivePlayback) => void = () => {}
    const echoPromise = new Promise<LivePlayback>((res) => {
      resolveEcho = res
    })
    // real `sendPlayerCommand` dispatches MYBLOG_PLAYBACK_CHANGED synchronously,
    // before its own promise resolves — reproduce that ordering here.
    player.sendPlayerCommand.mockImplementationOnce(async () => {
      window.dispatchEvent(new CustomEvent(EVT))
      return { ok: true } as never
    })
    playback.readLivePlayback.mockReturnValueOnce(echoPromise)

    await act(async () => {
      await result.current.playPause()
    })
    await waitFor(() => expect(result.current.paused).toBe(true))

    // the echo's read finally lands, AFTER our own authoritative bump — must
    // be discarded as stale, not flip the card back to "playing"
    await act(async () => {
      resolveEcho(livePlaying('should-be-discarded', { state: 'playing' }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.paused).toBe(true)
    expect(result.current.moment?.trackId).not.toBe('should-be-discarded')
  })

  it('discards the seek event read when the session re-anchors, without issuing a card confirmation read', async () => {
    const result = await mountReady()
    const readsBefore = playback.readLivePlayback.mock.calls.length
    let resolveEcho!: (value: LivePlayback) => void
    playback.readLivePlayback.mockReturnValueOnce(new Promise((resolve) => {
      resolveEcho = resolve
    }))
    session.seekTo.mockImplementationOnce(async (_ms, onReanchored?: () => void) => {
      // Production seek ordering: event first, authoritative session anchor next.
      window.dispatchEvent(new CustomEvent(EVT))
      onReanchored?.()
      return { ok: true }
    })

    await act(async () => result.current.seek(40_000))
    expect(playback.readLivePlayback).toHaveBeenCalledTimes(readsBefore + 1)

    await act(async () => resolveEcho(livePlaying('stale-pre-seek', { progressMs: 5_000 })))

    expect(result.current.moment?.trackId).not.toBe('stale-pre-seek')
    expect(playback.readLivePlayback).toHaveBeenCalledTimes(readsBefore + 1)
  })
})

describe('useNowPlaying — mount-time double-read race (BUG-28)', () => {
  it('does not flash back to a stale track when playbackSession has already converged on a different one', async () => {
    const result = await mountReady()

    // This card's own read (mount `sync()` / `onPlaybackChanged`) is in
    // flight, unresolved — models the real HTTP round trip.
    let resolveOwnRead: (v: LivePlayback) => void = () => {}
    const ownRead = new Promise<LivePlayback>((res) => {
      resolveOwnRead = res
    })
    playback.readLivePlayback.mockReturnValueOnce(ownRead)
    act(() => {
      window.dispatchEvent(new CustomEvent(EVT))
    })

    // Meanwhile `playbackSession`'s own adoption — a structurally identical
    // but entirely independent `readLivePlayback()` round trip — already
    // converged on a DIFFERENT track. It has its own freshness guard
    // (`localWriteSeq`) unrelated to this card's own read, so this ordering
    // is ordinary, not contrived (per `feedback-stub-must-model-async-lag`:
    // an instantly-resolving stub would erase the exact race this pins).
    session.currentSpotifyTrackId.mockReturnValue('session-converged-track')

    // This card's own read finally lands, holding the now-stale track.
    await act(async () => {
      resolveOwnRead(livePlaying('stale-own-read'))
    })

    // Applying it would revert the card to a track that, per the session's
    // own already-authoritative answer, is no longer playing.
    expect(result.current.moment?.trackId).not.toBe('stale-own-read')
  })
})

describe('useNowPlaying — playbackSession convergence (Step 3b)', () => {
  it('delegates seek to the session without issuing an independent live read', async () => {
    const result = await mountReady()
    const readsBefore = playback.readLivePlayback.mock.calls.length

    await act(async () => result.current.seek(12_345))

    expect(session.seekTo).toHaveBeenCalledWith(12_345, expect.any(Function))
    expect(playback.readLivePlayback).toHaveBeenCalledTimes(readsBefore)
  })

  it('keeps seek mutually exclusive with local transport and mode writes', async () => {
    const result = await mountReady()
    let resolveSeek!: (value: { ok: true }) => void
    session.seekTo.mockReturnValueOnce(new Promise((resolve) => {
      resolveSeek = resolve
    }) as never)
    player.sendPlayerCommand.mockClear()
    session.setMode.mockClear()

    act(() => {
      void result.current.seek(20_000)
    })
    act(() => {
      void result.current.playPause()
      void result.current.skip('next')
      void result.current.setMode({ kind: 'shuffle', on: true })
    })

    expect(player.sendPlayerCommand).not.toHaveBeenCalled()
    expect(session.setMode).not.toHaveBeenCalled()
    await act(async () => resolveSeek({ ok: true }))
  })

  it('does not start seek while a direct transport or mode write is in flight', async () => {
    const result = await mountReady()
    let resolveTransport!: (value: { ok: true }) => void
    player.sendPlayerCommand.mockReturnValueOnce(new Promise((resolve) => {
      resolveTransport = resolve
    }) as never)
    session.seekTo.mockClear()

    act(() => {
      void result.current.playPause()
    })
    await act(async () => result.current.seek(20_000))
    expect(session.seekTo).not.toHaveBeenCalled()
    await act(async () => resolveTransport({ ok: true }))

    let resolveMode!: (value: { ok: true }) => void
    session.setMode.mockReturnValueOnce(new Promise((resolve) => {
      resolveMode = resolve
    }) as never)
    act(() => {
      void result.current.setMode({ kind: 'shuffle', on: true })
    })
    await act(async () => result.current.seek(30_000))
    expect(session.seekTo).not.toHaveBeenCalled()
    await act(async () => resolveMode({ ok: true }))
  })

  it('converges track identity + anchor from a play started in the Playback Bucket panel, without a page reload', async () => {
    let notify: (() => void) | null = null
    session.subscribe.mockImplementation((cb) => {
      notify = cb
      return () => {}
    })

    const result = await mountReady()
    expect(result.current.moment).toBeNull()

    const bucketRow = { itemId: 'item-1', trackId: 'bucket-track', title: 'Bucket Track', artist: 'Bucket Artist', cover: 'https://example.com/c.jpg' } as BoardAlbum
    const bucketState: PlaybackSessionState = {
      ...EMPTY_SESSION_STATE,
      currentItemId: 'item-1',
      playing: true,
      anchor: { ms: 12_000, wallMs: performance.now() },
      durationMs: 240_000,
    }
    session.currentRow.mockReturnValue(bucketRow)
    // `bucketRow.trackId` is a DB catalog UUID; `currentSpotifyTrackId()` is
    // the already-resolved Spotify id the real module derives from it via
    // `cachedUri` — deliberately shaped differently here so a regression back
    // to the raw DB id (CHORE-nowplaying-trackid-namespace) fails loudly.
    session.currentSpotifyTrackId.mockReturnValue('spotify-bucket-track')
    session.getSnapshot.mockReturnValue(bucketState)

    // The Bucket panel's own write already landed in `playbackSession` — this
    // is its subscriber notification, the only channel this card reacts to
    // here. No `readLivePlayback` call of this card's own is involved.
    act(() => {
      notify?.()
    })

    await waitFor(() => expect(result.current.moment?.trackId).toBe('spotify-bucket-track'))
    expect(result.current.moment?.anchor).toEqual(bucketState.anchor)
    expect(result.current.moment?.durationMs).toBe(240_000)
    expect(result.current.paused).toBe(false)
    // The render gate this card actually uses (`liveSnapshot`) is `np`, not
    // `moment` — a prior version of this fix converged `moment` alone and
    // left the card showing IdleBox regardless (caught by real-browser
    // verification, not this test, until this assertion was added).
    expect(result.current.np?.is_playing).toBe(true)
    expect(result.current.np?.track).toBe('Bucket Track')
    // CHORE-nowplaying-trackid-namespace: the liked-heart lookup must receive
    // the resolved Spotify id, never `bucketRow.trackId` (the raw DB catalog
    // UUID) — that mismatch previously hit Spotify's `/me/tracks/contains`
    // with a Postgres UUID and briefly flashed the heart to "unknown".
    await waitFor(() => expect(session.loadLiked).toHaveBeenCalledWith('spotify-bucket-track'))
    expect(session.loadLiked).not.toHaveBeenCalledWith('bucket-track')
  })

  it('defers a session update landing while this card has its own control call in flight', async () => {
    let notify: (() => void) | null = null
    session.subscribe.mockImplementation((cb) => {
      notify = cb
      return () => {}
    })
    const result = await mountReady()
    // seed a moment via this card's own path first (Step 3a's onPlaybackChanged)
    playback.readLivePlayback.mockResolvedValueOnce(livePlaying('own-track'))
    act(() => {
      window.dispatchEvent(new CustomEvent(EVT))
    })
    await waitFor(() => expect(result.current.moment?.trackId).toBe('own-track'))

    // hold our own control call open
    let resolveCommand: (v: { ok: true }) => void = () => {}
    const commandPromise = new Promise<{ ok: true }>((res) => {
      resolveCommand = res
    })
    player.sendPlayerCommand.mockReturnValueOnce(commandPromise as never)
    act(() => {
      void result.current.playPause()
    })

    // meanwhile a session update lands claiming a DIFFERENT track
    session.currentRow.mockReturnValue({ itemId: 'item-2', trackId: 'other-track' } as BoardAlbum)
    session.getSnapshot.mockReturnValue({
      ...EMPTY_SESSION_STATE,
      currentItemId: 'item-2',
      playing: true,
      anchor: { ms: 0, wallMs: performance.now() },
      durationMs: 100_000,
    })
    act(() => {
      notify?.()
    })

    // deferred — this card's own control call is still in flight
    expect(result.current.moment?.trackId).toBe('own-track')

    act(() => {
      resolveCommand({ ok: true })
    })
    await waitFor(() => expect(result.current.paused).toBe(true))
    // still our own track — nothing re-applies the deferred update without a
    // fresh notification, which is the accepted tradeoff (the next real event
    // — from either tracker — re-syncs both, per the RFC's own eventual-
    // consistency framing elsewhere in this file)
    expect(result.current.moment?.trackId).toBe('own-track')
  })

  it('renders a session-owned shuffle change without performing an independent live read', async () => {
    let notify: (() => void) | null = null
    session.subscribe.mockImplementation((cb) => {
      notify = cb
      return () => {}
    })
    const result = await mountReady()
    const bucketState: PlaybackSessionState = {
      ...EMPTY_SESSION_STATE,
      currentItemId: 'item-1',
      playing: true,
      anchor: { ms: 0, wallMs: performance.now() },
      durationMs: 100_000,
      shuffle: true,
    }
    session.currentRow.mockReturnValue({ itemId: 'item-1', trackId: 'db-track', title: 'Track' } as BoardAlbum)
    session.currentSpotifyTrackId.mockReturnValue('spotify-track')
    session.getSnapshot.mockReturnValue(bucketState)
    const readsBefore = playback.readLivePlayback.mock.calls.length

    act(() => {
      notify?.()
    })

    await waitFor(() => expect(result.current.moment?.shuffle).toBe(true))
    expect(playback.readLivePlayback).toHaveBeenCalledTimes(readsBefore)
  })

  it('does not lose a session update landing during a session-owned setMode call (BUG-22)', async () => {
    let notify: (() => void) | null = null
    session.subscribe.mockImplementation((cb) => {
      notify = cb
      return () => {}
    })
    const result = await mountReady()
    // seed a moment via this card's own path first (Step 3a's onPlaybackChanged)
    playback.readLivePlayback.mockResolvedValueOnce(livePlaying('own-track'))
    act(() => {
      window.dispatchEvent(new CustomEvent(EVT))
    })
    await waitFor(() => expect(result.current.moment?.trackId).toBe('own-track'))

    // hold our own setMode call open — unlike playPause/seek/skip, this
    // dispatches no MYBLOG_PLAYBACK_CHANGED and has no confirmation read, so
    // nothing else will ever re-check the session state once this resolves
    let resolveMode: (v: { ok: true }) => void = () => {}
    const modePromise = new Promise<{ ok: true }>((res) => {
      resolveMode = res
    })
    session.setMode.mockReturnValueOnce(modePromise as never)
    act(() => {
      void result.current.setMode({ kind: 'shuffle', on: true })
    })

    // meanwhile a session update lands claiming a DIFFERENT track
    session.currentRow.mockReturnValue({ itemId: 'item-2', trackId: 'other-track' } as BoardAlbum)
    session.currentSpotifyTrackId.mockReturnValue('spotify-other-track')
    session.getSnapshot.mockReturnValue({
      ...EMPTY_SESSION_STATE,
      currentItemId: 'item-2',
      playing: true,
      anchor: { ms: 0, wallMs: performance.now() },
      durationMs: 100_000,
    })
    act(() => {
      notify?.()
    })

    // setMode is session-owned now, so it does not block the card's local
    // track/anchor convergence window (the BUG-22 update cannot be deferred).
    await waitFor(() => expect(result.current.moment?.trackId).toBe('spotify-other-track'))

    // Settling the mode request does not need a replay notification.
    act(() => {
      resolveMode({ ok: true })
    })
    await waitFor(() => expect(result.current.moment?.trackId).toBe('spotify-other-track'))
    expect(result.current.moment?.durationMs).toBe(100_000)
  })
})

describe('nowPlaying Overview variants', () => {
  it('keeps the banner/full/list render variants while variant changes add no live read', async () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia
    spotify.getNowPlayingData.mockResolvedValue(null as never)
    spotify.listRecentlyListened.mockResolvedValue({ items: [] } as never)
    spotify.listRecentTracks.mockResolvedValue({ items: [] } as never)
    playback.readLivePlayback.mockResolvedValue(livePlaying('overview-track', {
      albumCoverUrl: 'https://example.com/overview.jpg',
    }))
    session.currentSpotifyTrackId.mockReturnValue('overview-track')
    session.getSnapshot.mockReturnValue({
      ...EMPTY_SESSION_STATE,
      external: {
        title: 'track-overview-track',
        artist: 'artist',
        albumCoverUrl: 'https://example.com/overview.jpg',
        spotifyTrackId: 'overview-track',
        spotifyAlbumId: null,
        deviceName: null,
      },
      playing: true,
      anchor: { ms: 0, wallMs: performance.now() },
      durationMs: 200_000,
      capabilityTier: 'full',
    })

    const { container, rerender } = render(createElement(NowPlaying, { variant: 'banner' }))
    await screen.findByText('track-overview-track')
    expect(container.querySelectorAll('.lf-eq-bar')).toHaveLength(32)
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/overview.jpg')
    expect(playback.readLivePlayback).toHaveBeenCalledOnce()

    rerender(createElement(NowPlaying, { variant: 'full' }))
    expect(await screen.findByText('track-overview-track')).toBeInTheDocument()
    expect(container.querySelectorAll('.lf-eq-bar')).toHaveLength(4)
    expect(playback.readLivePlayback).toHaveBeenCalledOnce()

    rerender(createElement(NowPlaying, { variant: 'list' }))
    expect(await screen.findByText('최근 들은 앨범')).toBeInTheDocument()
    expect(screen.getByText('track-overview-track')).toBeInTheDocument()
    expect(playback.readLivePlayback).toHaveBeenCalledOnce()
  })
})
