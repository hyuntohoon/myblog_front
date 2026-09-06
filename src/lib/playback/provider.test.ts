import type { PlayIntent } from '@lib/spotifyPlayback'
import type { UriResolution } from './uris'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetYouTubePlayback, setYouTubeHost } from '@lib/youtubePlayback'
import {
  __resetProviderState,
  clearMappingPrompt,
  closeYouTubePlayer,
  getActiveProvider,
  getTrackLiked,
  getYouTubeNowPlaying,
  listDevices,
  play,
  providerStore,
  sendPlaybackMode,
  sendPlayerCommand,
  setTrackLiked,
  transferPlayback,
  tryPlayYouTubeTrack,
} from './provider'

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  fetch: vi.fn(),
  resolve: vi.fn(),
  ensureOwner: vi.fn(),
  play: vi.fn(),
  command: vi.fn(),
  mode: vi.fn(),
  devices: vi.fn(),
  transfer: vi.fn(),
  liked: vi.fn(),
  setLiked: vi.fn(),
}))
vi.mock('./uris', () => ({ resolveUriDetailed: mocks.resolve }))
vi.mock('./ownership', () => ({ playbackOwnership: { ensureOwner: mocks.ensureOwner } }))
vi.mock('@lib/spotifyPlayback', () => ({
  getStreamingToken: mocks.token,
  play: mocks.play,
  sendPlayerCommand: mocks.command,
  sendPlaybackMode: mocks.mode,
  listDevices: mocks.devices,
  transferPlayback: mocks.transfer,
  getTrackLiked: mocks.liked,
  setTrackLiked: mocks.setLiked,
}))

const TRACK = { kind: 'track', trackId: 'catalog-1', title: 'A song' } as const
const URI = { kind: 'uri', uri: 'youtube:video:abcdefghijk' } as const
const SPOTIFY_OK = { ok: true, rung: 'remote', degraded: false, message: 'Spotify' } as const
const lag = () => new Promise(resolve => setTimeout(resolve, 10))
let players: Array<{ commands: string[], destroyed: boolean, videoId: string }>
let errorCode: number | null
let neverReady: boolean
let unmount: () => void

beforeEach(() => {
  vi.clearAllMocks()
  __resetProviderState()
  __resetYouTubePlayback()
  mocks.token.mockResolvedValue({ ok: true, token: 'test' })
  mocks.fetch.mockRejectedValue(new Error('offline'))
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.resolve.mockResolvedValue(URI)
  mocks.ensureOwner.mockResolvedValue(true)
  mocks.play.mockResolvedValue(SPOTIFY_OK)
  mocks.command.mockResolvedValue({ ok: true })
  mocks.mode.mockResolvedValue({ ok: true })
  mocks.devices.mockResolvedValue({ ok: true, devices: [] })
  mocks.transfer.mockResolvedValue({ ok: true })
  mocks.liked.mockResolvedValue({ ok: true, liked: false })
  mocks.setLiked.mockResolvedValue({ ok: true })
  players = []
  errorCode = null
  neverReady = false
  class Player {
    commands: string[] = []
    destroyed = false
    videoId: string
    constructor(_el: HTMLElement, opts: { videoId: string, events: { onReady: () => void, onError: (e: { data: number }) => void } }) {
      this.videoId = opts.videoId
      players.push(this)
      // IFrame callbacks arrive after the constructor, including after unmount.
      if (!neverReady)
        setTimeout(() => errorCode === null ? opts.events.onReady() : opts.events.onError({ data: errorCode }), 5)
    }

    destroy() { this.destroyed = true }
    pauseVideo() { this.commands.push('pause') }
    playVideo() { this.commands.push('play') }
    seekTo(seconds: number) { this.commands.push(`seek:${seconds}`) }
    getPlayerState() { return 1 }
    getCurrentTime() { return 7 }
    getDuration() { return 180 }
    loadVideoById(videoId: string) { this.videoId = videoId }
  }
  Object.assign(window, { YT: { Player } })
  // Model React's delayed mount rather than making the host instantly available.
  unmount = providerStore.subscribe(() => {
    if (getActiveProvider() === 'youtube') {
      setTimeout(() => {
        if (getActiveProvider() === 'youtube')
          setYouTubeHost(document.createElement('div'))
      }, 5)
    }
  })
})

afterEach(async () => {
  unmount()
  closeYouTubePlayer()
  // Drain onReady/onError before resetting module state for the next test.
  if (vi.isFakeTimers()) {
    await vi.runOnlyPendingTimersAsync()
    vi.useRealTimers()
  }
  await lag()
  __resetYouTubePlayback()
  __resetProviderState()
  vi.unstubAllGlobals()
  delete (window as Window & { YT?: unknown }).YT
})

describe('track-only provider dispatch', () => {
  it.each<UriResolution>([{ kind: 'unmapped' }, { kind: 'gone' }, { kind: 'transient' }])('retains the exact Spotify intent when resolve is $kind', async (resolution) => {
    mocks.resolve.mockResolvedValue(resolution)
    expect(await play(TRACK)).toEqual(SPOTIFY_OK)
    expect(mocks.resolve).toHaveBeenCalledWith(TRACK.trackId, 'youtube')
    expect(mocks.play).toHaveBeenCalledExactlyOnceWith(TRACK)
    expect(mocks.command).not.toHaveBeenCalled()
    expect(players).toHaveLength(0)
    expect(getActiveProvider()).toBe('spotify')
    expect(providerStore.getSnapshot().needsMapping).toBe(resolution.kind === 'gone')
  })

  it('keeps a gone mapping prompt attached to the catalog track until dismissed', async () => {
    mocks.resolve.mockResolvedValue({ kind: 'gone' })
    expect(await tryPlayYouTubeTrack(TRACK)).toBeNull()
    expect(providerStore.getSnapshot()).toMatchObject({
      provider: 'spotify',
  needsMapping: true,
  mappingTrackId: 'catalog-1',
  mappingTitle: 'A song',
    })
    clearMappingPrompt()
    expect(providerStore.getSnapshot().needsMapping).toBe(false)
  })

  it('retains Spotify when resolving throws or the URI is malformed', async () => {
    mocks.resolve.mockRejectedValueOnce(new Error('offline'))
    expect(await play(TRACK)).toEqual(SPOTIFY_OK)
    mocks.resolve.mockResolvedValueOnce({ kind: 'uri', uri: 'spotify:track:invalid' })
    expect(await play(TRACK)).toEqual(SPOTIFY_OK)
    expect(players).toHaveLength(0)
  })

  it.each<PlayIntent>([
    { kind: 'album', albumId: 'album-1' },
    { kind: 'uris', uris: ['spotify:track:a', 'spotify:track:b'] },
    { kind: 'context', contextUri: 'spotify:album:a', offsetUri: 'spotify:track:b' },
  ])('never resolves YouTube for $kind', async (intent) => {
    expect(await play(intent)).toEqual(SPOTIFY_OK)
    expect(mocks.resolve).not.toHaveBeenCalled()
    expect(mocks.play).toHaveBeenCalledExactlyOnceWith(intent)
  })

  it('pauses Spotify and waits for a delayed host and IFrame before mapped playback succeeds', async () => {
    const result = await play(TRACK)
    expect(result).toMatchObject({ ok: true, rung: 'in-page', degraded: false })
    expect(mocks.command).toHaveBeenCalledExactlyOnceWith({ kind: 'pause' })
    expect(mocks.play).not.toHaveBeenCalled()
    expect(players[0].videoId).toBe('abcdefghijk')
    expect(providerStore.getSnapshot()).toMatchObject({ provider: 'youtube', trackId: 'catalog-1', videoId: 'abcdefghijk' })
    expect(getYouTubeNowPlaying()).toMatchObject({ positionMs: 7000, durationMs: 180000, playing: true })
  })

  it('does not start playback when another tab retains ownership', async () => {
    mocks.ensureOwner.mockResolvedValue(false)
    expect(await play(TRACK)).toMatchObject({ ok: false, reason: 'transient' })
    expect(players).toHaveLength(0)
    expect(mocks.command).not.toHaveBeenCalled()
    expect(mocks.play).not.toHaveBeenCalled()
    expect(getActiveProvider()).toBe('spotify')
  })

  it('does not start a second player when stopping Spotify fails', async () => {
    mocks.command.mockResolvedValue({ ok: false, reason: 'transient' })
    expect(await play(TRACK)).toMatchObject({ ok: false, reason: 'transient' })
    expect(getActiveProvider()).toBe('spotify')
    expect(players).toHaveLength(0)
    expect(mocks.play).not.toHaveBeenCalled()
  })

  it.each([
    { status: 200, body: { is_playing: false } },
    { status: 204, body: null },
  ])('accepts a rejected pause only after a delayed silent Spotify response ($status)', async ({ status, body }) => {
    mocks.command.mockResolvedValue({ ok: false, reason: 'forbidden' })
    let finish!: (response: Response) => void
    mocks.fetch.mockReturnValue(new Promise<Response>((resolve) => {
      finish = resolve
    }))
    const pending = play(TRACK)
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce())
    expect(players).toHaveLength(0)
    expect(getActiveProvider()).toBe('spotify')
    expect(mocks.fetch).toHaveBeenCalledWith('https://api.spotify.com/v1/me/player', {
      headers: { Authorization: 'Bearer test' },
      signal: expect.any(AbortSignal),
    })
    finish(new Response(status === 204 ? null : JSON.stringify(body), { status }))
    expect(await pending).toMatchObject({ ok: true })
    expect(players).toHaveLength(1)
  })

  it.each([
    { status: 200, body: { is_playing: true, item: { type: 'episode' } } },
    { status: 200, body: {} },
    { status: 200, body: { is_playing: 0 } },
    { status: 200, body: null },
    { status: 200, body: false },
    { status: 503, body: { is_playing: false } },
  ])('blocks a second player when silence is unverified ($status, $body)', async ({ status, body }) => {
    mocks.command.mockResolvedValue({ ok: false, reason: 'forbidden' })
    mocks.fetch.mockImplementation(async () => {
      await lag()
      return new Response(JSON.stringify(body), { status })
    })
    expect(await play(TRACK)).toMatchObject({ ok: false, reason: 'transient' })
    expect(players).toHaveLength(0)
    expect(getActiveProvider()).toBe('spotify')
    expect(mocks.play).not.toHaveBeenCalled()
  })

  it('blocks when a silence check cannot obtain a token or parse the response', async () => {
    mocks.command.mockResolvedValue({ ok: false, reason: 'forbidden' })
    mocks.token.mockResolvedValueOnce({ ok: false, status: 'error' })
    expect(await play(TRACK)).toMatchObject({ ok: false })
    expect(mocks.fetch).not.toHaveBeenCalled()
    mocks.fetch.mockResolvedValueOnce(new Response('not JSON', { status: 200 }))
    expect(await play(TRACK)).toMatchObject({ ok: false })
    expect(players).toHaveLength(0)
  })

  it('aborts a delayed silence check after five seconds and leaves Spotify selected', async () => {
    vi.useFakeTimers()
    mocks.command.mockResolvedValue({ ok: false, reason: 'forbidden' })
    let signal!: AbortSignal
    mocks.fetch.mockImplementation((_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    })
    const pending = play(TRACK)
    await vi.advanceTimersByTimeAsync(0)
    expect(signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await pending).toMatchObject({ ok: false, reason: 'transient' })
    expect(signal.aborted).toBe(true)
    expect(players).toHaveLength(0)
    expect(getActiveProvider()).toBe('spotify')
  })

  it('settles a silence check even when token minting never resolves', async () => {
    vi.useFakeTimers()
    mocks.command.mockResolvedValue({ ok: false, reason: 'forbidden' })
    mocks.token.mockReturnValue(new Promise(() => {}))
    const settled = vi.fn()
    const pending = play(TRACK).then(settled)
    await vi.advanceTimersByTimeAsync(4999)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ ok: false, reason: 'transient' }))
    await pending
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(players).toHaveLength(0)
    expect(getActiveProvider()).toBe('spotify')
  })

  it('does not fetch or switch when a token arrives after the silence deadline', async () => {
    vi.useFakeTimers()
    mocks.command.mockResolvedValue({ ok: false, reason: 'forbidden' })
    let finish!: (token: { ok: true, token: string }) => void
    mocks.token.mockReturnValue(new Promise((resolve) => {
      finish = resolve
    }))
    const settled = vi.fn()
    const pending = play(TRACK).then(settled)
    await vi.advanceTimersByTimeAsync(5000)
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ ok: false }))
    await pending
    finish({ ok: true, token: 'late' })
    await vi.advanceTimersByTimeAsync(10)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(players).toHaveLength(0)
    expect(getActiveProvider()).toBe('spotify')
  })

  it.each(['close', 'Spotify tail'] as const)('ignores a delayed paused response after %s supersedes the request', async (action) => {
    mocks.command.mockResolvedValue({ ok: false, reason: 'forbidden' })
    let finish!: (response: Response) => void
    mocks.fetch.mockReturnValue(new Promise<Response>((resolve) => {
      finish = resolve
    }))
    const pending = play(TRACK)
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce())
    if (action === 'close')
      closeYouTubePlayer()
    else
      await play({ kind: 'uris', uris: ['spotify:track:next'] })
    finish(new Response(JSON.stringify({ is_playing: false }), { status: 200 }))
    expect(await pending).toMatchObject({ ok: false, reason: 'transient' })
    expect(players).toHaveLength(0)
    expect(getActiveProvider()).toBe('spotify')
  })

  it('allows YouTube when Spotify has no active device', async () => {
    mocks.command.mockResolvedValue({ ok: false, reason: 'no-active-device' })
    expect(await play(TRACK)).toMatchObject({ ok: true })
    expect(players).toHaveLength(1)
  })

  it('offers another video after a delayed IFrame error 150', async () => {
    errorCode = 150
    expect(await play(TRACK)).toMatchObject({ ok: false, reason: 'unavailable' })
    expect(providerStore.getSnapshot()).toMatchObject({ needsMapping: true, mappingTrackId: 'catalog-1' })
    expect(mocks.play).not.toHaveBeenCalled()
  })

  it('routes pause, resume, seek and capabilities to YouTube while active', async () => {
    await play(TRACK)
    mocks.command.mockClear()
    await sendPlayerCommand({ kind: 'pause' })
    await sendPlayerCommand({ kind: 'play' })
    await sendPlayerCommand({ kind: 'seek', positionMs: 12345 })
    expect(players[0].commands).toEqual(['pause', 'play', 'seek:12.345'])
    expect(mocks.command).not.toHaveBeenCalled()
    const unavailable = { ok: false, reason: 'no-capability' }
    expect(await sendPlayerCommand({ kind: 'next' })).toEqual(unavailable)
    expect(await sendPlaybackMode({ kind: 'shuffle', on: true })).toEqual(unavailable)
    expect(await listDevices()).toEqual(unavailable)
    expect(await transferPlayback('device')).toEqual(unavailable)
    expect(await getTrackLiked('track')).toEqual(unavailable)
    expect(await setTrackLiked('track', true)).toEqual(unavailable)
    expect(mocks.mode).not.toHaveBeenCalled()
    expect(mocks.devices).not.toHaveBeenCalled()
    expect(mocks.transfer).not.toHaveBeenCalled()
    expect(mocks.liked).not.toHaveBeenCalled()
    expect(mocks.setLiked).not.toHaveBeenCalled()
  })

  it('destroys the YouTube player before starting a Spotify tail', async () => {
    await play(TRACK)
    mocks.play.mockImplementation(async () => {
      expect(players[0].destroyed).toBe(true)
      return SPOTIFY_OK
    })
    const tail = { kind: 'uris', uris: ['spotify:track:a', 'spotify:track:b'] } as const
    await play({ ...tail, uris: [...tail.uris] })
    expect(getActiveProvider()).toBe('spotify')
    expect(getYouTubeNowPlaying()).toBeNull()
  })

  it('keeps queue transport on Spotify and destroys YouTube first', async () => {
    await play(TRACK)
    mocks.command.mockImplementation(async () => {
      expect(players[0].destroyed).toBe(true)
      return { ok: true }
    })
    await sendPlayerCommand({ kind: 'play-context', contextUri: 'spotify:album:a', offsetUri: 'spotify:track:b' })
    expect(getActiveProvider()).toBe('spotify')
  })

  it('cancels a slow resolve after a newer Spotify action', async () => {
    let resolve!: (value: UriResolution) => void
    mocks.resolve.mockReturnValueOnce(new Promise<UriResolution>((done) => {
      resolve = done
    }))
    const old = play(TRACK)
    await play({ kind: 'uris', uris: ['spotify:track:new'] })
    resolve(URI)
    expect(await old).toMatchObject({ ok: false, reason: 'transient' })
    expect(getActiveProvider()).toBe('spotify')
    expect(players).toHaveLength(0)
    expect(mocks.play).toHaveBeenCalledTimes(1)
  })

  it('closing during delayed host mount prevents hidden playback', async () => {
    const pending = play(TRACK)
    await Promise.resolve()
    await Promise.resolve()
    closeYouTubePlayer()
    expect(await pending).toMatchObject({ ok: false })
    expect(players).toHaveLength(0)
    expect(getActiveProvider()).toBe('spotify')
  })

  it('rejects a concurrent mapped start without cancelling the accepted delayed IFrame', async () => {
    unmount()
    setYouTubeHost(document.createElement('div'))
    const accepted = play(TRACK)
    for (let i = 0; i < 16; i++) await Promise.resolve()
    expect(players).toHaveLength(1)
    const concurrent = await play({ ...TRACK, trackId: 'catalog-2' })
    expect(concurrent).toMatchObject({ ok: false, reason: 'transient' })
    expect(await accepted).toMatchObject({ ok: true })
    expect(players).toHaveLength(1)
    expect(providerStore.getSnapshot().trackId).toBe('catalog-1')
  })

  it('closing a never-ready iframe settles the request and allows the next unmapped Spotify track', async () => {
    unmount()
    neverReady = true
    setYouTubeHost(document.createElement('div'))
    const pending = play(TRACK)
    for (let i = 0; i < 16; i++) await Promise.resolve()
    expect(players).toHaveLength(1)
    closeYouTubePlayer()
    expect(await pending).toMatchObject({ ok: false, reason: 'transient' })
    expect(players[0].destroyed).toBe(true)
    mocks.resolve.mockResolvedValue({ kind: 'unmapped' })
    expect(await play({ ...TRACK, trackId: 'spotify-next' })).toEqual(SPOTIFY_OK)
    expect(mocks.play).toHaveBeenCalledExactlyOnceWith({ ...TRACK, trackId: 'spotify-next' })
  })

  it('bounds a never-ready iframe and releases the startup guard after timeout', async () => {
    vi.useFakeTimers()
    unmount()
    neverReady = true
    setYouTubeHost(document.createElement('div'))
    const pending = play(TRACK)
    await vi.advanceTimersByTimeAsync(0)
    expect(players).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(10001)
    expect(await pending).toMatchObject({ ok: false, reason: 'transient' })
    expect(players[0].destroyed).toBe(true)
    expect(getActiveProvider()).toBe('spotify')
    mocks.resolve.mockResolvedValue({ kind: 'unmapped' })
    expect(await play(TRACK)).toEqual(SPOTIFY_OK)
  })

  it('cancels a never-loaded API without entering the adapter or blocking Spotify', async () => {
    unmount()
    const originalYT = (window as Window & { YT?: unknown }).YT
    delete (window as Window & { YT?: unknown }).YT
    setYouTubeHost(document.createElement('div'))
    const pending = play(TRACK)
    for (let i = 0; i < 16; i++) await Promise.resolve()
    closeYouTubePlayer()
    expect(await pending).toMatchObject({ ok: false, reason: 'transient' })
    mocks.resolve.mockResolvedValue({ kind: 'unmapped' })
    expect(await play(TRACK)).toEqual(SPOTIFY_OK)
    // A script that eventually loads must not create the cancelled iframe.
    Object.assign(window, { YT: originalYT })
    ;(window as Window & { onYouTubeIframeAPIReady?: () => void }).onYouTubeIframeAPIReady?.()
    for (let i = 0; i < 16; i++) await Promise.resolve()
    expect(players).toHaveLength(0)
    expect(getActiveProvider()).toBe('spotify')
  })

  it('a cancelled loader cannot create an iframe in the next mapped request host', async () => {
    unmount()
    const originalYT = (window as Window & { YT?: unknown }).YT
    delete (window as Window & { YT?: unknown }).YT
    setYouTubeHost(document.createElement('div'))
    const abandoned = play(TRACK)
    for (let i = 0; i < 16; i++) await Promise.resolve()
    closeYouTubePlayer()
    expect(await abandoned).toMatchObject({ ok: false })
    setYouTubeHost(document.createElement('div'))
    mocks.resolve.mockResolvedValue({ kind: 'uri', uri: 'youtube:video:lmnopqrstuv' })
    const next = play({ ...TRACK, trackId: 'catalog-2' })
    for (let i = 0; i < 16; i++) await Promise.resolve()
    Object.assign(window, { YT: originalYT })
    ;(window as Window & { onYouTubeIframeAPIReady?: () => void }).onYouTubeIframeAPIReady?.()
    expect(await next).toMatchObject({ ok: true })
    expect(players).toHaveLength(1)
    expect(players[0].videoId).toBe('lmnopqrstuv')
    expect(providerStore.getSnapshot().trackId).toBe('catalog-2')
  })

  it('bounds a blocked second API script and ignores readiness arriving after timeout', async () => {
    vi.useFakeTimers()
    unmount()
    const originalYT = (window as Window & { YT?: unknown }).YT
    delete (window as Window & { YT?: unknown }).YT
    setYouTubeHost(document.createElement('div'))
    const pending = play(TRACK)
    await vi.advanceTimersByTimeAsync(10001)
    expect(await pending).toMatchObject({ ok: false, reason: 'transient' })
    expect(getActiveProvider()).toBe('spotify')
    Object.assign(window, { YT: originalYT })
    ;(window as Window & { onYouTubeIframeAPIReady?: () => void }).onYouTubeIframeAPIReady?.()
    await vi.advanceTimersByTimeAsync(10)
    expect(players).toHaveLength(0)
    mocks.resolve.mockResolvedValue({ kind: 'unmapped' })
    expect(await play(TRACK)).toEqual(SPOTIFY_OK)
  })

  it('closing during a delayed IFrame callback leaves the player destroyed', async () => {
    unmount()
    setYouTubeHost(document.createElement('div'))
    const pending = play(TRACK)
    // Let resolve, pause, host and API readiness settle, but not the callback.
    for (let i = 0; i < 16; i++) await Promise.resolve()
    expect(players).toHaveLength(1)
    closeYouTubePlayer()
    expect(await pending).toMatchObject({ ok: false })
    expect(players[0].destroyed).toBe(true)
    expect(getYouTubeNowPlaying()).toBeNull()
  })
})
