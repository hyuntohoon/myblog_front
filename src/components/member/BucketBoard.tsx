// Member dashboard — 평론 버킷 board (nested redesign).
//
// Horizontal-row buckets, nestable sub-buckets, native HTML5 DnD with a
// cycle guard. Step 1 persists the tree to localStorage (SAMPLE seed); a later
// RFC step adds a nested-bucket backend (parent_id + recursive API) and unifies
// this with the existing flat /reviews/queue board. Ported from bucket.jsx.
import type { BucketNode, DetailTarget, SampleAlbum } from '@lib/member'
import { useEffect, useState } from 'react'
import { ADD_POOL, BUCKETS_KEY, getBucketsInit } from '@lib/member'
import { Cover, SampleBadge, SectionTitle, Stars } from './ui'

interface DndItem { kind: 'album' | 'bucket', albumId?: string, fromBucketId?: string, bucketId?: string }
// Module-level drag payload (native DnD can't carry live object refs reliably).
let dnd: DndItem | null = null

const clone = (t: BucketNode[]): BucketNode[] => JSON.parse(JSON.stringify(t))
function visit(buckets: BucketNode[], fn: (b: BucketNode) => void) {
  for (const b of buckets) {
    fn(b)
    visit(b.children, fn)
  }
}
function findBucket(buckets: BucketNode[], id: string): BucketNode | null {
  let f: BucketNode | null = null
  visit(buckets, (b) => {
    if (b.id === id)
      f = b
  })
  return f
}
function removeAlbum(buckets: BucketNode[], albumId: string): SampleAlbum | null {
  let removed: SampleAlbum | null = null
  visit(buckets, (b) => {
    const i = b.albums.findIndex(a => a.id === albumId)
    if (i >= 0) {
      removed = b.albums[i]
      b.albums.splice(i, 1)
    }
  })
  return removed
}
function removeBucket(buckets: BucketNode[], id: string): BucketNode | null {
  let removed: BucketNode | null = null
  const rec = (arr: BucketNode[]): boolean => {
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
function subtreeHas(bucket: BucketNode, id: string): boolean {
  let y = false
  visit([bucket], (b) => {
    if (b.id === id)
      y = true
  })
  return y
}
function countAlbums(b: BucketNode): number {
  let n = b.albums.length
  for (const c of b.children)
    n += countAlbums(c)
  return n
}

let _localId = 0
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${++_localId}`

interface Ops {
  tree: BucketNode[]
  moveAlbum: (albumId: string, toId: string) => void
  moveBucketInto: (bucketId: string, targetId: string | null) => void
  addBucket: (parentId: string | null) => void
  rename: (id: string, name: string) => void
  deleteBucket: (id: string) => void
  addAlbum: (id: string, a: SampleAlbum) => void
}

function AlbumChip({ album, bucketId, onOpen, draggingId, setDraggingId }: { album: SampleAlbum, bucketId: string, onOpen: (t: DetailTarget) => void, draggingId: string | null, setDraggingId: (id: string | null) => void }) {
  return (
    <div
	draggable
	onDragStart={(e) => {
        dnd = { kind: 'album', albumId: album.id, fromBucketId: bucketId }
        e.dataTransfer.effectAllowed = 'move'
        setDraggingId(album.id)
      }}
	onDragEnd={() => {
        dnd = null
        setDraggingId(null)
      }}
	onClick={() => onOpen(album)}
	className={`lf-drag-handle${draggingId === album.id ? ' lf-is-dragging' : ''}`}
	title={`${album.album} — ${album.artist}`}
	style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 8, width: 184, flex: '0 0 auto', background: 'var(--color-bg)', border: '1px solid var(--color-border-soft)', borderRadius: 4 }}
    >
      <Cover label={album.album} size={42} radius={3} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="lf-serif" style={{ fontSize: 13.5, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{album.album}</div>
        <div className="lf-sans" style={{ fontSize: 11, color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>{album.artist}</div>
        <div style={{ marginTop: 3 }}>{album.rating != null ? <Stars score={album.rating} size={11} /> : <span className="lf-meta" style={{ fontSize: 9 }}>미평가</span>}</div>
      </div>
    </div>
  )
}

interface RowProps {
  bucket: BucketNode
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
  const [adding, setAdding] = useState(false)
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
    if (it.kind === 'album' && it.albumId)
      ops.moveAlbum(it.albumId, bucket.id)
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
                    ops.rename(bucket.id, name.trim() || bucket.name)
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
            <button type="button" className="lf-iconbtn" title="앨범 추가" onClick={() => setAdding(a => !a)}>＋</button>
            <button type="button" className="lf-iconbtn" title="하위 버킷 추가" onClick={() => ops.addBucket(bucket.id)}>⊞</button>
            <button type="button" className="lf-iconbtn danger" title="버킷 삭제" onClick={() => ops.deleteBucket(bucket.id)}>✕</button>
          </div>
        </div>

        {adding && (
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--color-border-soft)', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <span className="lf-meta" style={{ width: '100%', marginBottom: 2, display: 'flex', gap: 8, alignItems: 'center' }}>
추가할 앨범 선택
<SampleBadge />
            </span>
            {ADD_POOL.map(p => (
              <button
	key={p.id}
	type="button"
	className="lf-chip"
	onClick={() => {
                  ops.addAlbum(bucket.id, p)
                  setAdding(false)
                }}
              >
                {p.album}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, padding: 12, overflowX: 'auto', minHeight: 78, alignItems: 'stretch' }}>
          {bucket.albums.length === 0 && bucket.children.length === 0 && (
            <div className="lf-mono" style={{ fontSize: 11, color: 'var(--color-faded)', border: '1px dashed var(--color-border)', borderRadius: 4, padding: '16px 18px', width: '100%', textAlign: 'center', lineHeight: 1.6 }}>비어 있음 · 앨범이나 버킷을 여기로 드래그</div>
          )}
          {bucket.albums.map(a => (
            <AlbumChip key={a.id} album={a} bucketId={bucket.id} onOpen={onOpen} draggingId={draggingId} setDraggingId={setDraggingId} />
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
  const [tree, setTree] = useState<BucketNode[]>(() => {
    try {
      const s = localStorage.getItem(BUCKETS_KEY)
      if (s)
        return JSON.parse(s)
    }
    catch { /* ignore */ }
    return getBucketsInit()
  })
  useEffect(() => {
    try {
      localStorage.setItem(BUCKETS_KEY, JSON.stringify(tree))
    }
    catch { /* ignore */ }
  }, [tree])

  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [rootHot, setRootHot] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [draggingBucket, setDraggingBucket] = useState<string | null>(null)

  const ops: Ops = {
    tree,
    moveAlbum(albumId, toId) {
      setTree((prev) => {
        const t = clone(prev)
        const al = removeAlbum(t, albumId)
        const dst = findBucket(t, toId)
        if (al && dst)
          dst.albums.push(al)
        return t
      })
    },
    moveBucketInto(bucketId, targetId) {
      setTree((prev) => {
        const src = findBucket(prev, bucketId)
        if (targetId && src && subtreeHas(src, targetId))
          return prev
        const t = clone(prev)
        const rm = removeBucket(t, bucketId)
        if (!rm)
          return prev
        if (targetId == null) {
          t.push(rm)
        }
        else {
          const dst = findBucket(t, targetId)
          ;(dst ? dst.children : t).push(rm)
        }
        return t
      })
    },
    addBucket(parentId) {
      setTree((prev) => {
        const t = clone(prev)
        const nb: BucketNode = { id: newId('bk'), name: '새 버킷', albums: [], children: [] }
        if (parentId == null)
          t.push(nb)
        else
          findBucket(t, parentId)?.children.push(nb)
        return t
      })
    },
    rename(id, name) {
      setTree((prev) => {
        const t = clone(prev)
        const b = findBucket(t, id)
        if (b)
          b.name = name
        return t
      })
    },
    deleteBucket(id) {
      setTree((prev) => {
        const t = clone(prev)
        removeBucket(t, id)
        return t
      })
    },
    addAlbum(id, a) {
      setTree((prev) => {
        const t = clone(prev)
        const b = findBucket(t, id)
        if (b)
          b.albums.push({ ...a, id: newId('al') })
        return t
      })
    },
  }

  return (
    <div>
      <SectionTitle
	kicker={(
<span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
{tree.length}
{' '}
버킷
{' '}
<SampleBadge />
</span>
)}
	title="평론 버킷"
	right={<button type="button" className="lf-btn" onClick={() => ops.addBucket(null)}>＋ 버킷 추가</button>}
      />
      <p className="lf-serif lf-italic" style={{ marginTop: -10, marginBottom: 22, color: 'var(--color-subtle)', fontSize: 15 }}>
        가로줄 하나가 버킷입니다.
{' '}
<span className="lf-mono" style={{ fontStyle: 'normal', fontSize: 12 }}>⠿</span>
{' '}
를 끌어 버킷끼리 중첩하거나, 앨범 카드를 다른 버킷으로 옮겨보세요. 앨범을 클릭하면 상세가 열립니다.
      </p>

      {tree.map(b => (
        <BucketRow key={b.id} bucket={b} depth={0} ops={ops} onOpen={onOpen} dropTarget={dropTarget} setDropTarget={setDropTarget} draggingId={draggingId} setDraggingId={setDraggingId} draggingBucket={draggingBucket} setDraggingBucket={setDraggingBucket} />
      ))}

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
    </div>
  )
}
