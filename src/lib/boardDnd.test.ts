// Characterization tests for the bucket-board DnD decision logic extracted from
// BucketBoard.tsx (REFACTOR-frontend-member-surface Step 4a). The drop routing +
// acceptance rules are pure and headless-reproducible; only the native drag
// gesture / overlay needs a real browser (verified via CDP). These pin the
// current (target, payload) → ops-call mapping so the extraction is a proven
// no-op and future edits to the rules stay honest.
import type { BoardBucket } from './buckets'
import type { DndItem, DropOps } from './boardDnd'
import { describe, expect, it, vi } from 'vitest'
import { PLAYBACK_KIND, PLAYBACK_TYPE, SLIB_KIND } from './buckets'
import { canAcceptAlbumDrag, canAcceptBucketDrag, routeAlbumDrop } from './boardDnd'
import { boardDragAccepts } from './pocketBuckit/boardDnd'
import { PB_BOARD_DND_END_EVENT, PB_BOARD_DND_START_EVENT } from './pocketBuckit/events'

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
    queueTrack: vi.fn(),
    expandAlbumTracks: vi.fn(),
  }
}

const playback = bucket({ id: 'pq', kind: PLAYBACK_KIND, type: PLAYBACK_TYPE })

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
  // FEAT-playback-bucket-player Step 5 — the queue holds tracks: a track queues as
  // one row, an album expands into its tracks, an artist is refused (Artist inverted).
  it('a playback bucket accepts a track or an album source', () => {
    expect(canAcceptAlbumDrag(playback, { kind: 'album', trackId: 'tr', srcItemType: 'track' })).toBe(true)
    expect(canAcceptAlbumDrag(playback, { kind: 'album', albumId: 'al', srcItemType: 'album' })).toBe(true)
    // a queue row dragged out of the queue is itself a track source
    expect(canAcceptAlbumDrag(playback, { kind: 'album', trackId: 'tr', srcItemType: 'playback' })).toBe(true)
  })
  it('a playback bucket rejects an artist member', () => {
    expect(canAcceptAlbumDrag(playback, { kind: 'album', artistId: 'ar', srcItemType: 'artist' })).toBe(false)
  })
  it('a playback bucket rejects an artist source even if it somehow carries an album', () => {
    // Belt-and-braces: today an artist row has a null albumId, so the album/track test
    // alone would already reject it. The explicit srcItemType check is what keeps that
    // true if an artist row ever starts carrying its album.
    expect(canAcceptAlbumDrag(playback, { kind: 'album', srcItemType: 'artist', albumId: 'al' })).toBe(false)
  })
  it('a playback bucket rejects a source with nothing playable (review / snapshot)', () => {
    expect(canAcceptAlbumDrag(playback, { kind: 'album', srcItemType: 'review' })).toBe(false)
    expect(canAcceptAlbumDrag(playback, { kind: 'album', srcItemType: 'snapshot' })).toBe(false)
  })
})

// The Pocket island cannot read the board's live `dnd` (two React roots, no shared
// context), so `boardDragAccepts` duplicates the rule above. Duplication is the design;
// DRIFT is the bug — a tray chip that previews an acceptance the board then refuses.
// This pins them together case-for-case so a future edit to one fails here, not in prod.
describe('boardDragAccepts mirrors canAcceptAlbumDrag (drift guard)', () => {
  const cases: { name: string, type: string, it: DndItem }[] = [
    { name: 'general / album', type: 'general', it: { kind: 'album', albumId: 'al', srcItemType: 'album' } },
    { name: 'general / review', type: 'general', it: { kind: 'album', srcItemType: 'review' } },
    { name: 'artist / artist member', type: 'artist', it: { kind: 'album', artistId: 'ar', srcItemType: 'artist' } },
    { name: 'artist / album source', type: 'artist', it: { kind: 'album', albumId: 'al', srcItemType: 'album' } },
    { name: 'artist / review', type: 'artist', it: { kind: 'album', srcItemType: 'review' } },
    { name: 'playback / track', type: 'playback', it: { kind: 'album', trackId: 'tr', srcItemType: 'track' } },
    { name: 'playback / album', type: 'playback', it: { kind: 'album', albumId: 'al', srcItemType: 'album' } },
    { name: 'playback / artist', type: 'playback', it: { kind: 'album', artistId: 'ar', srcItemType: 'artist' } },
    { name: 'playback / review', type: 'playback', it: { kind: 'album', srcItemType: 'review' } },
  ]
  for (const c of cases) {
    it(`agrees on ${c.name}`, () => {
      // Feed the island singleton the same payload the board is holding.
      window.dispatchEvent(new CustomEvent(PB_BOARD_DND_START_EVENT, {
        detail: {
          srcItemType: c.it.srcItemType ?? 'album',
          albumId: c.it.albumId ?? null,
          trackId: c.it.trackId ?? null,
          artistId: c.it.artistId ?? null,
        },
      }))
      expect(boardDragAccepts(c.type)).toBe(canAcceptAlbumDrag(bucket({ type: c.type }), c.it))
      window.dispatchEvent(new CustomEvent(PB_BOARD_DND_END_EVENT))
    })
  }
  it('rejects everything with no drag in flight', () => {
    expect(boardDragAccepts('general')).toBe(false)
    expect(boardDragAccepts('playback')).toBe(false)
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

describe('routeAlbumDrop — playback target', () => {
  it('queues a track as ONE appended row', () => {
    const ops = mockOps([playback])
    routeAlbumDrop(playback, { kind: 'album', trackId: 'tr', srcItemType: 'track', itemId: 'i', fromBucketId: 'src' }, ops)
    expect(ops.queueTrack).toHaveBeenCalledWith('pq', 'tr')
    // a COPY, not a move: the source row must stay where it is
    expect(ops.insertAlbum).not.toHaveBeenCalled()
    expect(ops.expandAlbumTracks).not.toHaveBeenCalled()
  })
  it('expands an album into its tracks rather than storing the album', () => {
    const ops = mockOps([playback])
    routeAlbumDrop(playback, { kind: 'album', albumId: 'al', srcItemType: 'album', itemId: 'i', fromBucketId: 'src' }, ops)
    expect(ops.expandAlbumTracks).toHaveBeenCalledWith('pq', 'al')
    expect(ops.copyAlbum).not.toHaveBeenCalled()
    expect(ops.insertAlbum).not.toHaveBeenCalled()
  })
  it('queues the SAME track twice — the queue allows duplicates (D8)', () => {
    const ops = mockOps([playback])
    const drag: DndItem = { kind: 'album', trackId: 'tr', srcItemType: 'track', itemId: 'i', fromBucketId: 'src' }
    routeAlbumDrop(playback, drag, ops)
    routeAlbumDrop(playback, drag, ops)
    expect(ops.queueTrack).toHaveBeenCalledTimes(2)
  })
  it('does not re-queue a row dropped on its own bucket (that is a reorder)', () => {
    const ops = mockOps([playback])
    routeAlbumDrop(playback, { kind: 'album', trackId: 'tr', srcItemType: 'playback', itemId: 'i', fromBucketId: 'pq' }, ops)
    expect(ops.queueTrack).not.toHaveBeenCalled()
    expect(ops.expandAlbumTracks).not.toHaveBeenCalled()
  })
  it('a copy-source album (recent strip) still expands', () => {
    const ops = mockOps([playback])
    routeAlbumDrop(playback, { kind: 'album', copy: true, albumId: 'al', srcItemType: 'album', fromBucketId: 'strip' }, ops)
    expect(ops.expandAlbumTracks).toHaveBeenCalledWith('pq', 'al')
    expect(ops.copyAlbum).not.toHaveBeenCalled()
  })
  it('an artist member reaching the drop path is a no-op (drag-over already refused it)', () => {
    const ops = mockOps([playback])
    routeAlbumDrop(playback, { kind: 'album', artistId: 'ar', srcItemType: 'artist', itemId: 'i', fromBucketId: 'src' }, ops)
    expect(ops.queueTrack).not.toHaveBeenCalled()
    expect(ops.expandAlbumTracks).not.toHaveBeenCalled()
    expect(ops.insertAlbum).not.toHaveBeenCalled()
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
