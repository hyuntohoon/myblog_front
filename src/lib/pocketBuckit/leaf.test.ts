// FEAT-playback-bucket-player Step 5 — `actionFor` became kind-aware here. Until this
// step it returned 담기/add for every bucket, so `PocketAction='queue'` and
// `PocketLeaf.ordered` were declared but dead. These pin the new branch AND pin that
// ordinary crates did not change with it.
import type { BoardBucket } from '@lib/buckets'
import { describe, expect, it } from 'vitest'
import { PLAYBACK_KIND, PLAYBACK_TYPE, SLIB_KIND } from '@lib/buckets'
import { bucketsToLeaves } from './leaf'

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

const OPTS = { order: 'pinned' as const, treeDepth: 0 as const }

describe('bucketsToLeaves — the playback leaf', () => {
  const queue = bucket({ id: 'pq', name: '재생 대기열', kind: PLAYBACK_KIND, type: PLAYBACK_TYPE })

  it('queues rather than collects, and takes tracks AND albums', () => {
    const [leaf] = bucketsToLeaves([queue], OPTS)
    expect(leaf.action).toBe('queue')
    expect(leaf.verb).toBe('재생 대기열에 추가')
    expect(leaf.accepts).toBe('트랙 · 앨범')
  })

  it('is marked ordered — its position IS the play order', () => {
    const [leaf] = bucketsToLeaves([queue], OPTS)
    expect(leaf.ordered).toBe(true)
  })

  it('carries its type through, so the tray can run the accept gate without a tree lookup', () => {
    const [leaf] = bucketsToLeaves([queue], OPTS)
    expect(leaf.type).toBe(PLAYBACK_TYPE)
  })

  it('stays in the tray (unlike the spotify_library mirror, which is filtered out)', () => {
    const leaves = bucketsToLeaves([queue, bucket({ id: 'lib', kind: SLIB_KIND })], OPTS)
    expect(leaves.map(l => l.id)).toEqual(['pq'])
  })
})

describe('bucketsToLeaves — ordinary crates are unchanged', () => {
  it('still 담기/add/앨범, and not ordered', () => {
    const [leaf] = bucketsToLeaves([bucket({ id: 'g', name: '평론' })], OPTS)
    expect(leaf.action).toBe('add')
    expect(leaf.verb).toBe('담기')
    expect(leaf.accepts).toBe('앨범')
    expect(leaf.ordered).toBeUndefined()
  })
  it('an artist bucket is also unchanged (a collection, not a queue)', () => {
    const [leaf] = bucketsToLeaves([bucket({ id: 'ar', type: 'artist' })], OPTS)
    expect(leaf.action).toBe('add')
    expect(leaf.ordered).toBeUndefined()
  })
})
