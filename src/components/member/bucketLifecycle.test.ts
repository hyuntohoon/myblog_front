// Characterization tests for the bucket lifecycle-tag derivation (`crMeta` +
// `collectItems` + `isResearchEngaged`), today trapped inside BucketBoard.tsx.
// These PIN the current tag outputs so REFACTOR Step 3 (relocating the rule to
// @lib/buckets) is a proven no-op. When Step 3 moves them, update the import path
// here — the assertions must not change.
import type { BoardAlbum, BoardBucket } from '@lib/buckets'
import { describe, expect, it } from 'vitest'
import { collectItems, crMeta, isResearchEngaged, TOLISTEN_KIND } from './BucketBoard'

function bucket(over: Partial<BoardBucket> = {}): BoardBucket {
  return {
    id: 'b',
    name: 'b',
    color: null,
    isDone: false,
    kind: 'review',
    type: 'general',
    isPublic: false,
    researchMode: 'off',
    albums: [],
    children: [],
    ...over,
  }
}

function album(over: Partial<BoardAlbum> = {}): BoardAlbum {
  return {
    itemId: 'i',
    itemType: 'album',
    albumId: 'al',
    trackId: null,
    reviewTargetId: null,
    artistId: null,
    title: 't',
    artist: 'a',
    cover: null,
    year: null,
    alreadyReviewed: false,
    ...over,
  } as BoardAlbum
}

describe('isResearchEngaged', () => {
  it('is true for queued / running / done', () => {
    expect(isResearchEngaged('queued')).toBe(true)
    expect(isResearchEngaged('running')).toBe(true)
    expect(isResearchEngaged('done')).toBe(true)
  })
  it('is false for null and terminal failed', () => {
    expect(isResearchEngaged(null)).toBe(false)
    expect(isResearchEngaged('failed')).toBe(false)
  })
})

describe('collectItems', () => {
  it('flattens direct members plus all descendants', () => {
    const tree = bucket({
      albums: [album({ itemId: '1' })],
      children: [
        bucket({ albums: [album({ itemId: '2' })], children: [bucket({ albums: [album({ itemId: '3' })] })] }),
      ],
    })
    expect(collectItems(tree).map(a => a.itemId).sort()).toEqual(['1', '2', '3'])
  })
})

describe('crMeta', () => {
  it('tags the system to-listen bucket by kind, ignoring contents', () => {
    const b = bucket({ kind: TOLISTEN_KIND, albums: [album({ postId: 'p', alreadyReviewed: false } as Partial<BoardAlbum>)] })
    expect(crMeta(b).tag).toBe('청취 예정')
  })

  it('tags a done bucket 완료 (isDone wins over contents)', () => {
    const b = bucket({ isDone: true, albums: [album({ postId: 'p' } as Partial<BoardAlbum>)] })
    expect(crMeta(b).tag).toBe('완료')
  })

  it('tags 작성 중 when any item has a linked post that is not yet reviewed', () => {
    const b = bucket({ albums: [album({ postId: 'p', alreadyReviewed: false } as Partial<BoardAlbum>)] })
    expect(crMeta(b).tag).toBe('작성 중')
  })

  it('a linked-but-already-reviewed post does NOT trigger 작성 중', () => {
    const b = bucket({ albums: [album({ postId: 'p', alreadyReviewed: true } as Partial<BoardAlbum>)] })
    expect(crMeta(b).tag).toBe('담음')
  })

  it('tags 조사 중 when research is engaged and no writing post is open', () => {
    const b = bucket({ albums: [album({ researchStatus: 'running' } as Partial<BoardAlbum>)] })
    expect(crMeta(b).tag).toBe('조사 중')
  })

  it('작성 중 takes precedence over 조사 중', () => {
    const b = bucket({
      albums: [
        album({ itemId: 'w', postId: 'p', alreadyReviewed: false } as Partial<BoardAlbum>),
        album({ itemId: 'r', researchStatus: 'running' } as Partial<BoardAlbum>),
      ],
    })
    expect(crMeta(b).tag).toBe('작성 중')
  })

  it('a completed research note (done) still counts as 조사 중, not 담음', () => {
    const b = bucket({ albums: [album({ researchStatus: 'done' } as Partial<BoardAlbum>)] })
    expect(crMeta(b).tag).toBe('조사 중')
  })

  it('a terminal failed research run does not lift out of 담음', () => {
    const b = bucket({ albums: [album({ researchStatus: 'failed' } as Partial<BoardAlbum>)] })
    expect(crMeta(b).tag).toBe('담음')
  })

  it('an empty bucket is 담음', () => {
    expect(crMeta(bucket()).tag).toBe('담음')
  })

  it('aggregates over the whole subtree — a nested writing item lifts the parent to 작성 중', () => {
    const b = bucket({
      children: [bucket({ albums: [album({ postId: 'p', alreadyReviewed: false } as Partial<BoardAlbum>)] })],
    })
    expect(crMeta(b).tag).toBe('작성 중')
  })
})
