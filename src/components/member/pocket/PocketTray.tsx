// FEAT-pocket-buckit Step 1 — the tray dispatcher. Renders the chosen shell
// (F1–F4 editorial / F1L–F4L·F5·F6 light) against the live bucket leaves, with the
// entry control, tree-nav (depth), overflow (more/scroll/search), the chosen
// quick-inspection surface, and bucket-local Undo. A single dispatcher: new shells
// extend the family switch, never fork the tray (mirrors the atlas configurator).
import type { CSSProperties } from 'react'
import type { BoardAlbum } from '@lib/buckets'
import type { PocketBuckitDesign } from '@lib/pocketBuckit/design'
import type { PocketLeaf } from '@lib/pocketBuckit/leaf'
import type { PlaybackTarget } from '@lib/spotifyPlayback'
import { useEffect, useMemo, useState } from 'react'
import { isLoggedIn } from '@lib/auth'
import { engineFamily, isLightDesign } from '@lib/pocketBuckit/design'
import { requestPlayback } from '@lib/spotifyPlayback'
import { usePocket } from './PocketBuckitProvider'

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
    <div className="cover" style={{ width: size, height: size, borderRadius: 3 }}>
      <span className="cover-ph" style={{ fontSize: Math.max(11, size * 0.34) }}>
        {(label || '?').slice(0, 2)}
      </span>
    </div>
  )
}

function PlusTile({ size = 24, dark = false }: { size?: number, dark?: boolean }) {
  return (
    <span
	style={{
        width: size,
        height: size,
        flex: '0 0 auto',
        borderRadius: 2,
        display: 'grid',
        placeItems: 'center',
        background: dark ? 'rgba(245,243,238,.1)' : 'var(--color-paper)',
        border: '1px solid var(--color-border-soft)',
        color: 'var(--color-subtle)',
      }}
    >
      <svg width={Math.round(size * 0.55)} height={Math.round(size * 0.55)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="12" y1="5" x2="12" y2="19" />
<line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </span>
  )
}

function PathCrumb({ path, faded }: { path: string[], faded?: boolean }) {
  return (
    <span className="mono" style={{ fontSize: 9.5, letterSpacing: '.04em', whiteSpace: 'nowrap', color: faded ? 'rgba(245,243,238,.6)' : 'var(--color-faded)' }}>
      {path.map((p, i) => (
        <span key={`${p}-${i}`}>
{i > 0 && <span style={{ opacity: 0.5 }}> / </span>}
{p}
        </span>
      ))}
    </span>
  )
}

// ── editorial target (F1–F4) ─────────────────────────────────────────────────
function EditorialTarget({ leaf, family, onClick }: { leaf: PocketLeaf, family: string, onClick: () => void }) {
  let inner
  if (family === 'f2') {
    inner = (
      <>
        <div className="mono" style={{ fontSize: 8.5, letterSpacing: '.12em', color: 'var(--color-faded)', marginBottom: 5 }}>{leaf.kind === 'review' ? 'BUCKET' : leaf.kind.toUpperCase()}</div>
        <div className="tgt-name" style={{ fontSize: 14 }}>{leaf.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <span className="tgt-cnt" style={{ fontSize: 11 }}>{leaf.n}</span>
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
        <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2 }}>
          <span className="tgt-name" style={{ fontSize: 12.5 }}>{leaf.name}</span>
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ position: 'relative' }}>
            <PlusTile size={24} dark={family === 'f3'} />
            {leaf.processing && <span className="badge-bell">!</span>}
          </span>
          <span className="tgt-cnt" style={{ fontSize: 11.5 }}>{leaf.n}</span>
        </div>
        <div className="tgt-name" style={{ fontSize: 12 }}>{leaf.name}</div>
        <div className="tgt-meta" style={{ marginTop: 3 }}>
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
    <button type="button" className="tgt" onClick={onClick} aria-label={`${leaf.name} 버킷 점검`}>
      {inner}
    </button>
  )
}

// ── light chip / sticker (F1L–F4L, F5, F6) ───────────────────────────────────
function LightChip({ leaf, onClick }: { leaf: PocketLeaf, onClick: () => void }) {
  const acc = accentFor(leaf)
  return (
    <button type="button" className="lchip" onClick={onClick} style={{ '--chip-accent': acc } as CSSProperties} aria-label={`${leaf.name} 버킷 점검`}>
      <span className="lcov"><Cover label={leaf.name} size={30} /></span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="lname">{leaf.name}</span>
        <span className="lsub" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span className="ldot" style={{ background: acc }} />
{leaf.verb}
        </span>
      </span>
      <span className="lbadge" style={{ background: acc }}>{leaf.n}</span>
      {leaf.processing && <span className="proc-dot" style={{ marginLeft: 2 }} />}
    </button>
  )
}

function StickerChip({ leaf, onClick }: { leaf: PocketLeaf, onClick: () => void }) {
  const acc = accentFor(leaf)
  return (
    <button type="button" className="schip" onClick={onClick} style={{ '--chip-accent': acc, background: `color-mix(in srgb, ${acc} 10%, var(--color-bg))` } as CSSProperties} aria-label={`${leaf.name} 버킷 점검`}>
      <span className="stoken" style={{ background: acc }}>{leaf.name.slice(0, 1)}</span>
      <div className="lname" style={{ fontSize: 11.5, whiteSpace: 'normal', lineHeight: 1.1 }}>{leaf.name}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 5 }}>
        <span className="lsub">{leaf.verb}</span>
        <span className="lbadge" style={{ background: acc, fontSize: 10, height: 18, minWidth: 18 }}>{leaf.n}</span>
      </div>
    </button>
  )
}

// ── entry control (idle, closed) ─────────────────────────────────────────────
function EntryControl({ design, count, onOpen }: { design: PocketBuckitDesign, count: number, onOpen: () => void }) {
  const Icon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M4 7l1.5 12a2 2 0 0 0 2 1.8h9a2 2 0 0 0 2-1.8L20 7M9 7V5a3 3 0 0 1 6 0v2" />
    </svg>
  )
  if (design.entry === 'dual-same' || design.entry === 'dual-filtered') {
    const filtered = design.entry === 'dual-filtered'
    return (
      <>
        <button type="button" className="pkt-ctrl" data-variant="tab" style={{ left: 0, bottom: 18, borderRadius: '0 8px 8px 0' }} onClick={onOpen}>
          {Icon}
{filtered ? '듣기' : 'Pocket'}
<span className="cbadge">{count}</span>
        </button>
        <button type="button" className="pkt-ctrl" data-variant="tab" style={{ right: 0, bottom: 18, borderRadius: '8px 0 0 8px' }} onClick={onOpen}>
          {Icon}
{filtered ? '평론' : 'Pocket'}
        </button>
      </>
    )
  }
  return (
    <button type="button" className="pkt-ctrl" style={{ right: 22, bottom: 18 }} onClick={onOpen}>
      {Icon}
Pocket
<span className="cbadge">{count}</span>
    </button>
  )
}

// ── quick-inspection surface (above / card / side / drawer) ───────────────────
function InspectSurface({ design }: { design: PocketBuckitDesign }) {
  const { inspectId, setInspectId, bucketById, removeItem } = usePocket()
  const [notice, setNotice] = useState<string | null>(null)
  // auto-dismiss the play notice a few seconds after it appears
  useEffect(() => {
    if (!notice)
      return
    const t = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(t)
  }, [notice])
  const bucket = inspectId ? bucketById(inspectId) : undefined
  if (!bucket)
    return null
  // FEAT-pocket-buckit Step 5b — explicit play on an item. Token-first; in the
  // dormant v1 this surfaces a "not connected yet" notice and pulls NO SDK (rule #9).
  const onPlay = (a: BoardAlbum) => {
    const target = playbackTargetFor(a)
    if (!target) {
      setNotice('재생할 수 없는 항목이에요.')
      return
    }
    void requestPlayback(target).then(o => setNotice(o.message))
  }
  const cls = design.inspect === 'card' ? 'pb-inspect pb-inspect-card' : design.inspect === 'side' ? 'pb-inspect pb-inspect-side' : design.inspect === 'drawer' ? 'pb-inspect pb-inspect-drawer' : 'pb-inspect'
  const style: CSSProperties = design.inspect === 'side' ?
    {} :
    design.inspect === 'drawer' ?
      { left: '50%', transform: 'translateX(-50%)', bottom: 150, width: 330 } :
      { left: 18, bottom: 150 }
  return (
    <div className={cls} style={style} role="dialog" aria-label={`${bucket.name} 점검`}>
      {design.inspect === 'drawer' && <div className="pb-grabber" />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="mono" style={{ fontSize: 9.5, color: 'var(--color-faded)' }}>{design.inspect === 'side' ? 'SIDE PEEK' : '빠른 점검'}</span>
        <button type="button" className="mono" style={{ fontSize: 11, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-subtle)' }} onClick={() => setInspectId(null)}>닫기 ✕</button>
      </div>
      <div className="serif" style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{bucket.name}</div>
      <div className="sans" style={{ fontSize: 11, color: 'var(--color-subtle)', marginTop: 2 }}>
{bucket.albums.length}
개 · 담기 · 최근 추가순
      </div>
      <div className="rule" style={{ margin: '10px 0', height: 1, background: 'var(--color-border)' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 220, overflowY: 'auto' }}>
        {bucket.albums.slice(0, 8).map(a => (
          <div key={a.itemId} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <button type="button" className="pb-minus" title="버킷에서 제거 (원본은 유지)" onClick={() => void removeItem(bucket.id, a.itemId, a.albumId, a.title)}>−</button>
            <Cover label={a.title} size={26} />
            <span className="serif" style={{ fontSize: 12.5, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</span>
            <span className="tgt-meta">{a.itemType === 'album' ? a.artist : (ITEM_TYPE_LABEL[a.itemType] ?? a.itemType)}</span>
            <button type="button" className="pb-play" title="재생 (Spotify Premium)" aria-label={`${a.title} 재생`} onClick={() => onPlay(a)}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
            </button>
          </div>
        ))}
        {bucket.albums.length === 0 && <span className="sans" style={{ fontSize: 11, color: 'var(--color-faded)' }}>비어 있음 — 드롭 영역으로 유지</span>}
      </div>
      {notice && <div className="pb-playnote" role="status">{notice}</div>}
      <a className="btn" href="/profile" style={{ display: 'block', textAlign: 'center', padding: '7px 0', fontSize: 10, marginTop: 10, textDecoration: 'none' }}>전체 버킷 페이지 열기 ↗</a>
    </div>
  )
}

// ── tree-nav strip (depth) ───────────────────────────────────────────────────
function TreeNav({ folders, folder, setFolder, bottom }: { folders: string[], folder: string | null, setFolder: (f: string | null) => void, bottom: number }) {
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
  const { design, leaves, open, setOpen, setInspectId, undo, runUndo } = usePocket()
  const [folder, setFolder] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const light = isLightDesign(design)
  const fam = engineFamily(design)
  const sticker = design.shell === 'f6'

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

  if (typeof window !== 'undefined' && !isLoggedIn())
    return null

  if (!open)
    return <div className="pb-scope"><EntryControl design={design} count={leaves.length} onOpen={() => setOpen(true)} /></div>

  const trayBottom = light ? (sticker ? 116 : 88) : (fam === 'f4' ? 132 : 104)

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
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      닫기
    </button>
  )

  const rail = capped.map(leaf =>
    light ?
      (sticker ?
          <StickerChip key={leaf.id} leaf={leaf} onClick={() => setInspectId(leaf.id)} /> :
          <LightChip key={leaf.id} leaf={leaf} onClick={() => setInspectId(leaf.id)} />) :
      <EditorialTarget key={leaf.id} leaf={leaf} family={fam} onClick={() => setInspectId(leaf.id)} />,
  )

  const moreChip = moreCount > 0 && (
    <span className={sticker ? 'schip' : light ? 'lchip' : 'tgt'} style={{ display: 'grid', placeItems: 'center', minWidth: 64, opacity: 0.7 }}>
      <span className="mono" style={{ fontSize: 11 }}>
+
{moreCount}
      </span>
    </span>
  )

  return (
    <div className="pb-scope">
      {design.treeDepth >= 1 && <TreeNav folders={folders} folder={folder} setFolder={setFolder} bottom={trayBottom} />}

      {light ?
        (
            <div className={`ltray ltray-${fam}`} style={{ minHeight: sticker ? 116 : 88 }}>
              {!sticker && (
                <div className="ltray-path">
                  <span className="lpath-k">My Buckit</span>
                  <span className="lpath-v">{folder ?? '전체'}</span>
                </div>
              )}
              {design.overflow === 'search' && (
                <input className="lname" value={query} onChange={e => setQuery(e.target.value)} placeholder="버킷 검색…" style={{ flex: '0 0 130px', border: '1px solid var(--color-border)', borderRadius: 16, padding: '5px 12px', background: 'var(--color-bg)' }} />
              )}
              <div className="ltray-rail">
{rail}
{moreChip}
              </div>
              {close}
            </div>
          ) :
        (
            <div className={`tray tray-${fam} ${fam}`} style={{ minHeight: fam === 'f4' ? 132 : 104 }}>
              <div className="tray-path" style={{ borderRight: '1px solid var(--color-border-soft)' }}>
                <span className="mono" style={{ fontSize: 8.5, letterSpacing: '.16em', color: fam === 'f3' || fam === 'f4' ? 'rgba(245,243,238,.6)' : 'var(--color-faded)' }}>MY BUCKIT</span>
                <PathCrumb path={[folder ?? '전체']} faded={fam === 'f3' || fam === 'f4'} />
                {design.overflow === 'search' && (
                  <input value={query} onChange={e => setQuery(e.target.value)} placeholder="검색…" className="mono" style={{ marginTop: 4, width: 110, border: '1px solid var(--color-border)', borderRadius: 2, padding: '3px 6px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 11 }} />
                )}
              </div>
              <div className="tray-rail">
{rail}
{moreChip}
              </div>
              <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', padding: '0 14px', borderLeft: '1px solid var(--color-border-soft)' }}>{close}</div>
            </div>
          )}

      <InspectSurface design={design} />

      {undo && (
        <div className="undo-rib" style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: trayBottom + 14, width: 'auto', borderRadius: 4, zIndex: 73 }}>
          <span>{undo.label}</span>
          <button type="button" onClick={runUndo}>되돌리기</button>
        </div>
      )}
    </div>
  )
}
