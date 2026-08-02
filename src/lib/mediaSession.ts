// FEAT-member-player Step 5 — OS media integration for the in-page device.
//
// Not decoration. The moment this tab emits audio, the OS media keys, the lock
// screen and headset buttons have to reach it, or the sound has no visible source
// and no way to stop it except finding the tab. Chrome will also show a generic
// "site is playing" entry with no metadata if we say nothing — worse than silence.
//
// Scope: this only makes sense while **rung 2** owns the sound. On rung 1 a real
// Connect device is playing and its own app owns the OS surface; claiming it here
// would put a second, competing control on the lock screen.
import { getActiveRung, sendPlayerCommand } from '@lib/spotifyPlayback'

export interface NowPlayingMeta {
  title: string
  artist?: string
  album?: string
  artwork?: string
}

type Handler = () => void

interface Callbacks {
  onPlay: Handler
  onPause: Handler
  onNext: Handler
  onPrevious: Handler
  onSeek?: (positionMs: number) => void
}

function supported(): boolean {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator
}

/**
 * Publish what is playing to the OS. Called with `null` to clear.
 *
 * `MediaMetadata` is constructed defensively: it is absent in a few engines that
 * still expose `navigator.mediaSession`, and throwing here would break the caller's
 * render path for a cosmetic feature.
 */
export function publishNowPlaying(meta: NowPlayingMeta | null): void {
  if (!supported())
    return
  if (getActiveRung() !== 'in-page') {
    // A real device owns the OS surface — do not compete with its own app.
    navigator.mediaSession.metadata = null
    return
  }
  if (!meta) {
    navigator.mediaSession.metadata = null
    return
  }
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: meta.title,
      artist: meta.artist ?? '',
      album: meta.album ?? '',
      artwork: meta.artwork ? [{ src: meta.artwork, sizes: '512x512', type: 'image/jpeg' }] : [],
    })
  }
  catch {
    // MediaMetadata unavailable — the action handlers below still work.
  }
}

/** Reflect play/pause so the OS control shows the right glyph. */
export function publishPlaybackState(paused: boolean): void {
  if (!supported())
    return
  navigator.mediaSession.playbackState = getActiveRung() === 'in-page' ?
    (paused ? 'paused' : 'playing') :
    'none'
}

/** Publish position so the lock screen scrubber is not a lie. */
export function publishPosition(durationMs: number, positionMs: number): void {
  if (!supported() || getActiveRung() !== 'in-page')
    return
  if (!Number.isFinite(durationMs) || durationMs <= 0)
    return
  try {
    navigator.mediaSession.setPositionState({
      duration: durationMs / 1000,
      position: Math.min(Math.max(positionMs, 0), durationMs) / 1000,
      playbackRate: 1,
    })
  }
  catch {
    // Older engines reject non-monotonic updates; a stale scrubber is acceptable.
  }
}

/**
 * Bind the OS transport controls. Returns a teardown that clears every handler —
 * leaving a stale one bound after unmount would keep a dead tab on the lock screen.
 */
export function bindMediaSessionHandlers(cb: Callbacks): () => void {
  if (!supported())
    return () => {}

  const entries: [MediaSessionAction, MediaSessionActionHandler][] = [
    ['play', () => cb.onPlay()],
    ['pause', () => cb.onPause()],
    ['nexttrack', () => cb.onNext()],
    ['previoustrack', () => cb.onPrevious()],
  ]
  if (cb.onSeek) {
    entries.push(['seekto', (details) => {
      if (typeof details.seekTime === 'number')
        cb.onSeek?.(details.seekTime * 1000)
    }])
  }

  const bound: MediaSessionAction[] = []
  for (const [action, handler] of entries) {
    try {
      navigator.mediaSession.setActionHandler(action, handler)
      bound.push(action)
    }
    catch {
      // Unsupported action on this engine — skip it, keep the rest.
    }
  }

  return () => {
    for (const action of bound) {
      try {
        navigator.mediaSession.setActionHandler(action, null)
      }
      catch {}
    }
    if (supported())
      navigator.mediaSession.playbackState = 'none'
  }
}

/**
 * The default wiring: OS controls drive the same transport the player bar uses.
 * Exposed separately so a caller with its own optimistic UI can bind richer
 * handlers instead of these.
 */
export function defaultMediaSessionCallbacks(refresh: () => void): Callbacks {
  return {
    onPlay: () => void sendPlayerCommand({ kind: 'play' }).then(refresh),
    onPause: () => void sendPlayerCommand({ kind: 'pause' }).then(refresh),
    onNext: () => void sendPlayerCommand({ kind: 'next' }).then(refresh),
    onPrevious: () => void sendPlayerCommand({ kind: 'previous' }).then(refresh),
    onSeek: positionMs => void sendPlayerCommand({ kind: 'seek', positionMs }).then(refresh),
  }
}
