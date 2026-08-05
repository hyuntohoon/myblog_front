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
import type { LivePlayback } from './lyrics/playback.api'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

const spotify = vi.mocked(spotifyApi)
const playback = vi.mocked(playbackApi)
const player = vi.mocked(spotifyPlayback)

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
