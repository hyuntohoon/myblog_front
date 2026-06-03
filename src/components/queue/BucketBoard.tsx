// FEAT-review-bucket-board Step 4 — board orchestrator. Loads buckets, owns the
// @dnd-kit multi-container DnD (cross/within-column), persists order via
// PUT /api/buckets/reorder, and wires bucket CRUD + the add/detail surfaces.
import { useEffect, useRef, useState } from 'react'
import type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import BucketColumn from './BucketColumn'
import { AlbumCardBody } from './AlbumCard'
import AddAlbumModal from './AddAlbumModal'
import type { AddOutcome } from './AddAlbumModal'
import AlbumDetailPanel from './AlbumDetailPanel'
import * as api from './api'
import type { Bucket, BucketItem } from './api'

export default function BucketBoard() {
  const [buckets, setBuckets] = useState<Bucket[]>([])
  const [load, setLoad] = useState<'loading' | 'ok' | 'error'>('loading')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [addTarget, setAddTarget] = useState<Bucket | null>(null)
  const [detailItem, setDetailItem] = useState<BucketItem | null>(null)
  const [composing, setComposing] = useState(false)
  const [newName, setNewName] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  // Snapshot of the columns at drag-start, so a failed reorder can roll back.
  const preDragRef = useRef<Bucket[] | null>(null)
  // Two-click delete guard: first ✕ arms, second within the window deletes.
  const pendingDelRef = useRef<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    void refresh()
  }, [])

  function flashToast(msg: string) {
    setToast(msg)
    window.setTimeout(() => setToast(t => (t === msg ? null : t)), 2600)
  }

  async function refresh() {
    setLoad('loading')
    try {
      setBuckets(await api.listBuckets())
      setLoad('ok')
    }
    catch {
      setLoad('error')
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  function containerOf(id: string): string | undefined {
    if (buckets.some(b => b.id === id))
      return id
    return buckets.find(b => (b.items ?? []).some(i => i.id === id))?.id
  }

  function activeItem(): BucketItem | null {
    if (!activeId)
      return null
    for (const b of buckets) {
      const found = (b.items ?? []).find(i => i.id === activeId)
      if (found)
        return found
    }
    return null
  }

  async function persist(snapshot: Bucket[]) {
    try {
      await api.reorder({
        buckets: snapshot.map(b => ({ id: b.id, item_ids: (b.items ?? []).map(i => i.id) })),
      })
    }
    catch {
      flashToast('순서 저장 실패 — 새로고침합니다')
      void refresh()
    }
  }

  // ── DnD ──────────────────────────────────────────────────────────────────
  function onDragStart(e: DragStartEvent) {
    preDragRef.current = buckets
    setActiveId(String(e.active.id))
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e
    if (!over)
      return
    const from = containerOf(String(active.id))
    const to = containerOf(String(over.id))
    if (!from || !to || from === to)
      return

    setBuckets((prev) => {
      const fromCol = prev.find(b => b.id === from)
      const toCol = prev.find(b => b.id === to)
      if (!fromCol || !toCol)
        return prev
      const fromItems = fromCol.items ?? []
      const toItems = toCol.items ?? []
      const moving = fromItems.find(i => i.id === active.id)
      if (!moving)
        return prev

      // Index in the target column: above the hovered card, or at the end when
      // hovering the empty column body (over.id === bucket id).
      const overIsContainer = over.id === to
      const overIndex = toItems.findIndex(i => i.id === over.id)
      const insertAt = overIsContainer || overIndex === -1 ? toItems.length : overIndex

      return prev.map((b) => {
        if (b.id === from)
          return { ...b, items: fromItems.filter(i => i.id !== active.id) }
        if (b.id === to) {
          const next = [...toItems]
          next.splice(insertAt, 0, moving)
          return { ...b, items: next }
        }
        return b
      })
    })
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    setActiveId(null)
    if (!over) {
      preDragRef.current = null
      return
    }
    const from = containerOf(String(active.id))
    const to = containerOf(String(over.id))

    let snapshot = buckets
    if (from && to && from === to && active.id !== over.id) {
      snapshot = buckets.map((b) => {
        if (b.id !== to)
          return b
        const items = b.items ?? []
        const oldIndex = items.findIndex(i => i.id === active.id)
        const newIndex = items.findIndex(i => i.id === over.id)
        if (oldIndex === -1 || newIndex === -1)
          return b
        return { ...b, items: arrayMove(items, oldIndex, newIndex) }
      })
      setBuckets(snapshot)
    }
    preDragRef.current = null
    void persist(snapshot)
  }

  // ── bucket CRUD ────────────────────────────────────────────────────────────
  async function createBucket() {
    const name = newName.trim()
    if (!name)
      return
    setComposing(false)
    setNewName('')
    try {
      const created = await api.createBucket({ name })
      setBuckets(prev => [...prev, { ...created, items: created.items ?? [] }])
    }
    catch {
      flashToast('버킷 생성 실패')
      void refresh()
    }
  }

  function cancelCompose() {
    setNewName('')
    setComposing(false)
  }

  async function renameBucket(id: string, name: string) {
    setBuckets(prev => prev.map(b => (b.id === id ? { ...b, name } : b)))
    try {
      await api.updateBucket(id, { name })
    }
    catch {
      flashToast('이름 변경 실패')
      void refresh()
    }
  }

  async function toggleDone(bucket: Bucket) {
    const next = !bucket.is_done
    // is_done is at most 1 (RFC); optimistically clear the others when enabling.
    setBuckets(prev => prev.map(b => ({
      ...b,
      is_done: b.id === bucket.id ? next : (next ? false : b.is_done),
    })))
    try {
      await api.updateBucket(bucket.id, { is_done: next })
      // Re-sync so the server's single-done invariant is authoritative.
      void refresh()
    }
    catch {
      flashToast('“작성 완료” 변경 실패')
      void refresh()
    }
  }

  async function deleteBucket(bucket: Bucket) {
    // First ✕ arms the delete (with an explicit toast); a second ✕ within 3s
    // commits. Avoids a native confirm() dialog while still guarding a
    // destructive cascade.
    if (pendingDelRef.current !== bucket.id) {
      pendingDelRef.current = bucket.id
      const count = (bucket.items ?? []).length
      flashToast(count > 0 ?
        `“${bucket.name}” + 앨범 ${count}개 삭제하려면 ✕ 한 번 더` :
        `“${bucket.name}” 삭제하려면 ✕ 한 번 더`)
      window.setTimeout(() => {
        if (pendingDelRef.current === bucket.id)
          pendingDelRef.current = null
      }, 3000)
      return
    }
    pendingDelRef.current = null
    setBuckets(prev => prev.filter(b => b.id !== bucket.id))
    try {
      await api.deleteBucket(bucket.id)
    }
    catch {
      flashToast('버킷 삭제 실패')
      void refresh()
    }
  }

  // ── item ops ───────────────────────────────────────────────────────────────
  async function handleAdd(album: { id: string, title: string }): Promise<AddOutcome> {
    if (!addTarget)
      return { status: 'error', message: '버킷을 찾을 수 없습니다' }
    try {
      const { item, conflict } = await api.addItem(addTarget.id, { album_id: album.id })
      if (conflict || !item)
        return { status: 'conflict' }
      setBuckets(prev => prev.map(b => (b.id === addTarget.id ? { ...b, items: [...(b.items ?? []), item] } : b)))
      return { status: 'added', alreadyReviewed: item.already_reviewed }
    }
    catch {
      return { status: 'error', message: '담기 실패 — 잠시 후 다시 시도해주세요' }
    }
  }

  async function removeItem(bucketId: string, itemId: string) {
    setBuckets(prev => prev.map(b => (b.id === bucketId ? { ...b, items: (b.items ?? []).filter(i => i.id !== itemId) } : b)))
    if (detailItem?.id === itemId)
      setDetailItem(null)
    try {
      await api.deleteItem(bucketId, itemId)
    }
    catch {
      flashToast('제거 실패')
      void refresh()
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────
  if (load === 'loading')
    return <div className="qb-state">버킷을 불러오는 중…</div>
  if (load === 'error') {
    return (
<div className="qb-state">
버킷을 불러오지 못했습니다.
<button type="button" className="qb-state-retry" onClick={() => void refresh()}>다시 시도</button>
</div>
)
}

  const dragItem = activeItem()

  return (
    <div className="qb-root">
      <header className="qb-masthead">
        <p className="qb-kicker">To-Review Queue</p>
        <h1 className="qb-title">평론 버킷</h1>
        <p className="qb-sub">리뷰할 앨범을 버킷에 담아두고, 끌어다 우선순위를 정하세요.</p>
      </header>

      <DndContext
	sensors={sensors}
	collisionDetection={closestCorners}
	onDragStart={onDragStart}
	onDragOver={onDragOver}
	onDragEnd={onDragEnd}
      >
        <div className="qb-board">
          {buckets.map(bucket => (
            <BucketColumn
	key={bucket.id}
	bucket={bucket}
	onAddAlbum={() => setAddTarget(bucket)}
	onRename={renameBucket}
	onToggleDone={toggleDone}
	onDelete={deleteBucket}
	onOpenItem={setDetailItem}
	onRemoveItem={removeItem}
            />
          ))}

          <div className="qb-col qb-col-new">
            {composing ?
              (
                <div className="qb-newbucket">
                  <input
	className="qb-newbucket-input"
	placeholder="버킷 이름 (예: 꼭, 신보, 보류)"
	value={newName}
	autoFocus
	onChange={e => setNewName(e.target.value)}
	onBlur={() => {
 if (!newName.trim())
setComposing(false)
}}
	onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void createBucket()
                      }
                      else if (e.key === 'Escape') {
                        setNewName('')
                        setComposing(false)
                      }
                    }}
                  />
                  <div className="qb-newbucket-actions">
                    <button type="button" className="qb-newbucket-save" onClick={() => void createBucket()}>추가</button>
                    <button type="button" className="qb-newbucket-cancel" onClick={cancelCompose}>취소</button>
                  </div>
                </div>
              ) :
              (
                <button type="button" className="qb-col-new-btn" onClick={() => setComposing(true)}>
                  <span aria-hidden="true">＋</span>
                  <span>새 버킷</span>
                </button>
              )}
          </div>
        </div>

        <DragOverlay>
          {dragItem ? <AlbumCardBody item={dragItem} dragging /> : null}
        </DragOverlay>
      </DndContext>

      {addTarget && (
        <AddAlbumModal
	bucketName={addTarget.name}
	onAdd={handleAdd}
	onClose={() => setAddTarget(null)}
        />
      )}
      {detailItem && <AlbumDetailPanel item={detailItem} onClose={() => setDetailItem(null)} />}
      {toast && <div className="qb-toast" role="status">{toast}</div>}
    </div>
  )
}
