// FEAT-member-player Step 3 — the clock-estimate anchor, extracted from the
// lyrics viewer (FEAT-lyrics-auto-progression Step 1) so the player bar and the
// lyrics viewer share one estimation idiom: a playback position `ms` captured
// at the wall-clock instant `wallMs` (performance.now() timeline); the current
// position is estimated as `ms + (now − wallMs)`. Anchors are seeded/re-seeded
// only by explicit one-shot reads — no polling anywhere (D28).
import { useEffect, useState } from 'react'

/** Cadence for continuous estimate consumers (matches the lyrics loop grain). */
export const ESTIMATE_INTERVAL_MS = 250

export interface ClockAnchor {
  /** Playback position (ms into the track) at the anchor instant. */
  ms: number
  /** performance.now() instant the position was measured at. */
  wallMs: number
}

/** Estimated playback position for `anchor` at `nowMs` (defaults to now). */
export function estimateMs(anchor: ClockAnchor, nowMs: number = performance.now()): number {
  return anchor.ms + (nowMs - anchor.wallMs)
}

/**
 * Continuously estimated playback position for a progress bar (member-player
 * Step 3). While `running`, ticks every ESTIMATE_INTERVAL_MS (paused while the
 * tab is hidden — it catches up on the next visible tick, since the estimate is
 * wall-clock-derived, not accumulated). While NOT running (client-side pause),
 * holds at `anchor.ms` without ticking — callers re-anchor on pause/resume so
 * the frozen position is exact. Clamped to `maxMs` when known, so an aged
 * anchor never runs the bar past the track end. `null` anchor → `null`.
 */
export function useClockEstimate(anchor: ClockAnchor | null, running: boolean, maxMs: number | null): number | null {
  const [est, setEst] = useState<number | null>(null)
  useEffect(() => {
    if (!anchor) {
      setEst(null)
      return
    }
    const compute = () => {
      const raw = running ? estimateMs(anchor) : anchor.ms
      setEst(maxMs != null ? Math.min(raw, maxMs) : raw)
    }
    compute()
    if (!running)
      return
    const tick = () => {
      if (!document.hidden)
        compute()
    }
    const id = window.setInterval(tick, ESTIMATE_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [anchor, running, maxMs])
  return est
}
