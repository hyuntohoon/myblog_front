// Member dashboard — 평론 버킷 board (nested, API-backed).
//
// Horizontal-row buckets, nestable sub-buckets, native HTML5 DnD with a cycle
// guard. FEAT-member-dashboard Step 5 wires this to the nested-bucket backend
// (parent_id + recursive GET + PUT /{id}/move) via src/lib/buckets.ts, replacing
// Step 1's localStorage seed and retiring the old flat /reviews/queue board.
import type { DetailTarget } from '@lib/member'
import type { AddOutcome } from './AddAlbumModal'
import type { BoardAlbum, BoardBucket } from '@lib/buckets'
import { useEffect, useState } from 'react'
import * as api from '@lib/buckets'
import { BUCKETS_KEY } from '@lib/member'
import AddAlbumModal from './AddAlbumModal'
import { AlbumArt, SectionTitle } from './ui'

interface DndItem { kind: 'album' | 'bucket', itemId?: string, fromBucketId?: string, bucketId?: string }
// Module-level drag payload (native DnD can't carry live object refs reliably).
let dnd: DndItem | null = null

const clone = (t: BoardBucket[]): BoardBucket[] => JSON.parse(JSON.stringify(t))
function visit(buckets: BoardBucket[], fn: (b: BoardBucket) => void) {
  for (const b of buckets) {
    fn(b)
    visit(b.children, fn)
  }
}
function findBucket(buckets: BoardBucket[], id: string): BoardBucket | null {
  let f: BoardBucket | null = null
  visit(buckets, (b) => {
    if (b.id === id)
      f = b
  })
  return f
}
function removeBucketNode(buckets: BoardBucket[], id: string): BoardBucket | null {
  let removed: BoardBucket | null = null
  const rec = (arr: BoardBucket[]): boolean => {
    const i = arr.findIndex(b => b.id === id)
    if (i >= 0) {
      removed = arr[i]
      arr.splice(i, 1)
      return true
    }
    for (const b of arr) {
      if (rec(b.children))
        return true
    }
    return false
  }
  rec(buckets)
  return removed
}
function subtreeHas(bucket: BoardBucket, id: string): boolean {
  let y = false
  visit([bucket], (b) => {
    if (b.id === id)
      y = true
  })
  return y
}
function countAlbums(b: BoardBucket): number {
  let n = b.albums.length
  for (const c of b.children)
    n += countAlbums(c)
  return n
}

interface Ops {
  tree: BoardBucket[]
  moveAlbum: (itemId: string, fromBucketId: string, toBucketId: string) => void
  moveBucketInto: (bucketId: string, targetId: string | null) => void
  addBucket: (parentId: string | null) => void
  rename: (id: string, name: string) => void
  deleteBucket: (id: string) => void
  requestAdd: (bucketId: string, bucketName: string) => void
}

function AlbumChip({ album, bucketId, onOpen, draggingId, setDraggingId }: { album: BoardAlbum, bucketId: string, onOpen: (t: DetailTarget) => void, draggingId: string | null, setDraggingId: (id: string | null) => void }) {
  return (
    <div
	draggable
	onDragStart={(e) => {
        dnd = { kind: 'album', itemId: album.itemId, fromBucketId: bucketId }
        e.dataTransfer.effectAllowed = 'move'
        setDraggingId(album.itemId)
      }}
	onDragEnd={() => {
        dnd = null
        setDraggingId(null)
      }}
	onClick={() => onOpen({ album: album.title, artist: album.artist, real: true, albumId: album.albumId, cover: album.cover, year: album.year })}
	className={`lf-drag-handle${draggingId === album.itemId ? ' lf-is-dragging' : ''}`}
	title={`${album.title} — ${album.artist}`}
	style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 8, width: 184, flex: '0 0 auto', background: 'var(--color-bg)', border: '1px solid var(--color-border-soft)', borderRadius: 4 }}
    >
      <AlbumArt url={album.cover} label={album.title} size={42} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="lf-serif" style={{ fontSize: 13.5, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{album.title}</div>
        <div className="lf-sans" style={{ fontSize: 11, color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>{album.artist}</div>
        <div style={{ marginTop: 3 }}>{album.alreadyReviewed ? <span className="lf-mono" style={{ fontSize: 9, letterSpacing: '0.06em', color: 'var(--color-accent)' }}>평론함</span> : <span className="lf-meta" style={{ fontSize: 9 }}>미평론</span>}</div>
      </div>
    </div>
  )
}

interface RowProps {
  bucket: BoardBucket
  depth: number
  ops: Ops
  onOpen: (t: DetailTarget) => void
  dropTarget: string | null
  setDropTarget: (fn: string | null | ((t: string | null) => string | null)) => void
  draggingId: string | null
  setDraggingId: (id: string | null) => void
  draggingBucket: string | null
  setDraggingBucket: (id: string | null) => void
}

function BucketRow({ bucket, depth, ops, onOpen, dropTarget, setDropTarget, draggingId, setDraggingId, draggingBucket, setDraggingBucket }: RowProps) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(bucket.name)
  const hot = dropTarget === bucket.id

  const canAcceptBucket = (): boolean => {
    const it = dnd
    if (!it || it.kind !== 'bucket')
      return false
    if (it.bucketId === bucket.id)
      return false
    const src = it.bucketId ? findBucket(ops.tree, it.bucketId) : null
    return !(src && subtreeHas(src, bucket.id))
  }
  const onDragOver = (e: React.DragEvent) => {
    const it = dnd
    if (!it)
      return
    if (it.kind === 'album' || (it.kind === 'bucket' && canAcceptBucket())) {
      e.preventDefault()
      e.stopPropagation()
      setDropTarget(bucket.id)
    }
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const it = dnd
    setDropTarget(null)
    if (!it)
      return
    if (it.kind === 'album' && it.itemId && it.fromBucketId && it.fromBucketId !== bucket.id)
      ops.moveAlbum(it.itemId, it.fromBucketId, bucket.id)
    else if (it.kind === 'bucket' && it.bucketId && canAcceptBucket())
      ops.moveBucketInto(it.bucketId, bucket.id)
    dnd = null
  }

  return (
    <div style={{ marginLeft: depth ? 22 : 0, position: 'relative' }}>
      {depth > 0 && <div style={{ position: 'absolute', left: -12, top: 0, bottom: 12, width: 1, background: 'var(--color-border)' }} />}
      <div
	onDragOver={onDragOver}
	onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node))
            setDropTarget(t => (t === bucket.id ? null : t))
        }}
	onDrop={onDrop}
	className={`lf-panel${hot ? ' lf-drop-on' : ''}`}
	style={{ background: depth ? 'color-mix(in srgb, var(--color-paper) 60%, var(--color-bg))' : 'var(--color-paper)', padding: 0, marginBottom: 12, opacity: draggingBucket === bucket.id ? 0.45 : 1 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--color-border-soft)' }}>
          <span
	draggable
	onDragStart={(e) => {
              dnd = { kind: 'bucket', bucketId: bucket.id }
              e.dataTransfer.effectAllowed = 'move'
              setDraggingBucket(bucket.id)
            }}
	onDragEnd={() => {
              dnd = null
              setDraggingBucket(null)
              setDropTarget(null)
            }}
	className="lf-drag-handle lf-mono"
	style={{ color: 'var(--color-faded)', fontSize: 15, lineHeight: 1, userSelect: 'none' }}
	title="드래그하여 이동·중첩"
          >
            ⠿
          </span>
          {editing ?
            (
                <input
	autoFocus
	value={name}
	onChange={e => setName(e.target.value)}
	onBlur={() => {
                    const next = name.trim() || bucket.name
                    if (next !== bucket.name)
                      ops.rename(bucket.id, next)
                    setEditing(false)
                  }}
	onKeyDown={(e) => {
                    if (e.key === 'Enter')
                      e.currentTarget.blur()
                    if (e.key === 'Escape') {
                      setName(bucket.name)
                      setEditing(false)
                    }
                  }}
	className="lf-mono"
	style={{ fontSize: 12, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-text)', background: 'var(--color-bg)', border: '1px solid var(--color-accent)', borderRadius: 3, padding: '3px 6px' }}
                />
              ) :
            (
                <button
	type="button"
	onClick={() => {
                    setName(bucket.name)
                    setEditing(true)
                  }}
	className="lf-mono"
	style={{ fontSize: 12, fontWeight: 500, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-text)', background: 'none', border: 'none', cursor: 'text', padding: '2px 0', whiteSpace: 'nowrap', flexShrink: 0 }}
	title="클릭하여 이름 변경"
                >
                  {bucket.name}
                </button>
              )}
          <span className="lf-mono" style={{ fontSize: 11, color: 'var(--color-faded)', flexShrink: 0 }}>{countAlbums(bucket)}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
            <button type="button" className="lf-iconbtn" title="앨범 추가" onClick={() => ops.requestAdd(bucket.id, bucket.name)}>＋</button>
            <button type="button" className="lf-iconbtn" title="하위 버킷 추가" onClick={() => ops.addBucket(bucket.id)}>⊞</button>
            <button type="button" className="lf-iconbtn danger" title="버킷 삭제" onClick={() => ops.deleteBucket(bucket.id)}>✕</button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, padding: 12, overflowX: 'auto', minHeight: 78, alignItems: 'stretch' }}>
          {bucket.albums.length === 0 && bucket.children.length === 0 && (
            <div className="lf-mono" style={{ fontSize: 11, color: 'var(--color-faded)', border: '1px dashed var(--color-border)', borderRadius: 4, padding: '16px 18px', width: '100%', textAlign: 'center', lineHeight: 1.6 }}>비어 있음 · 앨범이나 버킷을 여기로 드래그</div>
          )}
          {bucket.albums.map(a => (
            <AlbumChip key={a.itemId} album={a} bucketId={bucket.id} onOpen={onOpen} draggingId={draggingId} setDraggingId={setDraggingId} />
          ))}
        </div>
      </div>

      {bucket.children.map(c => (
        <BucketRow key={c.id} bucket={c} depth={depth + 1} ops={ops} onOpen={onOpen} dropTarget={dropTarget} setDropTarget={setDropTarget} draggingId={draggingId} setDraggingId={setDraggingId} draggingBucket={draggingBucket} setDraggingBucket={setDraggingBucket} />
      ))}
    </div>
  )
}

export function BucketBoard({ onOpen }: { onOpen: (t: DetailTarget) => void }) {
  const [tree, setTree] = useState<BoardBucket[] | null>(null)
  const [error, setError] = useState(false)
  const [addingTo, setAddingTo] = useState<{ id: string, name: string } | null>(null)

  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [rootHot, setRootHot] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [draggingBucket, setDraggingBucket] = useState<string | null>(null)

  // Load the real tree on mount.
  useEffect(() => {
    let alive = true
    api.listBuckets()
      .then(t => alive && setTree(t))
      .catch(() => alive && setError(true))
    return () => {
      alive = false
    }
  }, [])

  // Mirror the album count to localStorage so the overview's bucket shortcut
  // (lib/member.ts bucketCount(), read synchronously) matches the live board.
  useEffect(() => {
    if (tree == null)
      return
    try {
      localStorage.setItem(BUCKETS_KEY, JSON.stringify(tree))
    }
    catch { /* ignore */ }
  }, [tree])

  async function refresh() {
    try {
      setTree(await api.listBuckets())
    }
    catch {
      setError(true)
    }
  }

  const ops: Ops = {
    tree: tree ?? [],
    moveAlbum(itemId, fromBucketId, toBucketId) {
      if (fromBucketId === toBucketId || tree == null)
        return
      const t = clone(tree)
      const src = findBucket(t, fromBucketId)
      const dst = findBucket(t, toBucketId)
      if (!src || !dst)
        return
      const idx = src.albums.findIndex(a => a.itemId === itemId)
      if (idx < 0)
        return
      const [moved] = src.albums.splice(idx, 1)
      dst.albums.push(moved)
      setTree(t)
      api.reorderItems([
        { id: fromBucketId, item_ids: src.albums.map(a => a.itemId) },
        { id: toBucketId, item_ids: dst.albums.map(a => a.itemId) },
      ]).catch(() => void refresh())
    },
    moveBucketInto(bucketId, targetId) {
      if (tree == null)
        return
      const src = findBucket(tree, bucketId)
      if (targetId && src && subtreeHas(src, targetId))
        return
      const siblings = targetId ? (findBucket(tree, targetId)?.children ?? []) : tree
      const position = siblings.length
      const t = clone(tree)
      const rm = removeBucketNode(t, bucketId)
      if (!rm)
        return
      if (targetId == null) {
        t.push(rm)
      }
      else {
        const dst = findBucket(t, targetId)
        ;(dst ? dst.children : t).push(rm)
      }
      setTree(t)
      api.moveBucket(bucketId, targetId, position)
        .then(canonical => setTree(canonical))
        .catch(() => void refresh())
    },
    addBucket(parentId) {
      if (tree == null)
        return
      const position = parentId ? (findBucket(tree, parentId)?.children.length ?? 0) : tree.length
      api.createBucket('새 버킷')
        .then((created) => {
          if (parentId == null) {
            setTree(prev => [...(prev ?? []), created])
            return undefined
          }
          return api.moveBucket(created.id, parentId, position).then(canonical => setTree(canonical))
        })
        .catch(() => void refresh())
    },
    rename(id, name) {
      if (tree == null)
        return
      const t = clone(tree)
      const b = findBucket(t, id)
      if (b)
        b.name = name
      setTree(t)
      api.renameBucket(id, name).catch(() => void refresh())
    },
    deleteBucket(id) {
      if (tree == null)
        return
      const t = clone(tree)
      removeBucketNode(t, id)
      setTree(t)
      api.deleteBucket(id).catch(() => void refresh())
    },
    requestAdd(bucketId, bucketName) {
      setAddingTo({ id: bucketId, name: bucketName })
    },
  }

  async function onAddAlbum(album: { id: string, title: string }): Promise<AddOutcome> {
    if (!addingTo)
      return { status: 'error', message: '버킷을 찾을 수 없습니다' }
    try {
      const { item, conflict } = await api.addBucketItem(addingTo.id, album.id)
      if (conflict)
        return { status: 'conflict' }
      if (item && tree != null) {
        const t = clone(tree)
        findBucket(t, addingTo.id)?.albums.push(item)
        setTree(t)
      }
      return { status: 'added', alreadyReviewed: item?.alreadyReviewed ?? false }
    }
    catch {
      return { status: 'error', message: '담기 실패' }
    }
  }

  if (error && tree == null) {
    return (
      <div>
        <SectionTitle title="평론 버킷" />
        <div className="lf-panel" style={{ padding: 32, textAlign: 'center' }}>
          <span className="lf-meta">버킷을 불러오지 못했습니다</span>
        </div>
      </div>
    )
  }

  return (
    <div>
      <SectionTitle
	kicker={tree == null ? '불러오는 중…' : `${tree.length} 버킷`}
	title="평론 버킷"
	right={<button type="button" className="lf-btn" disabled={tree == null} onClick={() => ops.addBucket(null)}>＋ 버킷 추가</button>}
      />
      <p className="lf-serif lf-italic" style={{ marginTop: -10, marginBottom: 22, color: 'var(--color-subtle)', fontSize: 15 }}>
        가로줄 하나가 버킷입니다.
{' '}
<span className="lf-mono" style={{ fontStyle: 'normal', fontSize: 12 }}>⠿</span>
{' '}
를 끌어 버킷끼리 중첩하거나, 앨범 카드를 다른 버킷으로 옮겨보세요. 앨범을 클릭하면 상세가 열립니다.
      </p>

      {tree == null && <div className="lf-meta" style={{ padding: '8px 0' }}>불러오는 중…</div>}

      {tree != null && tree.length === 0 && (
        <div className="lf-panel" style={{ padding: 40, textAlign: 'center' }}>
          <span className="lf-meta">아직 버킷이 없습니다 · “＋ 버킷 추가”로 시작해보세요</span>
        </div>
      )}

      {tree != null && tree.map(b => (
        <BucketRow key={b.id} bucket={b} depth={0} ops={ops} onOpen={onOpen} dropTarget={dropTarget} setDropTarget={setDropTarget} draggingId={draggingId} setDraggingId={setDraggingId} draggingBucket={draggingBucket} setDraggingBucket={setDraggingBucket} />
      ))}

      {tree != null && tree.length > 0 && (
        <div
	onDragOver={(e) => {
            const it = dnd
            if (it && it.kind === 'bucket') {
              e.preventDefault()
              setRootHot(true)
            }
          }}
	onDragLeave={() => setRootHot(false)}
	onDrop={(e) => {
            e.preventDefault()
            const it = dnd
            setRootHot(false)
            if (it && it.kind === 'bucket' && it.bucketId)
              ops.moveBucketInto(it.bucketId, null)
            dnd = null
          }}
	className={`lf-mono${rootHot ? ' lf-drop-on' : ''}`}
	style={{ marginTop: 6, padding: '14px', textAlign: 'center', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-faded)', border: '1px dashed var(--color-border)', borderRadius: 4 }}
        >
          여기로 끌어 최상위 버킷으로 빼기
        </div>
      )}

      {addingTo && (
        <AddAlbumModal
	bucketName={addingTo.name}
	onAdd={onAddAlbum}
	onClose={() => setAddingTo(null)}
        />
      )}
    </div>
  )
}
