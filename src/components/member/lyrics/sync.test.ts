// FEAT-lyrics-sync-precision Step 1 — the focus scheduler's two pure pieces.
//
// The scheduler itself lives inside LyricsViewer (timers + refs), but its
// correctness reduces to one invariant these two functions have to satisfy
// together: waking at `nextBoundaryMs(E)` must advance `focusIndexForMs` by
// exactly one timed segment, for every E. If that holds, "arm a timer for the
// next boundary" is equivalent to the old "poll every 250ms and diff" — minus
// the 0-250ms lateness.
import type { LyricsSegment } from './lyrics.api'
import { describe, expect, it } from 'vitest'
import { focusIndexForMs, nextBoundaryMs } from './LyricsViewer'

/** Build segments the way normalize_lyrics does: `i` is the array position. */
function segs(...starts: Array<number | null>): LyricsSegment[] {
  return starts.map((start_ms, i) => ({ i, text: `line ${i}`, start_ms }))
}

describe('nextBoundaryMs', () => {
  it('returns the first start strictly after ms', () => {
    expect(nextBoundaryMs(segs(0, 1000, 2000), 500)).toBe(1000)
  })

  it('is strictly-after, so sitting exactly on a boundary looks ahead', () => {
    // The scheduler computes the focus at E and then asks for the next wake.
    // A >= comparison here would arm a 0ms timer and spin on the same line.
    expect(nextBoundaryMs(segs(0, 1000, 2000), 1000)).toBe(2000)
  })

  it('returns null past the last timed segment', () => {
    expect(nextBoundaryMs(segs(0, 1000, 2000), 2000)).toBeNull()
    expect(nextBoundaryMs(segs(0, 1000, 2000), 99_999)).toBeNull()
  })

  it('skips untimed segments (mixed plain/synced rows)', () => {
    expect(nextBoundaryMs(segs(0, null, 2000), 500)).toBe(2000)
  })

  it('returns null when nothing is timed at all (plain-only row)', () => {
    expect(nextBoundaryMs(segs(null, null), 0)).toBeNull()
  })

  it('handles a seek backwards — an anchor re-seeded to an earlier position', () => {
    expect(nextBoundaryMs(segs(0, 1000, 2000, 3000), 900)).toBe(1000)
  })
})

describe('scheduler invariant: waking at the boundary advances exactly one line', () => {
  it('holds across a normal synced row', () => {
    const s = segs(0, 1200, 4800, 4800, 9000)
    for (const from of [0, 1, 500, 1199, 1200, 4799, 4800, 8999]) {
      const before = focusIndexForMs(s, from)
      const boundary = nextBoundaryMs(s, from)
      if (boundary == null)
        continue
      const after = focusIndexForMs(s, boundary)
      expect(after).toBeGreaterThan(before)
      // Duplicate starts (two lines stamped at the same ms) legitimately jump
      // more than one index — focusIndexForMs takes the LAST match. Anything
      // else must be a single step.
      const dupes = s.filter(x => x.start_ms === boundary).length
      expect(after - before).toBeLessThanOrEqual(dupes)
    }
  })

  it('never arms a timer in the past', () => {
    const s = segs(0, 1200, 4800, 9000)
    for (const from of [0, 600, 1200, 4801]) {
      const boundary = nextBoundaryMs(s, from)
      if (boundary != null)
        expect(boundary - from).toBeGreaterThan(0)
    }
  })

  it('terminates: the last line arms nothing, so the scheduler goes quiet', () => {
    const s = segs(0, 1200, 4800)
    expect(focusIndexForMs(s, 4800)).toBe(2)
    expect(nextBoundaryMs(s, 4800)).toBeNull()
  })
})

describe('focusIndexForMs (pre-existing, pinned here as the scheduler depends on it)', () => {
  it('selects the last segment starting at or before ms', () => {
    const s = segs(0, 1200, 4800)
    expect(focusIndexForMs(s, 0)).toBe(0)
    expect(focusIndexForMs(s, 1199)).toBe(0)
    expect(focusIndexForMs(s, 1200)).toBe(1)
    expect(focusIndexForMs(s, 10_000)).toBe(2)
  })

  it('clamps to the first line before the first start (lead can go negative-ish)', () => {
    expect(focusIndexForMs(segs(3000, 6000), 0)).toBe(0)
  })
})
