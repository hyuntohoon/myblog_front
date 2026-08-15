// FEAT-playback-bucket-player Step 5 — the queue projection. These pin the two
// properties that make a projection safe to build a player on in Step 6: it is the
// bucket's DIRECT members in server order, and it is found by `kind` (so renaming or
// moving the bucket, both of which the owner may do, cannot lose it).
import type { BoardAlbum, BoardBucket } from '@lib/buckets'
import { describe, expect, it } from 'vitest'
import { PLAYBACK_KIND, PLAYBACK_TYPE } from '@lib/buckets'
import { findPlaybackBucket, queueItems, withReorderedQueueItems } from './queue'

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

function item(itemId: string, trackId: string): BoardAlbum {
  return {
    itemId,
    itemType: 'playback',
    albumId: null,
    trackId,
    reviewTargetId: null,
    artistId: null,
    title: trackId,
    artist: '—',
    cover: null,
    year: null,
    alreadyReviewed: false,
    postId: null,
    researchSelected: false,
    note: null,
    prepTonight: false,
    researchStatus: null,
    popularity: null,
    releaseDate: null,
    artistNames: [],
    genres: [],
  }
}

const queue = bucket({
  id: 'pq',
  name: '재생 대기열',
  kind: PLAYBACK_KIND,
  type: PLAYBACK_TYPE,
  albums: [item('i1', 't1'), item('i2', 't2'), item('i3', 't3')],
})

describe('findPlaybackBucket', () => {
  it('finds the bucket by kind', () => {
    expect(findPlaybackBucket([bucket({ id: 'a' }), queue])?.id).toBe('pq')
  })
  it('finds it after the owner renames it (kind, never name)', () => {
    const renamed = { ...queue, name: '내 플레이리스트' }
    expect(findPlaybackBucket([renamed])?.id).toBe('pq')
  })
  it('is null before the bucket is auto-created, and on a null tree', () => {
    expect(findPlaybackBucket([bucket({ id: 'a' })])).toBeNull()
    expect(findPlaybackBucket(null)).toBeNull()
  })
})

describe('queueItems', () => {
  it('is the direct members in server (position) order', () => {
    expect(queueItems([queue]).map(a => a.itemId)).toEqual(['i1', 'i2', 'i3'])
  })
  it('keeps duplicate tracks as distinct rows (D8)', () => {
    const dup = { ...queue, albums: [item('i1', 't1'), item('i2', 't1')] }
    const items = queueItems([dup])
    expect(items).toHaveLength(2)
    expect(items.map(a => a.trackId)).toEqual(['t1', 't1'])
  })
  it('excludes items of a bucket nested UNDER the queue (not part of the play order)', () => {
    const nested = { ...queue, children: [bucket({ id: 'child', albums: [item('i9', 't9')] })] }
    expect(queueItems([nested]).map(a => a.itemId)).toEqual(['i1', 'i2', 'i3'])
  })
  it('is empty when there is no playback bucket yet', () => {
    expect(queueItems([bucket({ id: 'a' })])).toEqual([])
    expect(queueItems(null)).toEqual([])
  })
})

describe('withReorderedQueueItems', () => {
  it('reflows the bucket\'s direct members to the given order', () => {
    const next = withReorderedQueueItems([queue], 'pq', ['i3', 'i1', 'i2'])
    expect(queueItems(next).map(a => a.itemId)).toEqual(['i3', 'i1', 'i2'])
  })
  it('leaves other buckets and a nested child bucket untouched', () => {
    const nested = { ...queue, children: [bucket({ id: 'child', albums: [item('i9', 't9')] })] }
    const next = withReorderedQueueItems([bucket({ id: 'a' }), nested], 'pq', ['i2', 'i1', 'i3'])
    expect(queueItems(next).map(a => a.itemId)).toEqual(['i2', 'i1', 'i3'])
    expect(next[0].id).toBe('a')
    expect(findPlaybackBucket(next)?.children[0]?.albums.map(a => a.itemId)).toEqual(['i9'])
  })
  it('drops an id that no longer matches a live row (a concurrent-remove race) instead of inserting a hole', () => {
    const next = withReorderedQueueItems([queue], 'pq', ['i3', 'ghost', 'i1', 'i2'])
    expect(queueItems(next).map(a => a.itemId)).toEqual(['i3', 'i1', 'i2'])
  })
  it('is a no-op when the bucket id is not found', () => {
    const next = withReorderedQueueItems([queue], 'missing', ['i3', 'i1', 'i2'])
    expect(queueItems(next).map(a => a.itemId)).toEqual(['i1', 'i2', 'i3'])
  })
})
