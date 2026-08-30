import type { PlaybackSessionState } from '@lib/playback/session'
import { canControlPlayback } from '@lib/playback/ownership'
import { playbackSession } from '@lib/playback/session'

/**
 * The one offer a mirror tab can honestly make.
 *
 * Rendered exactly when `canControlPlayback` is false — this tab is a mirror whose
 * owner holds the in-page SDK device, so the audio lives in that other tab and the
 * only way to move it here is to take the lease. Every surface that withholds
 * transport for that reason renders THIS, so the wording and the action cannot
 * drift apart: it lives in its own module rather than in `PlaybackPanel.tsx`
 * (ARCH-playback-authority-convergence Step 1, OQ2) because the lyrics viewer
 * cannot import a 600-line panel, which is how it came to ship a hand-copied
 * banner in the first place.
 *
 * `className` exists because the hosts lay it out differently — the pocket panel
 * stacks it, the lyrics transport spans it across a grid — while the markup, the
 * copy and the predicate stay single-sourced.
 */
export function PlaybackOwnerBanner({ state, className = 'pbp-owner-banner' }: {
  state: PlaybackSessionState
  className?: string
}) {
  if (canControlPlayback(state))
    return null
  return (
    <div className={className} role="status">
      <span>다른 탭에서 재생 중이에요</span>
      <button type="button" onClick={() => void playbackSession.takeOver()}>이 탭에서 재생하기</button>
    </div>
  )
}
