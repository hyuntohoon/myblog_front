// BUG-20: `isManualAddTarget` is the single owner of "may a user manually
// add/move an item into this bucket?" — before this function existed, three
// call sites enforced the spotify_library exclusion independently (two by
// hardcoding the string literal, one via SLIB_KIND) and a fourth (LikedBoard's
// promote-to-bucket flow) omitted it entirely, letting a member write into the
// sync-owned mirror bucket. This pins the one predicate every "add to bucket"
// surface must route through.
import type { BoardBucket } from './buckets'
import { describe, expect, it } from 'vitest'
import { isManualAddTarget, SLIB_KIND } from './buckets'

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

describe('isManualAddTarget', () => {
  it('rejects the spotify_library mirror bucket', () => {
    expect(isManualAddTarget(bucket({ kind: SLIB_KIND }))).toBe(false)
  })

  it('accepts a normal review bucket', () => {
    expect(isManualAddTarget(bucket({ kind: 'review' }))).toBe(true)
  })

  it('accepts an artist-type bucket (type is orthogonal to kind)', () => {
    expect(isManualAddTarget(bucket({ kind: 'review', type: 'artist' }))).toBe(true)
  })

  it('accepts the playback-queue bucket (system-owned via type, not kind)', () => {
    expect(isManualAddTarget(bucket({ kind: 'playback_queue', type: 'playback' }))).toBe(true)
  })
})
