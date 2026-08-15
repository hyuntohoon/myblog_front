// FEAT-playback-bucket-player Step 5 — the queue PROJECTION.
//
// The playback queue is not a thing the front stores. It is a view of one bucket in
// the tree `bucketStore` already owns: the Playback Bucket's direct members, in the
// order the server serialized them (`review_bucket_items.position`). So this module
// is pure selectors over a `BoardBucket[]`, plus one convenience that reads the live
// store — deliberately NOT a second store.
//
// Why that matters enough to write down: a separate queue store would have to be
// kept in sync with the tree on every drop, reorder, delete and revalidate, and the
// two would drift exactly the way the three independent bucket-tree copies drifted
// before `bucketStore` unified them. Every mutation here already goes through the
// board's ops → the tree → the store, so the queue updates for free and the tray and
// the board can never disagree about what is queued.
//
// Step 6 layers the SESSION (current track, play state, device, rung) on top of this
// in `lib/playback/session.ts`. That is state the tree genuinely does not hold; this
// is not, and must not be duplicated there.
import type { BoardAlbum, BoardBucket } from '@lib/buckets'
import { PLAYBACK_KIND } from '@lib/buckets'
import { bucketStore } from '@lib/pocketBuckit/bucketStore'

/**
 * The user's Playback Bucket, or null when it has not been auto-created yet (the
 * backend mints it lazily on the first tree read once the user is playback-eligible,
 * so a brand-new or ineligible account legitimately has none).
 *
 * Matched by `kind`, never by name or position: the bucket is user-renamable and
 * user-movable by design (T1 — only delete is refused), so any other handle would
 * break the moment the owner renamed it.
 */
export function findPlaybackBucket(tree: BoardBucket[] | null): BoardBucket | null {
  return (tree ?? []).find(b => b.kind === PLAYBACK_KIND) ?? null
}

/**
 * The queue: the Playback Bucket's DIRECT members in position order.
 *
 * Direct members only — a bucket nested under the queue is a container the user
 * parked there, not part of the play order, so `collectItems`-style subtree
 * flattening would be wrong here.
 *
 * Not filtered by item_type: the server's membership gate (`_assert_item_type_allowed`
 * on a type='playback' bucket) means every row in here is already a playback row.
 * Filtering anyway would silently hide a row that should never exist — if one ever
 * does, it is a server bug and hiding it would only delay finding it.
 */
export function queueItems(tree: BoardBucket[] | null): BoardAlbum[] {
  return findPlaybackBucket(tree)?.albums ?? []
}

/** The live queue, read straight off the shared bucket store (no fetch, no cache of its own). */
export function playbackQueue(): { bucket: BoardBucket | null, items: BoardAlbum[] } {
  const tree = bucketStore.getTree()
  const bucket = findPlaybackBucket(tree)
  return { bucket, items: bucket?.albums ?? [] }
}

/**
 * `tree` with `itemIds` dropped from `bucketId`'s direct members.
 *
 * The DELETE endpoint does not mutate `bucketStore`, so every confirmed membership
 * delete has to be applied to the shared tree by hand. That walker existed twice —
 * once in `session.ts`, once in `PlaybackPanel.tsx`, character for character — which
 * is the duplicated-pattern class CLAUDE.md names by hand. One copy lives here and
 * both call sites import it.
 *
 * Takes a set of ids rather than one, because replacing the queue deletes N rows and
 * pruning them one re-render at a time would show the old queue draining row by row.
 */
export function withoutQueueItems(tree: BoardBucket[], bucketId: string, itemIds: Iterable<string>): BoardBucket[] {
  const drop = new Set(itemIds)
  if (drop.size === 0)
    return tree
  const walk = (nodes: BoardBucket[]): BoardBucket[] => nodes.map(b => ({
    ...b,
    albums: b.id === bucketId ? b.albums.filter(a => !drop.has(a.itemId)) : b.albums,
    children: b.children.length ? walk(b.children) : b.children,
  }))
  return walk(tree)
}

/**
 * `tree` with `bucketId`'s direct members reordered to `orderedItemIds`.
 *
 * Used for the queue's own pointer-drag/keyboard reorder (ARCH-global-playback-
 * experience Step 4) — an optimistic local reflow ahead of the `PUT /reorder`
 * round-trip, same shape as `withoutQueueItems` above. `orderedItemIds` is taken
 * as the full new member set, not a partial reordering: an album whose id is
 * absent from it is dropped, not left in place. The current (only) caller always
 * passes every row's id, matching a race with a concurrent remove — an id that no
 * longer resolves to a live album is dropped the same way. A future caller
 * passing a genuinely partial list would need to merge in the untouched ids first.
 */
export function withReorderedQueueItems(tree: BoardBucket[], bucketId: string, orderedItemIds: readonly string[]): BoardBucket[] {
  const walk = (nodes: BoardBucket[]): BoardBucket[] => nodes.map((b) => {
    if (b.id !== bucketId)
      return b.children.length ? { ...b, children: walk(b.children) } : b
    const byId = new Map(b.albums.map(a => [a.itemId, a]))
    const albums = orderedItemIds.map(id => byId.get(id)).filter((a): a is BoardAlbum => a != null)
    return { ...b, albums, children: b.children.length ? walk(b.children) : b.children }
  })
  return walk(tree)
}
