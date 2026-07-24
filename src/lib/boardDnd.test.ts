// Characterization tests for the bucket-board DnD decision logic extracted from
// BucketBoard.tsx (REFACTOR-frontend-member-surface Step 4a). The drop routing +
// acceptance rules are pure and headless-reproducible; only the native drag
// gesture / overlay needs a real browser (verified via CDP). These pin the
// current (target, payload) → ops-call mapping so the extraction is a proven
// no-op and future edits to the rules stay honest.
import type { BoardBucket } from './buckets'
import type { DropOps } from './boardDnd'
import { describe, expect, it, vi } from 'vitest'
import { SLIB_KIND } from './buckets'
import { canAcceptAlbumDrag, canAcceptBucketDrag, routeAlbumDrop } from './boardDnd'

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

function mockOps(tree: BoardBucket[] = []): DropOps {
  return {
    tree,
    copyAlbum: vi.fn(),
    insertAlbum: vi.fn(),
    moveBucketInto: vi.fn(),
    expandSource: vi.fn(),
  }
}

describe('canAcceptAlbumDrag', () => {
  it('a general bucket accepts any album drag', () => {
    expect(canAcceptAlbumDrag(bucket(), { kind: 'album' })).toBe(true)
    expect(canAcceptAlbumDrag(bucket(), { kind: 'album', srcItemType: 'review' })).toBe(true)
  })
  it('an artist bucket accepts an artist member, or an album/track source', () => {
    const artist = bucket({ type: 'artist' })
    expect(canAcceptAlbumDrag(artist, { kind: 'album', srcItemType: 'artist' })).toBe(true)
    expect(canAcceptAlbumDrag(artist, { kind: 'album', albumId: 'al' })).toBe(true)
    expect(canAcceptAlbumDrag(artist, { kind: 'album', trackId: 'tr' })).toBe(true)
  })
  it('an artist bucket rejects a source bearing no artist/album/track', () => {
    expect(canAcceptAlbumDrag(bucket({ type: 'artist' }), { kind: 'album', srcItemType: 'review' })).toBe(false)
  })
})

describe('canAcceptBucketDrag', () => {
  it('rejects a non-bucket drag', () => {
    expect(canAcceptBucketDrag([], bucket(), { kind: 'album' })).toBe(false)
  })
  it('rejects dropping a bucket onto itself', () => {
    const b = bucket({ id: 'x' })
    expect(canAcceptBucketDrag([b], b, { kind: 'bucket', bucketId: 'x' })).toBe(false)
  })
  it('rejects nesting a bucket into its own descendant (cycle guard)', () => {
    const child = bucket({ id: 'child' })
    const parent = bucket({ id: 'parent', children: [child] })
    expect(canAcceptBucketDrag([parent], child, { kind: 'bucket', bucketId: 'parent' })).toBe(false)
  })
  it('accepts nesting into an unrelated bucket', () => {
    const a = bucket({ id: 'a' })
    const target = bucket({ id: 'target' })
    expect(canAcceptBucketDrag([a, target], target, { kind: 'bucket', bucketId: 'a' })).toBe(true)
  })
})

describe('routeAlbumDrop — spotify-library target', () => {
  const lib = bucket({ id: 'lib', kind: SLIB_KIND })
  it('rejects an album drag with no albumId (nothing to reconcile)', () => {
    const ops = mockOps([lib])
    routeAlbumDrop(lib, { kind: 'album', itemId: 'i', fromBucketId: 'src' }, ops)
    expect(ops.copyAlbum).not.toHaveBeenCalled()
    expect(ops.insertAlbum).not.toHaveBeenCalled()
  })
  it('copies an album with an albumId into the library bucket', () => {
    const ops = mockOps([lib])
    routeAlbumDrop(lib, { kind: 'album', albumId: 'al', itemId: 'i', fromBucketId: 'src' }, ops)
    expect(ops.copyAlbum).toHaveBeenCalledWith('al', 'lib')
    expect(ops.insertAlbum).not.toHaveBeenCalled()
  })
})

describe('routeAlbumDrop — artist target', () => {
  const artist = bucket({ id: 'ar', type: 'artist' })
  it('moves an artist member in from another bucket', () => {
    const ops = mockOps([artist])
    routeAlbumDrop(artist, { kind: 'album', srcItemType: 'artist', itemId: 'i', fromBucketId: 'src' }, ops)
    expect(ops.insertAlbum).toHaveBeenCalledWith('i', 'src', 'ar', null)
  })
  it('does not re-insert an artist member dropped on its own bucket', () => {
    const ops = mockOps([artist])
    routeAlbumDrop(artist, { kind: 'album', srcItemType: 'artist', itemId: 'i', fromBucketId: 'ar' }, ops)
    expect(ops.insertAlbum).not.toHaveBeenCalled()
  })
  it('expands an album source into credited artists', () => {
    const ops = mockOps([artist])
    routeAlbumDrop(artist, { kind: 'album', albumId: 'al' }, ops)
    expect(ops.expandSource).toHaveBeenCalledWith('ar', { albumId: 'al' })
  })
  it('expands a track source into credited artists', () => {
    const ops = mockOps([artist])
    routeAlbumDrop(artist, { kind: 'album', trackId: 'tr' }, ops)
    expect(ops.expandSource).toHaveBeenCalledWith('ar', { trackId: 'tr' })
  })
})

describe('routeAlbumDrop — general target', () => {
  const target = bucket({ id: 'g' })
  it('copies when the drag is a copy source (recent strip)', () => {
    const ops = mockOps([target])
    routeAlbumDrop(target, { kind: 'album', copy: true, albumId: 'al' }, ops)
    expect(ops.copyAlbum).toHaveBeenCalledWith('al', 'g')
  })
  it('copies when the drag comes from the library bucket (fromLib)', () => {
    const ops = mockOps([target])
    routeAlbumDrop(target, { kind: 'album', fromLib: true, albumId: 'al', itemId: 'i', fromBucketId: 'lib' }, ops)
    expect(ops.copyAlbum).toHaveBeenCalledWith('al', 'g')
    expect(ops.insertAlbum).not.toHaveBeenCalled()
  })
  it('moves a member in from another bucket', () => {
    const ops = mockOps([target])
    routeAlbumDrop(target, { kind: 'album', itemId: 'i', fromBucketId: 'src', albumId: 'al' }, ops)
    expect(ops.insertAlbum).toHaveBeenCalledWith('i', 'src', 'g', null)
    expect(ops.copyAlbum).not.toHaveBeenCalled()
  })
  it('does not move a member dropped on its own bucket', () => {
    const ops = mockOps([target])
    routeAlbumDrop(target, { kind: 'album', itemId: 'i', fromBucketId: 'g', albumId: 'al' }, ops)
    expect(ops.insertAlbum).not.toHaveBeenCalled()
  })
  it('nests a bucket into an unrelated target', () => {
    const src = bucket({ id: 'src' })
    const ops = mockOps([src, target])
    routeAlbumDrop(target, { kind: 'bucket', bucketId: 'src' }, ops)
    expect(ops.moveBucketInto).toHaveBeenCalledWith('src', 'g')
  })
  it('refuses to nest a bucket into its own descendant', () => {
    const inner = bucket({ id: 'g' })
    const src = bucket({ id: 'src', children: [inner] })
    const ops = mockOps([src])
    routeAlbumDrop(inner, { kind: 'bucket', bucketId: 'src' }, ops)
    expect(ops.moveBucketInto).not.toHaveBeenCalled()
  })
})
