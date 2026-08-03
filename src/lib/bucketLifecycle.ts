// Bucket lifecycle-tag derivation — the pure domain rule mapping a bucket's typed
// fields to its status tag. Extracted from BucketBoard.tsx by
// REFACTOR-frontend-member-surface Step 3 (pure move, behavior unchanged); unit-
// tested by src/components/member/bucketLifecycle.test.ts.
import type { BoardAlbum, BoardBucket } from './buckets'
import type { ResearchStatus } from './research'
import { PLAYBACK_KIND, SLIB_KIND, visit } from './buckets'

// `review_buckets.kind` of the system "들을 것" queue. FEAT-pocket-buckit Step 6
// (V31) folded the old `album_to_listen_items` table into this kind, so the front
// no longer infers the to-listen bucket from its NAME — `kind` is the canonical,
// rename-proof signal. crMeta tags this bucket 청취 예정 by kind (FEAT-bucket-
// identity Direction B made every other tag rename-proof too, so the old name-
// regex fallback for pre-system buckets is gone).
export const TOLISTEN_KIND = 'to_listen'

// FEAT-playback-bucket-player Step 5 — the system-owned kinds. The backend's
// `delete_bucket` rejects exactly these with 409 (SYSTEM_BUCKET_KINDS in
// bucket_service.py); this list is the client-side mirror, and it is COSMETIC by
// design — it hides a doomed 삭제 affordance so a bucket never blinks out
// optimistically and then reappears, but the server is the authority.
//
// Note the axis: system-ness is `kind`, not `type`. `spotify_library` and
// `to_listen` are both type='general'; only the Playback Bucket has its own type.
// Guarding on type here would silently stop protecting the older two.
export const SYSTEM_BUCKET_KINDS: readonly string[] = [PLAYBACK_KIND, SLIB_KIND, TOLISTEN_KIND]

/** System-owned bucket — auto-created, non-deletable, non-duplicable (server-enforced). */
export function isSystemBucket(b: Pick<BoardBucket, 'kind'>): boolean {
  return SYSTEM_BUCKET_KINDS.includes(b.kind)
}

/**
 * BUG-playback-system-bucket-cascade — the `kind` of a system bucket anywhere in `b`'s
 * subtree (including `b` itself), or null. Deleting a bucket cascades to its whole subtree,
 * so "is this deletable" is a question about the subtree, never about the node alone.
 *
 * Mirrors the backend's `_system_bucket_in_subtree` and, like `isSystemBucket`, is cosmetic —
 * the server answers 409 either way. It exists because the optimistic delete removes the row
 * first: without it, deleting a crate that happens to contain the queue makes the whole
 * subtree vanish and then reappear on the error refresh.
 *
 * Returns the kind, not a bool, so the message can name what is in the way — "move it out
 * first" is only actionable if the member knows which bucket to move.
 */
export function systemBucketInSubtree(b: BoardBucket): string | null {
  let found: string | null = null
  visit([b], (n) => {
    if (found == null && isSystemBucket(n))
      found = n.kind
  })
  return found
}

/** Korean label for a system kind, for the "can't delete" message. */
export function systemBucketLabel(kind: string): string {
  if (kind === PLAYBACK_KIND)
    return '재생 대기열'
  if (kind === SLIB_KIND)
    return 'Spotify 라이브러리'
  return '청취 예정'
}

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
  // FEAT-playback-bucket-player Step 5: the Playback Bucket is not a lifecycle
  // stage at all — it is a queue, so none of 담음/조사 중/작성 중/완료 can ever
  // describe it. Tagged by kind first, ahead of every other rule, for the same
  // rename-proof reason as the to-listen bucket below. Without this it rendered as
  // an ordinary 담음 crate, indistinguishable from a user's own.
  if (b.kind === PLAYBACK_KIND)
    return { tag: '재생 대기열' }
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
