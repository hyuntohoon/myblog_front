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
//   - user-scoped keys (Cognito `sub`) + other-scope pruning on init → a logout / account
//     switch can never repaint the previous user's tree.
// React consumers subscribe via `useBucketStore()` (useSyncExternalStore).
import type { BoardBucket } from '@lib/buckets'
import { useSyncExternalStore } from 'react'
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
// localhost dev → a fixed scope; prod → the id_token `sub`; logged-out → 'anon'.
function userScope(): string {
  if (typeof window === 'undefined')
    return 'anon'
  const host = location.hostname
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local'))
    return 'local-dev'
  try {
    const idToken = localStorage.getItem('id_token')
    if (idToken) {
      const payload = JSON.parse(atob(idToken.split('.')[1])) as { sub?: string }
      if (payload.sub)
        return payload.sub
    }
  }
  catch { /* malformed token → anon */ }
  return 'anon'
}

const scope = userScope()
const cacheKey = KEY_PREFIX + scope

const EMPTY: BucketStoreSnapshot = { tree: null, fetchedAt: 0, loading: false, error: null }
let current: BucketStoreSnapshot = EMPTY
const listeners = new Set<() => void>()
let inflight: Promise<void> | null = null
// Monotonic id of the latest issued fetch. A resolving fetch only applies its
// result when it is still the latest (`seq === fetchSeq`); an earlier fetch that
// a later `force` superseded drops its (now-stale) result instead of overwriting.
let fetchSeq = 0
let seeded = false

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
        if (seq === fetchSeq)
          inflight = null
      })
    inflight = p
    return p
  },
  /** Optimistic local replace (a mutation patched the tree). Persists + notifies all islands. */
  setTree(tree: BoardBucket[]): void {
    current = { ...current, tree, fetchedAt: Date.now(), error: null }
    writeCache()
    emit()
  },
  /** Drop this scope's cache (in-memory + sessionStorage). */
  clear(): void {
    current = { tree: null, fetchedAt: 0, loading: false, error: null }
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
