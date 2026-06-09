// Member dashboard — 평론 버킷 board ("크레이트" gallery, nested, API-backed).
//
// Crate-gallery redesign (FEAT-crate-redesign): each bucket is a distinct card
// with a colored left spine, status dot + label, and a wrap-grid of large album
// covers (replacing the old horizontal-scroll chip row). New affordances:
//   · per-bucket accent color picker (PATCH color — already in the contract)
//   · rating chips on covers inside the single "평론 완료" (is_done) bucket,
//     read from the member's own reviews (no extra backend call)
//   · drag a bucket BETWEEN cards (the gaps show a red insertion line) to
//     reorder it / un-nest it to the top level; drop a bucket ON another card
//     to nest it as a child. Drag an album onto a cover to reorder, or onto a
//     card to move it between buckets.
//   · a single 휴지통 dock card (center-bottom of the viewport) that appears
//     ONLY while dragging — no backdrop blur, so the other buckets stay crisp
//     as drop targets. Drop an album → recoverable trash; a bucket → confirm +
//     delete (cascades server-side; bucket delete is not recoverable).
//   · recoverable album trash (localStorage stash + restore via re-add)
// Wires to the nested-bucket backend via src/lib/buckets.ts (parent_id +
// recursive GET + PUT /{id}/move + PATCH color).
import type { DetailTarget, MemberReview } from '@lib/member'
import type { AddOutcome } from './AddAlbumModal'
import type { BoardAlbum, BoardBucket } from '@lib/buckets'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as api from '@lib/buckets'
import { useDismissable } from '@lib/useDismissable'
import { BUCKETS_KEY } from '@lib/member'
import AddAlbumModal from './AddAlbumModal'
import { getSpotifyLibraryState, listRecentlyListened, syncSpotifyLibrary } from './spotify.api'
import type { SpotifyLibraryAlbumState, SpotifyLibraryState } from './spotify.api'
import { AlbumArt, SectionTitle } from './ui'

// `copy` (with `albumId`) marks a drag originating from the pinned 최근 들은 앨범
// strip: dropping it copies the album in (addBucketItem) instead of moving a
// bucket item. Synthetic id; not a real review_bucket_items row.
// `copy` (recent strip) and `fromLib` (the spotify_library bucket) both drop as a
// COPY into a target bucket; `fromLib` additionally keeps `itemId`/`source` so it can
// still be moved to the trash (only when source==='myblog_added' — a 기존/preexisting
// album is never deletable). `albumId` is carried on every album drag so a drop INTO
// the library bucket can copy by album id without a tree lookup.
interface DndItem { kind: 'album' | 'bucket', itemId?: string, fromBucketId?: string, bucketId?: string, copy?: boolean, albumId?: string, fromLib?: boolean, source?: string }
// Module-level drag payload (native DnD can't carry live object refs reliably).
let dnd: DndItem | null = null
type DragKind = 'album' | 'bucket' | null

// Synthetic id of the read-only 최근 들은 앨범 strip (never persisted server-side).
const RECENT_ID = '__recent__'
// `review_buckets.kind` value of the single special Spotify-library bucket — it
// is filtered out of the normal crate tree and rendered as its own section.
const SLIB_KIND = 'spotify_library'
// Recoverable album trash, mirrored to localStorage so it survives reloads.
const TRASH_KEY = 'lf_crate_trash'
// Last-seen 최근 들은 앨범 strip, cached so it paints instantly on the next mount
// (tab switch / navigation) while the worker-fed list revalidates in the
// background — kills the empty-then-pop flash. See the recent-strip effect.
const RECENT_KEY = 'lf_crate_recent'

// Curated editorial palette — muted oklch siblings of the brand red. `null` key
// is the default ink (no stored color). Mirrors the design prototype.
const BUCKET_COLORS: { key: string, label: string, color: string | null }[] = [
  { key: 'ink', label: '기본', color: null },
  { key: 'red', label: '레드', color: '#c8332b' },
  { key: 'amber', label: '앰버', color: 'oklch(0.66 0.12 70)' },
  { key: 'green', label: '그린', color: 'oklch(0.58 0.10 155)' },
  { key: 'blue', label: '블루', color: 'oklch(0.56 0.10 245)' },
  { key: 'violet', label: '바이올렛', color: 'oklch(0.55 0.11 300)' },
]

// Read a cached array seed from localStorage (SWR first paint). Returns null on
// miss / parse error / non-array so callers fall back to the loading state.
function readSeed<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed))
        return parsed as T
    }
  }
  catch { /* ignore */ }
  return null
}

// ── tree helpers ────────────────────────────────────────────────────────────
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
function findAlbum(buckets: BoardBucket[], itemId: string): { album: BoardAlbum, bucketName: string } | null {
  let f: { album: BoardAlbum, bucketName: string } | null = null
  visit(buckets, (b) => {
    const a = b.albums.find(x => x.itemId === itemId)
    if (a)
      f = { album: a, bucketName: b.name }
  })
  return f
}

// First album anywhere in the tree with this albumId — used to paint a copy's
// optimistic tile with real cover/title (a cross-bucket / library copy isn't in the
// recent strip), instead of a "…" placeholder until the server round-trip lands.
function findAlbumByAlbumId(buckets: BoardBucket[], albumId: string): BoardAlbum | null {
  let f: BoardAlbum | null = null
  visit(buckets, (b) => {
    const a = b.albums.find(x => x.albumId === albumId)
    if (a && !f)
      f = a
  })
  return f
}

// ── status meta ───────────────────────────────────────────────────────────--
// The single is_done column is the canonical "평론 완료". Other tags are inferred
// from the bucket name so the default seed buckets read sensibly; renamed
// buckets simply fall back to the neutral "버킷" tag.
function crMeta(b: BoardBucket): { tag: string, urgent: boolean } {
  if (b.isDone || /완료/.test(b.name))
    return { tag: '평론 완료', urgent: false }
  if (/급한|마감/.test(b.name))
    return { tag: '마감 임박', urgent: true }
  if (/평론/.test(b.name))
    return { tag: '평론 대기', urgent: false }
  if (/들을|예정/.test(b.name))
    return { tag: '청취 예정', urgent: false }
  if (/들은/.test(b.name))
    return { tag: '청취 완료', urgent: false }
  return { tag: '버킷', urgent: false }
}
// Effective accent color: an explicit user color wins, then urgency, then the
// neutral ink (top level) / hairline (nested) default.
function crColor(b: BoardBucket, depth: number): string {
  if (b.color)
    return b.color
  if (crMeta(b).urgent)
    return 'var(--color-accent)'
  return depth ? 'var(--color-border)' : 'var(--color-text)'
}

function CrStatus({ b }: { b: BoardBucket }) {
  const m = crMeta(b)
  const ink = b.color || (m.urgent ? 'var(--color-accent)' : 'var(--color-faded)')
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: 6, background: ink, flex: '0 0 auto' }} />
      <span className="lf-meta" style={{ color: ink, letterSpacing: '0.1em' }}>{m.tag}</span>
    </span>
  )
}

// ── spotify-library badge meta ───────────────────────────────────────────────
// Per-album source + sync-state, joined to a cover by album_id from the
// /spotify-library/state map. source → who put it there; state → the last
// reconcile outcome (dot color). Rendered only inside the special library bucket.
function slibSourceLabel(source: string): string {
  return source === 'myblog_added' ? '내가 추가' : '기존'
}
function slibStateColor(state: string): string {
  if (state === 'synced')
    return 'oklch(0.58 0.10 155)' // 녹 — Spotify matches intent
  if (state === 'failed')
    return 'var(--color-accent)' // 적 — a write errored
  if (state === 'needs_attention')
    return 'oklch(0.66 0.12 70)' // 주 — scope / reauth
  return 'var(--color-faded)' // 회 — pending (not yet reconciled)
}

// Source pill (top-left) + state dot (top-right) overlaid on a library cover.
function SlibBadges({ row }: { row: SpotifyLibraryAlbumState }) {
  return (
    <>
      <span className="lf-mono" style={{ position: 'absolute', left: 6, top: 6, fontSize: 9, letterSpacing: '0.06em', color: '#fff', background: 'rgba(11,61,31,0.82)', padding: '2px 5px', borderRadius: 3 }}>
        {slibSourceLabel(row.source)}
      </span>
      <span
	title={`상태: ${row.state}${row.last_error ? ` · ${row.last_error}` : ''}`}
	style={{ position: 'absolute', top: 6, right: 6, width: 10, height: 10, borderRadius: 10, background: slibStateColor(row.state), border: '1.5px solid var(--color-bg)' }}
      />
    </>
  )
}

// ── album cover tile ──────────────────────────────────────────────────────--
// Drag = move/reorder; dropping ON a cover inserts the dragged item BEFORE it
// (both directions). Click opens detail. Rating chips show only inside the
// is_done ("rated") bucket. `copySource` tiles (최근 들은 앨범) drag as a copy.
function AlbumChip({ album, bucketId, rated, score, onOpen, copySource, fromLib, libRow, draggingId, setDraggingId, setDragKind, onInsert }: {
  album: BoardAlbum
  bucketId: string
  rated: boolean
  score: number | null
  onOpen: (t: DetailTarget) => void
  copySource?: boolean
  /**
   * This chip lives in the spotify_library bucket: it drags as a COPY (drop into
   * another bucket copies it, leaving the library row intact) yet keeps its itemId
   * so a myblog_added album can still be trashed. Pre-existing albums can't.
   */
  fromLib?: boolean
  /**
   * Spotify-library sync row for this album (source/state badges) when inside
   * the special library bucket; absent for every other surface.
   */
  libRow?: SpotifyLibraryAlbumState | null
  draggingId: string | null
  setDraggingId: (id: string | null) => void
  setDragKind: (k: DragKind) => void
  onInsert?: (itemId: string, fromBucketId: string, beforeItemId: string) => void
}) {
  const [over, setOver] = useState(false)
  const dragging = draggingId === album.itemId
  const acceptCol = (): boolean => {
    const it = dnd
    // Reorder-insert targets reject copy drags (recent strip) AND library drags —
    // a fromLib item must bubble to the bucket's onDrop so it COPIES instead of moving.
    return !!it && it.kind === 'album' && !it.copy && !it.fromLib && !!it.itemId && it.itemId !== album.itemId
  }
  return (
    <div
	style={{ position: 'relative' }}
	onDragOver={(e) => {
        if (onInsert && acceptCol()) {
          e.preventDefault()
          e.stopPropagation()
          setOver(true)
        }
      }}
	onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setOver(false)
      }}
	onDrop={(e) => {
        if (!onInsert || !acceptCol())
          return
        e.preventDefault()
        e.stopPropagation()
        const it = dnd
        setOver(false)
        if (it && it.itemId && it.fromBucketId)
          onInsert(it.itemId, it.fromBucketId, album.itemId)
        dnd = null
      }}
    >
      {over && <div style={{ position: 'absolute', left: -7, top: 0, bottom: 26, width: 3, borderRadius: 2, background: 'var(--color-accent)' }} />}
      <div
	draggable
	onDragStart={(e) => {
          if (copySource)
            dnd = { kind: 'album', copy: true, albumId: album.albumId, fromBucketId: bucketId }
          else if (fromLib)
            dnd = { kind: 'album', itemId: album.itemId, fromBucketId: bucketId, albumId: album.albumId, fromLib: true, source: libRow?.source }
          else
            dnd = { kind: 'album', itemId: album.itemId, fromBucketId: bucketId, albumId: album.albumId }
          e.dataTransfer.effectAllowed = copySource ? 'copy' : (fromLib ? 'copyMove' : 'move')
          setDraggingId(album.itemId)
          setDragKind('album')
        }}
	onDragEnd={() => {
          dnd = null
          setDraggingId(null)
          setDragKind(null)
        }}
	onClick={() => onOpen({ album: album.title, artist: album.artist, real: true, albumId: album.albumId, cover: album.cover, year: album.year })}
	className={`lf-drag-handle bb-tile${dragging ? ' lf-is-dragging' : ''}`}
	title={`${album.title} — ${album.artist}`}
      >
        <div style={{ position: 'relative' }}>
          <AlbumArt url={album.cover} label={album.title} />
          {copySource && (
            <span className="lf-mono" style={{ position: 'absolute', left: 6, top: 6, fontSize: 9, letterSpacing: '0.06em', color: '#fff', background: 'rgba(11,61,31,0.82)', padding: '2px 5px', borderRadius: 3 }}>복사</span>
          )}
          {libRow && <SlibBadges row={libRow} />}
          {!copySource && !libRow && !rated && album.alreadyReviewed && (
            <span className="lf-mono" style={{ position: 'absolute', top: 0, left: 0, fontSize: 9, letterSpacing: '0.06em', color: '#fff', background: 'var(--color-accent)', padding: '3px 6px' }}>평론함</span>
          )}
          {rated && score != null && (
            <span className="lf-mono" style={{ position: 'absolute', top: 6, right: 6, fontSize: 11, fontWeight: 600, color: 'var(--color-bg)', background: 'var(--color-text)', padding: '2px 6px', borderRadius: 3 }}>{score.toFixed(1)}</span>
          )}
          {rated && score == null && (
            <span className="lf-mono" style={{ position: 'absolute', top: 6, right: 6, fontSize: 9, letterSpacing: '0.05em', color: 'var(--color-subtle)', background: 'var(--color-bg)', border: '1px solid var(--color-border-soft)', padding: '2px 5px', borderRadius: 3 }}>미평가</span>
          )}
        </div>
        <div style={{ marginTop: 7 }}>
          <div className="lf-serif lf-italic" style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{album.title}</div>
          <div className="lf-mono" style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{album.artist}</div>
        </div>
      </div>
    </div>
  )
}

interface Ops {
  tree: BoardBucket[]
  copyAlbum: (albumId: string, toBucketId: string) => void
  insertAlbum: (itemId: string, fromBucketId: string, toBucketId: string, beforeItemId: string | null) => void
  // Nest a bucket as the last child of `targetId` (drop ON a card body).
  moveBucketInto: (bucketId: string, targetId: string | null) => void
  // Reposition a bucket among `parentId`'s children, before `beforeId` (null =
  // append). parentId null = top level. Drives reorder + un-nest (gap drops).
  moveBucketTo: (bucketId: string, parentId: string | null, beforeId: string | null) => void
  addBucket: (parentId: string | null) => void
  rename: (id: string, name: string) => void
  setColor: (id: string, color: string | null) => void
  requestAdd: (bucketId: string, bucketName: string) => void
}

// Props shared by every BucketCard / BucketList in the tree (everything except
// the per-node `bucket` + `depth`). Bundled so BucketList can forward them with a
// single spread to the recursive cards.
interface SharedProps {
  ops: Ops
  onOpen: (t: DetailTarget) => void
  ratings: Map<string, number>
  /**
   * album_id → Spotify-library sync row; only populated for the special
   * spotify_library bucket so its covers get source/state badges.
   */
  libState: Map<string, SpotifyLibraryAlbumState>
  dropTarget: string | null
  setDropTarget: (fn: string | null | ((t: string | null) => string | null)) => void
  draggingId: string | null
  setDraggingId: (id: string | null) => void
  draggingBucket: string | null
  setDraggingBucket: (id: string | null) => void
  setDragKind: (k: DragKind) => void
  dragKind: DragKind
}

type CardProps = SharedProps & { bucket: BoardBucket, depth: number }

function BucketCard({ bucket, depth, ops, onOpen, ratings, libState, dropTarget, setDropTarget, draggingId, setDraggingId, draggingBucket, setDraggingBucket, setDragKind, dragKind }: CardProps) {
  const shared: SharedProps = { ops, onOpen, ratings, libState, dropTarget, setDropTarget, draggingId, setDraggingId, draggingBucket, setDraggingBucket, setDragKind, dragKind }
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(bucket.name)
  const [coloring, setColoring] = useState(false)
  const m = crMeta(bucket)
  const accent = crColor(bucket, depth)
  const hot = dropTarget === bucket.id
  const isLib = bucket.kind === SLIB_KIND

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
    // COPY when: dropping INTO the library bucket (req 1), or the dragged item is a
    // copy source (recent strip) or a library item dropped elsewhere (req 5).
    // Otherwise a normal move/reorder.
    const copyIn = isLib || it.copy || it.fromLib
    if (it.kind === 'album' && copyIn && it.albumId)
      ops.copyAlbum(it.albumId, bucket.id)
    else if (it.kind === 'album' && it.itemId && it.fromBucketId)
      ops.insertAlbum(it.itemId, it.fromBucketId, bucket.id, null)
    else if (it.kind === 'bucket' && it.bucketId && canAcceptBucket())
      ops.moveBucketInto(it.bucketId, bucket.id)
    dnd = null
  }

  const renderChip = (a: BoardAlbum) => (
    <AlbumChip
	key={a.itemId}
	album={a}
	bucketId={bucket.id}
	rated={bucket.isDone}
	score={bucket.isDone ? (ratings.get(a.albumId) ?? null) : null}
	libRow={isLib ? (libState.get(a.albumId) ?? null) : null}
	fromLib={isLib}
	onOpen={onOpen}
	draggingId={draggingId}
	setDraggingId={setDraggingId}
	setDragKind={setDragKind}
	onInsert={isLib ? undefined : (itemId, fromBucketId, beforeItemId) => ops.insertAlbum(itemId, fromBucketId, bucket.id, beforeItemId)}
    />
  )
  const addBtn = (
    <button
	type="button"
	onClick={() => ops.requestAdd(bucket.id, bucket.name)}
	style={{ aspectRatio: '1 / 1', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-faded)', background: 'none', border: '1px dashed var(--color-border)', borderRadius: 4, cursor: 'pointer' }}
    >
      ＋ 추가
    </button>
  )
  // Library bucket: split covers into "내가 넣은" (myblog_added → pushed to Spotify) and
  // "기존" (preexisting in the Library, non-deletable) with a boundary between the two.
  const libMine = isLib ? bucket.albums.filter(a => (libState.get(a.albumId)?.source ?? 'myblog_added') !== 'preexisting') : []
  const libExisting = isLib ? bucket.albums.filter(a => libState.get(a.albumId)?.source === 'preexisting') : []
  const slibLabel = (divider: boolean): React.CSSProperties => ({
    gridColumn: '1 / -1',
    fontSize: 10,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--color-subtle)',
    marginTop: divider ? 6 : 0,
    paddingTop: divider ? 14 : 0,
    borderTop: divider ? '1px solid var(--color-border)' : 'none',
  })

  return (
    <div
	onDragOver={onDragOver}
	onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDropTarget(t => (t === bucket.id ? null : t))
      }}
	onDrop={onDrop}
	style={{
        background: depth ? 'color-mix(in srgb, var(--color-paper) 55%, var(--color-bg))' : 'var(--color-paper)',
        border: hot ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
        borderLeft: `3px solid ${accent}`,
        borderRadius: 8,
        padding: 14,
        boxShadow: hot ? '0 0 0 3px color-mix(in srgb, var(--color-accent) 14%, transparent)' : (depth ? 'none' : '0 1px 2px rgba(26,26,26,0.05)'),
        opacity: draggingBucket === bucket.id ? 0.45 : 1,
        transition: 'box-shadow 0.12s, border-color 0.12s',
      }}
    >
      {/* header — the WHOLE row is the bucket drag handle now (was just the tiny
          ⠿, which users couldn't find / grab). Disabled while renaming so the
          text field stays selectable. Child buttons still click normally. */}
      <div
	draggable={!editing}
	onDragStart={(e) => {
          dnd = { kind: 'bucket', bucketId: bucket.id }
          e.dataTransfer.effectAllowed = 'move'
          setDraggingBucket(bucket.id)
          setDragKind('bucket')
        }}
	onDragEnd={() => {
          dnd = null
          setDraggingBucket(null)
          setDropTarget(null)
          setDragKind(null)
        }}
	style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, cursor: editing ? 'default' : 'grab' }}
      >
        <span
	className="lf-mono"
	style={{ color: 'var(--color-faded)', fontSize: 16, lineHeight: 1, userSelect: 'none', flex: '0 0 auto' }}
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
	className="lf-serif"
	style={{ fontSize: 17, fontWeight: 500, color: 'var(--color-text)', background: 'var(--color-bg)', border: '1px solid var(--color-accent)', borderRadius: 4, padding: '1px 7px', minWidth: 120 }}
              />
            ) :
          (
              <button
	type="button"
	onClick={() => {
                  setName(bucket.name)
                  setEditing(true)
                }}
	className="lf-serif"
	style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-0.01em', color: bucket.color || (m.urgent ? 'var(--color-accent)' : 'var(--color-text)'), background: 'none', border: 'none', padding: 0, cursor: 'text', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}
	title="클릭하여 이름 변경"
              >
                {bucket.name}
              </button>
            )}
        <span style={{ marginLeft: 2 }}><CrStatus b={bucket} /></span>
        <span className="lf-mono" style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--color-faded)', whiteSpace: 'nowrap' }}>
          {countAlbums(bucket)}
          장
        </span>
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <button type="button" className="lf-iconbtn" title="버킷 색상" onClick={() => setColoring(v => !v)} style={{ padding: 0 }}>
            <span style={{ width: 13, height: 13, borderRadius: 13, background: accent, border: '1px solid var(--color-border)', display: 'block' }} />
          </button>
          <button type="button" className="lf-iconbtn" title="앨범 추가" onClick={() => ops.requestAdd(bucket.id, bucket.name)}>＋</button>
          <button type="button" className="lf-iconbtn" title="하위 버킷 추가" onClick={() => ops.addBucket(bucket.id)}>⊞</button>
        </div>
      </div>

      {/* color picker */}
      {coloring && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span className="lf-meta">색상</span>
          <div style={{ display: 'flex', gap: 7 }}>
            {BUCKET_COLORS.map((c) => {
              const selected = c.color == null ? !bucket.color : bucket.color === c.color
              return (
                <button
	type="button"
	key={c.key}
	title={c.label}
	aria-label={`버킷 색상 ${c.label}`}
	onClick={() => {
                    ops.setColor(bucket.id, c.color)
                    setColoring(false)
                  }}
	style={{ width: 20, height: 20, borderRadius: 20, background: c.color ?? 'var(--color-text)', cursor: 'pointer', border: selected ? '2px solid var(--color-text)' : '1px solid var(--color-border)', outline: selected ? '1px solid var(--color-bg)' : 'none', outlineOffset: -3 }}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* cover grid */}
      <div style={{ display: 'grid', gap: '14px 12px', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))' }}>
        {isLib ?
(
          <>
            <div className="lf-mono" style={slibLabel(false)}>내가 넣은 · Spotify에 추가</div>
            {libMine.map(renderChip)}
            {addBtn}
            <div className="lf-mono" style={slibLabel(true)}>기존 · Spotify 라이브러리 (삭제 불가)</div>
            {libExisting.length > 0 ?
              libExisting.map(renderChip) :
              <div className="lf-mono" style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--color-faded)', padding: '4px 0', letterSpacing: '0.04em' }}>없음</div>}
          </>
        ) :
(
          <>
            {bucket.albums.map(renderChip)}
            {bucket.albums.length === 0 && bucket.children.length === 0 && (
              <div className="lf-mono" style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--color-faded)', border: '1px dashed var(--color-border)', borderRadius: 4, padding: 18, textAlign: 'center', letterSpacing: '0.04em' }}>비어 있음</div>
            )}
            {addBtn}
          </>
        )}
      </div>

      {/* nested buckets — a reorderable list (gaps show the insertion line) */}
      {bucket.children.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <BucketList items={bucket.children} parentId={bucket.id} depth={depth + 1} shared={shared} />
        </div>
      )}
    </div>
  )
}

// ── trash icon (simple stroke) ───────────────────────────────────────────────
function CrTrashIcon({ s = 28 }: { s?: number }) {
  return (
    <svg
	width={s}
	height={s}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	strokeWidth="1.7"
	strokeLinecap="round"
	strokeLinejoin="round"
	aria-hidden="true"
    >
      <line x1="4" y1="7" x2="20" y2="7" />
      <path d="M9 7V5.6A1.6 1.6 0 0 1 10.6 4h2.8A1.6 1.6 0 0 1 15 5.6V7" />
      <path d="M6.3 7l.9 12.4A1.7 1.7 0 0 0 8.9 21h6.2a1.7 1.7 0 0 0 1.7-1.6L17.7 7" />
      <line x1="10" y1="10.5" x2="10" y2="17.5" />
      <line x1="14" y1="10.5" x2="14" y2="17.5" />
    </svg>
  )
}

// ── trash dock (center-bottom card, mounted only while dragging) ─────────────--
// A single solid card pinned to the bottom-center of the viewport (portaled to
// <body>). No backdrop / blur — the buckets behind it stay crisp so you can keep
// dropping onto them. Replaces the old full-height side rails (휴지통 + 최상위로
// 빼기): un-nesting now happens by dragging a bucket into a top-level gap, so the
// dock only needs to host deletion. Albums → recoverable trash; buckets → confirm.
function TrashDock({ trashCount, onTrashAlbum, onTrashBucket }: { trashCount: number, onTrashAlbum: (itemId: string, fromBucketId: string) => void, onTrashBucket: (bucketId: string) => void }) {
  const [hot, setHot] = useState(false)
  // A 기존/preexisting Spotify-library album can't be trashed (req 4): removing it
  // wouldn't delete it from Spotify and the next sync re-pulls it anyway. myblog_added
  // library albums DO trash (→ next sync removes them from Spotify).
  const accepts = (): boolean => !!dnd && ((dnd.kind === 'album' && !dnd.copy && !(dnd.fromLib && dnd.source === 'preexisting')) || dnd.kind === 'bucket')
  return (
    <div
	className="crate-trash-dock"
	onDragOver={(e) => {
        if (accepts()) {
          e.preventDefault()
          setHot(true)
        }
      }}
	onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setHot(false)
      }}
	onDrop={(e) => {
        if (!accepts())
          return
        e.preventDefault()
        const it = dnd
        setHot(false)
        if (it && it.kind === 'album' && it.itemId && it.fromBucketId)
          onTrashAlbum(it.itemId, it.fromBucketId)
        else if (it && it.kind === 'bucket' && it.bucketId)
          onTrashBucket(it.bucketId)
        dnd = null
      }}
    >
      <div className="crate-trash-card" data-hot={hot ? 'true' : 'false'}>
        <span className="crate-trash-ring"><CrTrashIcon s={28} /></span>
        <div>
          <div className="lf-serif" style={{ fontSize: 21, fontWeight: 500, lineHeight: 1.2, color: hot ? 'var(--color-accent)' : 'var(--color-text)' }}>휴지통</div>
          {trashCount > 0 && (
            <div className="lf-mono" style={{ marginTop: 7, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, letterSpacing: '0.06em', whiteSpace: 'nowrap', color: hot ? 'var(--color-accent)' : 'var(--color-faded)' }}>
              <span style={{ width: 5, height: 5, borderRadius: 5, background: 'currentColor' }} />
              보관
              {' '}
              {trashCount}
              개
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── bucket reorder drop gap (shows the red insertion line) ───────────────────-
// Sits between sibling bucket cards (and at the head/tail of each list). While a
// bucket is being dragged it becomes a drop target: dropping here repositions the
// bucket among `parentId`'s children before `beforeId` (null = append). A
// top-level gap (parentId == null) un-nests a nested bucket — the replacement for
// the removed "최상위로 빼기" rail. Cycle / self-adjacent drops are rejected.
function BucketDropGap({ parentId, beforeId, ops, active }: { parentId: string | null, beforeId: string | null, ops: Ops, active: boolean }) {
  const [hot, setHot] = useState(false)
  const accepts = (): boolean => {
    const it = dnd
    if (!it || it.kind !== 'bucket' || !it.bucketId)
      return false
    if (it.bucketId === beforeId)
      return false // gap directly above itself = no-op
    if (parentId != null) {
      const src = findBucket(ops.tree, it.bucketId)
      if (parentId === it.bucketId || (src && subtreeHas(src, parentId)))
        return false // would nest a bucket inside its own subtree
    }
    return true
  }
  return (
    <div
	onDragOver={(e) => {
        if (active && accepts()) {
          e.preventDefault()
          e.stopPropagation()
          setHot(true)
        }
      }}
	onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setHot(false)
      }}
	onDrop={(e) => {
        if (!active || !accepts())
          return
        e.preventDefault()
        e.stopPropagation()
        const it = dnd
        setHot(false)
        if (it && it.bucketId)
          ops.moveBucketTo(it.bucketId, parentId, beforeId)
        dnd = null
      }}
	style={{ height: 14, position: 'relative' }}
    >
      {active && (
        <div
	style={{
            position: 'absolute',
            left: 2,
            right: 2,
            top: '50%',
            transform: 'translateY(-50%)',
            height: hot ? 4 : 2,
            borderRadius: 3,
            background: hot ? 'var(--color-accent)' : 'transparent',
            boxShadow: hot ? '0 0 0 3px color-mix(in srgb, var(--color-accent) 18%, transparent)' : 'none',
            transition: 'height 0.1s, background 0.1s',
          }}
        >
          {hot && <span style={{ position: 'absolute', left: -2, top: '50%', transform: 'translate(-100%, -50%)', width: 7, height: 7, borderRadius: 7, background: 'var(--color-accent)' }} />}
        </div>
      )}
    </div>
  )
}

// ── bucket list — drop gaps interleaved with cards ───────────────────────────-
// Renders a sibling list with a BucketDropGap before each card and a trailing gap
// (the append target). Recurses through BucketCard for nested children so reorder
// works at every depth.
function BucketList({ items, parentId, depth, shared }: { items: BoardBucket[], parentId: string | null, depth: number, shared: SharedProps }) {
  const active = shared.dragKind === 'bucket'
  return (
    <div>
      {items.map(b => (
        <div key={b.id}>
          <BucketDropGap parentId={parentId} beforeId={b.id} ops={shared.ops} active={active} />
          <BucketCard bucket={b} depth={depth} {...shared} />
        </div>
      ))}
      <BucketDropGap parentId={parentId} beforeId={null} ops={shared.ops} active={active} />
    </div>
  )
}

// ── trash drawer (recoverable albums) ────────────────────────────────────────
interface TrashEntry { tid: string, album: BoardAlbum, fromBucketId: string, fromName: string }

function TrashDrawer({ trash, onRestore, onPurge, onEmpty, onClose }: { trash: TrashEntry[], onRestore: (tid: string) => void, onPurge: (tid: string) => void, onEmpty: () => void, onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape')
        onClose()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="lf-scrim" onClick={onClose} role="presentation">
      <aside className="lf-slideover" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="휴지통">
        <button type="button" className="lf-iconbtn" onClick={onClose} aria-label="닫기" style={{ position: 'absolute', top: 16, right: 16, width: 30, height: 30, borderColor: 'var(--color-border-soft)' }}>✕</button>
        <div className="lf-kicker" style={{ marginBottom: 6 }}>휴지통</div>
        <h2 className="lf-serif" style={{ fontSize: 24, fontWeight: 500 }}>
          {trash.length}
          개 항목
        </h2>
        <p className="lf-serif lf-italic" style={{ color: 'var(--color-subtle)', fontSize: 14, marginTop: 6, marginBottom: 22 }}>버킷에서 뺀 앨범이 보관됩니다. 원래 버킷으로 복원하거나 완전히 비울 수 있어요.</p>

        {trash.length === 0 && (
          <div className="lf-mono" style={{ fontSize: 11, color: 'var(--color-faded)', border: '1px dashed var(--color-border)', borderRadius: 6, padding: 28, textAlign: 'center' }}>휴지통이 비어 있습니다</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {trash.map(t => (
            <div key={t.tid} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'var(--color-paper)', border: '1px solid var(--color-border-soft)', borderRadius: 6 }}>
              <div style={{ flex: '0 0 42px', width: 42 }}><AlbumArt url={t.album.cover} label={t.album.title} size={42} /></div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="lf-serif" style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.album.title}</div>
                <div className="lf-meta" style={{ textTransform: 'none', letterSpacing: 0, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {t.album.artist}
                  {t.fromName ? ` · ${t.fromName}에서` : ''}
                </div>
              </div>
              <button type="button" className="lf-chip" onClick={() => onRestore(t.tid)}>복원</button>
              <button type="button" className="lf-iconbtn danger" title="완전 삭제" onClick={() => onPurge(t.tid)}>✕</button>
            </div>
          ))}
        </div>

        {trash.length > 0 && (
          <button type="button" className="lf-btn" onClick={onEmpty} style={{ width: '100%', marginTop: 18, color: 'var(--color-accent)', borderColor: 'var(--color-accent)' }}>휴지통 비우기</button>
        )}
      </aside>
    </div>
  )
}

// ── board ────────────────────────────────────────────────────────────────---
export function BucketBoard({ onOpen, reviews }: { onOpen: (t: DetailTarget) => void, reviews: MemberReview[] }) {
  // Seed both from localStorage so the board paints immediately on mount and
  // only the (background) revalidation is async — no "불러오는 중…" flash, no
  // disappear-then-reappear when returning to the tab. Stale by design; the
  // mount effects below overwrite with the canonical server data (SWR).
  const [tree, setTree] = useState<BoardBucket[] | null>(() => readSeed<BoardBucket[]>(BUCKETS_KEY))
  const [recent, setRecent] = useState<BoardAlbum[] | null>(() => readSeed<BoardAlbum[]>(RECENT_KEY))
  const [error, setError] = useState(false)
  const [addingTo, setAddingTo] = useState<{ id: string, name: string } | null>(null)

  // FEAT-spotify-library-sync — the special bucket's sync state (banners + the
  // per-album source/state map) and whether a manual sync is in flight.
  const [libState, setLibState] = useState<SpotifyLibraryState | null>(null)
  const [syncing, setSyncing] = useState(false)

  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [draggingBucket, setDraggingBucket] = useState<string | null>(null)
  const [dragKind, setDragKind] = useState<DragKind>(null)

  // Auto-scroll the page while a drag is in flight and the pointer nears the top or
  // bottom edge of the viewport — otherwise you can't reach buckets off-screen mid-
  // drag (HTML5 DnD suppresses normal wheel/scroll). Speed ramps with edge proximity.
  useEffect(() => {
    if (draggingId == null && draggingBucket == null)
      return
    const EDGE = 96 // px band at top/bottom that triggers scroll
    const MAX = 24 // px per frame at the very edge
    let vy = 0
    let raf = 0
    const onMove = (e: DragEvent) => {
      const y = e.clientY
      const h = window.innerHeight
      if (y < EDGE)
        vy = -Math.ceil(((EDGE - y) / EDGE) * MAX)
      else if (y > h - EDGE)
        vy = Math.ceil(((y - (h - EDGE)) / EDGE) * MAX)
      else
        vy = 0
    }
    const tick = () => {
      if (vy !== 0)
        window.scrollBy(0, vy)
      raf = requestAnimationFrame(tick)
    }
    window.addEventListener('dragover', onMove)
    raf = requestAnimationFrame(tick)
    return () => {
      window.removeEventListener('dragover', onMove)
      cancelAnimationFrame(raf)
    }
  }, [draggingId, draggingBucket])

  // Safety net: always clear the drag state when ANY drag ends — even one that
  // ends without a drop (released outside a target / Escape). The per-op endDrag
  // below covers the case where a card drop handler stopPropagation()'d the
  // event AND the dragged item's original DOM node unmounted (cross-bucket move),
  // so neither this document `drop` nor the item's own `dragend` fires; without
  // both, a moved item would stay stuck at the 0.45 drag opacity.
  useEffect(() => {
    const reset = () => {
      setDraggingId(null)
      setDraggingBucket(null)
      setDragKind(null)
      setDropTarget(null)
      dnd = null
    }
    document.addEventListener('drop', reset)
    document.addEventListener('dragend', reset)
    return () => {
      document.removeEventListener('drop', reset)
      document.removeEventListener('dragend', reset)
    }
  }, [])
  const [trash, setTrash] = useState<TrashEntry[]>(() => {
    try {
      const s = localStorage.getItem(TRASH_KEY)
      if (s)
        return JSON.parse(s) as TrashEntry[]
    }
    catch { /* ignore */ }
    return []
  })
  const [trashOpen, setTrashOpen] = useState(false)
  const [pendingBucketDelete, setPendingBucketDelete] = useState<{ id: string, name: string } | null>(null)
  const confirmModalRef = useRef<HTMLDivElement>(null)
  useDismissable(!!pendingBucketDelete, () => setPendingBucketDelete(null), confirmModalRef)

  // album_id → the member's own star rating (0–5). Feeds the rated-bucket chips
  // without any extra fetch (reviews are already server-built into props).
  const ratings = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of reviews) {
      if (r.rating == null)
        continue
      for (const id of r.albumIds) {
        if (!m.has(id))
          m.set(id, r.rating)
      }
    }
    return m
  }, [reviews])

  // album_id → Spotify-library sync row, for the cover source/state badges.
  const libAlbumMap = useMemo(() => {
    const m = new Map<string, SpotifyLibraryAlbumState>()
    for (const a of libState?.albums ?? [])
      m.set(a.album_id, a)
    return m
  }, [libState])

  // Split the special spotify_library bucket out of the normal crate tree: it
  // renders as its own section below the recent strip, never inside the grid.
  // (Top-level only — the backend guarantees one such bucket at the root.)
  const libBucket = useMemo(
    () => (tree ?? []).find(b => b.kind === SLIB_KIND) ?? null,
    [tree],
  )
  const normalTree = useMemo(
    () => (tree ?? []).filter(b => b.kind !== SLIB_KIND),
    [tree],
  )

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
  useEffect(() => {
    let alive = true
    listRecentlyListened()
      .then((r) => {
        if (!alive)
          return
        const mapped: BoardAlbum[] = r.items.map(it => ({
          itemId: `recent:${it.album_id}`,
          albumId: it.album_id,
          title: it.album?.title ?? '제목 미상',
          artist: (it.album?.artist_names ?? []).join(', ') || '—',
          cover: it.album?.cover_url ?? null,
          year: it.album?.release_date ? Number(String(it.album.release_date).slice(0, 4)) || null : null,
          alreadyReviewed: false,
        }))
        setRecent(mapped)
        try {
          localStorage.setItem(RECENT_KEY, JSON.stringify(mapped))
        }
        catch { /* ignore */ }
      })
      // Keep the cached seed on a transient failure instead of blanking the
      // strip; only fall back to empty when there was nothing cached.
      .catch(() => alive && setRecent(prev => prev ?? []))
    return () => {
      alive = false
    }
  }, [])

  // Load the Spotify-library sync state (banners + per-album source/state map).
  // Worker-fed; the GET never calls Spotify (rule #9). A transient failure just
  // leaves the section unbadged — it never blocks the crate board.
  useEffect(() => {
    let alive = true
    getSpotifyLibraryState()
      .then(s => alive && setLibState(s))
      .catch(() => { /* non-fatal — board renders without badges */ })
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

  useEffect(() => {
    try {
      localStorage.setItem(TRASH_KEY, JSON.stringify(trash))
    }
    catch { /* ignore */ }
  }, [trash])

  async function refresh() {
    try {
      setTree(await api.listBuckets())
    }
    catch {
      setError(true)
    }
  }

  // 동기화 — model on refreshRecent(): POST enqueues the worker reconcile (rule
  // #9, no synchronous Spotify call), then POLL /spotify-library/state until
  // last_synced_at advances past the pre-sync value (cap ~10 polls / ~20s), then
  // refetch the board + state so the new badges/pulled albums paint. A
  // 'debounced' response (a sync ran <30s ago) skips the poll. Best-effort: any
  // failure just clears the spinner — the next mount/poll reconciles.
  async function runLibrarySync() {
    if (syncing)
      return
    setSyncing(true)
    const before = libState?.last_synced_at ?? null
    try {
      const { status } = await syncSpotifyLibrary()
      if (status === 'debounced') {
        setLibState(await getSpotifyLibraryState())
        return
      }
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 2000))
        const next = await getSpotifyLibraryState()
        setLibState(next)
        if (next.last_synced_at && next.last_synced_at !== before) {
          await refresh()
          break
        }
      }
    }
    catch { /* non-fatal — clear the spinner, leave existing state in place */ }
    finally {
      setSyncing(false)
    }
  }

  // Clear all drag state the instant a drop completes its op. Needed in addition
  // to the document-level reset above because card drop handlers stopPropagation
  // (so the document `drop` never fires) and a moved item's original node unmounts
  // before its own `dragend` — either of which would leave it stuck at 0.45.
  function endDrag() {
    setDraggingId(null)
    setDraggingBucket(null)
    setDragKind(null)
    setDropTarget(null)
    dnd = null
  }

  const ops: Ops = {
    tree: tree ?? [],
    // Copy a 최근 들은 앨범 tile into a real bucket. Optimistic: splice a temp
    // tile in on drop so it appears instantly, then reconcile with the server —
    // swap temp → canonical item on success, drop temp on 409 (already there) /
    // failure. Previously this awaited the round-trip before painting (~200–
    // 500ms lag), which read as "버킷 반영이 느리다".
    copyAlbum(albumId, toBucketId) {
      endDrag()
      if (tree == null)
        return
      const tempId = `temp:${Date.now()}:${albumId}`
      const src = recent?.find(a => a.albumId === albumId) ?? findAlbumByAlbumId(tree, albumId)
      setTree((prev) => {
        if (prev == null)
          return prev
        const t = clone(prev)
        const dst = findBucket(t, toBucketId)
        if (dst && !dst.albums.some(a => a.albumId === albumId)) {
          dst.albums.push({
            itemId: tempId,
            albumId,
            title: src?.title ?? '…',
            artist: src?.artist ?? '',
            cover: src?.cover ?? null,
            year: src?.year ?? null,
            alreadyReviewed: src?.alreadyReviewed ?? false,
          })
        }
        return t
      })
      api.addBucketItem(toBucketId, albumId)
        .then(({ item, conflict }) => {
          setTree((prev) => {
            if (prev == null)
              return prev
            const t = clone(prev)
            const dst = findBucket(t, toBucketId)
            if (!dst)
              return t
            const i = dst.albums.findIndex(a => a.itemId === tempId)
            if (i < 0)
              return t
            if (conflict || !item)
              dst.albums.splice(i, 1) // already present elsewhere / no row → drop the temp
            else
              dst.albums[i] = item // promote temp → canonical (real itemId)
            return t
          })
        })
        .catch(() => void refresh())
    },
    // Move/reorder an album, inserting before `beforeItemId` (null = append).
    // Persists via PUT /reorder with the affected bucket(s)' new item order.
    insertAlbum(itemId, fromBucketId, toBucketId, beforeItemId) {
      endDrag()
      if (tree == null)
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
      const bi = beforeItemId ? dst.albums.findIndex(a => a.itemId === beforeItemId) : -1
      if (bi < 0)
        dst.albums.push(moved)
      else
        dst.albums.splice(bi, 0, moved)
      setTree(t)
      const payload = fromBucketId === toBucketId ?
        [{ id: toBucketId, item_ids: dst.albums.map(a => a.itemId) }] :
        [{ id: fromBucketId, item_ids: src.albums.map(a => a.itemId) }, { id: toBucketId, item_ids: dst.albums.map(a => a.itemId) }]
      api.reorderItems(payload).catch(() => void refresh())
    },
    moveBucketInto(bucketId, targetId) {
      endDrag()
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
      // Don't reconcile with the server snapshot: the optimistic splice already
      // reflects the move, and a whole-tree overwrite would clobber any concurrent
      // optimistic edit (rename/color/add) made during the round-trip (BB-1). Each
      // such edit persists via its own PUT; on error the .catch refreshes/rolls back.
      api.moveBucket(bucketId, targetId, position)
        .catch(() => void refresh())
    },
    // Reposition a bucket among `parentId`'s children, before `beforeId` (null =
    // append). Drives both reorder (drop in a sibling gap) and un-nest (drop in a
    // top-level gap, parentId null). Optimistic splice only — no server-snapshot
    // reconcile (see BB-1 note in moveBucketInto).
    moveBucketTo(bucketId, parentId, beforeId) {
      endDrag()
      if (tree == null || bucketId === beforeId)
        return
      const src = findBucket(tree, bucketId)
      if (parentId != null && src && (parentId === bucketId || subtreeHas(src, parentId)))
        return
      const t = clone(tree)
      const rm = removeBucketNode(t, bucketId)
      if (!rm)
        return
      const list = parentId == null ? t : findBucket(t, parentId)?.children
      if (!list)
        return
      const idx = beforeId ? list.findIndex(b => b.id === beforeId) : -1
      const position = idx < 0 ? list.length : idx
      if (idx < 0)
        list.push(rm)
      else
        list.splice(idx, 0, rm)
      setTree(t)
      api.moveBucket(bucketId, parentId, position)
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
          // Optimistically nest the new bucket under the parent on the LATEST tree,
          // then persist the parent assignment — but don't overwrite the tree with the
          // server snapshot (would clobber concurrent optimistic edits, BB-1).
          setTree((prev) => {
            if (prev == null)
              return prev
            const t = clone(prev)
            const parent = findBucket(t, parentId)
            if (parent)
              parent.children.push(created)
            return t
          })
          return api.moveBucket(created.id, parentId, position).then(() => undefined)
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
    setColor(id, color) {
      if (tree == null)
        return
      const t = clone(tree)
      const b = findBucket(t, id)
      if (b)
        b.color = color
      setTree(t)
      api.setBucketColor(id, color).catch(() => void refresh())
    },
    requestAdd(bucketId, bucketName) {
      setAddingTo({ id: bucketId, name: bucketName })
    },
  }

  // Drop an album on the trash dock: optimistic splice + DELETE, then stash a
  // recoverable entry. Restore re-adds it via the normal item route.
  function trashAlbum(itemId: string, fromBucketId: string) {
    endDrag()
    if (tree == null)
      return
    const found = findAlbum(tree, itemId)
    const t = clone(tree)
    const src = findBucket(t, fromBucketId)
    if (src) {
      const i = src.albums.findIndex(a => a.itemId === itemId)
      if (i >= 0)
        src.albums.splice(i, 1)
    }
    setTree(t)
    if (found)
      setTrash(prev => [{ tid: itemId, album: found.album, fromBucketId, fromName: found.bucketName }, ...prev])
    api.deleteBucketItem(fromBucketId, itemId).catch(() => void refresh())
  }

  // Restore: re-add to the original bucket (or the first root if it's gone). A
  // 409 means it's already back — either way the trash entry is cleared.
  function restoreTrash(tid: string) {
    const entry = trash.find(x => x.tid === tid)
    if (!entry || tree == null)
      return
    const target = findBucket(tree, entry.fromBucketId) ? entry.fromBucketId : tree[0]?.id
    if (!target) {
      setTrash(prev => prev.filter(x => x.tid !== tid))
      return
    }
    api.addBucketItem(target, entry.album.albumId)
      .then(({ item }) => {
        if (item) {
          setTree((prev) => {
            if (prev == null)
              return prev
            const t = clone(prev)
            findBucket(t, target)?.albums.push(item)
            return t
          })
        }
        setTrash(prev => prev.filter(x => x.tid !== tid))
      })
      .catch(() => void refresh())
  }

  function confirmBucketDelete() {
    if (pendingBucketDelete == null || tree == null) {
      setPendingBucketDelete(null)
      return
    }
    const { id } = pendingBucketDelete
    const t = clone(tree)
    removeBucketNode(t, id)
    setTree(t)
    setPendingBucketDelete(null)
    api.deleteBucket(id).catch(() => void refresh())
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

  // Props shared by every card / list in the tree — bundled so BucketList can
  // forward them with one spread.
  const shared: SharedProps = { ops, onOpen, ratings, libState: libAlbumMap, dropTarget, setDropTarget, draggingId, setDraggingId, draggingBucket, setDraggingBucket, setDragKind, dragKind }

  return (
    <div>
      <SectionTitle
	kicker={tree == null ? '불러오는 중…' : `${normalTree.length} 버킷 · 크레이트`}
	title="평론 버킷"
	right={(
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="lf-btn" onClick={() => setTrashOpen(true)}>
              🗑 휴지통
              {trash.length ? ` · ${trash.length}` : ''}
            </button>
            <button type="button" className="lf-btn lf-btn-solid" disabled={tree == null} onClick={() => ops.addBucket(null)}>＋ 버킷</button>
          </div>
        )}
      />
      {recent != null && recent.length > 0 && (
        <div
	className="lf-panel crate-spotify"
	style={{ padding: 0, marginBottom: 22 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 14px', borderBottom: '1px solid var(--color-border-soft)' }}>
            <span className="lf-serif" style={{ fontSize: 16, fontWeight: 500, whiteSpace: 'nowrap' }}>최근 들은 앨범</span>
            <span className="lf-meta" style={{ color: 'var(--color-spotify)' }}>SPOTIFY 연동</span>
          </div>
          <div style={{ display: 'flex', gap: 14, padding: 14, overflowX: 'auto', alignItems: 'flex-start' }}>
            {recent.map(a => (
              <div key={a.itemId} style={{ flex: '0 0 116px', width: 116 }}>
                <AlbumChip album={a} bucketId={RECENT_ID} rated={false} score={null} onOpen={onOpen} copySource draggingId={draggingId} setDraggingId={setDraggingId} setDragKind={setDragKind} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Spotify 라이브러리 — the special kind='spotify_library' bucket, pulled
          out of the normal crate tree and rendered here as its own section just
          below the recent strip. Drag albums in/out to set the bucket INTENT
          only (copyAlbum / trash via the shared ops) — NO synchronous Spotify
          call; the 동기화 button enqueues the worker reconcile (rule #9). */}
      {tree != null && (
        <div className="lf-panel crate-spotify" style={{ padding: 0, marginBottom: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 14px', borderBottom: '1px solid var(--color-border-soft)' }}>
            <span className="lf-serif" style={{ fontSize: 16, fontWeight: 500, whiteSpace: 'nowrap' }}>Spotify 라이브러리</span>
            <span className="lf-meta" style={{ color: 'var(--color-spotify)' }}>SPOTIFY 동기화</span>
            <button
	type="button"
	className="lf-btn"
	disabled={syncing}
	onClick={() => void runLibrarySync()}
	style={{ marginLeft: 'auto' }}
            >
              {syncing ? '동기화 중…' : '동기화'}
            </button>
          </div>

          {libState?.needs_reauth && (
            <div className="lf-mono" style={{ padding: '9px 14px', fontSize: 11.5, letterSpacing: '0.03em', color: '#fff', background: 'var(--color-accent)' }}>
              Spotify 재인증 필요
            </div>
          )}
          {libState != null && libState.writes_enabled === false && (
            <div className="lf-mono" style={{ padding: '9px 14px', fontSize: 11.5, letterSpacing: '0.03em', color: 'oklch(0.42 0.10 70)', background: 'oklch(0.95 0.04 80)', borderBottom: '1px solid var(--color-border-soft)' }}>
              검토 모드: Spotify에 실제 반영 안 됨
            </div>
          )}

          <div style={{ padding: 14 }}>
            {libBucket && countAlbums(libBucket) > 0 ?
              (
                <BucketList items={[libBucket]} parentId={null} depth={0} shared={shared} />
              ) :
              (
                <div className="lf-mono" style={{ fontSize: 11.5, color: 'var(--color-faded)', border: '1px dashed var(--color-border)', borderRadius: 6, padding: 24, textAlign: 'center', letterSpacing: '0.04em' }}>
                  동기화를 누르면 Spotify 라이브러리의 앨범을 불러옵니다
                </div>
              )}
          </div>
        </div>
      )}

      {tree == null && <div className="lf-meta" style={{ padding: '8px 0' }}>불러오는 중…</div>}

      {tree != null && normalTree.length === 0 && (
        <div className="lf-panel" style={{ padding: 40, textAlign: 'center' }}>
          <span className="lf-meta">버킷 없음</span>
        </div>
      )}

      {tree != null && normalTree.length > 0 && (
        <BucketList items={normalTree} parentId={null} depth={0} shared={shared} />
      )}

      {/* trash dock — a single center-bottom card, mounted only while dragging an
          album or bucket. PORTALED to <body>: .lf-rise (the tab-content wrapper)
          keeps a filled identity transform after its entrance animation
          (matrix(1,0,0,1,0,0) ≠ none), which makes it the containing block for
          position:fixed — so rendering in-tree pinned the dock to lf-rise's box
          instead of the viewport. Portaling escapes that. No backdrop/blur: the
          buckets behind stay crisp so you can keep dropping onto them. */}
      {(dragKind === 'album' || dragKind === 'bucket') && typeof document !== 'undefined' && createPortal(
        <TrashDock
	trashCount={trash.length}
	onTrashAlbum={trashAlbum}
	onTrashBucket={(id) => {
            const b = tree ? findBucket(tree, id) : null
            setPendingBucketDelete({ id, name: b?.name ?? '' })
          }}
        />,
        document.body,
      )}

      {addingTo && (
        <AddAlbumModal
	bucketName={addingTo.name}
	onAdd={onAddAlbum}
	onClose={() => setAddingTo(null)}
        />
      )}

      {trashOpen && (
        <TrashDrawer
	trash={trash}
	onRestore={restoreTrash}
	onPurge={tid => setTrash(prev => prev.filter(x => x.tid !== tid))}
	onEmpty={() => setTrash([])}
	onClose={() => setTrashOpen(false)}
        />
      )}

      {pendingBucketDelete && (
        <div className="qb-modal-scrim" onClick={() => setPendingBucketDelete(null)} role="presentation">
          <div ref={confirmModalRef} className="qb-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="버킷 삭제 확인" style={{ maxWidth: 400 }}>
            <header className="qb-modal-head">
              <div>
                <div className="qb-modal-kicker">버킷 삭제</div>
                <h3 className="qb-modal-title">이 버킷을 삭제할까요?</h3>
              </div>
              <button type="button" className="qb-modal-close" onClick={() => setPendingBucketDelete(null)} aria-label="닫기">✕</button>
            </header>
            <div style={{ padding: 'var(--space-4) var(--space-5) var(--space-5)' }}>
              <p className="lf-sans" style={{ fontSize: 13.5, color: 'var(--color-subtle)', lineHeight: 1.65, margin: 0 }}>
                <span className="lf-serif lf-italic" style={{ color: 'var(--color-text)' }}>{pendingBucketDelete.name || '이 버킷'}</span>
                {' '}
                과(와) 그 하위 버킷·담긴 앨범이 함께 삭제됩니다. 평론 기록에는 영향을 주지 않습니다.
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
                <button type="button" className="lf-btn" onClick={() => setPendingBucketDelete(null)}>취소</button>
                <button type="button" className="lf-btn lf-btn-solid" onClick={confirmBucketDelete}>삭제</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
