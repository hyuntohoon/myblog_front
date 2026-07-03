// Member dashboard — 개요 customizable widget dashboard.
//
// Row-based board: `rows` is an array of rows, each row an array of widget ids
// sharing the row width equally (1 → full, 2 → ½, 3 → ⅓ …). Rows are explicit
// and fixed: dragging shows an insertion indicator (vertical bar = into a row,
// horizontal bar = new row) computed from a geometry snapshot taken at drag
// start, so nothing reflows mid-drag — only the lifted overlay (portaled to
// <body>) moves. On drop the new arrangement commits. Layout persists to
// localStorage. Ported from overview.jsx (kept pointer-based, NOT @dnd-kit).
import type { CSSProperties, ReactNode } from 'react'
import type { NpStyle, OnOpenLyrics } from './NowPlaying'
import type { DetailTarget, MemberReview, SampleAlbum, SampleTrack } from '@lib/member'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { bucketCount, OV_ROWS_KEY, OV_VIEWS_KEY } from '@lib/member'
import { useDismissable } from '@lib/useDismissable'
import { NowPlaying } from './NowPlaying'
import { listListenedAlbums, listRecentlyListened, listRecentTracks } from './spotify.api'
import { AlbumArt, BucketShortcut, SectionTitle, Seg, Stars } from './ui'

/** Relative "when" label from an ISO timestamp (오늘 / 어제 / N일 전 / 날짜). */
function fmtWhen(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime()))
    return ''
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000)
  if (days <= 0)
    return '오늘'
  if (days === 1)
    return '어제'
  if (days < 7)
    return `${days}일 전`
  return then.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
}

type ViewKey = 'list' | 'grid' | 'card'

interface DashCtx {
  views: Record<string, ViewKey>
  setView: (id: string, v: ViewKey) => void
  onOpen: (t: DetailTarget) => void
  npStyle: NpStyle
  setNpStyle: (s: NpStyle) => void
  goBucket: () => void
  reviews: MemberReview[]
  onOpenLyrics?: OnOpenLyrics
}

interface HandleProps { onPointerDown?: (e: React.PointerEvent) => void, style: CSSProperties }

/* ── album / track collections (list · grid · card) ──────── */
function AlbumColl({ items, view, onOpen }: { items: SampleAlbum[], view: ViewKey, onOpen: (t: DetailTarget) => void }) {
  if (view === 'grid') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px,1fr))', gap: 16 }}>
        {items.map(a => (
          <button key={a.id} type="button" onClick={() => onOpen(a)} style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }}>
            <AlbumArt url={a.cover} label={a.album} />
            <div className="serif italic" style={{ fontSize: 13.5, marginTop: 6, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.album}</div>
            <div className="mono" style={{ fontSize: 9.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{a.artist}</div>
          </button>
        ))}
      </div>
    )
  }
  if (view === 'card') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px,1fr))', gap: 12 }}>
        {items.map(a => (
          <button key={a.id} type="button" onClick={() => onOpen(a)} className="panel" style={{ display: 'flex', gap: 12, padding: 12, alignItems: 'center', textAlign: 'left', cursor: 'pointer', background: 'var(--color-bg)' }}>
            <div style={{ width: 56, flex: '0 0 auto' }}><AlbumArt url={a.cover} label={a.album} size={56} /></div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="meta" style={{ marginBottom: 3 }}>{a.when}</div>
              <div className="serif italic" style={{ fontSize: 16, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.album}</div>
              <div className="sans" style={{ fontSize: 12, color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.artist}</div>
              <div style={{ marginTop: 5 }}>{a.rating != null ? <Stars score={a.rating} size={12} /> : <span className="meta" style={{ fontSize: 9 }}>미평가</span>}</div>
            </div>
          </button>
        ))}
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {items.map((a, i) => (
        <button key={a.id} type="button" onClick={() => onOpen(a)} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '9px 2px', borderTop: i ? '1px solid var(--color-border-soft)' : 'none', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', width: '100%' }}>
          <div style={{ width: 38, flex: '0 0 auto' }}><AlbumArt url={a.cover} label={a.album} size={38} /></div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="serif italic" style={{ fontSize: 15, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.album}</div>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{a.artist}</div>
          </div>
          {a.rating != null && <Stars score={a.rating} size={12} />}
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-faded)', width: 44, textAlign: 'right' }}>{a.when}</span>
        </button>
      ))}
    </div>
  )
}

function TrackColl({ items, view, onOpen }: { items: SampleTrack[], view: ViewKey, onOpen: (t: DetailTarget) => void }) {
  const open = (t: SampleTrack) => onOpen({ album: t.album, artist: t.artist, track: t.track })
  if (view === 'grid') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px,1fr))', gap: 16 }}>
        {items.map(t => (
          <button key={t.id} type="button" onClick={() => open(t)} style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }}>
            <AlbumArt url={t.cover} label={t.album} />
            <div className="serif" style={{ fontSize: 13.5, marginTop: 6, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.track}</div>
            <div className="mono" style={{ fontSize: 9.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{t.artist}</div>
          </button>
        ))}
      </div>
    )
  }
  if (view === 'card') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px,1fr))', gap: 12 }}>
        {items.map(t => (
          <button key={t.id} type="button" onClick={() => open(t)} className="panel" style={{ display: 'flex', gap: 12, padding: 12, alignItems: 'center', textAlign: 'left', cursor: 'pointer', background: 'var(--color-bg)' }}>
            <div style={{ width: 50, flex: '0 0 auto' }}><AlbumArt url={t.cover} label={t.album} size={50} /></div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="serif" style={{ fontSize: 15, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.track}</div>
              <div className="sans" style={{ fontSize: 12, color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
{t.artist}
{' '}
·
{' '}
{t.album}
              </div>
              <div className="meta" style={{ marginTop: 4 }}>
{t.when}
{' '}
·
{' '}
{t.len}
              </div>
            </div>
          </button>
        ))}
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {items.map((t, i) => (
        <button key={t.id} type="button" onClick={() => open(t)} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '9px 2px', borderTop: i ? '1px solid var(--color-border-soft)' : 'none', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', width: '100%' }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--color-faded)', width: 20 }}>{String(i + 1).padStart(2, '0')}</span>
          <div style={{ width: 34, flex: '0 0 auto' }}><AlbumArt url={t.cover} label={t.album} size={34} /></div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="serif" style={{ fontSize: 14.5, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.track}</div>
            <div className="sans" style={{ fontSize: 11, color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>{t.artist}</div>
          </div>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-faded)' }}>{t.len}</span>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-faded)', width: 46, textAlign: 'right' }}>{t.when}</span>
        </button>
      ))}
    </div>
  )
}

function ViewToggle({ value, onChange }: { value: ViewKey, onChange: (v: ViewKey) => void }) {
  const opts: { v: ViewKey, label: string }[] = [{ v: 'list', label: '리스트' }, { v: 'grid', label: '그리드' }, { v: 'card', label: '카드' }]
  return (
    <div style={{ display: 'inline-flex', border: '1px solid var(--color-border)' }}>
      {opts.map((o, i) => (
        <button
	key={o.v}
	type="button"
	onClick={() => onChange(o.v)}
	className="mono"
	style={{ border: 'none', borderLeft: i ? '1px solid var(--color-border)' : 'none', padding: '5px 9px', fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', cursor: 'pointer', background: value === o.v ? 'var(--color-text)' : 'transparent', color: value === o.v ? 'var(--color-bg)' : 'var(--color-text)' }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ── widget registry ─────────────────────────────────────── */
const WIDGET_TITLES: Record<string, string> = {
  'nowplaying': '지금 듣는 음악',
  'recent-albums': '최근 들은 앨범',
  'recent-tracks': '최근 재생 트랙',
  'listened-albums': '들은 앨범 (누적)',
  'bucket': 'My Buckit',
  'latest-reviews': '최근 평론',
}
const ALL_WIDGETS = Object.keys(WIDGET_TITLES)

function MiniReview({ r, onOpen }: { r: MemberReview, onOpen: (t: DetailTarget) => void }) {
  return (
    <button type="button" onClick={() => onOpen({ album: r.album, artist: r.artist, genre: r.genre, year: r.year, rating: r.rating })} className="panel" style={{ display: 'flex', gap: 12, padding: 12, alignItems: 'center', background: 'var(--color-bg)', textAlign: 'left', cursor: 'pointer' }}>
      <div style={{ width: 44, flex: '0 0 auto' }}><AlbumArt url={r.cover} label={r.album} size={44} /></div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="meta">
{r.type}
{' '}
·
{' '}
{new Date(r.date).getFullYear()}
        </div>
        <div className="serif italic" style={{ fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.album}</div>
      </div>
      {r.rating != null && <Stars score={r.rating} size={12} />}
    </button>
  )
}

/** How many 최근 들은 앨범 the widget shows inline; the rest live behind 더 보기. */
const RECENT_ALBUMS_LIMIT = 6

/** Modal listing every 최근 들은 앨범 (grid). Reuses the slide-over shell + scrim. */
function RecentAlbumsModal({ items, onOpen, onClose }: { items: SampleAlbum[], onOpen: (t: DetailTarget) => void, onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape')
        onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const openAndClose = (t: DetailTarget) => {
    onClose()
    onOpen(t)
  }
  return createPortal(
    <div className="scrim" onClick={onClose} role="presentation">
      <aside className="slideover" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="최근 들은 앨범 전체">
        <button type="button" className="iconbtn" onClick={onClose} aria-label="닫기" style={{ position: 'absolute', top: 16, right: 16, width: 30, height: 30, borderColor: 'var(--color-border-soft)' }}>✕</button>
        <div className="kicker" style={{ marginBottom: 4 }}>최근 들은 앨범</div>
        <div className="meta" style={{ marginBottom: 18 }}>
          {items.length}
          장
        </div>
        <AlbumColl items={items} view="grid" onOpen={openAndClose} />
      </aside>
    </div>,
    document.body,
  )
}

/** 최근 들은 앨범 widget — real (worker-fed cache, Step 3 D25), mapped to AlbumColl. */
function RecentAlbumsWidget({ view, onOpen }: { view: ViewKey, onOpen: (t: DetailTarget) => void }) {
  const [items, setItems] = useState<SampleAlbum[] | null>(null)
  const [showAll, setShowAll] = useState(false)
  useEffect(() => {
    let on = true
    listRecentlyListened()
      .then(snap => on && setItems(snap.items.map(it => ({
        id: it.album_id,
        album: it.album?.title ?? '앨범',
        artist: (it.album?.artist_names ?? []).join(', ') || '—',
        year: null,
        genre: '',
        rating: null,
        when: fmtWhen(it.last_played_at),
        cover: it.album?.cover_url ?? null,
      }))))
      .catch(() => on && setItems([]))
    return () => {
      on = false
    }
  }, [])
  if (items == null) {
    return (
<div className="lf-skel-stack" aria-busy="true" aria-label="불러오는 중">
<div className="lf-skeleton" style={{ height: 44 }} />
<div className="lf-skeleton" style={{ height: 44 }} />
<div className="lf-skeleton" style={{ height: 44 }} />
</div>
)
}
  if (items.length === 0)
    return <div className="meta" style={{ padding: '6px 2px' }}>기록 없음</div>
  const shown = items.slice(0, RECENT_ALBUMS_LIMIT)
  const hidden = items.length - shown.length
  return (
    <>
      <AlbumColl items={shown} view={view} onOpen={onOpen} />
      {hidden > 0 && (
        <button
	type="button"
	onClick={() => setShowAll(true)}
	className="mono"
	style={{ marginTop: 12, width: '100%', padding: '8px 0', background: 'none', border: '1px solid var(--color-border-soft)', borderRadius: 3, color: 'var(--color-subtle)', fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', cursor: 'pointer' }}
        >
          {`더 보기 (+${hidden})`}
        </button>
      )}
      {showAll && <RecentAlbumsModal items={items} onOpen={onOpen} onClose={() => setShowAll(false)} />}
    </>
  )
}

/** How many 최근 재생 트랙 the widget shows inline; the rest live behind 더 보기. */
const RECENT_TRACKS_LIMIT = 8

/** Modal listing every 최근 재생 트랙 (list). Reuses the slide-over shell + scrim. */
function RecentTracksModal({ items, view, onOpen, onClose }: { items: SampleTrack[], view: ViewKey, onOpen: (t: DetailTarget) => void, onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape')
        onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const openAndClose = (t: DetailTarget) => {
    onClose()
    onOpen(t)
  }
  return createPortal(
    <div className="scrim" onClick={onClose} role="presentation">
      <aside className="slideover" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="최근 재생 트랙 전체">
        <button type="button" className="iconbtn" onClick={onClose} aria-label="닫기" style={{ position: 'absolute', top: 16, right: 16, width: 30, height: 30, borderColor: 'var(--color-border-soft)' }}>✕</button>
        <div className="kicker" style={{ marginBottom: 4 }}>최근 재생 트랙</div>
        <div className="meta" style={{ marginBottom: 18 }}>
          {items.length}
          곡
        </div>
        <TrackColl items={items} view={view === 'grid' ? 'grid' : 'list'} onOpen={openAndClose} />
      </aside>
    </div>,
    document.body,
  )
}

/**
 * 최근 재생 트랙 widget — real (worker-fed track cache, D-B), mapped to TrackColl.
 *  Duration isn't stored (we only cache play timestamps), so `len` is left blank.
 */
function RecentTracksWidget({ view, onOpen }: { view: ViewKey, onOpen: (t: DetailTarget) => void }) {
  const [items, setItems] = useState<SampleTrack[] | null>(null)
  const [showAll, setShowAll] = useState(false)
  useEffect(() => {
    let on = true
    listRecentTracks()
      .then(snap => on && setItems(snap.items.map(it => ({
        id: `${it.spotify_track_id}|${it.played_at}`,
        track: it.track_name,
        artist: it.artist_name ?? '—',
        album: it.album_name ?? it.album?.title ?? '—',
        len: '',
        when: fmtWhen(it.played_at),
        cover: it.album?.cover_url ?? null,
      }))))
      .catch(() => on && setItems([]))
    return () => {
      on = false
    }
  }, [])
  if (items == null) {
    return (
<div className="lf-skel-stack" aria-busy="true" aria-label="불러오는 중">
<div className="lf-skeleton" style={{ height: 44 }} />
<div className="lf-skeleton" style={{ height: 44 }} />
<div className="lf-skeleton" style={{ height: 44 }} />
</div>
)
}
  if (items.length === 0)
    return <div className="meta" style={{ padding: '6px 2px' }}>기록 없음</div>
  const shown = items.slice(0, RECENT_TRACKS_LIMIT)
  const hidden = items.length - shown.length
  return (
    <>
      <TrackColl items={shown} view={view} onOpen={onOpen} />
      {hidden > 0 && (
        <button
	type="button"
	onClick={() => setShowAll(true)}
	className="mono"
	style={{ marginTop: 12, width: '100%', padding: '8px 0', background: 'none', border: '1px solid var(--color-border-soft)', borderRadius: 3, color: 'var(--color-subtle)', fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', cursor: 'pointer' }}
        >
          {`더 보기 (+${hidden})`}
        </button>
      )}
      {showAll && <RecentTracksModal items={items} view={view} onOpen={onOpen} onClose={() => setShowAll(false)} />}
    </>
  )
}

/**
 * 들은 앨범 (누적) widget — real (D-A), the durable archive aggregated from the
 *  play-event log. Distinct from 최근 들은 앨범 (a rolling cache); `when` shows the
 *  cumulative play count so the two surfaces read differently.
 */
function ListenedAlbumsWidget({ view, onOpen }: { view: ViewKey, onOpen: (t: DetailTarget) => void }) {
  const [items, setItems] = useState<SampleAlbum[] | null>(null)
  useEffect(() => {
    let on = true
    listListenedAlbums(60)
      .then(rows => on && setItems(rows.map(r => ({
        id: r.album_id,
        album: r.album?.title ?? '앨범',
        artist: (r.album?.artist_names ?? []).join(', ') || '—',
        year: null,
        genre: '',
        rating: null,
        when: `${r.play_count}회`,
        cover: r.album?.cover_url ?? null,
      }))))
      .catch(() => on && setItems([]))
    return () => {
      on = false
    }
  }, [])
  if (items == null) {
    return (
<div className="lf-skel-stack" aria-busy="true" aria-label="불러오는 중">
<div className="lf-skeleton" style={{ height: 44 }} />
<div className="lf-skeleton" style={{ height: 44 }} />
<div className="lf-skeleton" style={{ height: 44 }} />
</div>
)
}
  if (items.length === 0)
    return <div className="meta" style={{ padding: '6px 2px' }}>기록 없음</div>
  return <AlbumColl items={items} view={view} onOpen={onOpen} />
}

function WidgetBody({ id, ctx }: { id: string, ctx: DashCtx }) {
  switch (id) {
    case 'nowplaying': return <NowPlaying variant={ctx.npStyle} onOpenLyrics={ctx.onOpenLyrics} />
    case 'recent-albums': return <RecentAlbumsWidget view={ctx.views['recent-albums']} onOpen={ctx.onOpen} />
    case 'recent-tracks': return <RecentTracksWidget view={ctx.views['recent-tracks']} onOpen={ctx.onOpen} />
    case 'listened-albums': return <ListenedAlbumsWidget view={ctx.views['listened-albums']} onOpen={ctx.onOpen} />
    case 'bucket': return <BucketShortcut count={bucketCount()} onGo={ctx.goBucket} />
    case 'latest-reviews': return <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{ctx.reviews.slice(0, 2).map(r => <MiniReview key={r.slug} r={r} onOpen={ctx.onOpen} />)}</div>
    default: return null
  }
}

/* ── row-based board ─────────────────────────────────────── */
interface RowGeom { top: number, bottom: number, cells: { left: number, right: number, cx: number }[] }
interface Geom { rows: RowGeom[], left: number, right: number }
type Target = { kind: 'newrow', at: number } | { kind: 'slot', row: number, slot: number } | null
interface DragState { id: string, w: number, grabX: number, grabY: number, px: number, py: number, target: Target }

function RowsBoard({ rows, setRows, render }: { rows: string[][], setRows: (fn: (prev: string[][]) => string[][]) => void, render: (id: string, handleProps: HandleProps, dragging: boolean) => ReactNode }) {
  const cellRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const geom = useRef<Geom | null>(null)
  const drag = useRef<DragState | null>(null)
  const [, force] = useReducer((c: number) => c + 1, 0)

  const computeTarget = (px: number, py: number): Target => {
    const g = geom.current
    if (!g)
      return null
    const R = g.rows
    if (py < R[0].top)
      return { kind: 'newrow', at: 0 }
    if (py > R[R.length - 1].bottom)
      return { kind: 'newrow', at: R.length }
    for (let ri = 0; ri < R.length; ri++) {
      const r = R[ri]
      if (py >= r.top && py <= r.bottom) {
        const t = (py - r.top) / Math.max(1, r.bottom - r.top)
        if (t < 0.22)
          return { kind: 'newrow', at: ri }
        if (t > 0.78)
          return { kind: 'newrow', at: ri + 1 }
        let slot = 0
        r.cells.forEach((c) => {
 if (px > c.cx)
slot++
})
        return { kind: 'slot', row: ri, slot }
      }
      const nx = R[ri + 1]
      if (nx && py > r.bottom && py < nx.top)
        return { kind: 'newrow', at: ri + 1 }
    }
    return null
  }

  const move = (e: PointerEvent) => {
    const dd = drag.current
    if (!dd)
      return
    dd.px = e.clientX
    dd.py = e.clientY
    dd.target = computeTarget(e.clientX, e.clientY)
    force()
  }
  const end = () => {
    const dd = drag.current
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    window.removeEventListener('blur', end)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    if (!dd)
      return
    drag.current = null
    const tg = dd.target
    if (tg) {
      setRows((prev) => {
        let Rn = prev.map(r => r.slice())
        let sri = -1
        let ssi = -1
        Rn.forEach((row, ri) => {
          const i = row.indexOf(dd.id)
          if (i >= 0) {
            sri = ri
            ssi = i
          }
        })
        if (sri < 0)
          return prev
        Rn[sri].splice(ssi, 1)
        if (tg.kind === 'newrow') {
          Rn.splice(tg.at, 0, [dd.id])
        }
        else {
          let slot = tg.slot
          if (tg.row === sri && slot > ssi)
            slot--
          Rn[tg.row].splice(slot, 0, dd.id)
        }
        Rn = Rn.filter(r => r.length > 0)
        return Rn
      })
    }
    else {
      force()
    }
  }
  const begin = (e: React.PointerEvent, id: string) => {
    if (e.button != null && e.button !== 0)
      return
    e.preventDefault()
    const el = cellRefs.current[id]
    if (!el)
      return
    const r = el.getBoundingClientRect()
    const grows: RowGeom[] = rows.map((row) => {
      const cs = row.map(cid => cellRefs.current[cid]!.getBoundingClientRect())
      return { top: Math.min(...cs.map(c => c.top)), bottom: Math.max(...cs.map(c => c.bottom)), cells: cs.map(c => ({ left: c.left, right: c.right, cx: c.left + c.width / 2 })) }
    })
    const allLeft = Math.min(...grows.flatMap(rr => rr.cells.map(c => c.left)))
    const allRight = Math.max(...grows.flatMap(rr => rr.cells.map(c => c.right)))
    geom.current = { rows: grows, left: allLeft, right: allRight }
    drag.current = { id, w: r.width, grabX: e.clientX - r.left, grabY: e.clientY - r.top, px: e.clientX, py: e.clientY, target: null }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'grabbing'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    // OV-4: capture the pointer so an interrupted gesture fires pointercancel, and
    // end the drag if the window loses focus (alt-tab / OS dialog can swallow the
    // pointerup, otherwise leaving the drag overlay stuck).
    try {
      el.setPointerCapture(e.pointerId)
    }
    catch {}
    window.addEventListener('blur', end)
    force()
  }

  const d = drag.current
  const tg = d && d.target
  const g = geom.current

  return (
    <div>
      {rows.map((row, ri) => (
        <div key={ri} className="ov-dash-row" style={{ display: 'flex', gap: 16, marginBottom: 16, alignItems: 'stretch' }}>
          {row.map(id => (
            <div key={id} ref={(el) => { cellRefs.current[id] = el }} style={{ flex: 1, minWidth: 0, opacity: d && d.id === id ? 0.3 : 1 }}>
              {render(id, { onPointerDown: e => begin(e, id), style: { touchAction: 'none', cursor: 'grab' } }, !!(d && d.id === id))}
            </div>
          ))}
        </div>
      ))}

      {tg && g && d && createPortal(
        <div className="member-root" style={{ padding: 0, margin: 0, maxWidth: 'none' }}>
          <div style={{ position: 'fixed', left: d.px - d.grabX, top: d.py - d.grabY, width: d.w, zIndex: 1000, pointerEvents: 'none', transform: 'scale(1.02)', transformOrigin: 'top left' }}>
            {render(d.id, { style: {} }, true)}
          </div>
          {tg.kind === 'slot' && (() => {
            const r = g.rows[tg.row]
            const cells = r.cells
            const x = tg.slot < cells.length ? cells[tg.slot].left - 9 : cells[cells.length - 1].right + 6
            return <div style={{ position: 'fixed', left: x, top: r.top - 4, height: (r.bottom - r.top) + 8, width: 3, background: 'var(--color-accent)', borderRadius: 2, zIndex: 999, pointerEvents: 'none' }} />
          })()}
          {tg.kind === 'newrow' && (() => {
            const y = tg.at < g.rows.length ? g.rows[tg.at].top - 9 : g.rows[g.rows.length - 1].bottom + 6
            return <div style={{ position: 'fixed', left: g.left, top: y, width: g.right - g.left, height: 3, background: 'var(--color-accent)', borderRadius: 2, zIndex: 999, pointerEvents: 'none' }} />
          })()}
        </div>,
        document.body,
      )}
    </div>
  )
}

/* ── one widget shell ────────────────────────────────────── */
function Widget({ id, ctx, onRemove, handleProps, dragging }: { id: string, ctx: DashCtx, onRemove: (id: string) => void, handleProps: HandleProps, dragging: boolean }) {
  const hasView = id === 'recent-albums' || id === 'recent-tracks' || id === 'listened-albums'
  return (
    <div
	className="panel"
	style={{ padding: 18, transition: 'box-shadow .18s, border-color .18s', boxShadow: dragging ? '0 22px 50px -16px rgba(0,0,0,.45)' : undefined, borderColor: dragging ? 'color-mix(in srgb, var(--color-accent) 55%, var(--color-border))' : undefined }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, borderBottom: '1px solid var(--color-text)', paddingBottom: 10 }}>
        <span {...handleProps} className="lf-drag-handle mono" style={{ ...handleProps.style, color: dragging ? 'var(--color-accent)' : 'var(--color-faded)', fontSize: 15, lineHeight: 1, userSelect: 'none' }} title="드래그하여 순서 변경">⠿</span>
        <span className="mono" style={{ fontSize: 11.5, fontWeight: 500, letterSpacing: '.1em', textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0 }}>{WIDGET_TITLES[id]}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {id === 'nowplaying' && <Seg value={ctx.npStyle} onChange={v => ctx.setNpStyle(v as NpStyle)} options={[{ v: 'banner', label: '배너' }, { v: 'full', label: '플레이어' }, { v: 'list', label: '리스트' }]} />}
          {hasView && <ViewToggle value={ctx.views[id]} onChange={v => ctx.setView(id, v)} />}
          <button type="button" className="iconbtn danger" title="컴포넌트 제거" onClick={() => onRemove(id)}>✕</button>
        </div>
      </div>
      <WidgetBody id={id} ctx={ctx} />
    </div>
  )
}

/* ── dashboard ───────────────────────────────────────────── */
const DEFAULT_ROWS = (): string[][] => [['nowplaying'], ['recent-albums', 'recent-tracks'], ['listened-albums'], ['bucket']]

export function OverviewDash({ npStyle, setNpStyle, onOpen, goBucket, reviews, onOpenLyrics }: { npStyle: NpStyle, setNpStyle: (s: NpStyle) => void, onOpen: (t: DetailTarget) => void, goBucket: () => void, reviews: MemberReview[], onOpenLyrics?: OnOpenLyrics }) {
  const [rows, setRows] = useState<string[][]>(() => {
    try {
      const s = JSON.parse(localStorage.getItem(OV_ROWS_KEY) || 'null')
      if (Array.isArray(s) && s.length)
        return s.map((r: string[]) => r.filter(x => ALL_WIDGETS.includes(x))).filter((r: string[]) => r.length)
    }
    catch { /* ignore */ }
    return DEFAULT_ROWS()
  })
  const [views, setViews] = useState<Record<string, ViewKey>>(() => {
    try {
      const s = JSON.parse(localStorage.getItem(OV_VIEWS_KEY) || 'null')
      if (s)
        return s
    }
    catch { /* ignore */ }
    return { 'recent-albums': 'grid', 'recent-tracks': 'list', 'listened-albums': 'grid' }
  })
  useEffect(() => {
    try {
      localStorage.setItem(OV_ROWS_KEY, JSON.stringify(rows))
    }
    catch { /* ignore */ }
  }, [rows])
  useEffect(() => {
    try {
      localStorage.setItem(OV_VIEWS_KEY, JSON.stringify(views))
    }
    catch { /* ignore */ }
  }, [views])

  const [addOpen, setAddOpen] = useState(false)
  const addMenuRef = useRef<HTMLDivElement | null>(null)
  const addTriggerRef = useRef<HTMLButtonElement | null>(null)
  const closeAdd = useCallback(() => setAddOpen(false), [])
  // ESC + focus-restore to the trigger (trapFocus off — it's a menu, not a modal).
  useDismissable(addOpen, closeAdd, addMenuRef, { trapFocus: false, autoFocus: false })
  // Outside-pointerdown close (useDismissable doesn't cover outside-click).
  useEffect(() => {
    if (!addOpen)
      return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (addMenuRef.current?.contains(t) || addTriggerRef.current?.contains(t))
        return
      setAddOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [addOpen])
  const ctx: DashCtx = { views, setView: (id, v) => setViews(p => ({ ...p, [id]: v })), onOpen, npStyle, setNpStyle, goBucket, reviews, onOpenLyrics }
  const flat = rows.flat()
  const remove = (id: string) => setRows(prev => prev.map(r => r.filter(x => x !== id)).filter(r => r.length))
  const add = (id: string) => {
    setRows(prev => [...prev, [id]])
    setAddOpen(false)
  }
  const available = ALL_WIDGETS.filter(w => !flat.includes(w))

  return (
    <div>
      <SectionTitle
	kicker="대시보드"
	title="개요"
	right={(
          <div style={{ position: 'relative' }}>
            <button ref={addTriggerRef} type="button" className="btn" onClick={() => setAddOpen(o => !o)} disabled={!available.length} aria-haspopup="menu" aria-expanded={addOpen}>＋ 컴포넌트 추가</button>
            {addOpen && available.length > 0 && (
              <div ref={addMenuRef} role="menu" className="panel" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 30, padding: 6, minWidth: 180, background: 'var(--color-bg)', boxShadow: '0 18px 40px -16px rgba(0,0,0,.4)' }}>
                {available.map(w => (
                  <button key={w} type="button" role="menuitem" onClick={() => add(w)} className="mono" style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', fontSize: 11, letterSpacing: '.04em', textTransform: 'uppercase', background: 'none', border: 'none', color: 'var(--color-text)', cursor: 'pointer', borderRadius: 3 }}>
＋
{WIDGET_TITLES[w]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      />
      {flat.length === 0 ?
        <div className="panel" style={{ padding: 40, textAlign: 'center' }}><span className="meta">컴포넌트 없음</span></div> :
        <RowsBoard rows={rows} setRows={setRows} render={(id, handleProps, dragging) => <Widget id={id} ctx={ctx} onRemove={remove} handleProps={handleProps} dragging={dragging} />} />}
    </div>
  )
}
