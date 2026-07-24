// Bucket-board drag-and-drop decision logic — the pure routing + acceptance rules
// shared by the board cards, the trash dock, and the reverse-DnD Pocket bridge.
// Extracted from BucketBoard.tsx by REFACTOR-frontend-member-surface Step 4a: the
// native-DnD gesture wiring (event handlers, the module-level payload, dragKind
// state, the window-event bridge) stays in the component, but the DECISIONS —
// which drop is accepted and which `ops` call a drop maps to — live here as pure
// functions so they are unit-testable in jsdom (the drop routing is
// headless-reproducible; only the gesture/overlay needs a real browser).
import type { BoardBucket } from './buckets'
import { findBucket, SLIB_KIND, subtreeHas } from './buckets'

// The live drag payload (native DnD can't carry object refs reliably, so
// BucketBoard keeps one module-level `dnd` of this shape).
//
// `copy` (with `albumId`) marks a drag originating from the pinned 최근 들은 앨범
// strip: dropping it copies the album in (addBucketItem) instead of moving a
// bucket item. Synthetic id; not a real review_bucket_items row.
// `copy` (recent strip) and `fromLib` (the spotify_library bucket) both drop as a
// COPY into a target bucket; `fromLib` additionally keeps `itemId`/`source` so it can
// still be moved to the trash (only when source==='myblog_added' — a 기존/preexisting
// album is never deletable). `albumId` is carried on every album drag so a drop INTO
// the library bucket can copy by album id without a tree lookup.
export interface DndItem { kind: 'album' | 'bucket', itemId?: string, fromBucketId?: string, bucketId?: string, copy?: boolean, albumId?: string | null, fromLib?: boolean, source?: string, trackId?: string | null, artistId?: string | null, srcItemType?: string }

// The subset of BucketBoard's `Ops` that a drop dispatches to. Declared here (not
// imported from the component) so this module has no dependency on BucketBoard;
// the component's full `Ops` structurally satisfies it.
export interface DropOps {
  tree: BoardBucket[]
  copyAlbum: (albumId: string, toBucketId: string) => void
  insertAlbum: (itemId: string, fromBucketId: string, toBucketId: string, beforeItemId: string | null, bakeOrder?: string[]) => void
  moveBucketInto: (bucketId: string, targetId: string | null) => void
  expandSource: (bucketId: string, source: { albumId: string } | { trackId: string }) => void
}

// FEAT-my-buckit-artist: an Artist bucket accepts only an artist member (move) or
// an album/track SOURCE that expands into its credited artists. A source bearing
// no artist (review/playback/snapshot tile) is rejected at drag-over — no glow, no
// optimistic insert. General buckets accept all (today's behavior).
export function canAcceptAlbumDrag(bucket: BoardBucket, it: DndItem): boolean {
  if (bucket.type !== 'artist')
    return true
  return it.srcItemType === 'artist' || !!it.albumId || !!it.trackId
}

// A bucket drag is accepted onto `bucket` when it is a different bucket and `bucket`
// is not inside the dragged bucket's own subtree (cycle guard).
export function canAcceptBucketDrag(tree: BoardBucket[], bucket: BoardBucket, it: DndItem): boolean {
  if (it.kind !== 'bucket')
    return false
  if (it.bucketId === bucket.id)
    return false
  const src = it.bucketId ? findBucket(tree, it.bucketId) : null
  return !(src && subtreeHas(src, bucket.id))
}

// FEAT-pocket-buckit-viewers Track A — route a member/bucket drop onto a target
// bucket using the board's ops. The SINGLE source of drop semantics: the BucketCard
// onDrop AND the reverse-DnD PB_BOARD_DROP listener both call it, so a board member
// dropped on a Pocket target (tray chip / open drawer) behaves IDENTICALLY to
// dropping it on the board card — General add/move, Artist source-expansion
// (album/track → credited artists), the Spotify-library copy/guard, and
// bucket-into-bucket — all reused verbatim, no fork.
export function routeAlbumDrop(target: BoardBucket, it: DndItem, ops: DropOps): void {
  const isLib = target.kind === SLIB_KIND
  // The sync-owned library bucket holds only albums — a track/null-album row has nothing
  // to reconcile against Spotify, so reject it.
  if (isLib && it.kind === 'album' && !it.albumId)
    return
  // Artist bucket: an artist member moves/adds in; an album/track SOURCE expands into its
  // credited artists (the source row itself is never stored). A non-artist-bearing source
  // no-ops (it is rejected at drag-over upstream, so it never reaches here in practice).
  if (target.type === 'artist' && it.kind === 'album') {
    if (it.srcItemType === 'artist') {
      if (it.itemId && it.fromBucketId && it.fromBucketId !== target.id)
        ops.insertAlbum(it.itemId, it.fromBucketId, target.id, null)
    }
    else if (it.albumId) {
      ops.expandSource(target.id, { albumId: it.albumId })
    }
    else if (it.trackId) {
      ops.expandSource(target.id, { trackId: it.trackId })
    }
    return
  }
  // COPY when dropping into the library bucket, or the source is a copy/library item;
  // otherwise a normal move/add. Bucket-into-bucket guarded against self / cycle.
  const copyIn = isLib || it.copy || it.fromLib
  if (it.kind === 'album' && copyIn && it.albumId) {
    ops.copyAlbum(it.albumId, target.id)
  }
  else if (it.kind === 'album' && it.itemId && it.fromBucketId && it.fromBucketId !== target.id) {
    // Same-bucket guard (mirrors the artist branch): dropping a member on its own
    // bucket would otherwise persist a spurious reorder (PUT /api/buckets/reorder).
    ops.insertAlbum(it.itemId, it.fromBucketId, target.id, null)
  }
  else if (it.kind === 'bucket' && it.bucketId && it.bucketId !== target.id) {
    const src = findBucket(ops.tree, it.bucketId)
    if (!(src && subtreeHas(src, target.id)))
      ops.moveBucketInto(it.bucketId, target.id)
  }
}
