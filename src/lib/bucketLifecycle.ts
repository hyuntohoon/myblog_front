// Bucket lifecycle-tag derivation — the pure domain rule mapping a bucket's typed
// fields to its status tag. Extracted from BucketBoard.tsx by
// REFACTOR-frontend-member-surface Step 3 (pure move, behavior unchanged); unit-
// tested by src/components/member/bucketLifecycle.test.ts.
import type { BoardAlbum, BoardBucket } from './buckets'
import type { ResearchStatus } from './research'

// `review_buckets.kind` of the system "들을 것" queue. FEAT-pocket-buckit Step 6
// (V31) folded the old `album_to_listen_items` table into this kind, so the front
// no longer infers the to-listen bucket from its NAME — `kind` is the canonical,
// rename-proof signal. crMeta tags this bucket 청취 예정 by kind (FEAT-bucket-
// identity Direction B made every other tag rename-proof too, so the old name-
// regex fallback for pre-system buckets is gone).
export const TOLISTEN_KIND = 'to_listen'

// ── status meta ───────────────────────────────────────────────────────────--
// FEAT-bucket-identity Direction B: the lifecycle tag is derived ONLY from typed
// fields (is_done / item postId / item research_status), NEVER from the bucket's
// free-text name — so renaming a bucket can no longer change its tag. Precedence
// is most-advanced-wins: 완료 → 작성 중 → 조사 중 → 담음.
//   · 완료      bucket.isDone (the single "평론 완료" column).
//   · 작성 중   some item has a linked post (postId) that is not yet published
//              as a review (alreadyReviewed false) — a draft/post is in flight.
//   · 조사 중   some item is in the research phase (research engaged; see below).
//   · 담음      otherwise — collected, nothing in motion.
// The system to-listen bucket stays 청취 예정, tagged by its typed `kind` (also
// rename-proof). There is NO rename-proof deadline/urgency field, so the old
// name-regex accent (급한/마감) is dropped — accent now comes only from the
// bucket's explicit editorial color.

// Every album (item) in a bucket's subtree — direct members + all descendants —
// so a parent bucket's lifecycle tag reflects the aggregate state of everything
// nested under it, not just its own direct members.
export function collectItems(b: BoardBucket): BoardAlbum[] {
  const out: BoardAlbum[] = []
  const walk = (node: BoardBucket): void => {
    out.push(...node.albums)
    node.children.forEach(walk)
  }
  walk(b)
  return out
}

// Research is "engaged" when a run is in flight OR has produced a note. The tag
// marks the research PHASE, so a completed note (done) still counts — excluding
// it would relabel a fully-researched album as merely 담음. A terminal failed run
// yields no note, so it does not lift the bucket out of 담음.
export function isResearchEngaged(s: ResearchStatus | null): boolean {
  return s === 'queued' || s === 'running' || s === 'done'
}

export function crMeta(b: BoardBucket): { tag: string } {
  // Canonical: the system to-listen bucket is tagged by kind, not its name.
  if (b.kind === TOLISTEN_KIND)
    return { tag: '청취 예정' }
  if (b.isDone)
    return { tag: '완료' }
  const items = collectItems(b)
  if (items.some(a => a.postId != null && !a.alreadyReviewed))
    return { tag: '작성 중' }
  if (items.some(a => isResearchEngaged(a.researchStatus ?? null)))
    return { tag: '조사 중' }
  return { tag: '담음' }
}
