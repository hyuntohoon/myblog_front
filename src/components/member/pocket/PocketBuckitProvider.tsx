// FEAT-pocket-buckit Step 1 — the Pocket context: the persisted user-selectable
// design + the live bucket leaves + runtime tray state.
// Single instance, mounted once site-wide by PocketBuckit (the island).
//
// FEAT-pocket-buckit-workspace Step A — the single quick-inspect drawer became a
// MULTI-drawer workspace: several bucket mini-drawers open at once, each movable /
// focusable / closable independently, brought-to-front on re-click, never duplicated.
// A separate `editMode` (NOT derived from any drawer being open) gates removal +
// reorder. State kept deliberately separate (request §9): tray leaves, the open-drawer
// set, per-bucket persisted positions, the focus z-order, and edit mode are distinct.
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type { BoardBucket } from '@lib/buckets'
import type { PocketBuckitDesign } from '@lib/pocketBuckit/design'
import type { PocketLeaf } from '@lib/pocketBuckit/leaf'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { isLoggedIn } from '@lib/auth'
import { addBucketItem, deleteBucket as apiDeleteBucket, deleteBucketItem, moveBucket } from '@lib/buckets'
import { bucketStore, useBucketStore } from '@lib/pocketBuckit/bucketStore'
import { normalizeDesign, POCKET_DESIGN_DEFAULTS, readDesign, writeDesign } from '@lib/pocketBuckit/design'
import { bucketsToLeaves } from '@lib/pocketBuckit/leaf'

// Stable empty tree so a null cache doesn't churn the leaves/flatBuckets memos.
const EMPTY_BUCKETS: BoardBucket[] = []

interface UndoState {
  label: string
  run: () => Promise<void>
}

export interface DrawerPos { x: number, y: number }

/**
 * One open mini-drawer. `z` is the focus order (higher = on top); the position
 *  is NOT stored here — it lives in the persisted per-bucket map so a reopen
 *  restores it. The drawer component owns the live drag position locally.
 */
export interface OpenDrawer { bucketId: string, z: number }

interface PocketContextValue {
  design: PocketBuckitDesign
  setDesign: (patch: Partial<PocketBuckitDesign>) => void
  resetDesign: () => void
  leaves: PocketLeaf[]
  loading: boolean
  error: string | null
  refresh: () => void
  open: boolean
  // The raw useState dispatcher — accepts a boolean OR a functional updater
  // (v => !v) so cross-island toggles flip without a stale read.
  setOpen: Dispatch<SetStateAction<boolean>>
  // ── multi-drawer workspace ──────────────────────────────────────────────────
  /** The buckets whose mini-drawers are currently open (with their focus z-order). */
  openDrawers: OpenDrawer[]
  /**
   * Open the bucket's drawer, or — if already open — bring it to the front + focus it
   *  (never a duplicate drawer).
   */
  openDrawer: (bucketId: string) => void
  /** Bring an already-open drawer to the front (focus). */
  focusDrawer: (bucketId: string) => void
  /** Close a single drawer; the others stay open + put. */
  closeDrawer: (bucketId: string) => void
  /** Close every open drawer (used when the tray collapses). */
  closeAllDrawers: () => void
  /** Persist a drawer's viewport-clamped position (per bucket) after a drag/place. */
  moveDrawer: (bucketId: string, pos: DrawerPos) => void
  /** The persisted position for a bucket's drawer, or null (→ cascade default). */
  drawerPosFor: (bucketId: string) => DrawerPos | null
  /** True when the bucket has an open drawer (drives the tray chip's active ring). */
  isDrawerOpen: (bucketId: string) => boolean
  // ── edit / arrange mode (independent of drawer-open) ────────────────────────
  /** When true the tray reveals removal (× / item −) + enables drag-reorder. */
  editMode: boolean
  setEditMode: (b: boolean) => void
  // ── data ────────────────────────────────────────────────────────────────────
  bucketById: (id: string) => BoardBucket | undefined
  removeItem: (bucketId: string, itemId: string, albumId: string | null, title: string) => Promise<void>
  /**
   * Reorder a TOP-LEVEL bucket in the tray, persisted via PUT /api/buckets/{id}/move
   * (the bucket `position` column — the existing, real source of truth). Optimistic
   * local reorder, then the server's authoritative tree; reverts on failure. Nested
   * (non-root) chips are a no-op (they keep their position; no accidental reparent).
   */
  reorderBucket: (draggedId: string, targetId: string, place: 'before' | 'after') => Promise<void>
  /**
   * Delete a bucket (cascades to descendants + items). Optimistic prune; reverts on
   *  failure. Edit-mode only, behind an inline 2-tap confirm (no server undo).
   */
  deleteBucket: (bucketId: string) => Promise<void>
  undo: UndoState | null
  runUndo: () => void
}

// Per-bucket drawer positions: { [bucketId]: {x,y} }. Replaces the single-drawer
// `pb:drawer` key — now several drawers each remember where they were left.
const DRAWERS_KEY = 'pb:drawers'

function readDrawerMap(): Record<string, DrawerPos> {
  if (typeof window === 'undefined')
    return {}
  try {
    const raw = localStorage.getItem(DRAWERS_KEY)
    if (!raw)
      return {}
    const v = JSON.parse(raw) as Record<string, Partial<DrawerPos>>
    const out: Record<string, DrawerPos> = {}
    for (const [id, p] of Object.entries(v ?? {})) {
      if (p && typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y))
        out[id] = { x: p.x, y: p.y }
    }
    return out
  }
  catch { /* corrupt → empty */ }
  return {}
}

// Remove a bucket (and its subtree) from the tree at any depth — optimistic delete.
function pruneBucket(tree: BoardBucket[], id: string): BoardBucket[] {
  return tree
    .filter(b => b.id !== id)
    .map(b => (b.children.length ? { ...b, children: pruneBucket(b.children, id) } : b))
}

const PocketContext = createContext<PocketContextValue | null>(null)

/** Access the Pocket context. Throws when used outside the provider. */
export function usePocket(): PocketContextValue {
  const ctx = useContext(PocketContext)
  if (!ctx)
    throw new Error('usePocket must be used within <PocketBuckitProvider>')
  return ctx
}

export function PocketBuckitProvider({ children }: { children: ReactNode }) {
  const [design, setDesignState] = useState<PocketBuckitDesign>(POCKET_DESIGN_DEFAULTS)
  // The bucket tree is no longer local state — it lives in the shared, user-scoped,
  // sessionStorage-backed bucketStore so the tray, /profile board, and library share one
  // source and a same-tab navigation reuses the cache instead of refetching.
  const store = useBucketStore()
  const buckets = store.tree ?? EMPTY_BUCKETS
  const loading = store.loading
  const error = store.error
  const [open, setOpen] = useState(false)
  const [openDrawers, setOpenDrawers] = useState<OpenDrawer[]>([])
  const [editMode, setEditMode] = useState(false)
  const [drawerMap, setDrawerMap] = useState<Record<string, DrawerPos>>({})
  const drawerMapRef = useRef<Record<string, DrawerPos>>({})
  drawerMapRef.current = drawerMap // fresh read inside openDrawer without a stale closure
  const topZ = useRef(0)
  const [undo, setUndo] = useState<UndoState | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // hydrate the persisted design + drawer positions on mount (SSR renders the
  // default; client swaps). Each drawer position is re-clamped to the live viewport
  // when its drawer opens (so a stale off-screen coord is corrected).
  useEffect(() => {
    setDesignState(readDesign())
    setDrawerMap(readDrawerMap())
  }, [])

  const refresh = useCallback(() => {
    if (isLoggedIn())
      void bucketStore.ensureFresh(true)
  }, [])

  // SWR: paint from the shared cache instantly (it survives a same-tab navigation), and
  // revalidate only when stale — no full-tree refetch on every page nav. Skipped when
  // logged out (the tray is hidden anyway).
  useEffect(() => {
    if (isLoggedIn())
      void bucketStore.ensureFresh()
  }, [])

  const setDesign = useCallback((patch: Partial<PocketBuckitDesign>) => {
    setDesignState((prev) => {
      const next = normalizeDesign({ ...prev, ...patch })
      writeDesign(next)
      return next
    })
  }, [])

  const resetDesign = useCallback(() => {
    writeDesign(POCKET_DESIGN_DEFAULTS)
    setDesignState(POCKET_DESIGN_DEFAULTS)
  }, [])

  // ── multi-drawer actions ──────────────────────────────────────────────────────
  const openDrawer = useCallback((bucketId: string) => {
    setOpenDrawers((prev) => {
      const z = ++topZ.current
      if (prev.some(d => d.bucketId === bucketId)) // already open → focus (no duplicate)
        return prev.map(d => (d.bucketId === bucketId ? { ...d, z } : d))
      return [...prev, { bucketId, z }]
    })
  }, [])

  const focusDrawer = useCallback((bucketId: string) => {
    setOpenDrawers((prev) => {
      const cur = prev.find(d => d.bucketId === bucketId)
      if (!cur || cur.z === topZ.current) // already on top → no state churn
        return prev
      const z = ++topZ.current
      return prev.map(d => (d.bucketId === bucketId ? { ...d, z } : d))
    })
  }, [])

  const closeDrawer = useCallback((bucketId: string) => {
    setOpenDrawers(prev => prev.filter(d => d.bucketId !== bucketId))
  }, [])

  const closeAllDrawers = useCallback(() => setOpenDrawers([]), [])

  const moveDrawer = useCallback((bucketId: string, pos: DrawerPos) => {
    setDrawerMap((prev) => {
      const next = { ...prev, [bucketId]: pos }
      try {
        localStorage.setItem(DRAWERS_KEY, JSON.stringify(next))
      }
      catch { /* quota / SSR — in-memory only */ }
      return next
    })
  }, [])

  const drawerPosFor = useCallback((bucketId: string) => drawerMapRef.current[bucketId] ?? null, [])
  const openIds = useMemo(() => new Set(openDrawers.map(d => d.bucketId)), [openDrawers])
  const isDrawerOpen = useCallback((bucketId: string) => openIds.has(bucketId), [openIds])

  const leaves = useMemo(
    () => bucketsToLeaves(buckets, { order: design.order, treeDepth: design.treeDepth }),
    [buckets, design.order, design.treeDepth],
  )

  const flatBuckets = useMemo(() => {
    const out: BoardBucket[] = []
    const walk = (bs: BoardBucket[]) => bs.forEach((b) => {
      out.push(b)
      walk(b.children)
    })
    walk(buckets)
    return out
  }, [buckets])

  const bucketById = useCallback((id: string) => flatBuckets.find(b => b.id === id), [flatBuckets])

  // Drop drawers + edit mode whenever the underlying bucket vanishes (deleted
  // elsewhere) so a stale id can never render an empty drawer.
  useEffect(() => {
    setOpenDrawers(prev => prev.filter(d => flatBuckets.some(b => b.id === d.bucketId)))
  }, [flatBuckets])

  const showUndo = useCallback((u: UndoState) => {
    if (undoTimer.current)
      clearTimeout(undoTimer.current)
    setUndo(u)
    undoTimer.current = setTimeout(() => setUndo(null), 6000)
  }, [])

  const removeItem = useCallback(async (bucketId: string, itemId: string, albumId: string | null, title: string) => {
    await deleteBucketItem(bucketId, itemId)
    void bucketStore.ensureFresh(true)
    showUndo({
      label: `${title} 제거됨 · 실행취소`,
      // Undo re-adds by album_id, which only exists for album members. A
      // non-album row can't be re-added through the album path, so the removal stands.
      run: albumId ?
        async () => {
          await addBucketItem(bucketId, albumId)
          void bucketStore.ensureFresh(true)
        } :
        async () => {},
    })
  }, [showUndo])

  const reorderBucket = useCallback(async (draggedId: string, targetId: string, place: 'before' | 'after') => {
    if (draggedId === targetId)
      return
    // The shared store's tree has only roots at the top level. Tray reorder operates on
    // those roots (the common flat case); a non-root chip is a no-op so we never
    // accidentally reparent it. Read the LIVE tree, not a render closure.
    const cur = bucketStore.getTree()
    const fromIdx = cur.findIndex(b => b.id === draggedId)
    if (fromIdx < 0 || cur.findIndex(b => b.id === targetId) < 0)
      return
    const next = [...cur]
    const [moved] = next.splice(fromIdx, 1)
    let insertAt = next.findIndex(b => b.id === targetId)
    if (place === 'after')
      insertAt += 1
    next.splice(insertAt, 0, moved)
    const newIndex = next.findIndex(b => b.id === draggedId)
    if (newIndex === fromIdx)
      return
    bucketStore.setTree(next) // optimistic — every island sees it
    try {
      // a root's parent_id is null; keep it at root, new position.
      const tree = await moveBucket(draggedId, null, newIndex)
      bucketStore.setTree(tree) // authoritative server order
    }
    catch {
      void bucketStore.ensureFresh(true) // revert to the server's truth
    }
  }, [])

  const deleteBucket = useCallback(async (bucketId: string) => {
    closeDrawer(bucketId)
    const snapshot = bucketStore.getTree()
    bucketStore.setTree(pruneBucket(snapshot, bucketId)) // optimistic — every island
    try {
      await apiDeleteBucket(bucketId)
    }
    catch {
      bucketStore.setTree(snapshot) // restore on failure
      void bucketStore.ensureFresh(true)
    }
  }, [closeDrawer])

  const runUndo = useCallback(() => {
    const u = undo
    setUndo(null)
    if (u)
      void u.run()
  }, [undo])

  const value = useMemo<PocketContextValue>(() => ({
    design,
    setDesign,
    resetDesign,
    leaves,
    loading,
    error,
    refresh,
    open,
    setOpen,
    openDrawers,
    openDrawer,
    focusDrawer,
    closeDrawer,
    closeAllDrawers,
    moveDrawer,
    drawerPosFor,
    isDrawerOpen,
    editMode,
    setEditMode,
    bucketById,
    removeItem,
    reorderBucket,
    deleteBucket,
    undo,
    runUndo,
  }), [
    design,
setDesign,
resetDesign,
leaves,
loading,
error,
refresh,
open,
    openDrawers,
openDrawer,
focusDrawer,
closeDrawer,
closeAllDrawers,
moveDrawer,
drawerPosFor,
isDrawerOpen,
    editMode,
bucketById,
removeItem,
reorderBucket,
deleteBucket,
undo,
runUndo,
  ])

  return <PocketContext.Provider value={value}>{children}</PocketContext.Provider>
}
