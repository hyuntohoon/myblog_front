// FEAT-pocket-buckit-workspace Step B — one cached, user-scoped source of truth for
// the bucket tree, shared across every island.
//
// WHY: the site is an MPA (no client router), so each page load remounts the layout
// Pocket island AND any member board, and each used to re-`listBuckets()` the full
// tree. Three independent copies (tray provider / BucketBoard / LikedBoard) also drifted
// from each other. This module is a framework-agnostic observable store:
//   - module singleton → islands on the SAME page share one in-memory tree (a mutation
//     in one is seen by the others instantly, no refetch);
//   - sessionStorage-backed → the tree survives a same-tab navigation, so moving between
//     pages reuses the cache instead of refetching (SWR: revalidate only when stale);
//   - user-scoped keys (Cognito `sub`) + other-scope pruning → a logout / account
//     switch can never repaint the previous user's tree. FIX-auth-identity-lifecycle
//     Step 1: this used to be pruning "on init" only, which made the guarantee true of
//     a fresh page load and false of the tab that was already open when the account
//     changed. The scope is now live — see `rescope()`.
// React consumers subscribe via `useBucketStore()` (useSyncExternalStore).
import type { BoardBucket } from '@lib/buckets'
import { useSyncExternalStore } from 'react'
import { getAuthIdentity, subscribeAuthIdentity } from '@lib/authIdentity'
import { listBuckets } from '@lib/buckets'

const KEY_PREFIX = 'pb:cache:buckets:'
// SWR window: within this, a navigation reuses the cache with no network call; past it
// the next read revalidates in the background (the stale tree still paints immediately).
// 5 min (was 30s): normal MPA browsing reused the sessionStorage tree instead of
// refetching the full bucket tree (the heaviest DB read) on nearly every navigation,
// which kept Neon's auto-suspending compute awake. Tray content is not latency-sensitive.
const DEFAULT_STALE_MS = 300_000

interface CacheBlob { tree: BoardBucket[], fetchedAt: number }

export interface BucketStoreSnapshot {
  /** The cached tree, or null before the first load (paints from cache, then revalidates). */
  tree: BoardBucket[] | null
  fetchedAt: number
  loading: boolean
  error: string | null
}

// ── user scope (Cognito sub) ─────────────────────────────────────────────────
// Delegated to `@lib/authIdentity`, which is also what publishes the CHANGES this
// store now reacts to. It used to parse the id_token here and freeze the result in a
// module constant — correct on the load that computed it, and wrong forever after,
// because a second tab whose account changed never re-ran module init. It went on
// painting account A's tree, and wrote account B's fetch results under A's key.
let scope = getAuthIdentity()
let cacheKey = KEY_PREFIX + scope

const EMPTY: BucketStoreSnapshot = { tree: null, fetchedAt: 0, loading: false, error: null }
let current: BucketStoreSnapshot = EMPTY
const listeners = new Set<() => void>()
let inflight: Promise<void> | null = null
// Monotonic id of the latest issued fetch. A resolving fetch only applies its
// result when it is still the latest (`seq === fetchSeq`); an earlier fetch that
// a later `force` superseded drops its (now-stale) result instead of overwriting.
let fetchSeq = 0
// Structural writes (move/delete) are optimistic and may remain in flight while
// another island asks for a full-tree refresh. Such a read can observe the server
// before the write commits, so hold it until every pending structural write settles.
let structuralMutations = 0
const structuralWaiters = new Set<() => void>()
let structuralQueue: Promise<void> = Promise.resolve()
let structuralReplayTree: BoardBucket[] | null = null
let seeded = false

export interface StructuralMutationContext {
  /** Expected server tree after every earlier queued structural write. */
  tree: BoardBucket[]
  /** Advance the expected server tree after this task succeeds. */
  commitTree: (tree: BoardBucket[]) => void
  /** Repaint from the expected server tree plus every still-pending intent. */
  reconcileTree: () => void
}

type StructuralProjection = (tree: BoardBucket[]) => BoardBucket[]
interface PendingStructuralProjection { id: number, apply: StructuralProjection }
let structuralProjectionSeq = 0
let pendingStructuralProjections: PendingStructuralProjection[] = []

function emit(): void {
  for (const l of listeners)
    l()
}

// Drop any cached tree belonging to a DIFFERENT user scope — the logout / account-switch
// isolation guarantee (a stale-user blob is never read or repainted).
function pruneOtherScopes(): void {
  if (typeof sessionStorage === 'undefined')
    return
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i)
      if (k && k.startsWith(KEY_PREFIX) && k !== cacheKey)
        sessionStorage.removeItem(k)
    }
  }
  catch { /* storage disabled */ }
}

// Seed the in-memory tree from this scope's sessionStorage blob (once, lazily, client-side).
function ensureSeeded(): void {
  if (seeded || typeof window === 'undefined')
    return
  seeded = true
  pruneOtherScopes()
  try {
    const raw = sessionStorage.getItem(cacheKey)
    if (raw) {
      const blob = JSON.parse(raw) as CacheBlob
      if (Array.isArray(blob.tree))
        current = { ...current, tree: blob.tree, fetchedAt: blob.fetchedAt || 0 }
    }
  }
  catch { /* corrupt → ignore */ }
}

function writeCache(): void {
  if (typeof sessionStorage === 'undefined' || !current.tree)
    return
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify({ tree: current.tree, fetchedAt: current.fetchedAt } satisfies CacheBlob))
  }
  catch { /* quota → in-memory only */ }
}

/**
 * FIX-auth-identity-lifecycle Step 1 — move the store to a new account.
 *
 * Three things have to happen together, and the order matters:
 *   1. `fetchSeq` is bumped, which is what CANCELS account A's in-flight reads. They
 *      still resolve, but `seq !== fetchSeq` makes them drop their result instead of
 *      writing it — the store already has that guard for superseded refreshes, and an
 *      account switch is the same shape of staleness.
 *   2. Every optimistic structural intent is dropped. Those describe moves inside A's
 *      tree; replaying them against B's would corrupt it.
 *   3. The key is repointed and re-seeded, so what paints next is B's cache or
 *      nothing — never A's tree.
 *
 * `pruneOtherScopes` then deletes A's blob outright: it is the isolation guarantee the
 * module was always documented to make, and until now it only held for a fresh load.
 */
function rescope(next: string): void {
  if (next === scope)
    return
  scope = next
  cacheKey = KEY_PREFIX + scope
  fetchSeq += 1
  inflight = null
  structuralReplayTree = null
  pendingStructuralProjections = []
  current = { tree: null, fetchedAt: 0, loading: false, error: null }
  seeded = false
  ensureSeeded()
  emit()
}
// `structuralMutations` is deliberately NOT reset here. Zeroing the counter without
// resolving `structuralWaiters` strands them, and resolving them races the real
// completion callback into a negative count — while leaving it alone costs only that
// the new account's first read waits for account A's in-flight write to settle, which
// `apiFetch`'s own ceiling bounds. The write itself can no longer touch the tree: its
// projections were dropped above and `fetchSeq` has moved past it.

if (typeof window !== 'undefined')
  subscribeAuthIdentity(identity => rescope(identity))

async function waitForStructuralMutations(): Promise<void> {
  if (structuralMutations === 0)
    return
  await new Promise<void>((resolve) => {
    structuralWaiters.add(resolve)
  })
  return waitForStructuralMutations()
}

function mergeCurrentNodeData(projected: BoardBucket[], live: BoardBucket[]): BoardBucket[] {
  const liveById = new Map<string, BoardBucket>()
  const collect = (tree: BoardBucket[]) => tree.forEach((bucket) => {
    liveById.set(bucket.id, bucket)
    collect(bucket.children)
  })
  collect(live)
  const merge = (tree: BoardBucket[]): BoardBucket[] => tree.map(bucket => ({
    ...(liveById.get(bucket.id) ?? bucket),
    children: merge(bucket.children),
  }))
  return merge(projected)
}

function replaceTree(tree: BoardBucket[]): void {
  fetchSeq += 1
  current = { ...current, tree, fetchedAt: Date.now(), loading: false, error: null }
  writeCache()
  emit()
}

function reconcileStructuralTree(): void {
  if (!structuralReplayTree)
    return
  const projected = pendingStructuralProjections.reduce(
    (tree, intent) => intent.apply(tree),
    structuralReplayTree,
  )
  replaceTree(mergeCurrentNodeData(projected, current.tree ?? []))
}

// ── public store API ─────────────────────────────────────────────────────────
export const bucketStore = {
  subscribe(cb: () => void): () => void {
    ensureSeeded()
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
  getSnapshot(): BucketStoreSnapshot {
    ensureSeeded()
    return current
  },
  /** SSR snapshot — stable empty state (the tray/board are client:only, so this only guards hydration). */
  getServerSnapshot(): BucketStoreSnapshot {
    return EMPTY
  },
  /** The live in-memory tree (for mutation closures that must read the latest, not a stale render). */
  getTree(): BoardBucket[] {
    ensureSeeded()
    return current.tree ?? []
  },
  /**
   * Ensure the tree is fresh. SWR: returns immediately when a non-stale cached tree exists
   * (no network); otherwise fetches once (deduped via the in-flight promise) and notifies.
   * `force` always refetches (used after a mutation / by an explicit refresh).
   */
  async ensureFresh(force = false, staleMs = DEFAULT_STALE_MS): Promise<void> {
    if (typeof window === 'undefined')
      return
    ensureSeeded()
    if (structuralMutations > 0)
      await waitForStructuralMutations()
    const fresh = current.tree != null && (Date.now() - current.fetchedAt) < staleMs
    if (fresh && !force)
      return
    // A non-forced revalidate dedupes onto any in-flight fetch. A FORCED refresh
    // (post-mutation / optimistic-failure rollback) must NOT join a possibly-stale
    // in-flight fetch: that pre-mutation snapshot would resolve, get stamped fresh,
    // and mask the mutation for the whole SWR window. So force always issues its own
    // fetch; the fetchSeq guard drops the superseded in-flight result when it lands.
    if (inflight && !force)
      return inflight
    const seq = ++fetchSeq
    current = { ...current, loading: true }
    emit()
    const p = listBuckets()
      .then((tree) => {
        if (seq !== fetchSeq)
          return // a newer (forced) fetch superseded this one — drop the stale result
        current = { tree, fetchedAt: Date.now(), loading: false, error: null }
        writeCache()
        emit()
      })
      .catch((e: unknown) => {
        if (seq !== fetchSeq)
          return
        current = { ...current, loading: false, error: e instanceof Error ? e.message : 'load failed' }
        emit()
      })
      .finally(() => {
        if (inflight === p)
          inflight = null
      })
    inflight = p
    return p
  },
  /** Optimistic local replace (a mutation patched the tree). Persists + notifies all islands. */
  setTree(tree: BoardBucket[]): void {
    // A read issued before this write is older by definition. Invalidating its
    // sequence prevents its full-tree response from reverting the optimistic UI.
    replaceTree(tree)
  },
  /**
   * Mark a structural write as pending. Full-tree refreshes wait for all such writes
   * to settle, because the server snapshot is not authoritative mid-mutation.
   * Returns an idempotent completion callback for success and failure paths.
   */
  beginStructuralMutation(): () => void {
    if (structuralMutations === 0)
      structuralReplayTree = current.tree ?? []
    structuralMutations += 1
    fetchSeq += 1 // also supersede a refresh that started immediately before the write
    let completed = false
    return () => {
      if (completed)
        return
      completed = true
      structuralMutations -= 1
      if (structuralMutations === 0) {
        structuralReplayTree = null
        const waiters = [...structuralWaiters]
        structuralWaiters.clear()
        for (const resolve of waiters)
          resolve()
      }
    }
  },
  /**
   * Run structural API writes in one cross-island FIFO. Callers begin their barrier
   * before the optimistic patch and end it only after their own failure rollback;
   * this executor owns request order only. Rejections are returned to the caller but
   * normalized on the private tail so one failed request cannot poison later work.
   */
  enqueueStructuralMutation<T>(task: (context: StructuralMutationContext) => Promise<T>, project?: StructuralProjection): Promise<T> {
    const projection = project ? { id: ++structuralProjectionSeq, apply: project } : null
    if (projection)
      pendingStructuralProjections.push(projection)
    const taskResult = structuralQueue.then(() => task({
      tree: structuralReplayTree ?? current.tree ?? [],
      commitTree: (tree) => {
        structuralReplayTree = tree
      },
      reconcileTree: reconcileStructuralTree,
    }))
    const removeProjection = () => {
      if (projection)
        pendingStructuralProjections = pendingStructuralProjections.filter(item => item.id !== projection.id)
    }
    const result = taskResult.then(
      (value) => {
        removeProjection()
        return value
      },
      (error: unknown) => {
        removeProjection()
        if (projection)
          reconcileStructuralTree()
        throw error
      },
    )
    structuralQueue = result.then(() => undefined, () => undefined)
    return result
  },
  /** Drop this scope's cache (in-memory + sessionStorage). */
  clear(): void {
    current = { tree: null, fetchedAt: 0, loading: false, error: null }
    structuralReplayTree = null
    pendingStructuralProjections = []
    try {
      sessionStorage.removeItem(cacheKey)
    }
    catch { /* ignore */ }
    emit()
  },
}

/** Subscribe a React component to the shared bucket store. */
export function useBucketStore(): BucketStoreSnapshot {
  return useSyncExternalStore(bucketStore.subscribe, bucketStore.getSnapshot, bucketStore.getServerSnapshot)
}
