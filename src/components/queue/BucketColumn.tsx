// FEAT-review-bucket-board Step 4 — one kanban column. Droppable container that
// holds a vertical SortableContext of album cards. Header supports inline rename,
// a "작성 완료"(is_done) toggle, and delete.
import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import AlbumCard from './AlbumCard'
import type { Bucket, BucketItem } from './api'

interface Props {
  bucket: Bucket
  onAddAlbum: (bucketId: string) => void
  onRename: (bucketId: string, name: string) => void
  onToggleDone: (bucket: Bucket) => void
  onDelete: (bucket: Bucket) => void
  onOpenItem: (item: BucketItem) => void
  onRemoveItem: (bucketId: string, itemId: string) => void
}

export default function BucketColumn({
  bucket,
  onAddAlbum,
  onRename,
  onToggleDone,
  onDelete,
  onOpenItem,
  onRemoveItem,
}: Props) {
  const items = bucket.items ?? []
  const { setNodeRef, isOver } = useDroppable({ id: bucket.id })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(bucket.name)

  function commitRename() {
    const next = draft.trim()
    setEditing(false)
    if (next && next !== bucket.name)
      onRename(bucket.id, next)
    else
      setDraft(bucket.name)
  }

  function startEditing() {
    setDraft(bucket.name)
    setEditing(true)
  }

  const accent = bucket.color || undefined

  return (
    <section className={`qb-col${bucket.is_done ? ' is-done' : ''}`} style={accent ? { '--qb-col-accent': accent } as React.CSSProperties : undefined}>
      <header className="qb-col-head">
        <span className="qb-col-rail" aria-hidden="true" />
        <div className="qb-col-titlewrap">
          {editing ?
            (
              <input
	className="qb-col-name-input"
	value={draft}
	autoFocus
	onChange={e => setDraft(e.target.value)}
	onBlur={commitRename}
	onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitRename()
                  }
                  else if (e.key === 'Escape') {
                    setDraft(bucket.name)
                    setEditing(false)
                  }
                }}
              />
            ) :
            (
              <button type="button" className="qb-col-name" onClick={startEditing} title="이름 변경">
                {bucket.is_done && <span className="qb-col-done-mark" aria-hidden="true">✓ </span>}
                {bucket.name}
              </button>
            )}
          <span className="qb-col-count">{items.length}</span>
        </div>
        <div className="qb-col-actions">
          <button
	type="button"
	className={`qb-col-btn qb-col-done${bucket.is_done ? ' on' : ''}`}
	onClick={() => onToggleDone(bucket)}
	title={bucket.is_done ? '“작성 완료” 버킷 해제' : '“작성 완료” 버킷으로 지정'}
	aria-pressed={bucket.is_done}
          >
            ✓
          </button>
          <button
	type="button"
	className="qb-col-btn qb-col-del"
	onClick={() => onDelete(bucket)}
	title="버킷 삭제"
	aria-label="버킷 삭제"
          >
            ✕
          </button>
        </div>
      </header>

      <div ref={setNodeRef} className={`qb-col-body${isOver ? ' is-over' : ''}`}>
        <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
          {items.map(item => (
            <AlbumCard
	key={item.id}
	item={item}
	onOpen={() => onOpenItem(item)}
	onRemove={() => onRemoveItem(bucket.id, item.id)}
            />
          ))}
        </SortableContext>
        {items.length === 0 && (
          <div className="qb-col-empty">
여기로 앨범을 끌어다 놓거나
<br />
아래에서 담아보세요
          </div>
        )}
      </div>

      <button type="button" className="qb-col-add" onClick={() => onAddAlbum(bucket.id)}>
        <span aria-hidden="true">＋</span>
{' '}
앨범 담기
      </button>
    </section>
  )
}
