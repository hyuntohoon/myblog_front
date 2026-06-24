// FEAT-pocket-buckit Step 1 — the Pocket context: the persisted user-selectable
// design + the live bucket leaves + runtime tray state (open / inspect / undo).
// Single instance, mounted once site-wide by PocketBuckit (the island).
import type { ReactNode } from 'react'
import type { BoardBucket } from '@lib/buckets'
import type { PocketBuckitDesign } from '@lib/pocketBuckit/design'
import type { PocketLeaf } from '@lib/pocketBuckit/leaf'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { isLoggedIn } from '@lib/auth'
import { addBucketItem, deleteBucketItem, listBuckets, moveBucket } from '@lib/buckets'
import { normalizeDesign, POCKET_DESIGN_DEFAULTS, readDesign, writeDesign } from '@lib/pocketBuckit/design'
import { bucketsToLeaves } from '@lib/pocketBuckit/leaf'

interface UndoState {
  label: string
  run: () => Promise<void>
}

export interface DrawerPos { x: number, y: number }

interface PocketContextValue {
  design: PocketBuckitDesign
  setDesign: (patch: Partial<PocketBuckitDesign>) => void
  resetDesign: () => void
  leaves: PocketLeaf[]
  loading: boolean
  error: string | null
  refresh: () => void
  open: boolean
  setOpen: (o: boolean) => void
  inspectId: string | null
  setInspectId: (id: string | null) => void
  bucketById: (id: string) => BoardBucket | undefined
  removeItem: (bucketId: string, itemId: string, albumId: string | null, title: string) => Promise<void>
  /**
   * Reorder a TOP-LEVEL bucket in the tray, persisted via PUT /api/buckets/{id}/move
   * (the bucket `position` column — the existing, real source of truth). Optimistic
   * local reorder, then the server's authoritative tree; reverts on failure. Nested
   * (non-root) chips are a no-op (they keep their position; no accidental reparent).
   */
  reorderBucket: (draggedId: string, targetId: string, place: 'before' | 'after') => Promise<void>
  /** Persisted, viewport-clamped position of the movable mini drawer (null = default). */
  drawerPos: DrawerPos | null
  setDrawerPos: (p: DrawerPos | null) => void
  undo: UndoState | null
  runUndo: () => void
}

const DRAWER_KEY = 'pb:drawer'

function readDrawerPos(): DrawerPos | null {
  if (typeof window === 'undefined')
    return null
  try {
    const raw = localStorage.getItem(DRAWER_KEY)
    if (!raw)
      return null
    const v = JSON.parse(raw) as Partial<DrawerPos>
    if (v && typeof v.x === 'number' && typeof v.y === 'number' && Number.isFinite(v.x) && Number.isFinite(v.y))
      return { x: v.x, y: v.y }
  }
  catch { /* corrupt → default */ }
  return null
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
  const [buckets, setBuckets] = useState<BoardBucket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [inspectId, setInspectId] = useState<string | null>(null)
  const [drawerPos, setDrawerPosState] = useState<DrawerPos | null>(null)
  const [undo, setUndo] = useState<UndoState | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // hydrate the persisted design + drawer position on mount (SSR renders the
  // default; client swaps). The drawer position is re-clamped to the live
  // viewport when the drawer opens (so a stale off-screen coord is corrected).
  useEffect(() => {
    setDesignState(readDesign())
    setDrawerPosState(readDrawerPos())
  }, [])

  const setDrawerPos = useCallback((p: DrawerPos | null) => {
    setDrawerPosState(p)
    try {
      if (p)
        localStorage.setItem(DRAWER_KEY, JSON.stringify(p))
      else localStorage.removeItem(DRAWER_KEY)
    }
    catch { /* quota / SSR — in-memory only */ }
  }, [])

  const refresh = useCallback(() => {
    if (!isLoggedIn()) {
      setLoading(false)
      return
    }
    setLoading(true)
    listBuckets()
      .then((bs) => {
        setBuckets(bs)
        setError(null)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'load failed'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

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

  const showUndo = useCallback((u: UndoState) => {
    if (undoTimer.current)
      clearTimeout(undoTimer.current)
    setUndo(u)
    undoTimer.current = setTimeout(() => setUndo(null), 6000)
  }, [])

  const removeItem = useCallback(async (bucketId: string, itemId: string, albumId: string | null, title: string) => {
    await deleteBucketItem(bucketId, itemId)
    refresh()
    showUndo({
      label: `${title} 제거됨 · 실행취소`,
      // Undo re-adds by album_id, which only exists for album members. A
      // non-album row (forward-compat; none in prod until Step 6) can't be
      // re-added through the album path, so the removal simply stands.
      run: albumId ?
        async () => {
          await addBucketItem(bucketId, albumId)
          refresh()
        } :
        async () => {},
    })
  }, [refresh, showUndo])

  const reorderBucket = useCallback(async (draggedId: string, targetId: string, place: 'before' | 'after') => {
    if (draggedId === targetId)
      return
    // listBuckets() returns the tree with only roots at the top level. Tray
    // reorder operates on those roots (the common flat case); a non-root chip
    // is a no-op so we never accidentally reparent it.
    const fromIdx = buckets.findIndex(b => b.id === draggedId)
    if (fromIdx < 0 || buckets.findIndex(b => b.id === targetId) < 0)
      return
    const next = [...buckets]
    const [moved] = next.splice(fromIdx, 1)
    let insertAt = next.findIndex(b => b.id === targetId)
    if (place === 'after')
      insertAt += 1
    next.splice(insertAt, 0, moved)
    const newIndex = next.findIndex(b => b.id === draggedId)
    if (newIndex === fromIdx)
      return
    setBuckets(next) // optimistic
    try {
      // a root's parent_id is null; keep it at root, new position.
      const tree = await moveBucket(draggedId, null, newIndex)
      setBuckets(tree) // authoritative server order
    }
    catch {
      refresh() // revert to the server's truth
    }
  }, [buckets, refresh])

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
    inspectId,
    setInspectId,
    bucketById,
    removeItem,
    reorderBucket,
    drawerPos,
    setDrawerPos,
    undo,
    runUndo,
  }), [design, setDesign, resetDesign, leaves, loading, error, refresh, open, inspectId, bucketById, removeItem, reorderBucket, drawerPos, setDrawerPos, undo, runUndo])

  return <PocketContext.Provider value={value}>{children}</PocketContext.Provider>
}
