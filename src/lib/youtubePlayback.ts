// FEAT-youtube-playback-provider Step A4 — the YouTube IFrame Player adapter.
//
// WHAT THIS IS. A second playback transport with the same OUTCOME shapes as
// `spotifyPlayback.ts`, so the session layer can dispatch on a provider without
// learning a second vocabulary. It is not a peer in capability and does not
// pretend to be: YouTube has no Connect devices, no library, no shuffle/repeat
// grant, and no streaming token. Those calls return the SHIPPED
// `'no-capability'` outcome, which the existing UI already renders — adding a
// fourth reason would mean touching every consumer for a state they already
// have a sentence for.
//
// ERROR CODES — MEASURED, AND THE RFC WAS WRONG. Phase 0-A step 3 (2026-09-06)
// played eight videos through the real IFrame API:
//
//   embeddable control x2        → plays, no error
//   embedding disabled by owner  → 150
//   deleted / private / absent x4 → 150   ← NOT 100
//
// `100` was produced by NOTHING. The RFC documented `100` as "video not found"
// and this adapter was specced to branch on it; that branch would be dead code.
// So: any onError is `'unavailable'`, and **the adapter does not attempt to
// distinguish "gone" from "embed-disabled"** — it cannot. `videos.list` in the
// Step-A5 refresh job is the only thing that can, which is exactly what
// `verify_state` is for.
//
// A CONTROL CAUGHT A HARNESS DEFECT IN THAT MEASUREMENT and it is worth
// recording next to the result: served from `http://127.0.0.1` every case
// returned 150, INCLUDING the embeddable control. Re-served from
// `http://lvh.me` the control played and the discrimination appeared. Without
// the control this file would have been written against "the API returns 150
// for everything", which is false.
//
// THE PLAYER MUST BE VISIBLE. YouTube's Terms forbid background/audio-only
// playback and require the player to be at least 200x200 and unobstructed —
// which is why the dock exists at all and why nothing may be drawn over it.
// That rules out reusing the lyrics blur backdrop.

/** Emitted after a YouTube target starts, mirroring the Spotify signal. */
export const MYBLOG_PLAYBACK_CHANGED = 'myblog:playback-changed'

/** IFrame API player states. `-1` unstarted, `0` ended, `1` playing, `2` paused, `3` buffering, `5` cued. */
export type YouTubePlayerState = -1 | 0 | 1 | 2 | 3 | 5

export interface YouTubeNowPlaying {
	videoId: string
	playing: boolean
	positionMs: number
	durationMs: number
}

/** The DOM element the dock owns. Set by the dock on mount, cleared on unmount. */
let hostElement: HTMLElement | null = null
let player: any = null
let currentVideoId: string | null = null
let lastError: number | null = null
let apiPromise: Promise<void> | null = null

/** Test seam — module-level state must be resettable between tests. */
export function __resetYouTubePlayback(): void {
  player = null
  currentVideoId = null
  lastError = null
  apiPromise = null
  hostElement = null
}

export function setYouTubeHost(el: HTMLElement | null): void {
  hostElement = el
  if (el === null) {
    // The dock unmounted. Drop the player with it — an orphaned IFrame keeps
    // playing audio with nothing on screen, which is precisely the
    // background-playback shape the Terms forbid.
    try {
      player?.destroy?.()
    }
    catch {
      // A destroy that throws must not take the caller down; the reference is
      // dropped either way.
    }
    player = null
    currentVideoId = null
  }
}

export function getYouTubeHost(): HTMLElement | null {
  return hostElement
}

/**
 * Load `https://www.youtube.com/iframe_api` once.
 *
 * CSP: `script-src` and `frame-src` allow `www.youtube.com` and
 * `www.youtube-nocookie.com` (applied 2026-09-06). If this ever fails silently,
 * READ THE CONSOLE FOR "Refused to load the script" BEFORE concluding the
 * player is broken — `/iframe_api` injects a second script whose URL is chosen
 * server-side, and Google has historically served it from `s.ytimg.com`, which
 * is deliberately NOT allowlisted.
 */
export function loadIframeApi(): Promise<void> {
  if (apiPromise)
    return apiPromise
  apiPromise = new Promise<void>((resolve, reject) => {
    const w = window as any
    if (w.YT?.Player) {
      resolve()
      return
    }
    const prior = w.onYouTubeIframeAPIReady
    w.onYouTubeIframeAPIReady = () => {
      try {
        prior?.()
      }
      catch { /* a foreign hook must not block ours */ }
      resolve()
    }
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    s.async = true
    s.onerror = () => reject(new Error('iframe_api failed to load'))
    document.head.appendChild(s)
  })
  return apiPromise
}

// ── outcome shapes, mirrored from spotifyPlayback.ts ─────────────────────────
//
// Mirrored rather than imported: the two adapters must be swappable by the
// dispatcher without either importing the other, and a shared types module for
// six type aliases would be indirection for its own sake. The dispatcher's
// tests assert the shapes agree, so the duplication is checked rather than
// trusted.

export type YouTubePlayIntent =
	| { kind: 'track', videoId: string, title?: string }

export interface YouTubePlaySuccess { ok: true, rung: 'in-page', degraded: false, message: string }
export interface YouTubePlayFailure {
	ok: false
	reason: 'no-capability' | 'unresolvable' | 'unavailable' | 'transient'
	message: string
}
export type YouTubePlayOutcome = YouTubePlaySuccess | YouTubePlayFailure

export type YouTubePlayerCommand =
	| { kind: 'play' } | { kind: 'pause' } | { kind: 'seek', positionMs: number }

export type YouTubeCommandOutcome =
	| { ok: true } | { ok: false, reason: 'no-capability' | 'no-active-device' | 'transient' }

const PLAY_MESSAGE = 'YouTube에서 재생 중'
/** The dock is not mounted, so there is nowhere a visible player could go. */
const NO_HOST_MESSAGE = '재생하려면 플레이어를 먼저 열어주세요'
const UNAVAILABLE_MESSAGE = '이 영상은 재생할 수 없어요. 다른 영상을 골라주세요'

/**
 * ANY onError is `'unavailable'`. Measured 2026-09-06: embed-disabled AND four
 * separate deleted/private/absent ids all return `150`, and `100` was produced
 * by nothing — so a `code === 100` branch would be dead. Distinguishing "gone"
 * from "embed-disabled" is `videos.list`'s job in the A5 refresh, not the
 * player's.
 */
function errorOutcome(): YouTubePlayFailure {
  return { ok: false, reason: 'unavailable', message: UNAVAILABLE_MESSAGE }
}

/** `youtube:video:<id>` → `<id>`. Returns null for anything else. */
export function videoIdFromUri(uri: string): string | null {
  const m = /^youtube:video:([\w-]{11})$/.exec(uri)
  return m ? m[1] : null
}

export async function play(intent: YouTubePlayIntent): Promise<YouTubePlayOutcome> {
  if (!hostElement) {
    // NOT 'no-capability': the account can play, the surface simply is not open.
    // 'no-capability' is documented as durable and callers may disable on it,
    // which would be wrong for a state one click fixes.
    return { ok: false, reason: 'transient', message: NO_HOST_MESSAGE }
  }
  try {
    await loadIframeApi()
  }
  catch {
    return { ok: false, reason: 'transient', message: '플레이어를 불러오지 못했어요' }
  }

  lastError = null
  const w = window as any
  return new Promise<YouTubePlayOutcome>((resolve) => {
    let settled = false
    const done = (o: YouTubePlayOutcome): void => {
      if (settled)
        return
      settled = true
      resolve(o)
    }

    const onError = (e: { data: number }): void => {
      lastError = e?.data ?? null
      done(errorOutcome())
    }
    const onReady = (): void => {
      currentVideoId = intent.videoId
      // Dispatched here rather than by the caller, mirroring Spotify: the
      // cross-island listeners key off this event and must not need to know
      // which provider produced it.
      window.dispatchEvent(new CustomEvent(MYBLOG_PLAYBACK_CHANGED))
      done({ ok: true, rung: 'in-page', degraded: false, message: PLAY_MESSAGE })
    }

    if (player && currentVideoId !== null) {
      // Reuse the existing player. Rebuilding it per track drops the iframe and
      // reloads the whole widget, which is both slower and a visible flash.
      try {
        player.loadVideoById(intent.videoId)
        currentVideoId = intent.videoId
        window.dispatchEvent(new CustomEvent(MYBLOG_PLAYBACK_CHANGED))
        done({ ok: true, rung: 'in-page', degraded: false, message: PLAY_MESSAGE })
        return
      }
      catch {
        // Fall through and rebuild.
        player = null
      }
    }

    try {
      player = new w.YT.Player(hostElement, {
        videoId: intent.videoId,
        playerVars: { autoplay: 1, playsinline: 1, rel: 0 },
        events: { onReady, onError },
      })
    }
    catch {
      done({ ok: false, reason: 'transient', message: '플레이어를 만들지 못했어요' })
    }
  })
}

export function sendPlayerCommand(cmd: YouTubePlayerCommand): YouTubeCommandOutcome {
  if (!player) {
    // Recoverable in the same sense Spotify's 404 is: start something and the
    // very same command works. Folding it into 'no-capability' is the mistake
    // the Spotify adapter's own comment warns about.
    return { ok: false, reason: 'no-active-device' }
  }
  try {
    if (cmd.kind === 'play')
      player.playVideo()
    else if (cmd.kind === 'pause')
      player.pauseVideo()
    else player.seekTo(cmd.positionMs / 1000, true)
    return { ok: true }
  }
  catch {
    return { ok: false, reason: 'transient' }
  }
}

/** Position/duration for the progress UI. Null when nothing is loaded. */
export function getNowPlaying(): YouTubeNowPlaying | null {
  if (!player || !currentVideoId)
    return null
  try {
    const state = player.getPlayerState?.() as YouTubePlayerState | undefined
    return {
      videoId: currentVideoId,
      playing: state === 1,
      positionMs: Math.round((player.getCurrentTime?.() ?? 0) * 1000),
      durationMs: Math.round((player.getDuration?.() ?? 0) * 1000),
    }
  }
  catch {
    return null
  }
}

/** The last `onError` code, for diagnostics only — never for branching. */
export function getLastErrorCode(): number | null {
  return lastError
}

// ── what YouTube does not have ───────────────────────────────────────────────
//
// Each returns the SHIPPED 'no-capability' outcome, which the existing UI
// already renders as "이 계정/기기에선 재생 제어를 사용할 수 없어요". Adding a
// fourth reason would mean touching every consumer for a state they already
// have a sentence for.
//
// These are functions rather than a capability flag the caller reads because
// the dispatcher calls them uniformly; a flag would put the branch in every
// call site instead of once here.

export function listDevices(): { ok: false, reason: 'no-capability' } {
  // There is no Connect equivalent. The player IS the device.
  return { ok: false, reason: 'no-capability' }
}

export function transferPlayback(): { ok: false, reason: 'no-capability' } {
  return { ok: false, reason: 'no-capability' }
}

export function getTrackLiked(): { ok: false, reason: 'no-capability' } {
  // Library state is Milestone B (OAuth) and gated on Phase 0-B.
  return { ok: false, reason: 'no-capability' }
}

export function setTrackLiked(): { ok: false, reason: 'no-capability' } {
  return { ok: false, reason: 'no-capability' }
}

export function sendPlaybackMode(): { ok: false, reason: 'no-capability' } {
  // Shuffle/repeat/volume are Connect-device commands; the IFrame player has no
  // analogue our UI could drive meaningfully.
  return { ok: false, reason: 'no-capability' }
}

export function getStreamingToken(): { ok: false, reason: 'no-capability' } {
  // No token exists. The IFrame player authenticates nothing.
  return { ok: false, reason: 'no-capability' }
}
