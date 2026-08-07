// Characterization tests for the bucket-board DnD decision logic extracted from
// BucketBoard.tsx (REFACTOR-frontend-member-surface Step 4a). The drop routing +
// acceptance rules are pure and headless-reproducible; only the native drag
// gesture / overlay needs a real browser (verified via CDP). These pin the
// current (target, payload) → ops-call mapping so the extraction is a proven
// no-op and future edits to the rules stay honest.
//
// ARCH-entity-interaction-v2 Step 3 adds the adapter suite at the bottom: every payload
// in this file is pushed through `fromDndItem` → `toDndItem` and must produce the SAME
// accept answers and the SAME `ops` calls against every drop target. That is what turns
// "the board behaves identically through the new payload" into a measurement.
import type { BoardBucket } from './buckets'
import type { DndItem, DropOps } from './boardDnd'
import type { DragPayload } from './entityDrag'
import { describe, expect, it, vi } from 'vitest'
import { PLAYBACK_KIND, PLAYBACK_TYPE, SLIB_KIND } from './buckets'
import { canAcceptAlbumDrag, canAcceptBucketDrag, memberAcceptsLabel, routeAlbumDrop } from './boardDnd'
import { fromDndItem, toDndItem } from './entityDrag'
import { boardDragAccepts, externalAlbumCopy } from './pocketBuckit/boardDnd'
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

// ── ARCH-entity-interaction-v2 Step 3 — the adapter is a proven no-op ──────────
//
// Every payload used anywhere above, plus the four shapes the live drag sources actually
// build (BucketBoard `AlbumChip` × recent-strip / library / member, and the bucket node).
// The suites below push each one through `fromDndItem` → `toDndItem` and require the same
// answers from every rule, against every drop target — which is the Step 3 claim stated as
// an assertion instead of a promise.
const ADAPTER_CORPUS: DndItem[] = [
  // bare / source-only shapes
  { kind: 'member' },
  { kind: 'member', srcItemType: 'review' },
  { kind: 'member', srcItemType: 'snapshot' },
  { kind: 'member', srcItemType: 'artist' },
  { kind: 'member', albumId: 'al' },
  { kind: 'member', trackId: 'tr' },
  { kind: 'member', albumId: 'al', srcItemType: 'album' },
  { kind: 'member', trackId: 'tr', srcItemType: 'track' },
  { kind: 'member', trackId: 'tr', srcItemType: 'playback' },
  { kind: 'member', artistId: 'ar', srcItemType: 'artist' },
  // the belt-and-braces case: `srcItemType` disagreeing with the ids the row carries.
  // This is why the adapter dispatches on id presence — keying on `itemType` would drop
  // the album id here and quietly change what the gates see.
  { kind: 'member', srcItemType: 'artist', albumId: 'al' },
  // real memberships (MOVE)
  { kind: 'member', itemId: 'i', fromBucketId: 'src' },
  { kind: 'member', albumId: 'al', itemId: 'i', fromBucketId: 'src' },
  { kind: 'member', srcItemType: 'artist', itemId: 'i', fromBucketId: 'src' },
  { kind: 'member', srcItemType: 'artist', itemId: 'i', fromBucketId: 'ar' },
  { kind: 'member', trackId: 'tr', srcItemType: 'track', itemId: 'i', fromBucketId: 'src' },
  { kind: 'member', albumId: 'al', srcItemType: 'album', itemId: 'i', fromBucketId: 'src' },
  { kind: 'member', trackId: 'tr', srcItemType: 'playback', itemId: 'i', fromBucketId: 'pq' },
  { kind: 'member', artistId: 'ar', srcItemType: 'artist', itemId: 'i', fromBucketId: 'src' },
  { kind: 'member', itemId: 'i', fromBucketId: 'g', albumId: 'al' },
  // the recent strip (COPY, no membership) — live source #1
  { kind: 'member', copy: true, albumId: 'al' },
  { kind: 'member', copy: true, albumId: 'al', fromBucketId: 'strip', srcItemType: 'album' },
  // the spotify_library bucket (a membership that COPIES out) — live source #2
  { kind: 'member', fromLib: true, albumId: 'al', itemId: 'i', fromBucketId: 'lib', srcItemType: 'album' },
  { kind: 'member', fromLib: true, albumId: 'al', itemId: 'i', fromBucketId: 'lib', srcItemType: 'album', source: 'preexisting' },
  { kind: 'member', fromLib: true, albumId: 'al', itemId: 'i', fromBucketId: 'lib', srcItemType: 'album', source: 'myblog_added' },
  // bucket nodes — live source #4
  { kind: 'bucket', bucketId: 'src' },
  { kind: 'bucket' },
]

/** Round-trip a legacy payload through the new one. */
function viaAdapter(drag: DndItem): DndItem {
  return toDndItem(fromDndItem(drag))
}

/**
 * Drop absent values before comparing. `null` and `undefined` are indistinguishable to
 * every read site in `boardDnd.ts` (each is `!!x`, `x &&`, or `x === <literal>`), and the
 * live sources genuinely produce both — `album.albumId` is `null` on a track row while a
 * bare source simply omits the key. Comparing them as distinct would fail the identity
 * test on a spelling difference; the ops-level assertions below are the real proof.
 */
function present(drag: DndItem): Record<string, unknown> {
  return Object.fromEntries(Object.entries(drag).filter(([, v]) => v !== undefined && v !== null))
}

/** Record every `ops` call a drop makes, in order — the observable a drop IS. */
function recordDrop(target: BoardBucket, drag: DndItem, tree: BoardBucket[]): [string, unknown[]][] {
  const ops = mockOps(tree)
  routeAlbumDrop(target, drag, ops)
  const calls: [string, unknown[]][] = []
  for (const [name, fn] of Object.entries(ops)) {
    if (typeof fn !== 'function')
      continue
    for (const args of (fn as ReturnType<typeof vi.fn>).mock.calls)
      calls.push([name, args])
  }
  return calls
}

describe('canAcceptAlbumDrag', () => {
  it('a general bucket accepts any album drag', () => {
    expect(canAcceptAlbumDrag(bucket(), { kind: 'member' })).toBe(true)
    expect(canAcceptAlbumDrag(bucket(), { kind: 'member', srcItemType: 'review' })).toBe(true)
  })
  it('an artist bucket accepts an artist member, or an album/track source', () => {
    const artist = bucket({ type: 'artist' })
    expect(canAcceptAlbumDrag(artist, { kind: 'member', srcItemType: 'artist' })).toBe(true)
    expect(canAcceptAlbumDrag(artist, { kind: 'member', albumId: 'al' })).toBe(true)
    expect(canAcceptAlbumDrag(artist, { kind: 'member', trackId: 'tr' })).toBe(true)
  })
  it('an artist bucket rejects a source bearing no artist/album/track', () => {
    expect(canAcceptAlbumDrag(bucket({ type: 'artist' }), { kind: 'member', srcItemType: 'review' })).toBe(false)
  })
  // FEAT-playback-bucket-player Step 5 — the queue holds tracks: a track queues as
  // one row, an album expands into its tracks, an artist is refused (Artist inverted).
  it('a playback bucket accepts a track or an album source', () => {
    expect(canAcceptAlbumDrag(playback, { kind: 'member', trackId: 'tr', srcItemType: 'track' })).toBe(true)
    expect(canAcceptAlbumDrag(playback, { kind: 'member', albumId: 'al', srcItemType: 'album' })).toBe(true)
    // a queue row dragged out of the queue is itself a track source
    expect(canAcceptAlbumDrag(playback, { kind: 'member', trackId: 'tr', srcItemType: 'playback' })).toBe(true)
  })
  it('a playback bucket rejects an artist member', () => {
    expect(canAcceptAlbumDrag(playback, { kind: 'member', artistId: 'ar', srcItemType: 'artist' })).toBe(false)
  })
  it('a playback bucket rejects an artist source even if it somehow carries an album', () => {
    // Belt-and-braces: today an artist row has a null albumId, so the album/track test
    // alone would already reject it. The explicit srcItemType check is what keeps that
    // true if an artist row ever starts carrying its album.
    expect(canAcceptAlbumDrag(playback, { kind: 'member', srcItemType: 'artist', albumId: 'al' })).toBe(false)
  })
  it('a playback bucket rejects a source with nothing playable (review / snapshot)', () => {
    expect(canAcceptAlbumDrag(playback, { kind: 'member', srcItemType: 'review' })).toBe(false)
    expect(canAcceptAlbumDrag(playback, { kind: 'member', srcItemType: 'snapshot' })).toBe(false)
  })
})

// ARCH-entity-interaction-v2 E3 — the library cell of the drop matrix. Step 2 wrote the
// matrix and found this is the ONE cell where the code did not obey it: `routeAlbumDrop`
// has always refused a non-album row (`isLib && !albumId` → silent return), but this gate
// keyed on `type` while the library is identified by `kind`, so the drag-over preview
// highlighted it as accepted and the drop then did nothing. These pin the agreement.
describe('canAcceptAlbumDrag — spotify-library target (E3)', () => {
  const lib = bucket({ id: 'lib', kind: SLIB_KIND })
  it('accepts an album row', () => {
    expect(canAcceptAlbumDrag(lib, { kind: 'member', albumId: 'al', srcItemType: 'album' })).toBe(true)
  })
  it('rejects a track row — nothing to reconcile against Spotify', () => {
    expect(canAcceptAlbumDrag(lib, { kind: 'member', trackId: 'tr', srcItemType: 'track' })).toBe(false)
  })
  it('rejects an artist row', () => {
    expect(canAcceptAlbumDrag(lib, { kind: 'member', artistId: 'ar', srcItemType: 'artist' })).toBe(false)
  })
  it('rejects a row with no album id at all (review / snapshot)', () => {
    expect(canAcceptAlbumDrag(lib, { kind: 'member', srcItemType: 'review' })).toBe(false)
  })
  // The point of the fix, stated as the one-directional contract E3 actually asks for:
  // the drag-over preview must never promise a write the drop will not make. The reverse
  // is allowed and deliberate — the belt-and-braces guards below refuse two rows that
  // `routeAlbumDrop` *would* still copy (an artist row carrying an album, a track row
  // carrying its parent album). Neither exists in prod, and the gate runs first on the
  // board's only path to the library, so the strictness costs nothing and the asymmetry
  // fails safe: it can only ever prevent a write, never invent one.
  it('never highlights a row the drop routing would not write', () => {
    for (const drag of ADAPTER_CORPUS) {
      if (drag.kind !== 'member' || !canAcceptAlbumDrag(lib, drag))
        continue
      const ops = mockOps([lib])
      routeAlbumDrop(lib, drag, ops)
      expect({ drag, wrote: (ops.copyAlbum as ReturnType<typeof vi.fn>).mock.calls.length > 0 }).toEqual({ drag, wrote: true })
    }
  })
  it('refuses a track that starts carrying its parent album (E1 forward-compat)', () => {
    // A track ref carries its PARENT album by E1. Nothing populates it today, but when a
    // source does, `!!albumId` alone would copy the parent album into the sync-owned
    // library. `!trackId` is what keeps this cell correct through that change.
    expect(canAcceptAlbumDrag(lib, { kind: 'member', trackId: 'tr', albumId: 'parent', srcItemType: 'track' })).toBe(false)
  })
})

// The Pocket island cannot read the board's live payload (two React roots, no shared
// context), so `boardDragAccepts` duplicates the rule above. Duplication is the design;
// DRIFT is the bug — a tray chip that previews an acceptance the board then refuses.
// This pins them together case-for-case so a future edit to one fails here, not in prod.
describe('boardDragAccepts mirrors canAcceptAlbumDrag (drift guard)', () => {
  const cases: { name: string, target: BoardBucket, it: DndItem }[] = [
    { name: 'general / album', target: bucket({ type: 'general' }), it: { kind: 'member', albumId: 'al', srcItemType: 'album' } },
    { name: 'general / review', target: bucket({ type: 'general' }), it: { kind: 'member', srcItemType: 'review' } },
    { name: 'artist / artist member', target: bucket({ type: 'artist' }), it: { kind: 'member', artistId: 'ar', srcItemType: 'artist' } },
    { name: 'artist / album source', target: bucket({ type: 'artist' }), it: { kind: 'member', albumId: 'al', srcItemType: 'album' } },
    { name: 'artist / review', target: bucket({ type: 'artist' }), it: { kind: 'member', srcItemType: 'review' } },
    { name: 'playback / track', target: playback, it: { kind: 'member', trackId: 'tr', srcItemType: 'track' } },
    { name: 'playback / album', target: playback, it: { kind: 'member', albumId: 'al', srcItemType: 'album' } },
    { name: 'playback / artist', target: playback, it: { kind: 'member', artistId: 'ar', srcItemType: 'artist' } },
    { name: 'playback / review', target: playback, it: { kind: 'member', srcItemType: 'review' } },
    // The library is filtered out of the tray rail today (`leaf.ts` flatten), so these are
    // unreachable from the Pocket island — mirrored anyway, because the twin must be the
    // same RULE and a filter is not an invariant.
    { name: 'library / album', target: bucket({ kind: SLIB_KIND }), it: { kind: 'member', albumId: 'al', srcItemType: 'album' } },
    { name: 'library / track', target: bucket({ kind: SLIB_KIND }), it: { kind: 'member', trackId: 'tr', srcItemType: 'track' } },
    { name: 'library / artist', target: bucket({ kind: SLIB_KIND }), it: { kind: 'member', artistId: 'ar', srcItemType: 'artist' } },
  ]
  for (const c of cases) {
    it(`agrees on ${c.name}`, () => {
      // Feed the island singleton the same payload the board is holding — now literally
      // the same value, since the wire carries `DragPayload` rather than a mirror of it.
      window.dispatchEvent(new CustomEvent<DragPayload>(PB_BOARD_DND_START_EVENT, { detail: fromDndItem(c.it) }))
      expect(boardDragAccepts(c.target)).toBe(canAcceptAlbumDrag(c.target, c.it))
      window.dispatchEvent(new CustomEvent(PB_BOARD_DND_END_EVENT))
    })
  }
  it('rejects everything with no drag in flight', () => {
    expect(boardDragAccepts(bucket({ type: 'general' }))).toBe(false)
    expect(boardDragAccepts(playback)).toBe(false)
  })
})

describe('pocket external album copy bridge', () => {
  it('accepts only a catalog-backed external copy payload', () => {
    expect(externalAlbumCopy({
      ref: { entity: 'album', albumId: 'album-1', title: 'Album One' },
      origin: { kind: 'external', copies: true },
    })).toEqual({ albumId: 'album-1', title: 'Album One' })
    expect(externalAlbumCopy({
      ref: { entity: 'album', albumId: 'album-1' },
      origin: { kind: 'external', copies: false },
    })).toBeNull()
    expect(externalAlbumCopy({
      ref: { entity: 'track', trackId: 'track-1', albumId: 'album-1' },
      origin: { kind: 'external', copies: true },
    })).toBeNull()
  })
})

// ARCH-entity-interaction-v2 E3 Step 5 — the reject-cell reason label. Pins that the
// label agrees with `canAcceptAlbumDrag`'s own branches (General has no label because
// it never rejects) and that every target `canAcceptAlbumDrag` can reject has a
// non-null reason to show.
describe('memberAcceptsLabel', () => {
  it('a general bucket has no label — it never rejects a member drag', () => {
    expect(memberAcceptsLabel(bucket())).toBeNull()
  })
  it('an artist bucket names artist/album/track', () => {
    expect(memberAcceptsLabel(bucket({ type: 'artist' }))).toBe('아티스트 · 앨범 · 트랙')
  })
  it('a playback bucket names track/album', () => {
    expect(memberAcceptsLabel(playback)).toBe('트랙 · 앨범')
  })
  it('a spotify-library bucket names album only', () => {
    expect(memberAcceptsLabel(bucket({ kind: SLIB_KIND }))).toBe('앨범')
  })
  it('every reject answer from canAcceptAlbumDrag has a non-null label to explain it', () => {
    const targets = [bucket({ type: 'artist' }), playback, bucket({ kind: SLIB_KIND })]
    for (const target of targets) {
      for (const drag of ADAPTER_CORPUS) {
        if (drag.kind === 'member' && !canAcceptAlbumDrag(target, drag))
          expect(memberAcceptsLabel(target)).not.toBeNull()
      }
    }
  })
})

describe('canAcceptBucketDrag', () => {
  it('rejects a non-bucket drag', () => {
    expect(canAcceptBucketDrag([], bucket(), { kind: 'member' })).toBe(false)
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
    routeAlbumDrop(lib, { kind: 'member', itemId: 'i', fromBucketId: 'src' }, ops)
    expect(ops.copyAlbum).not.toHaveBeenCalled()
    expect(ops.insertAlbum).not.toHaveBeenCalled()
  })
  it('copies an album with an albumId into the library bucket', () => {
    const ops = mockOps([lib])
    routeAlbumDrop(lib, { kind: 'member', albumId: 'al', itemId: 'i', fromBucketId: 'src' }, ops)
    expect(ops.copyAlbum).toHaveBeenCalledWith('al', 'lib')
    expect(ops.insertAlbum).not.toHaveBeenCalled()
  })
})

describe('routeAlbumDrop — artist target', () => {
  const artist = bucket({ id: 'ar', type: 'artist' })
  it('moves an artist member in from another bucket', () => {
    const ops = mockOps([artist])
    routeAlbumDrop(artist, { kind: 'member', srcItemType: 'artist', itemId: 'i', fromBucketId: 'src' }, ops)
    expect(ops.insertAlbum).toHaveBeenCalledWith('i', 'src', 'ar', null)
  })
  it('does not re-insert an artist member dropped on its own bucket', () => {
    const ops = mockOps([artist])
    routeAlbumDrop(artist, { kind: 'member', srcItemType: 'artist', itemId: 'i', fromBucketId: 'ar' }, ops)
    expect(ops.insertAlbum).not.toHaveBeenCalled()
  })
  it('expands an album source into credited artists', () => {
    const ops = mockOps([artist])
    routeAlbumDrop(artist, { kind: 'member', albumId: 'al' }, ops)
    expect(ops.expandSource).toHaveBeenCalledWith('ar', { albumId: 'al' })
  })
  it('expands a track source into credited artists', () => {
    const ops = mockOps([artist])
    routeAlbumDrop(artist, { kind: 'member', trackId: 'tr' }, ops)
    expect(ops.expandSource).toHaveBeenCalledWith('ar', { trackId: 'tr' })
  })
})

describe('routeAlbumDrop — playback target', () => {
  it('queues a track as ONE appended row', () => {
    const ops = mockOps([playback])
    routeAlbumDrop(playback, { kind: 'member', trackId: 'tr', srcItemType: 'track', itemId: 'i', fromBucketId: 'src' }, ops)
    expect(ops.queueTrack).toHaveBeenCalledWith('pq', 'tr')
    // a COPY, not a move: the source row must stay where it is
    expect(ops.insertAlbum).not.toHaveBeenCalled()
    expect(ops.expandAlbumTracks).not.toHaveBeenCalled()
  })
  it('expands an album into its tracks rather than storing the album', () => {
    const ops = mockOps([playback])
    routeAlbumDrop(playback, { kind: 'member', albumId: 'al', srcItemType: 'album', itemId: 'i', fromBucketId: 'src' }, ops)
    expect(ops.expandAlbumTracks).toHaveBeenCalledWith('pq', 'al')
    expect(ops.copyAlbum).not.toHaveBeenCalled()
    expect(ops.insertAlbum).not.toHaveBeenCalled()
  })
  it('queues the SAME track twice — the queue allows duplicates (D8)', () => {
    const ops = mockOps([playback])
    const drag: DndItem = { kind: 'member', trackId: 'tr', srcItemType: 'track', itemId: 'i', fromBucketId: 'src' }
    routeAlbumDrop(playback, drag, ops)
    routeAlbumDrop(playback, drag, ops)
    expect(ops.queueTrack).toHaveBeenCalledTimes(2)
  })
  it('does not re-queue a row dropped on its own bucket (that is a reorder)', () => {
    const ops = mockOps([playback])
    routeAlbumDrop(playback, { kind: 'member', trackId: 'tr', srcItemType: 'playback', itemId: 'i', fromBucketId: 'pq' }, ops)
    expect(ops.queueTrack).not.toHaveBeenCalled()
    expect(ops.expandAlbumTracks).not.toHaveBeenCalled()
  })
  it('a copy-source album (recent strip) still expands', () => {
    const ops = mockOps([playback])
    routeAlbumDrop(playback, { kind: 'member', copy: true, albumId: 'al', srcItemType: 'album', fromBucketId: 'strip' }, ops)
    expect(ops.expandAlbumTracks).toHaveBeenCalledWith('pq', 'al')
    expect(ops.copyAlbum).not.toHaveBeenCalled()
  })
  it('an artist member reaching the drop path is a no-op (drag-over already refused it)', () => {
    const ops = mockOps([playback])
    routeAlbumDrop(playback, { kind: 'member', artistId: 'ar', srcItemType: 'artist', itemId: 'i', fromBucketId: 'src' }, ops)
    expect(ops.queueTrack).not.toHaveBeenCalled()
    expect(ops.expandAlbumTracks).not.toHaveBeenCalled()
    expect(ops.insertAlbum).not.toHaveBeenCalled()
  })
})

describe('routeAlbumDrop — general target', () => {
  const target = bucket({ id: 'g' })
  it('copies when the drag is a copy source (recent strip)', () => {
    const ops = mockOps([target])
    routeAlbumDrop(target, { kind: 'member', copy: true, albumId: 'al' }, ops)
    expect(ops.copyAlbum).toHaveBeenCalledWith('al', 'g')
  })
  it('copies when the drag comes from the library bucket (fromLib)', () => {
    const ops = mockOps([target])
    routeAlbumDrop(target, { kind: 'member', fromLib: true, albumId: 'al', itemId: 'i', fromBucketId: 'lib' }, ops)
    expect(ops.copyAlbum).toHaveBeenCalledWith('al', 'g')
    expect(ops.insertAlbum).not.toHaveBeenCalled()
  })
  it('moves a member in from another bucket', () => {
    const ops = mockOps([target])
    routeAlbumDrop(target, { kind: 'member', itemId: 'i', fromBucketId: 'src', albumId: 'al' }, ops)
    expect(ops.insertAlbum).toHaveBeenCalledWith('i', 'src', 'g', null)
    expect(ops.copyAlbum).not.toHaveBeenCalled()
  })
  it('does not move a member dropped on its own bucket', () => {
    const ops = mockOps([target])
    routeAlbumDrop(target, { kind: 'member', itemId: 'i', fromBucketId: 'g', albumId: 'al' }, ops)
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

describe('entityDrag adapter — round trip is the identity on every rule field', () => {
  for (const [i, drag] of ADAPTER_CORPUS.entries()) {
    it(`preserves payload #${i} ${JSON.stringify(drag)}`, () => {
      expect(present(viaAdapter(drag))).toEqual(present(drag))
    })
  }
})

describe('entityDrag adapter — every drop target answers identically', () => {
  // The four `canAcceptAlbumDrag` targets of the E3 matrix. The trash dock and the bucket
  // node are gated elsewhere (TrashDock.accepts in the component, `canAcceptBucketDrag`
  // here) and are covered by the bucket-drag rows of the corpus below.
  const targets: [string, BoardBucket][] = [
    ['general', bucket({ id: 'g', type: 'general' })],
    ['artist', bucket({ id: 'ar', type: 'artist' })],
    ['playback', playback],
    ['library', bucket({ id: 'lib', kind: SLIB_KIND })],
  ]
  const tree = targets.map(([, b]) => b).concat(bucket({ id: 'src' }), bucket({ id: 'strip' }))

  for (const [tname, target] of targets) {
    for (const [i, drag] of ADAPTER_CORPUS.entries()) {
      it(`${tname} ← payload #${i}: same accept answer and same ops calls`, () => {
        const adapted = viaAdapter(drag)
        if (drag.kind === 'member')
          expect(canAcceptAlbumDrag(target, adapted)).toBe(canAcceptAlbumDrag(target, drag))
        else
          expect(canAcceptBucketDrag(tree, target, adapted)).toBe(canAcceptBucketDrag(tree, target, drag))
        expect(recordDrop(target, adapted, tree)).toEqual(recordDrop(target, drag, tree))
      })
    }
  }

  // The board's own move/copy decision is read straight off the payload at three call
  // sites (AlbumChip.acceptCol, TrashDock.accepts, the drop router). If the adapter got
  // `origin` wrong, a copy would become a move — the exact failure the RFC names as this
  // step's top risk — so pin the three flags the way the component reads them.
  it('preserves the move / copy / library distinction the component branches on', () => {
    const strip = ADAPTER_CORPUS.find(d => d.copy && d.fromBucketId === 'strip')!
    const lib = ADAPTER_CORPUS.find(d => d.fromLib && d.source === 'preexisting')!
    const member = ADAPTER_CORPUS.find(d => d.itemId === 'i' && d.fromBucketId === 'src' && d.albumId === 'al' && !d.fromLib && !d.copy)!
    // the recent strip COPIES and is not a membership
    expect(viaAdapter(strip).copy).toBe(true)
    expect(viaAdapter(strip).fromLib).toBeUndefined()
    expect(viaAdapter(strip).itemId).toBeUndefined()
    // a library row IS a membership (the trash can reach it) yet still copies out
    expect(viaAdapter(lib)).toMatchObject({ fromLib: true, source: 'preexisting', itemId: 'i' })
    expect(viaAdapter(lib).copy).toBeUndefined()
    // a plain membership MOVES — neither copy flag survives, or a move becomes a copy
    expect(viaAdapter(member)).toMatchObject({ itemId: 'i', fromBucketId: 'src' })
    expect(viaAdapter(member).copy).toBeUndefined()
    expect(viaAdapter(member).fromLib).toBeUndefined()
  })

  // A member row that points at no canonical entity (review / snapshot) has a null `ref`
  // — E1 Rule 0's inert entity. It must survive the trip as a droppable membership, not
  // become undraggable, or a review row would stop moving between General buckets.
  it('keeps a ref-less member row (review / snapshot) a real membership', () => {
    const p = fromDndItem({ kind: 'member', srcItemType: 'review', itemId: 'i', fromBucketId: 'src' })
    expect(p.ref).toBeNull()
    expect(p.origin).toEqual({ kind: 'internal', itemId: 'i', fromBucketId: 'src', itemType: 'review' })
    expect(recordDrop(bucket({ id: 'g' }), toDndItem(p), tree)).toEqual([['insertAlbum', ['i', 'src', 'g', null]]])
  })
})
