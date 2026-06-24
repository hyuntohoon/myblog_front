// FEAT-pocket-buckit Step 1 — the tray dispatcher. Renders the chosen shell
// (F1–F4 editorial / F1L–F4L·F5·F6 light) against the live bucket leaves, with the
// entry control, tree-nav (depth), overflow (more/scroll/search), the movable
// quick-inspection drawer, bucket-local Undo, and pointer drag-to-reorder. A single
// dispatcher: new shells extend the family switch, never fork the tray.
//
// SIZE: inline dimensions use sc(px) = `calc(<px> * var(--pb-scale))` so the whole
// layer scales with the one CSS var (and its responsive step-downs). Card sizes,
// thumbnails, gaps, padding, icons, drawer all scale together.
import type { CSSProperties } from 'react'
import type { BoardAlbum } from '@lib/buckets'
import type { DrawerPos } from './PocketBuckitProvider'
import type { PocketBuckitDesign } from '@lib/pocketBuckit/design'
import type { PocketLeaf } from '@lib/pocketBuckit/leaf'
import type { PlaybackTarget } from '@lib/spotifyPlayback'
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { isLoggedIn } from '@lib/auth'
import { engineFamily, isLightDesign } from '@lib/pocketBuckit/design'
import { requestPlayback } from '@lib/spotifyPlayback'
import { usePocket } from './PocketBuckitProvider'

// ── scale helper — every inline px scales with the --pb-scale CSS var ──────────
const SCALE = 'var(--pb-scale, 1)'
const sc = (n: number) => `calc(${n}px * ${SCALE})`

function accentFor(leaf: PocketLeaf): string {
  return leaf.color || 'var(--color-accent)'
}

// FEAT-pocket-buckit Step 5 — a member's kind label, for safely rendering a
// non-album row in quick-inspect (none exist in prod until Step 6; this is the
// forward-compat fallback so a generalized row never renders blank).
const ITEM_TYPE_LABEL: Record<string, string> = {
  track: '트랙',
  review: '평론',
  playback: '재생',
  snapshot: '스냅샷',
}

// FEAT-pocket-buckit Step 5b — a bucket item → a provider-neutral play target.
// Prod rows are all `album` (track members are forward-compat until Step 6).
function playbackTargetFor(a: BoardAlbum): PlaybackTarget | null {
  if (a.itemType === 'track' && a.trackId)
    return { kind: 'track', trackId: a.trackId, title: a.title }
  if (a.albumId)
    return { kind: 'album', albumId: a.albumId, title: a.title }
  return null
}

function Cover({ label, size }: { label: string, size: number }) {
  return (
    <div className="cover" style={{ width: sc(size), height: sc(size), borderRadius: sc(3) }}>
      <span className="cover-ph" style={{ fontSize: sc(Math.max(11, size * 0.34)) }}>
        {(label || '?').slice(0, 2)}
      </span>
    </div>
  )
}

function PlusTile({ size = 24, dark = false }: { size?: number, dark?: boolean }) {
  return (
    <span
	style={{
        width: sc(size),
        height: sc(size),
        flex: '0 0 auto',
        borderRadius: sc(2),
        display: 'grid',
        placeItems: 'center',
        background: dark ? 'rgba(245,243,238,.1)' : 'var(--color-paper)',
        border: '1px solid var(--color-border-soft)',
        color: 'var(--color-subtle)',
      }}
    >
      <svg width={`calc(${Math.round(size * 0.55)}px * ${SCALE})`} height={`calc(${Math.round(size * 0.55)}px * ${SCALE})`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="12" y1="5" x2="12" y2="19" />
<line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </span>
  )
}

function PathCrumb({ path, faded }: { path: string[], faded?: boolean }) {
  return (
    <span className="mono" style={{ fontSize: sc(9.5), letterSpacing: '.04em', whiteSpace: 'nowrap', color: faded ? 'rgba(245,243,238,.6)' : 'var(--color-faded)' }}>
      {path.map((p, i) => (
        <span key={`${p}-${i}`}>
{i > 0 && <span style={{ opacity: 0.5 }}> / </span>}
{p}
        </span>
      ))}
    </span>
  )
}

// shared drag/click props attached to a chip's button (the drag + open target).
interface ChipDrag {
  active?: boolean
  onOpen: () => void
  bind: {
    onPointerDown: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
    onPointerUp: (e: React.PointerEvent) => void
    onKeyDown: (e: React.KeyboardEvent) => void
  }
}

// ── editorial target (F1–F4) ─────────────────────────────────────────────────
function EditorialTarget({ leaf, family, active, onOpen, bind }: { leaf: PocketLeaf, family: string } & ChipDrag) {
  let inner
  if (family === 'f2') {
    inner = (
      <>
        <div className="mono" style={{ fontSize: sc(8.5), letterSpacing: '.12em', color: 'var(--color-faded)', marginBottom: sc(5) }}>{leaf.kind === 'review' ? 'BUCKET' : leaf.kind.toUpperCase()}</div>
        <div className="tgt-name" style={{ fontSize: sc(14) }}>{leaf.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: sc(6), marginTop: sc(6) }}>
          <span className="tgt-cnt" style={{ fontSize: sc(11) }}>{leaf.n}</span>
          <span className="tgt-meta">{leaf.accepts}</span>
          {leaf.processing && <span className="proc-dot" />}
        </div>
      </>
    )
  }
  else if (family === 'f4') {
    inner = (
      <>
        <span style={{ position: 'relative' }}>
          <Cover label={leaf.name} size={36} />
          {leaf.processing && <span className="badge-bell">!</span>}
        </span>
        <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: sc(2) }}>
          <span className="tgt-name" style={{ fontSize: sc(12.5) }}>{leaf.name}</span>
          <span className="tgt-meta">
{leaf.verb}
{' '}
·
{' '}
{leaf.n}
          </span>
        </span>
      </>
    )
  }
  else {
    inner = (
      <>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: sc(6) }}>
          <span style={{ position: 'relative' }}>
            <PlusTile size={24} dark={family === 'f3'} />
            {leaf.processing && <span className="badge-bell">!</span>}
          </span>
          <span className="tgt-cnt" style={{ fontSize: sc(11.5) }}>{leaf.n}</span>
        </div>
        <div className="tgt-name" style={{ fontSize: sc(12) }}>{leaf.name}</div>
        <div className="tgt-meta" style={{ marginTop: sc(3) }}>
{leaf.verb}
{' '}
·
{' '}
{leaf.accepts}
        </div>
      </>
    )
  }
  return (
    <button type="button" className="tgt" data-active={active || undefined} onClick={onOpen} {...bind} style={{ '--chip-accent': accentFor(leaf) } as CSSProperties} aria-label={`${leaf.name} 버킷 열기`}>
      {inner}
    </button>
  )
}

// ── light chip / sticker (F1L–F4L, F5, F6) ───────────────────────────────────
function LightChip({ leaf, active, onOpen, bind }: { leaf: PocketLeaf } & ChipDrag) {
  const acc = accentFor(leaf)
  return (
    <button type="button" className="lchip" data-active={active || undefined} onClick={onOpen} {...bind} style={{ '--chip-accent': acc } as CSSProperties} aria-label={`${leaf.name} 버킷 열기`}>
      <span className="lcov"><Cover label={leaf.name} size={30} /></span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: sc(2) }}>
        <span className="lname">{leaf.name}</span>
        <span className="lsub" style={{ display: 'flex', alignItems: 'center', gap: sc(5) }}>
          <span className="ldot" style={{ background: acc }} />
{leaf.verb}
        </span>
      </span>
      <span className="lbadge" style={{ background: acc }}>{leaf.n}</span>
      {leaf.processing && <span className="proc-dot" style={{ marginLeft: sc(2) }} />}
    </button>
  )
}

function StickerChip({ leaf, active, onOpen, bind }: { leaf: PocketLeaf } & ChipDrag) {
  const acc = accentFor(leaf)
  return (
    <button type="button" className="schip" data-active={active || undefined} onClick={onOpen} {...bind} style={{ '--chip-accent': acc, background: `color-mix(in srgb, ${acc} 10%, var(--color-bg))` } as CSSProperties} aria-label={`${leaf.name} 버킷 열기`}>
      <span className="stoken" style={{ background: acc }}>{leaf.name.slice(0, 1)}</span>
      <div className="lname" style={{ fontSize: sc(11.5), whiteSpace: 'normal', lineHeight: 1.1 }}>{leaf.name}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: sc(5) }}>
        <span className="lsub">{leaf.verb}</span>
        <span className="lbadge" style={{ background: acc, fontSize: sc(10), height: sc(18), minWidth: sc(18) }}>{leaf.n}</span>
      </div>
    </button>
  )
}

// ── entry control (idle, closed) ─────────────────────────────────────────────
function EntryControl({ design, count, onOpen }: { design: PocketBuckitDesign, count: number, onOpen: () => void }) {
  const Icon = (
    <svg width={sc(14)} height={sc(14)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M4 7l1.5 12a2 2 0 0 0 2 1.8h9a2 2 0 0 0 2-1.8L20 7M9 7V5a3 3 0 0 1 6 0v2" />
    </svg>
  )
  if (design.entry === 'dual-same' || design.entry === 'dual-filtered') {
    const filtered = design.entry === 'dual-filtered'
    return (
      <>
        <button type="button" className="pkt-ctrl" data-variant="tab" style={{ left: 0, bottom: sc(18), borderRadius: '0 8px 8px 0' }} onClick={onOpen}>
          {Icon}
{filtered ? '듣기' : 'Pocket'}
<span className="cbadge">{count}</span>
        </button>
        <button type="button" className="pkt-ctrl" data-variant="tab" style={{ right: 0, bottom: sc(18), borderRadius: '8px 0 0 8px' }} onClick={onOpen}>
          {Icon}
{filtered ? '평론' : 'Pocket'}
        </button>
      </>
    )
  }
  return (
    <button type="button" className="pkt-ctrl" style={{ right: sc(22), bottom: sc(18) }} onClick={onOpen}>
      {Icon}
Pocket
<span className="cbadge">{count}</span>
    </button>
  )
}

// ── viewport-clamped drawer position ──────────────────────────────────────────
const DRAWER_MARGIN = 8
function clampDrawer(p: DrawerPos, w: number, h: number): DrawerPos {
  if (typeof window === 'undefined')
    return p
  const maxX = Math.max(DRAWER_MARGIN, window.innerWidth - w - DRAWER_MARGIN)
  const maxY = Math.max(DRAWER_MARGIN, window.innerHeight - h - DRAWER_MARGIN)
  return {
    x: Math.min(Math.max(p.x, DRAWER_MARGIN), maxX),
    y: Math.min(Math.max(p.y, DRAWER_MARGIN), maxY),
  }
}
// initial spot per the design's inspect axis (used only when nothing is persisted)
function defaultDrawer(w: number, h: number, inspect: PocketBuckitDesign['inspect']): DrawerPos {
  if (typeof window === 'undefined')
    return { x: DRAWER_MARGIN, y: DRAWER_MARGIN }
  const vw = window.innerWidth
  const vh = window.innerHeight
  const aboveTray = vh - h - 150
  if (inspect === 'side')
    return clampDrawer({ x: vw - w - 16, y: 80 }, w, h)
  if (inspect === 'drawer')
    return clampDrawer({ x: (vw - w) / 2, y: aboveTray }, w, h)
  return clampDrawer({ x: 18, y: aboveTray }, w, h) // above / card → near the tray, left
}

// ── movable mini drawer (quick-inspection + move actions) ─────────────────────
function InspectSurface({ design }: { design: PocketBuckitDesign }) {
  const { inspectId, setInspectId, bucketById, removeItem, drawerPos, setDrawerPos } = usePocket()
  const panelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ dx: number, dy: number } | null>(null)
  const [pos, setPos] = useState<DrawerPos | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const posRef = useRef<DrawerPos | null>(null)
  posRef.current = pos // mirror so the resize handler reads fresh pos without an impure updater

  const bucket = inspectId ? bucketById(inspectId) : undefined
  const bucketKey = bucket?.id ?? null

  // auto-dismiss the play notice
  useEffect(() => {
    if (!notice)
      return
    const t = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(t)
  }, [notice])

  // on open (or bucket switch): place from the persisted position (re-clamped to
  // the live viewport so a stale off-screen coord is corrected) or the default.
  useLayoutEffect(() => {
    if (!bucketKey)
      return
    const el = panelRef.current
    if (!el)
      return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const init = drawerPos ? clampDrawer(drawerPos, w, h) : defaultDrawer(w, h, design.inspect)
    setPos(init)
    if (!drawerPos || init.x !== drawerPos.x || init.y !== drawerPos.y)
      setDrawerPos(init)
    // Intentionally keyed on bucketKey only: re-place on open / bucket switch,
    // not on every drawerPos change (the drag updates pos locally).
  }, [bucketKey])

  // keep it on-screen across viewport resizes
  useEffect(() => {
    if (!bucketKey)
      return
    const onResize = () => {
      const el = panelRef.current
      if (!el || !posRef.current)
        return
      const c = clampDrawer(posRef.current, el.offsetWidth, el.offsetHeight)
      setPos(c)
      setDrawerPos(c)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [bucketKey, setDrawerPos])

  if (!bucket)
    return null

  const accent = bucket.color || 'var(--color-accent)'

  const onHeadDown = (e: React.PointerEvent) => {
    const el = panelRef.current
    if (!el)
      return
    const r = el.getBoundingClientRect()
    dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top }
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onHeadMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    const el = panelRef.current
    if (!d || !el)
      return
    setPos(clampDrawer({ x: e.clientX - d.dx, y: e.clientY - d.dy }, el.offsetWidth, el.offsetHeight))
  }
  const onHeadUp = () => {
    if (dragRef.current && pos)
      setDrawerPos(pos)
    dragRef.current = null
  }

  // FEAT-pocket-buckit Step 5b — explicit play (token-first; dormant in v1).
  const onPlay = (a: BoardAlbum) => {
    const target = playbackTargetFor(a)
    if (!target) {
      setNotice('재생할 수 없는 항목이에요.')
      return
    }
    void requestPlayback(target).then(o => setNotice(o.message))
  }

  const cls = design.inspect === 'card' ? 'pb-inspect pb-inspect-card' : 'pb-inspect'
  const style: CSSProperties = {
    left: pos?.x ?? 16,
    top: pos?.y ?? 16,
    visibility: pos ? 'visible' : 'hidden',
    '--bucket-accent': accent,
  } as CSSProperties

  return (
    <div ref={panelRef} className={cls} style={style} role="dialog" aria-label={`${bucket.name} 점검`}>
      <div className="pb-dhead" onPointerDown={onHeadDown} onPointerMove={onHeadMove} onPointerUp={onHeadUp}>
        <span className="pb-dhandle">
          <span className="pb-dgrip" aria-hidden="true">
<i />
<i />
<i />
          </span>
          {bucket.name}
        </span>
        <button type="button" className="mono" style={{ fontSize: sc(11), border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-subtle)' }} onClick={() => setInspectId(null)} aria-label="닫기">닫기 ✕</button>
      </div>
      <div className="sans" style={{ fontSize: sc(11), color: 'var(--color-subtle)' }}>
{bucket.albums.length}
개 · 담기 · 최근 추가순
      </div>
      <div className="rule" style={{ margin: `${sc(10)} 0`, height: 1, background: 'color-mix(in srgb, var(--bucket-accent) 20%, var(--color-border))' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: sc(7), maxHeight: sc(220), overflowY: 'auto' }}>
        {bucket.albums.slice(0, 8).map(a => (
          <div key={a.itemId} style={{ display: 'flex', alignItems: 'center', gap: sc(9) }}>
            <button type="button" className="pb-minus" title="버킷에서 제거 (원본은 유지)" onClick={() => void removeItem(bucket.id, a.itemId, a.albumId, a.title)}>−</button>
            <Cover label={a.title} size={26} />
            <span className="serif" style={{ fontSize: sc(12.5), flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</span>
            <span className="tgt-meta">{a.itemType === 'album' ? a.artist : (ITEM_TYPE_LABEL[a.itemType] ?? a.itemType)}</span>
            <button type="button" className="pb-play" title="재생 (Spotify Premium)" aria-label={`${a.title} 재생`} onClick={() => onPlay(a)}>
              <svg width={sc(9)} height={sc(9)} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
            </button>
          </div>
        ))}
        {bucket.albums.length === 0 && <span className="sans" style={{ fontSize: sc(11), color: 'var(--color-faded)' }}>비어 있음 — 드롭 영역으로 유지</span>}
      </div>
      {notice && <div className="pb-playnote" role="status">{notice}</div>}
      <a className="btn" href="/profile" style={{ display: 'block', textAlign: 'center', padding: `${sc(7)} 0`, fontSize: sc(10), marginTop: sc(10), textDecoration: 'none', borderColor: 'color-mix(in srgb, var(--bucket-accent) 40%, var(--color-border))' }}>전체 버킷 페이지 열기 ↗</a>
    </div>
  )
}

// ── tree-nav strip (depth) ───────────────────────────────────────────────────
function TreeNav({ folders, folder, setFolder, bottom }: { folders: string[], folder: string | null, setFolder: (f: string | null) => void, bottom: string }) {
  if (folders.length <= 1)
    return null
  return (
    <div className="pb-tree" style={{ bottom }}>
      <span className="lpath-k">MY BUCKIT</span>
      <button type="button" className="pb-fchip" data-on={folder === null} onClick={() => setFolder(null)}>전체</button>
      {folders.map(f => (
        <button type="button" key={f} className="pb-fchip" data-on={folder === f} onClick={() => setFolder(folder === f ? null : f)}>
{f}
{' '}
▸
        </button>
      ))}
    </div>
  )
}

// ── the dispatcher ───────────────────────────────────────────────────────────
export function PocketTray() {
  const { design, leaves, open, setOpen, inspectId, setInspectId, undo, runUndo, reorderBucket } = usePocket()
  const [folder, setFolder] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const light = isLightDesign(design)
  const fam = engineFamily(design)
  const sticker = design.shell === 'f6'
  // manual order only in the UNFILTERED WYSIWYG (position) view — a folder/search
  // filter narrows the rail, so the index would land relative to hidden roots.
  const canReorder = design.order === 'pinned' && !folder && !(design.overflow === 'search' && query.trim())

  const folders = useMemo(() => Array.from(new Set(leaves.map(l => l.path[0]).filter(Boolean))), [leaves])

  const shown = useMemo(() => {
    let ls = leaves
    if (design.treeDepth >= 1 && folder)
      ls = ls.filter(l => l.path[0] === folder)
    if (design.overflow === 'search' && query.trim())
      ls = ls.filter(l => l.name.toLowerCase().includes(query.trim().toLowerCase()))
    return ls
  }, [leaves, folder, design.treeDepth, design.overflow, query])

  const capped = design.overflow === 'more' ? shown.slice(0, 6) : shown
  const moreCount = shown.length - capped.length

  // ── drag-to-reorder state (pointer-based; works for mouse + touch) ──────────
  const railRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<{ x: number, y: number, id: string, moved: boolean } | null>(null)
  const dropRef = useRef<{ overId: string | null, place: 'before' | 'after' } | null>(null)
  const suppressClick = useRef(false)
  const pendingFocus = useRef<string | null>(null)
  const [drag, setDrag] = useState<{ id: string, overId: string | null, place: 'before' | 'after' } | null>(null)
  const [liveMsg, setLiveMsg] = useState('')

  // a11y: after a keyboard reorder, return focus to the moved chip once it re-renders.
  useEffect(() => {
    const id = pendingFocus.current
    if (!id)
      return
    pendingFocus.current = null
    railRef.current?.querySelector<HTMLButtonElement>(`[data-chip-id="${id}"] button`)?.focus()
  }, [leaves])

  const openChip = (id: string) => {
    if (suppressClick.current) { // a drag just ended — its trailing click must not open
      suppressClick.current = false
      return
    }
    setInspectId(id)
  }
  const onChipDown = (e: React.PointerEvent, id: string) => {
    suppressClick.current = false // clear any stale guard (a prior drag may not have emitted a click)
    if (!canReorder)
      return
    startRef.current = { x: e.clientX, y: e.clientY, id, moved: false }
    dropRef.current = null
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onChipMove = (e: React.PointerEvent) => {
    const s = startRef.current
    if (!s)
      return
    if (!s.moved && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 6)
      return
    s.moved = true
    const rail = railRef.current
    if (!rail)
      return
    const wraps = Array.from(rail.querySelectorAll<HTMLElement>('[data-chip-id]'))
    let overId: string | null = null
    let place: 'before' | 'after' = 'before'
    for (const w of wraps) {
      const r = w.getBoundingClientRect()
      if (e.clientX >= r.left && e.clientX <= r.right) {
        overId = w.dataset.chipId ?? null
        place = e.clientX < r.left + r.width / 2 ? 'before' : 'after'
        break
      }
    }
    if (!overId && wraps.length) {
      const first = wraps[0].getBoundingClientRect()
      if (e.clientX < first.left) {
        overId = wraps[0].dataset.chipId ?? null
        place = 'before'
      }
      else {
        overId = wraps[wraps.length - 1].dataset.chipId ?? null
        place = 'after'
      }
    }
    const drop = { overId: overId === s.id ? null : overId, place }
    dropRef.current = drop // mirror to a ref so pointerup never depends on state-commit timing
    setDrag({ id: s.id, overId: drop.overId, place })
  }
  const onChipUp = () => {
    const s = startRef.current
    startRef.current = null
    const drop = dropRef.current
    dropRef.current = null
    setDrag(null)
    if (s?.moved) {
      suppressClick.current = true // the click that trails a drag must not open the drawer
      if (drop?.overId) {
        void reorderBucket(s.id, drop.overId, drop.place)
        setLiveMsg(`${leaves.find(l => l.id === s.id)?.name ?? '버킷'} 위치를 옮겼어요`)
      }
    }
  }
  const onChipKey = (e: React.KeyboardEvent, id: string) => {
    if (!canReorder || !e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight'))
      return
    e.preventDefault()
    const idx = capped.findIndex(l => l.id === id)
    const tgt = e.key === 'ArrowLeft' ? idx - 1 : idx + 1
    if (tgt < 0 || tgt >= capped.length)
      return
    pendingFocus.current = id
    setLiveMsg(`${capped[idx]?.name ?? '버킷'}을(를) ${e.key === 'ArrowLeft' ? '왼쪽' : '오른쪽'}으로 옮겼어요`)
    void reorderBucket(id, capped[tgt].id, e.key === 'ArrowLeft' ? 'before' : 'after')
  }
  const bindFor = (leaf: PocketLeaf) => ({
    onPointerDown: (e: React.PointerEvent) => onChipDown(e, leaf.id),
    onPointerMove: onChipMove,
    onPointerUp: onChipUp,
    onKeyDown: (e: React.KeyboardEvent) => onChipKey(e, leaf.id),
  })

  if (typeof window !== 'undefined' && !isLoggedIn())
    return null

  if (!open)
    return <div className="pb-scope"><EntryControl design={design} count={leaves.length} onOpen={() => setOpen(true)} /></div>

  const trayBottom = sc(light ? (sticker ? 116 : 88) : (fam === 'f4' ? 132 : 104))

  const close = (
    <button
	type="button"
	className={light ? 'lpill is-static' : 'pkt-ctrl is-static'}
	data-variant={fam === 'f1' || fam === 'f2' ? 'ghost' : 'solid'}
	onClick={() => {
          setOpen(false)
          setInspectId(null)
        }}
	style={light ? { background: 'color-mix(in srgb, #fff 55%, transparent)' } : undefined}
    >
      <svg width={sc(12)} height={sc(12)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      닫기
    </button>
  )

  const rail = capped.map((leaf) => {
    const active = inspectId === leaf.id
    const isDragging = drag?.id === leaf.id
    const chip = light ?
      (sticker ?
          <StickerChip leaf={leaf} active={active} onOpen={() => openChip(leaf.id)} bind={bindFor(leaf)} /> :
          <LightChip leaf={leaf} active={active} onOpen={() => openChip(leaf.id)} bind={bindFor(leaf)} />) :
      <EditorialTarget leaf={leaf} family={fam} active={active} onOpen={() => openChip(leaf.id)} bind={bindFor(leaf)} />
    return (
      <Fragment key={leaf.id}>
        {drag?.overId === leaf.id && drag.place === 'before' && <span className="pb-drop-line" />}
        <span data-chip-id={leaf.id} className={isDragging ? 'pb-chip-drag' : undefined} style={{ display: 'inline-flex', flex: '0 0 auto', alignItems: 'flex-end', touchAction: canReorder ? 'none' : undefined }}>
          {chip}
        </span>
        {drag?.overId === leaf.id && drag.place === 'after' && <span className="pb-drop-line" />}
      </Fragment>
    )
  })

  const moreChip = moreCount > 0 && (
    <span className={sticker ? 'schip' : light ? 'lchip' : 'tgt'} style={{ display: 'grid', placeItems: 'center', minWidth: sc(64), opacity: 0.7 }}>
      <span className="mono" style={{ fontSize: sc(11) }}>
+
{moreCount}
      </span>
    </span>
  )

  return (
    <div className="pb-scope" data-reordering={drag ? 'true' : undefined} data-can-reorder={canReorder ? 'true' : undefined}>
      <span role="status" aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }}>{liveMsg}</span>
      {design.treeDepth >= 1 && <TreeNav folders={folders} folder={folder} setFolder={setFolder} bottom={trayBottom} />}

      {light ?
        (
            <div className={`ltray ltray-${fam}`} style={{ minHeight: sc(sticker ? 116 : 88) }}>
              {!sticker && (
                <div className="ltray-path">
                  <span className="lpath-k">My Buckit</span>
                  <span className="lpath-v">{folder ?? '전체'}</span>
                </div>
              )}
              {design.overflow === 'search' && (
                <input className="lname" value={query} onChange={e => setQuery(e.target.value)} placeholder="버킷 검색…" style={{ flex: '0 0 130px', border: '1px solid var(--color-border)', borderRadius: sc(16), padding: `${sc(5)} ${sc(12)}`, background: 'var(--color-bg)' }} />
              )}
              <div className="ltray-rail" ref={railRef}>
{rail}
{moreChip}
              </div>
              {close}
            </div>
          ) :
        (
            <div className={`tray tray-${fam} ${fam}`} style={{ minHeight: sc(fam === 'f4' ? 132 : 104) }}>
              <div className="tray-path" style={{ borderRight: '1px solid var(--color-border-soft)' }}>
                <span className="mono" style={{ fontSize: sc(8.5), letterSpacing: '.16em', color: fam === 'f3' || fam === 'f4' ? 'rgba(245,243,238,.6)' : 'var(--color-faded)' }}>MY BUCKIT</span>
                <PathCrumb path={[folder ?? '전체']} faded={fam === 'f3' || fam === 'f4'} />
                {design.overflow === 'search' && (
                  <input value={query} onChange={e => setQuery(e.target.value)} placeholder="검색…" className="mono" style={{ marginTop: sc(4), width: sc(110), border: '1px solid var(--color-border)', borderRadius: sc(2), padding: `${sc(3)} ${sc(6)}`, background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: sc(11) }} />
                )}
              </div>
              <div className="tray-rail" ref={railRef}>
{rail}
{moreChip}
              </div>
              <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', padding: `0 ${sc(14)}`, borderLeft: '1px solid var(--color-border-soft)' }}>{close}</div>
            </div>
          )}

      <InspectSurface design={design} />

      {undo && (
        <div className="undo-rib" style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: `calc(${trayBottom} + ${sc(14)})`, width: 'auto', borderRadius: sc(4), zIndex: 73 }}>
          <span>{undo.label}</span>
          <button type="button" onClick={runUndo}>되돌리기</button>
        </div>
      )}
    </div>
  )
}
