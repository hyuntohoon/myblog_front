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
import { listRecentlyListened } from './spotify.api'
import { AlbumArt, SectionTitle } from './ui'

// `copy` (with `albumId`) marks a drag originating from the pinned 최근 들은 앨범
// strip: dropping it on a bucket copies the album in (addBucketItem) instead of
// moving a bucket item. Synthetic id; not a real review_bucket_items row.
interface DndItem { kind: 'album' | 'bucket', itemId?: string, fromBucketId?: string, bucketId?: string, copy?: boolean, albumId?: string }
// Module-level drag payload (native DnD can't carry live object refs reliably).
let dnd: DndItem | null = null

// Synthetic id of the read-only 최근 들은 앨범 strip (never persisted server-side).
const RECENT_ID = '__recent__'

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
function findAlbum(buckets: BoardBucket[], itemId: string): { album: BoardAlbum, bucketId: string } | null {
  let f: { album: BoardAlbum, bucketId: string } | null = null
  visit(buckets, (b) => {
    const a = b.albums.find(x => x.itemId === itemId)
    if (a)
      f = { album: a, bucketId: b.id }
  })
  return f
}

interface Ops {
  tree: BoardBucket[]
  moveAlbum: (itemId: string, fromBucketId: string, toBucketId: string) => void
  copyAlbum: (albumId: string, toBucketId: string) => void
  moveBucketInto: (bucketId: string, targetId: string | null) => void
  addBucket: (parentId: string | null) => void
  rename: (id: string, name: string) => void
  deleteBucket: (id: string) => void
  requestAdd: (bucketId: string, bucketName: string) => void
  requestDelete: (itemId: string, fromBucketId: string, title: string) => void
}

// Cover-forward album tile — mirrors ReviewedSection's grammar (LibraryTab.tsx):
// a full-width square cover on top, then title + artist on a full-width block
// (nowrap+ellipsis), which is structurally immune to the old chip's vertical-text
// squeeze. A hover ✕ removes the album (via the board's confirm modal).
// `copySource` tiles (the 최근 들은 앨범 strip) drag as a copy and have no ✕ —
// they are not bucket items, so they can be copied into a bucket but not removed.
function AlbumChip({ album, bucketId, onOpen, onDelete, copySource, draggingId, setDraggingId }: { album: BoardAlbum, bucketId: string, onOpen: (t: DetailTarget) => void, onDelete?: () => void, copySource?: boolean, draggingId: string | null, setDraggingId: (id: string | null) => void }) {
  return (
    <div
	draggable
	onDragStart={(e) => {
        dnd = copySource ?
          { kind: 'album', copy: true, albumId: album.albumId, fromBucketId: bucketId } :
          { kind: 'album', itemId: album.itemId, fromBucketId: bucketId }
        e.dataTransfer.effectAllowed = copySource ? 'copy' : 'move'
        setDraggingId(album.itemId)
      }}
	onDragEnd={() => {
        dnd = null
        setDraggingId(null)
      }}
	onClick={() => onOpen({ album: album.title, artist: album.artist, real: true, albumId: album.albumId, cover: album.cover, year: album.year })}
	className={`lf-drag-handle bb-tile${draggingId === album.itemId ? ' lf-is-dragging' : ''}`}
	title={copySource ? `${album.title} — ${album.artist} · 드래그하면 버킷에 복사` : `${album.title} — ${album.artist}`}
    >
      <div style={{ position: 'relative' }}>
        <AlbumArt url={album.cover} label={album.title} />
        {album.alreadyReviewed && (
          <span className="lf-mono" style={{ position: 'absolute', top: 0, left: 0, fontSize: 9, letterSpacing: '0.06em', color: '#fff', background: 'var(--color-accent)', padding: '3px 6px' }}>평론함</span>
        )}
        {!copySource && onDelete && (
          <button
	type="button"
	className="bb-tile-del"
	title="이 앨범을 버킷에서 빼기"
	aria-label={`${album.title} 버킷에서 빼기`}
	onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            ✕
          </button>
        )}
      </div>
      <div style={{ marginTop: 8 }}>
        <div className="lf-serif lf-italic" style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{album.title}</div>
        <div className="lf-mono" style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 3 }}>{album.artist}</div>
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
    if (it.kind === 'album' && it.copy && it.albumId)
      ops.copyAlbum(it.albumId, bucket.id)
    else if (it.kind === 'album' && it.itemId && it.fromBucketId && it.fromBucketId !== bucket.id)
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

        <div style={{ display: 'flex', gap: 14, padding: 14, overflowX: 'auto', minHeight: 200, alignItems: 'flex-start' }}>
          {bucket.albums.length === 0 && bucket.children.length === 0 && (
            <div className="lf-mono" style={{ fontSize: 11, color: 'var(--color-faded)', border: '1px dashed var(--color-border)', borderRadius: 4, padding: '52px 18px', width: '100%', textAlign: 'center', lineHeight: 1.6, alignSelf: 'stretch' }}>비어 있음 · 앨범이나 버킷을 여기로 드래그</div>
          )}
          {bucket.albums.map(a => (
            <AlbumChip key={a.itemId} album={a} bucketId={bucket.id} onOpen={onOpen} onDelete={() => ops.requestDelete(a.itemId, bucket.id, a.title)} draggingId={draggingId} setDraggingId={setDraggingId} />
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
  const [recent, setRecent] = useState<BoardAlbum[] | null>(null)
  const [error, setError] = useState(false)
  const [addingTo, setAddingTo] = useState<{ id: string, name: string } | null>(null)

  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [rootHot, setRootHot] = useState(false)
  const [trashHot, setTrashHot] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [draggingBucket, setDraggingBucket] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ itemId: string, fromBucketId: string, title: string } | null>(null)

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

  // Load the pinned 최근 들은 앨범 strip — same worker-fed cache the overview uses
  // (GET /api/library/recently-listened, no synchronous Spotify call, rule #9).
  // Mapped to BoardAlbum with a synthetic `recent:` itemId; these are copy-source
  // only. A failure (e.g. Spotify not connected) just hides the strip.
  useEffect(() => {
    let alive = true
    listRecentlyListened()
      .then((r) => {
        if (!alive)
          return
        setRecent(r.items.map(it => ({
          itemId: `recent:${it.album_id}`,
          albumId: it.album_id,
          title: it.album?.title ?? '제목 미상',
          artist: (it.album?.artist_names ?? []).join(', ') || '—',
          cover: it.album?.cover_url ?? null,
          year: it.album?.release_date ? Number(String(it.album.release_date).slice(0, 4)) || null : null,
          alreadyReviewed: false,
        })))
      })
      .catch(() => alive && setRecent([]))
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
    // Copy a 최근 들은 앨범 tile into a real bucket: add the item server-side, then
    // splice the canonical item (with its real itemId) into the tree. A 409 means
    // it's already in that bucket — silent no-op. The recent strip is untouched.
    copyAlbum(albumId, toBucketId) {
      if (tree == null)
        return
      api.addBucketItem(toBucketId, albumId)
        .then(({ item, conflict }) => {
          if (conflict || !item)
            return
          setTree((prev) => {
            if (prev == null)
              return prev
            const t = clone(prev)
            findBucket(t, toBucketId)?.albums.push(item)
            return t
          })
        })
        .catch(() => void refresh())
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
    requestDelete(itemId, fromBucketId, title) {
      setPendingDelete({ itemId, fromBucketId, title })
    },
  }

  // Confirm + delete a single album: optimistic splice, then the existing DELETE
  // route. The localStorage bucket-count mirror re-syncs via the [tree] effect.
  function confirmDelete() {
    if (pendingDelete == null || tree == null) {
      setPendingDelete(null)
      return
    }
    const { itemId, fromBucketId } = pendingDelete
    const t = clone(tree)
    const src = findBucket(t, fromBucketId)
    if (src) {
      const idx = src.albums.findIndex(a => a.itemId === itemId)
      if (idx >= 0)
        src.albums.splice(idx, 1)
    }
    setTree(t)
    setPendingDelete(null)
    api.deleteBucketItem(fromBucketId, itemId).catch(() => void refresh())
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

      {recent != null && recent.length > 0 && (
        <div className="lf-panel" style={{ background: 'var(--color-paper)', padding: 0, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--color-border-soft)' }}>
            <span className="lf-mono" style={{ fontSize: 12, fontWeight: 500, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-text)' }}>최근 들은 앨범</span>
            <span className="lf-mono" style={{ fontSize: 11, color: 'var(--color-faded)' }}>{recent.length}</span>
            <span className="lf-mono" style={{ marginLeft: 'auto', fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-faded)' }}>드래그하면 버킷에 복사 · 원본 유지</span>
          </div>
          <div style={{ display: 'flex', gap: 14, padding: 14, overflowX: 'auto', minHeight: 200, alignItems: 'flex-start' }}>
            {recent.map(a => (
              <AlbumChip key={a.itemId} album={a} bucketId={RECENT_ID} onOpen={onOpen} copySource draggingId={draggingId} setDraggingId={setDraggingId} />
            ))}
          </div>
        </div>
      )}

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
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
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
	style={{ flex: 1, padding: '14px', textAlign: 'center', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-faded)', border: '1px dashed var(--color-border)', borderRadius: 4 }}
          >
            여기로 끌어 최상위 버킷으로 빼기
          </div>
          <div
	onDragOver={(e) => {
              const it = dnd
              if (it && it.kind === 'album' && !it.copy) {
                e.preventDefault()
                setTrashHot(true)
              }
            }}
	onDragLeave={() => setTrashHot(false)}
	onDrop={(e) => {
              e.preventDefault()
              const it = dnd
              setTrashHot(false)
              if (it && it.kind === 'album' && !it.copy && it.itemId && it.fromBucketId) {
                const found = findAlbum(tree, it.itemId)
                setPendingDelete({ itemId: it.itemId, fromBucketId: it.fromBucketId, title: found?.album.title ?? '' })
              }
              dnd = null
            }}
	className={`lf-mono${trashHot ? ' bb-trash-hot' : ''} bb-trash`}
          >
            🗑 앨범을 여기로 끌어 빼기
          </div>
        </div>
      )}

      {addingTo && (
        <AddAlbumModal
	bucketName={addingTo.name}
	onAdd={onAddAlbum}
	onClose={() => setAddingTo(null)}
        />
      )}

      {pendingDelete && (
        <div className="qb-modal-scrim" onClick={() => setPendingDelete(null)} role="presentation">
          <div className="qb-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="앨범 빼기 확인" style={{ maxWidth: 400 }}>
            <header className="qb-modal-head">
              <div>
                <div className="qb-modal-kicker">앨범 빼기</div>
                <h3 className="qb-modal-title">이 앨범을 버킷에서 뺄까요?</h3>
              </div>
              <button type="button" className="qb-modal-close" onClick={() => setPendingDelete(null)} aria-label="닫기">✕</button>
            </header>
            <div style={{ padding: 'var(--space-4) var(--space-5) var(--space-5)' }}>
              <p className="lf-sans" style={{ fontSize: 13.5, color: 'var(--color-subtle)', lineHeight: 1.65, margin: 0 }}>
                <span className="lf-serif lf-italic" style={{ color: 'var(--color-text)' }}>{pendingDelete.title || '이 앨범'}</span>
                {' '}
                을(를) 버킷에서 영구적으로 뺍니다. 평론 기록에는 영향을 주지 않습니다.
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
                <button type="button" className="lf-btn" onClick={() => setPendingDelete(null)}>취소</button>
                <button type="button" className="lf-btn lf-btn-solid" onClick={confirmDelete}>빼기</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
