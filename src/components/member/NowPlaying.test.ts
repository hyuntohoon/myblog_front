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
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as sessionModule from '@lib/playback/session'
import * as playbackApi from './lyrics/playback.api'
import { useNowPlaying } from './NowPlaying'
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
      syncFromLive: vi.fn(() => Promise.resolve()),
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
})

describe('useNowPlaying — playbackSession convergence (Step 3b)', () => {
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
    session.getSnapshot.mockReturnValue(bucketState)

    // The Bucket panel's own write already landed in `playbackSession` — this
    // is its subscriber notification, the only channel this card reacts to
    // here. No `readLivePlayback` call of this card's own is involved.
    act(() => {
      notify?.()
    })

    await waitFor(() => expect(result.current.moment?.trackId).toBe('bucket-track'))
    expect(result.current.moment?.anchor).toEqual(bucketState.anchor)
    expect(result.current.moment?.durationMs).toBe(240_000)
    expect(result.current.paused).toBe(false)
    // The render gate this card actually uses (`liveSnapshot`) is `np`, not
    // `moment` — a prior version of this fix converged `moment` alone and
    // left the card showing IdleBox regardless (caught by real-browser
    // verification, not this test, until this assertion was added).
    expect(result.current.np?.is_playing).toBe(true)
    expect(result.current.np?.track).toBe('Bucket Track')
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

  it('replays a session update deferred during a setMode call (BUG-22), which has no confirmation read of its own', async () => {
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
    player.sendPlaybackMode.mockReturnValueOnce(modePromise as never)
    act(() => {
      void result.current.setMode({ kind: 'shuffle', on: true })
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

    // deferred — this card's own setMode call is still in flight
    expect(result.current.moment?.trackId).toBe('own-track')

    // once setMode resolves, the deferred session update must be replayed —
    // there is no other channel that will ever apply it
    act(() => {
      resolveMode({ ok: true })
    })
    await waitFor(() => expect(result.current.moment?.trackId).toBe('other-track'))
    expect(result.current.moment?.durationMs).toBe(100_000)
  })
})
