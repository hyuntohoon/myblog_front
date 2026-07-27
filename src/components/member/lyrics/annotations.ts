// FEAT-lyrics-annotations Thread 1 — the render rules, kept out of the component
// so they can be tested without mounting anything.
//
// The spec these implement is docs/design/lyrics-annotations/README.md → "The render
// spec". Where a rule looks arbitrary here, that file carries the measurement it came
// from. Two rules are fixed and only the highlight treatment is a setting, because
// marker density runs 9.5%–64.7% per track and no single treatment survives that range.
import type { LyricsAnnotation } from './lyrics.api'

/** Highlight treatment. The one axis exposed to the reader. */
export type AnnoStyle = 'm0' | 'm1' | 'm2' | 'm3'

export const ANNO_STYLE_KEY = 'lys:anno-style'

const STYLES: readonly AnnoStyle[] = ['m0', 'm1', 'm2', 'm3'] as const

export function readAnnoStyle(): AnnoStyle {
  try {
    const v = localStorage.getItem(ANNO_STYLE_KEY) as AnnoStyle | null
    return v && STYLES.includes(v) ? v : 'm0'
  }
  catch {
    return 'm0'
  }
}

export function writeAnnoStyle(v: AnnoStyle): void {
  try {
    localStorage.setItem(ANNO_STYLE_KEY, v)
  }
  catch { /* private mode — the setting just does not persist */ }
}

/**
 * A span of 4+ segments is "long". Measured: one annotation in six clears this, and
 * the longest observed is 12. Filling all 12 turns a passage into a slab, so past
 * this threshold only the ends are filled and the gutter bracket carries the middle.
 */
export const LONG_SPAN = 4

export function spanLength(a: LyricsAnnotation): number {
  if (a.start_i == null || a.end_i == null)
    return 0
  return a.end_i - a.start_i + 1
}

export function isAnchored(a: LyricsAnnotation): boolean {
  return a.start_i != null && a.end_i != null
}

/** Where a line sits inside its annotation's span — drives the ends-only rule. */
export type LinePos = 'start' | 'middle' | 'end' | 'only'

export interface LineMark {
  anno: LyricsAnnotation
  pos: LinePos
  /**
   * What clicking this line opens. Usually just the owner; the full set only in the
   * containment case, where opening the owner alone would strand the other one.
   * Deliberately NOT the same as `sharedBy` — one drives behaviour, the other drives
   * what the reader is told.
   */
  claims: LyricsAnnotation[]
  /** How many annotations claim this line at all. >1 renders the overlap affordance. */
  sharedBy: number
  /** True when the span is long enough for the ends-only treatment. */
  long: boolean
}

/**
 * Build the per-line map: which annotation owns each segment index.
 *
 * **Overlap (B2): the shorter span owns the line.** 3 of 201 marked lines carry two
 * claims and never three. The more specific claim wins because the longer one stays
 * reachable from its own other lines — so nothing becomes unreachable.
 *
 * **The containment fallback is required and untestable from real data.** If the
 * shorter span sits entirely inside the longer one *and* the longer one has no
 * unshared line, B2 would make the longer one unreachable. Both are then kept in
 * `claims` so the caller opens both. This case does not occur in the LUX measurement,
 * so it will never show up in testing — it is implemented from the rule, not observed.
 *
 * What this replaces was never a decision: "the later annotation wins" was a side
 * effect of a loop overwriting per line, and it silently deleted the other annotation.
 */
export function buildLineMarks(annotations: LyricsAnnotation[]): Map<number, LineMark> {
  const anchored = annotations.filter(isAnchored)

  const claimsByLine = new Map<number, LyricsAnnotation[]>()
  for (const a of anchored) {
    for (let i = a.start_i!; i <= a.end_i!; i++) {
      const list = claimsByLine.get(i)
      if (list)
        list.push(a)
      else claimsByLine.set(i, [a])
    }
  }

  // An annotation is "trapped" when every one of its lines is shared — B2 would
  // never give it a line, so it can only be reached by opening the shared line's
  // whole claim set.
  const trapped = new Set<number>()
  for (const a of anchored) {
    let hasOwnLine = false
    for (let i = a.start_i!; i <= a.end_i!; i++) {
      if ((claimsByLine.get(i)?.length ?? 0) === 1) {
        hasOwnLine = true
        break
      }
    }
    if (!hasOwnLine && spanLength(a) > 1)
      trapped.add(a.id)
  }

  const marks = new Map<number, LineMark>()
  for (const [line, claims] of claimsByLine) {
    const ordered = [...claims].sort((x, y) => (x.start_i! - y.start_i!) || (x.ordinal - y.ordinal))
    // Shorter span wins; ordinal breaks a tie so the choice is deterministic.
    const owner = [...claims].sort(
      (x, y) => (spanLength(x) - spanLength(y)) || (x.ordinal - y.ordinal),
    )[0]

    const len = spanLength(owner)
    const pos: LinePos = len === 1 ?
      'only' :
      line === owner.start_i ?
        'start' :
        line === owner.end_i ? 'end' : 'middle'

    marks.set(line, {
      anno: owner,
      pos,
      // Surface the full claim set when a trapped annotation is involved, so the
      // caller can open both rather than stranding it.
      claims: ordered.some(a => trapped.has(a.id)) ? ordered : [owner],
      sharedBy: claims.length,
      long: len >= LONG_SPAN,
    })
  }
  return marks
}

/**
 * CSS classes for one lyric line. The component stays declarative; the rules live here.
 *
 * `long-mid` is the ends-only rule (A2): past the threshold, the middle keeps the
 * page's own ink and the gutter bracket is what joins the two ends.
 */
export function lineClasses(mark: LineMark | undefined, openIds: number[]): string[] {
  if (!mark)
    return []
  const out = ['lys-mark']
  if (mark.pos === 'start' || mark.pos === 'only')
    out.push('is-start')
  if (mark.pos === 'end' || mark.pos === 'only')
    out.push('is-end')
  if (mark.long && mark.pos === 'middle')
    out.push('is-long-mid')
  // Negative votes never receive the fill, in any treatment — the site would read
  // as agreeing with a reading the community rejected.
  if (mark.anno.disputed)
    out.push('is-disputed')
  if (mark.anno.status === 'repeated')
    out.push('is-repeated')
  // Two claims meeting on one line must be visible, not just handled.
  if (mark.sharedBy > 1)
    out.push('is-shared')
  if (openIds.includes(mark.anno.id))
    out.push('is-open')
  return out
}

/** Annotations that never reached the text — the drawer, marked ㄱ·ㄴ·ㄷ. */
export function drawerItems(annotations: LyricsAnnotation[]): LyricsAnnotation[] {
  return annotations.filter(a => !isAnchored(a) && a.status !== 'section')
}

const DRAWER_MARKS = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ']

export function drawerMark(idx: number): string {
  return DRAWER_MARKS[idx] ?? '·'
}

/** Section referents render on the section label, never as an in-text highlight. */
export function sectionAnnotations(annotations: LyricsAnnotation[]): LyricsAnnotation[] {
  return annotations.filter(a => a.status === 'section')
}
