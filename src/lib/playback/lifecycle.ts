import { playbackSession } from './session'

// The player island survives Astro navigation. Share one listener set across
// its bar, queue and mini views; unmounting the last surface releases it.
const surfaces = new Set<symbol>()
function refresh(): void {
  if (document.visibilityState !== 'hidden')
    void playbackSession.syncFromLive()
}

export function observePlaybackLifecycle(): () => void {
  const surface = Symbol('playback surface')
  if (surfaces.size === 0) {
    document.addEventListener('astro:page-load', refresh)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('pageshow', refresh)
    window.addEventListener('focus', refresh)
    refresh()
  }
  surfaces.add(surface)
  return () => {
    surfaces.delete(surface)
    if (surfaces.size === 0) {
      document.removeEventListener('astro:page-load', refresh)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('pageshow', refresh)
      window.removeEventListener('focus', refresh)
    }
  }
}
