// FEAT-pocket-buckit Step 1 — the live-data adapter.
//
// The ported atlas tray engines consume a flat `PocketLeaf` shape
// (`{id,name,path,verb,action,accepts,n,…}`); the live API
// (`listBuckets()` from `@lib/buckets`) returns the nested `BoardBucket` tree.
// This module is the single seam between them. v1 = album-only review buckets,
// so every leaf is an album `add` target; richer item types arrive in Step 5.

import type { BoardBucket } from '@lib/buckets'
import type { PocketOrder, PocketTreeDepth } from './design'

export type PocketAction = 'add' | 'queue' | 'play' | 'summarize'

/** One droppable leaf bucket, as the tray engine renders it. */
export interface PocketLeaf {
  /** review_buckets.id */
  id: string
  name: string
  /** compact tree path, root→self, e.g. ['평론', '읽을 평론']. */
  path: string[]
  /** what dropping here does, as a word ('담기'). */
  verb: string
  action: PocketAction
  /** accepted source-type label ('앨범'). */
  accepts: string
  /** item count. */
  n: number
  color: string | null
  kind: string
  /**
   * FEAT-pocket-buckit-viewers Track A — the bucket TYPE ('general' | 'artist'), carried
   * so a tray chip can run the reverse-DnD accept-gate (an Artist chip rejects a non-artist
   * source) without a tree lookup. Mirrors `BoardBucket.type`.
   */
  type: string
  pinned?: boolean
  ordered?: boolean
  processing?: boolean
  /**
   * the up-to-3 most-recent member covers/titles, for quick-inspect.
   * `albumId` is null for non-album members (Step 5 generalization).
   */
  recent: { itemId: string, itemType: string, albumId: string | null, title: string, cover: string | null }[]
}

/**
 * v1 verb/action per bucket kind. Today every review bucket is an album
 * collection (`add`); the special `spotify_library` mirror is excluded upstream.
 * Kept as a table so Step-5 kinds (playlist/queue/summary) slot in.
 */
function actionFor(_kind: string): { verb: string, action: PocketAction, accepts: string } {
  return { verb: '담기', action: 'add', accepts: '앨범' }
}

/** Flatten the bucket tree to leaves with their root→self path, honoring depth. */
function flatten(
  buckets: BoardBucket[],
  depth: PocketTreeDepth,
  trail: string[] = [],
  level = 0,
): { bucket: BoardBucket, path: string[] }[] {
  const out: { bucket: BoardBucket, path: string[] }[] = []
  for (const b of buckets) {
    if (b.kind === 'spotify_library')
      continue
    const path = [...trail, b.name]
    const isLeaf = b.children.length === 0
    // depth 0 → only top-level (level 0); depth 1 → through level 1; depth 2 → all.
    const withinDepth = level <= depth
    if (withinDepth && (isLeaf || level === depth || b.albums.length > 0))
      out.push({ bucket: b, path })
    if (b.children.length && level < depth)
      out.push(...flatten(b.children, depth, path, level + 1))
  }
  return out
}

function toLeaf(b: BoardBucket, path: string[]): PocketLeaf {
  const meta = actionFor(b.kind)
  return {
    id: b.id,
    name: b.name,
    path: path.length > 2 ? path.slice(-2) : path,
    verb: meta.verb,
    action: meta.action,
    accepts: meta.accepts,
    n: b.albums.length,
    color: b.color,
    kind: b.kind,
    type: b.type,
    pinned: path.length === 1,
    processing: b.researchMode !== 'off',
    recent: b.albums.slice(0, 3).map(a => ({ itemId: a.itemId, itemType: a.itemType, albumId: a.albumId, title: a.title, cover: a.cover })),
  }
}

/** Order a leaf list per the design's `order` axis (pure; never reshuffles a frozen list mid-drag). */
function applyOrder(leaves: PocketLeaf[], order: PocketOrder): PocketLeaf[] {
  if (order === 'pinned')
    return [...leaves].sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false))
  if (order === 'recent')
    return [...leaves].reverse()
  // contextual: review-leaning kinds first (album review pipeline), then the rest — stable.
  return [...leaves].sort((a, b) => Number(b.processing ?? false) - Number(a.processing ?? false))
}

/** Map the live bucket tree → ordered, depth-projected leaves for the tray rail. */
export function bucketsToLeaves(
  buckets: BoardBucket[],
  opts: { order: PocketOrder, treeDepth: PocketTreeDepth },
): PocketLeaf[] {
  const flat = flatten(buckets, opts.treeDepth)
  // de-dupe by id (a bucket can be matched at its own level and as a child)
  const seen = new Set<string>()
  const leaves: PocketLeaf[] = []
  for (const { bucket, path } of flat) {
    if (seen.has(bucket.id))
      continue
    seen.add(bucket.id)
    leaves.push(toLeaf(bucket, path))
  }
  return applyOrder(leaves, opts.order)
}
