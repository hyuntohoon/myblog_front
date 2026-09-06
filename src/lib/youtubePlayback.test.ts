// FEAT-youtube-playback-provider Step A4 — the adapter.
//
// THE STUB SLEEPS. `onReady` and `onError` are callbacks the real IFrame API
// fires asynchronously, and an instant stub erases the window in which a caller
// can be wrong about ordering — this project has shipped a bug that way before
// (a same-shape defect was invisible until the stub was given a delay). Every
// player here settles on a timer, not in the constructor.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __resetYouTubePlayback,
  getLastErrorCode,
  getNowPlaying,
  getStreamingToken,
  getTrackLiked,
  listDevices,
  MYBLOG_PLAYBACK_CHANGED,
  play,
  sendPlaybackMode,
  sendPlayerCommand,
  setTrackLiked,
  setYouTubeHost,
  transferPlayback,
  videoIdFromUri,
} from './youtubePlayback'

const LAG = 5

interface StubOpts { error?: number, state?: number, current?: number, duration?: number }

/** A YT.Player stand-in whose callbacks fire LATE, like the real one's. */
function installYT(opts: StubOpts = {}) {
  const instances: any[] = []
  class StubPlayer {
    events: any
    destroyed = false
    loaded: string[] = []
    commands: string[] = []
    constructor(_el: any, cfg: any) {
      this.events = cfg.events
      instances.push(this)
      setTimeout(() => {
        if (opts.error !== undefined)
          this.events.onError?.({ data: opts.error })
        else this.events.onReady?.({ target: this })
      }, LAG)
    }

    loadVideoById(id: string) { this.loaded.push(id) }
    playVideo() { this.commands.push('play') }
    pauseVideo() { this.commands.push('pause') }
    seekTo(s: number) { this.commands.push(`seek:${s}`) }
    getPlayerState() { return opts.state ?? 1 }
    getCurrentTime() { return opts.current ?? 0 }
    getDuration() { return opts.duration ?? 0 }
    destroy() { this.destroyed = true }
  }
  ;(window as any).YT = { Player: StubPlayer }
  return instances
}

beforeEach(() => {
  __resetYouTubePlayback()
  // The API is already "loaded" for these tests; loadIframeApi resolves
  // immediately when window.YT.Player exists, which is the real fast path too.
  installYT()
  setYouTubeHost(document.createElement('div'))
})

afterEach(() => {
  setYouTubeHost(null)
  delete (window as any).YT
  __resetYouTubePlayback()
})

describe('videoIdFromUri', () => {
  it('accepts the URI the backend returns', () => {
    expect(videoIdFromUri('youtube:video:dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it.each([
    'spotify:track:abc',
    'youtube:video:tooshort',
    'youtube:video:way-too-long-for-an-id',
    'youtube:playlist:dQw4w9WgXcQ',
    '',
  ])('rejects %s', (uri) => {
    expect(videoIdFromUri(uri)).toBeNull()
  })
})

describe('play', () => {
  it('resolves only after onReady fires, not at construction', async () => {
    const instances = installYT()
    setYouTubeHost(document.createElement('div'))
    let settled = false
    const p = play({ kind: 'track', videoId: 'dQw4w9WgXcQ' }).then((o) => {
      settled = true
      return o
    })
    // `play` awaits loadIframeApi first, so the player does not exist on the
    // very next line — drain the microtask queue, then look. (An earlier
    // revision asserted synchronously, failed, and therefore never awaited `p`;
    // that player's LATE callback then fired during the NEXT test and made an
    // unrelated assertion fail. A stub that models lag models it for the
    // teardown too.)
    await Promise.resolve()
    await Promise.resolve()
    // The player now exists and has NOT called back yet. An instant stub would
    // make this assertion impossible to write and the ordering impossible to check.
    expect(instances.length).toBe(1)
    expect(settled).toBe(false)
    await expect(p).resolves.toMatchObject({ ok: true, rung: 'in-page', degraded: false })
  })

  it('emits the cross-island signal on success', async () => {
    const seen: string[] = []
    const onChanged = () => seen.push('changed')
    window.addEventListener(MYBLOG_PLAYBACK_CHANGED, onChanged)
    await play({ kind: 'track', videoId: 'dQw4w9WgXcQ' })
    window.removeEventListener(MYBLOG_PLAYBACK_CHANGED, onChanged)
    expect(seen).toEqual(['changed'])
  })

  it('reuses the player for a second track instead of rebuilding', async () => {
    const instances = installYT()
    setYouTubeHost(document.createElement('div'))
    await play({ kind: 'track', videoId: 'dQw4w9WgXcQ' })
    await play({ kind: 'track', videoId: 'kffacxfA7G4' })
    expect(instances.length).toBe(1)
    expect(instances[0].loaded).toEqual(['kffacxfA7G4'])
  })

  it('with no dock mounted is TRANSIENT, not no-capability', async () => {
    // 'no-capability' is documented as durable and callers may disable on it.
    // "the player is not open" is fixed by one click, so calling it durable
    // would leave a member permanently unable to play for no reason.
    setYouTubeHost(null)
    await expect(play({ kind: 'track', videoId: 'dQw4w9WgXcQ' })).resolves.toMatchObject({
      ok: false,
      reason: 'transient',
    })
  })
})

describe('onError is always `unavailable`', () => {
  // MEASURED 2026-09-06 against the real IFrame API: embed-disabled AND four
  // separate deleted/private/absent ids all returned 150. `100` was produced by
  // NOTHING, so the RFC's `100` → "video not found" branch would be dead code.
  it.each([150, 101, 100, 5, 2])('code %i maps to unavailable', async (code) => {
    installYT({ error: code })
    setYouTubeHost(document.createElement('div'))
    await expect(play({ kind: 'track', videoId: 'dQw4w9WgXcQ' })).resolves.toMatchObject({
      ok: false,
      reason: 'unavailable',
    })
    expect(getLastErrorCode()).toBe(code)
  })

  it('keeps the raw code for diagnostics but never for branching', async () => {
    // The code is recorded so a future measurement can contradict this one.
    // What must NOT happen is a branch on it — the discriminator between "gone"
    // and "embed-disabled" is `videos.list` in the A5 job.
    installYT({ error: 150 })
    setYouTubeHost(document.createElement('div'))
    const a = await play({ kind: 'track', videoId: 'dQw4w9WgXcQ' })
    installYT({ error: 100 })
    setYouTubeHost(document.createElement('div'))
    const b = await play({ kind: 'track', videoId: 'kffacxfA7G4' })
    expect(a).toEqual(b)
  })
})

describe('sendPlayerCommand', () => {
  it('drives the player once one exists', async () => {
    const instances = installYT()
    setYouTubeHost(document.createElement('div'))
    await play({ kind: 'track', videoId: 'dQw4w9WgXcQ' })

    expect(sendPlayerCommand({ kind: 'pause' })).toEqual({ ok: true })
    expect(sendPlayerCommand({ kind: 'play' })).toEqual({ ok: true })
    expect(sendPlayerCommand({ kind: 'seek', positionMs: 30_000 })).toEqual({ ok: true })
    expect(instances[0].commands).toEqual(['pause', 'play', 'seek:30'])
  })

  it('before anything plays is `no-active-device`, not `no-capability`', () => {
    // Recoverable in the same sense Spotify's 404 is: start something and the
    // very same command works. Folding it into 'no-capability' is the mistake
    // the Spotify adapter's own comment warns about.
    expect(sendPlayerCommand({ kind: 'play' })).toEqual({ ok: false, reason: 'no-active-device' })
  })
})

describe('getNowPlaying', () => {
  it('is null before anything plays', () => {
    expect(getNowPlaying()).toBeNull()
  })

  it('reports position and duration in MILLISECONDS', async () => {
    // The IFrame API speaks seconds and every consumer in this codebase speaks
    // milliseconds. Getting this wrong makes a 3-minute track look 3ms long.
    installYT({ state: 1, current: 42.5, duration: 213 })
    setYouTubeHost(document.createElement('div'))
    await play({ kind: 'track', videoId: 'dQw4w9WgXcQ' })
    expect(getNowPlaying()).toEqual({
      videoId: 'dQw4w9WgXcQ',
      playing: true,
      positionMs: 42_500,
      durationMs: 213_000,
    })
  })

  it('reports playing:false for a paused player', async () => {
    installYT({ state: 2 })
    setYouTubeHost(document.createElement('div'))
    await play({ kind: 'track', videoId: 'dQw4w9WgXcQ' })
    expect(getNowPlaying()?.playing).toBe(false)
  })
})

describe('unmounting the dock destroys the player', () => {
  it('does not leave audio playing with nothing on screen', async () => {
    // An orphaned IFrame keeps playing with no visible player, which is exactly
    // the background-playback shape YouTube's Terms forbid.
    const instances = installYT()
    setYouTubeHost(document.createElement('div'))
    await play({ kind: 'track', videoId: 'dQw4w9WgXcQ' })

    setYouTubeHost(null)

    expect(instances[0].destroyed).toBe(true)
    expect(getNowPlaying()).toBeNull()
  })
})

describe('what YouTube does not have', () => {
  it.each([
    ['listDevices', listDevices],
    ['transferPlayback', transferPlayback],
    ['getTrackLiked', getTrackLiked],
    ['setTrackLiked', setTrackLiked],
    ['sendPlaybackMode', sendPlaybackMode],
    ['getStreamingToken', getStreamingToken],
  ])('%s returns the SHIPPED no-capability outcome', (_name, fn) => {
    // The existing UI already renders this reason. A fourth reason would mean
    // touching every consumer for a state they already have a sentence for.
    expect(fn()).toEqual({ ok: false, reason: 'no-capability' })
  })
})
