// The render rules from docs/design/lyrics-annotations/README.md → "The render spec".
// These pin the two decisions that replaced accidents, so a later refactor cannot
// quietly reintroduce either:
//   * overlap goes to the SHORTER span, not to whichever was processed last
//   * a long span is filled at its ends only, not straight through
import { describe, expect, it } from 'vitest'
import type { LyricsAnnotation } from './lyrics.api'
import { buildLineMarks, drawerItems, drawerMark, lineClasses, LONG_SPAN, spanLength } from './annotations'

function anno(partial: Partial<LyricsAnnotation> & { id: number }): LyricsAnnotation {
  return {
    ordinal: partial.id,
    status: 'unique',
    fragment: 'x',
    occurrences: 1,
    votes_total: 0,
    disputed: false,
    translation_status: 'done',
    ...partial,
  } as LyricsAnnotation
}

describe('spanLength', () => {
  it('counts an inclusive range', () => {
    expect(spanLength(anno({ id: 1, start_i: 3, end_i: 3 }))).toBe(1)
    expect(spanLength(anno({ id: 2, start_i: 3, end_i: 6 }))).toBe(4)
  })

  it('is 0 for an unanchored annotation', () => {
    expect(spanLength(anno({ id: 3 }))).toBe(0)
  })
})

describe('overlap — the shorter span owns the line', () => {
  it('gives a shared line to the more specific claim', () => {
    // 4-line span and a 1-line span both claim line 2.
    const wide = anno({ id: 1, ordinal: 1, start_i: 0, end_i: 3 })
    const narrow = anno({ id: 2, ordinal: 2, start_i: 2, end_i: 2 })
    const marks = buildLineMarks([wide, narrow])
    expect(marks.get(2)!.anno.id).toBe(2)
  })

  it('does not strand the wider annotation — it keeps its own lines', () => {
    const wide = anno({ id: 1, ordinal: 1, start_i: 0, end_i: 3 })
    const narrow = anno({ id: 2, ordinal: 2, start_i: 2, end_i: 2 })
    const marks = buildLineMarks([wide, narrow])
    expect([0, 1, 3].map(i => marks.get(i)!.anno.id)).toEqual([1, 1, 1])
  })

  it('is independent of input order — the old behaviour was not', () => {
    const wide = anno({ id: 1, ordinal: 1, start_i: 0, end_i: 3 })
    const narrow = anno({ id: 2, ordinal: 2, start_i: 2, end_i: 2 })
    expect(buildLineMarks([wide, narrow]).get(2)!.anno.id)
      .toBe(buildLineMarks([narrow, wide]).get(2)!.anno.id)
  })

  it('breaks a same-length tie by ordinal, deterministically', () => {
    const a = anno({ id: 7, ordinal: 9, start_i: 1, end_i: 1 })
    const b = anno({ id: 8, ordinal: 2, start_i: 1, end_i: 1 })
    expect(buildLineMarks([a, b]).get(1)!.anno.id).toBe(8)
    expect(buildLineMarks([b, a]).get(1)!.anno.id).toBe(8)
  })

  it('opens BOTH when the wider annotation has no unshared line (containment fallback)', () => {
    // Every line of the wider span is also claimed by a narrower one, so B2 alone
    // would leave the wider annotation unreachable. This case is absent from the LUX
    // measurement, so it is implemented from the rule rather than from observed data.
    const wide = anno({ id: 1, ordinal: 1, start_i: 0, end_i: 1 })
    const n1 = anno({ id: 2, ordinal: 2, start_i: 0, end_i: 0 })
    const n2 = anno({ id: 3, ordinal: 3, start_i: 1, end_i: 1 })
    const marks = buildLineMarks([wide, n1, n2])
    expect(marks.get(0)!.claims.map(a => a.id)).toEqual([1, 2])
    expect(marks.get(1)!.claims.map(a => a.id)).toEqual([1, 3])
  })

  it('carries a single claim when nothing overlaps', () => {
    const marks = buildLineMarks([anno({ id: 1, start_i: 0, end_i: 1 })])
    expect(marks.get(0)!.claims).toHaveLength(1)
    expect(marks.get(0)!.sharedBy).toBe(1)
  })

  it('reports a shared line as shared even when only one annotation opens', () => {
    // sharedBy is what the reader is TOLD; claims is what clicking DOES. Conflating
    // them hid the overlap affordance on every line except the containment case.
    const wide = anno({ id: 1, ordinal: 1, start_i: 0, end_i: 3 })
    const narrow = anno({ id: 2, ordinal: 2, start_i: 2, end_i: 2 })
    const mark = buildLineMarks([wide, narrow]).get(2)!
    expect(mark.sharedBy).toBe(2)
    expect(mark.claims).toHaveLength(1)
    expect(lineClasses(mark, [])).toContain('is-shared')
  })

  it('does not mark an unshared line as shared', () => {
    const marks = buildLineMarks([anno({ id: 1, start_i: 0, end_i: 1 })])
    expect(lineClasses(marks.get(0), [])).not.toContain('is-shared')
  })
})

describe('long spans — ends only', () => {
  it('marks the middle of a long span so it can drop the fill', () => {
    const long = anno({ id: 1, start_i: 0, end_i: LONG_SPAN - 1 })
    const marks = buildLineMarks([long])
    expect(marks.get(0)!.pos).toBe('start')
    expect(marks.get(LONG_SPAN - 1)!.pos).toBe('end')
    expect(marks.get(1)!.pos).toBe('middle')
    expect(marks.get(1)!.long).toBe(true)
    expect(lineClasses(marks.get(1), [])).toContain('is-long-mid')
  })

  it('leaves a short span alone — every line keeps the fill', () => {
    const short = anno({ id: 1, start_i: 0, end_i: LONG_SPAN - 2 })
    const marks = buildLineMarks([short])
    expect(marks.get(1)!.long).toBe(false)
    expect(lineClasses(marks.get(1), [])).not.toContain('is-long-mid')
  })

  it('a one-line span is both start and end', () => {
    const marks = buildLineMarks([anno({ id: 1, start_i: 4, end_i: 4 })])
    const cls = lineClasses(marks.get(4), [])
    expect(cls).toContain('is-start')
    expect(cls).toContain('is-end')
  })
})

describe('lineClasses', () => {
  it('marks a disputed reading so it can be denied the fill', () => {
    const marks = buildLineMarks([anno({ id: 1, start_i: 0, end_i: 0, votes_total: -17, disputed: true })])
    expect(lineClasses(marks.get(0), [])).toContain('is-disputed')
  })

  it('marks a chorus as repeated rather than as a failure', () => {
    const marks = buildLineMarks([anno({ id: 1, start_i: 0, end_i: 0, status: 'repeated', occurrences: 2 })])
    expect(lineClasses(marks.get(0), [])).toContain('is-repeated')
  })

  it('flags the open annotation', () => {
    const marks = buildLineMarks([anno({ id: 5, start_i: 0, end_i: 0 })])
    expect(lineClasses(marks.get(0), [5])).toContain('is-open')
    expect(lineClasses(marks.get(0), [9])).not.toContain('is-open')
  })

  it('returns nothing for an unmarked line', () => {
    expect(lineClasses(undefined, [])).toEqual([])
  })
})

describe('drawer', () => {
  it('collects annotations that never reached the text, excluding section markers', () => {
    const items = drawerItems([
      anno({ id: 1, start_i: 0, end_i: 0 }),
      anno({ id: 2, status: 'unmatched' }),
      anno({ id: 3, status: 'section' }),
    ])
    expect(items.map(a => a.id)).toEqual([2])
  })

  it('marks entries ㄱ ㄴ ㄷ', () => {
    expect([0, 1, 2].map(drawerMark)).toEqual(['ㄱ', 'ㄴ', 'ㄷ'])
  })
})
