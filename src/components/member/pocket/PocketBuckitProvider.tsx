// FEAT-pocket-buckit Step 1 — the Pocket context: the persisted user-selectable
// design + the live bucket leaves + runtime tray state (open / inspect / undo).
// Single instance, mounted once site-wide by PocketBuckit (the island).
import type { ReactNode } from 'react'
import type { BoardBucket } from '@lib/buckets'
import type { PocketBuckitDesign } from '@lib/pocketBuckit/design'
import type { PocketLeaf } from '@lib/pocketBuckit/leaf'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { isLoggedIn } from '@lib/auth'
import { addBucketItem, deleteBucketItem, listBuckets } from '@lib/buckets'
import { normalizeDesign, POCKET_DESIGN_DEFAULTS, readDesign, writeDesign } from '@lib/pocketBuckit/design'
import { bucketsToLeaves } from '@lib/pocketBuckit/leaf'

interface UndoState {
  label: string
  run: () => Promise<void>
}

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
  undo: UndoState | null
  runUndo: () => void
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
  const [undo, setUndo] = useState<UndoState | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // hydrate the persisted design on mount (SSR renders the default; client swaps)
  useEffect(() => {
    setDesignState(readDesign())
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
    undo,
    runUndo,
  }), [design, setDesign, resetDesign, leaves, loading, error, refresh, open, inspectId, bucketById, removeItem, undo, runUndo])

  return <PocketContext.Provider value={value}>{children}</PocketContext.Provider>
}
