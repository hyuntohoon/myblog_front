// Member dashboard root island (/profile). Owns tab + theme + album-detail
// state. Reviews + profile stats are REAL (server-built, passed as props);
// other surfaces are sample (see lib/member.ts). Ported from app.jsx (the dev
// "tweaks panel" + prototype TopNav are dropped; the site header is the nav).
import type { ReactNode } from 'react'
import type { LyricsOpenTarget, NpStyle } from './NowPlaying'
import type { DetailTarget, MemberProfile, MemberReview } from '@lib/member'
import { useEffect, useRef, useState } from 'react'
import { AlbumDetail } from './AlbumDetail'
import { BucketBoard } from './BucketBoard'
import { LyricsViewer } from './lyrics/LyricsViewer'
import { OverviewDash } from './OverviewDash'
import { ReviewsTab } from './ReviewsTab'
import { SpotifyIntegrationTab } from './SpotifyIntegrationTab'
import { StatsTab } from './StatsTab'
import { Avatar, Stat } from './ui'

const TABS = [
  { id: 'overview', label: '개요' },
  { id: 'reviews', label: '평론' },
  { id: 'bucket', label: 'My Buckit' },
  { id: 'stats', label: '분석 버킷' },
  { id: 'integration', label: '연동' },
]
const TAB_IDS = TABS.map(t => t.id)

/**
 * Initial tab from the URL (`?tab=<id>` or `#<id>`), so the dedicated `/buckets`
 * route (→ `/profile/?tab=bucket`) and any deep link land directly on the right
 * tab. Falls back to 'overview' on a miss / unknown id. Client-only island, so
 * `window` is available at first render.
 */
function initialTab(): string {
  if (typeof window === 'undefined')
    return 'overview'
  try {
    const q = new URLSearchParams(window.location.search).get('tab')
    const want = q || window.location.hash.replace(/^#/, '')
    if (want && TAB_IDS.includes(want))
      return want
  }
  catch { /* ignore */ }
  return 'overview'
}

/* ── view preferences (layout + density), persisted to localStorage ──────── */
type Layout = 'sidebar' | 'stacked' | 'dashboard'
type Density = 'compact' | 'regular' | 'comfy'

const LAYOUT_KEY = 'lf_layout'
const DENSITY_KEY = 'lf_density'
const NP_STYLE_KEY = 'lf_np_style'
const NP_STYLE_OPTS = ['banner', 'full', 'list'] as const

const LAYOUT_OPTS: { v: Layout, label: string }[] = [
  { v: 'sidebar', label: '사이드바' },
  { v: 'stacked', label: '에디토리얼' },
  { v: 'dashboard', label: '대시보드' },
]
const DENSITY_OPTS: { v: Density, label: string }[] = [
  { v: 'compact', label: '콤팩트' },
  { v: 'regular', label: '보통' },
  { v: 'comfy', label: '넓게' },
]

/** Read a persisted enum pref, falling back when storage/value is unusable. */
function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof localStorage === 'undefined')
    return fallback
  try {
    const v = localStorage.getItem(key)
    if (v && (allowed as readonly string[]).includes(v))
      return v as T
  }
  catch { /* ignore */ }
  return fallback
}

function STAT_ITEMS(s: MemberProfile['stats']): [string, string | number][] {
  return [
  ['평론', s.reviews],
  ['평론한 앨범', s.albums.toLocaleString()],
  ['평균 평점', s.avgRating == null ? '—' : s.avgRating.toFixed(1)],
]
}

/** Stacked stat grid for the sidebar panel. */
function StatGrid({ s }: { s: MemberProfile['stats'] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px 14px' }}>
      {STAT_ITEMS(s).map(([l, v], i) => <Stat key={l} label={l} value={v} accent={i === 2} />)}
    </div>
  )
}

/**
 * Horizontal stat row for the hero / bar layouts. The prototype showed six
 * stats; the three social ones (followers/following/lists) stay hidden in
 * Step 1 (RFC non-goal: hidden, not faked), so we lay out the real three.
 */
function StatRow({ s }: { s: MemberProfile['stats'] }) {
  const items = STAT_ITEMS(s)
  return (
    <div style={{ display: 'flex', gap: 'clamp(22px, 5vw, 52px)', flexWrap: 'wrap' }}>
      {items.map(([l, v], i) => <Stat key={l} label={l} value={v} accent={i === items.length - 1} />)}
    </div>
  )
}

function ProfileSidebar({ u }: { u: MemberProfile }) {
  return (
    <aside style={{ position: 'sticky', top: 20, alignSelf: 'start', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Avatar size={80} name={u.name} />
        <div>
          <h1 className="serif" style={{ fontSize: 30, fontWeight: 500, letterSpacing: '-.02em', lineHeight: 1, margin: 0 }}>{u.name}</h1>
          <div className="mono" style={{ fontSize: 12, color: 'var(--color-subtle)', marginTop: 5 }}>
@
{u.handle}
          </div>
        </div>
        <div className="meta" style={{ display: 'flex', gap: 14 }}>
<span>{u.location}</span>
<span>
SINCE
{u.joined}
</span>
        </div>
        <a href="/write" className="btn btn-solid" style={{ textDecoration: 'none' }}>새 평론 쓰기</a>
      </div>
      <div className="panel" style={{ padding: 22 }}><StatGrid s={u.stats} /></div>
    </aside>
  )
}

/** Editorial layout header: full-width hero with a big serif headline. */
function ProfileHero({ u }: { u: MemberProfile }) {
  return (
    <header style={{ display: 'flex', flexDirection: 'column', gap: 22, borderBottom: '1px solid var(--color-text)', paddingBottom: 28, marginBottom: 30 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
        <Avatar size={88} name={u.name} />
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 className="serif" style={{ fontSize: 'clamp(34px, 6vw, 52px)', fontWeight: 500, letterSpacing: '-.025em', lineHeight: 1, margin: 0 }}>{u.name}</h1>
        </div>
        <a href="/write" className="btn btn-solid" style={{ textDecoration: 'none', alignSelf: 'flex-start' }}>새 평론 쓰기</a>
      </div>
      <StatRow s={u.stats} />
    </header>
  )
}

/** Dashboard layout header: a single compact bar above full-width content. */
function ProfileBar({ u }: { u: MemberProfile }) {
  return (
    <header className="panel" style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '16px 20px', marginBottom: 28, flexWrap: 'wrap' }}>
      <Avatar size={48} name={u.name} />
      <div style={{ minWidth: 130 }}>
        <h1 className="serif" style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-.02em', lineHeight: 1.05, margin: 0 }}>{u.name}</h1>
        <div className="mono" style={{ fontSize: 11, color: 'var(--color-subtle)', marginTop: 3 }}>
          @
          {u.handle}
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 200 }}>
        <StatRow s={u.stats} />
      </div>
      <a href="/write" className="btn btn-solid" style={{ textDecoration: 'none' }}>새 평론 쓰기</a>
    </header>
  )
}

/** A labeled group of mutually-exclusive options inside the settings menu. */
function MenuGroup<T extends string>({ label, value, options, onChange }: { label: string, value: T, options: { v: T, label: string }[], onChange: (v: T) => void }) {
  return (
    <div>
      <div className="kicker" style={{ marginBottom: 8 }}>{label}</div>
      <div className="lf-menu-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
        {options.map(o => (
          <button
	key={o.v}
	type="button"
	onClick={() => onChange(o.v)}
	className="mono"
	aria-pressed={value === o.v}
	style={{
              border: '1px solid var(--color-border)',
              padding: '7px 4px',
              fontSize: 10.5,
              letterSpacing: '0.03em',
              cursor: 'pointer',
              background: value === o.v ? 'var(--color-text)' : 'transparent',
              color: value === o.v ? 'var(--color-bg)' : 'var(--color-text)',
              transition: 'background .14s, color .14s',
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** ⚙ dropdown beside the theme toggle: pick layout + density. */
function SettingsMenu({ layout, setLayout, density, setDensity }: { layout: Layout, setLayout: (v: Layout) => void, density: Density, setDensity: (v: Density) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open)
      return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape')
        setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-label="보기 설정" aria-expanded={open} className="btn" style={{ padding: '7px 9px', borderRadius: 3 }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open && (
        <div
	className="panel"
	role="menu"
	style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 'var(--z-nav)', width: 224, padding: 14, display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 10px 30px rgba(10, 9, 8, 0.16)' }}
        >
          <MenuGroup label="레이아웃" value={layout} options={LAYOUT_OPTS} onChange={setLayout} />
          <MenuGroup label="여백" value={density} options={DENSITY_OPTS} onChange={setDensity} />
        </div>
      )}
    </div>
  )
}

function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'))
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem('theme', theme)
    }
    catch { /* ignore */ }
  }, [theme])
  return (
    <button type="button" onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))} aria-label="테마 전환" className="btn" style={{ padding: '7px 9px', borderRadius: 3 }}>
      {theme === 'dark' ?
(
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
<circle cx="12" cy="12" r="4.5" />
<path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" strokeLinecap="round" />
        </svg>
      ) :
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>}
    </button>
  )
}

/**
 * One tab's content. Mounted on first visit and then KEPT MOUNTED — inactive
 * tabs are hidden with display:none rather than unmounted, so revisiting a tab
 * never refetches data or resets its in-tab state (scroll, filters, open sheets).
 * The lf-rise entrance plays once, on the panel's first appearance; later
 * re-shows skip it (toggling display would otherwise replay the animation).
 */
function TabPanel({ active, children }: { active: boolean, children: ReactNode }) {
  const seenRef = useRef(false)
  const firstShow = active && !seenRef.current
  useEffect(() => {
    if (active)
      seenRef.current = true
  }, [active])
  return (
    <div className={firstShow ? 'lf-rise' : undefined} style={{ display: active ? undefined : 'none' }}>
      {children}
    </div>
  )
}

export function ProfileApp({ reviews, profile }: { reviews: MemberReview[], profile: MemberProfile }) {
  const [tab, setTab] = useState(initialTab)
  // Tabs visited at least once. Each is mounted lazily on first visit and then
  // kept mounted (hidden, not unmounted) so a re-visit never refetches. The
  // functional updater keeps rapid clicks from clobbering the set.
  const [visited, setVisited] = useState<Set<string>>(() => new Set([initialTab()]))
  const selectTab = (id: string) => {
    setTab(id)
    // Keep the URL in sync so the tab is shareable / reload-stable (matches the
    // /buckets deeplink). replaceState — no history spam on tab clicks.
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('tab', id)
      url.hash = ''
      window.history.replaceState(null, '', url)
    }
    catch { /* ignore */ }
    setVisited((v) => {
      if (v.has(id))
        return v
      const next = new Set(v)
      next.add(id)
      return next
    })
  }
  const [npStyle, setNpStyle] = useState<NpStyle>(() => readPref(NP_STYLE_KEY, NP_STYLE_OPTS, 'banner'))
  const [detail, setDetail] = useState<DetailTarget | null>(null)
  // FEAT-lyrics-viewer overlay state (ProfileApp owns overlay mounts — component
  // map). Two entries share one mount:
  //  - Step 3 dynamic entry: NowPlaying's 가사 tap → live track id + one-shot
  //    position, refresh enabled (`live: true`).
  //  - Step 2 debug entry: `?lyrics=<spotify_track_id>` — no playback binding, no
  //    refresh. Closing strips the param so a reload doesn't reopen it.
  const [lyrics, setLyrics] = useState<{ trackId: string, progressMs: number | null, progressAtMs: number | null, durationMs: number | null, albumCoverUrl: string | null, track: string | null, artist: string | null, live: boolean } | null>(() => {
    if (typeof window === 'undefined')
      return null
    try {
      const id = new URLSearchParams(window.location.search).get('lyrics')
      return id ? { trackId: id, progressMs: null, progressAtMs: null, durationMs: null, albumCoverUrl: null, track: null, artist: null, live: false } : null
    }
    catch {
      return null
    }
  })
  const openLyrics = (t: LyricsOpenTarget) => setLyrics({ trackId: t.trackId, progressMs: t.progressMs, progressAtMs: t.progressAtMs, durationMs: t.durationMs, albumCoverUrl: t.albumCoverUrl, track: t.track, artist: t.artist, live: true })
  // ARCH-entity-interaction-contract Step 2 static entry: TrackRow `lyrics`
  // actions (AlbumDetail tracklist / LikedBoard rows) open the same mount
  // non-live — no playback binding, no refresh affordance.
  const openStaticLyrics = (spotifyTrackId: string) => setLyrics({ trackId: spotifyTrackId, progressMs: null, progressAtMs: null, durationMs: null, albumCoverUrl: null, track: null, artist: null, live: false })
  const closeLyrics = () => {
    setLyrics(null)
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('lyrics')
      window.history.replaceState(null, '', url)
    }
    catch { /* ignore */ }
  }
  const [layout, setLayout] = useState<Layout>(() => readPref(LAYOUT_KEY, LAYOUT_OPTS.map(o => o.v), 'sidebar'))
  const [density, setDensity] = useState<Density>(() => readPref(DENSITY_KEY, DENSITY_OPTS.map(o => o.v), 'regular'))
  // Latest in-session memo edits (note / prepTonight) keyed by bucket-item id.
  // The bucket board's BoardAlbum snapshot isn't refreshed after a memo PATCH, so
  // reopening a memo would re-seed from the stale value (and a later note edit
  // could clobber a saved prep_tonight). openDetail merges any fresh edit so the
  // modal always opens on the saved state. See AlbumDetail.useBucketMemo.
  const memoEdits = useRef<Map<string, { note: string | null, prepTonight: boolean }>>(new Map())
  const onMemoSaved = (itemId: string, memo: { note: string | null, prepTonight: boolean }) => {
    memoEdits.current.set(itemId, memo)
  }
  const openDetail = (a: DetailTarget) => {
    const edit = a.itemId ? memoEdits.current.get(a.itemId) : undefined
    setDetail(edit ? { ...a, note: edit.note, prepTonight: edit.prepTonight } : a)
  }

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, layout)
    }
    catch { /* ignore */ }
  }, [layout])
  useEffect(() => {
    try {
      localStorage.setItem(DENSITY_KEY, density)
    }
    catch { /* ignore */ }
  }, [density])
  useEffect(() => {
    try {
      localStorage.setItem(NP_STYLE_KEY, npStyle)
    }
    catch { /* ignore */ }
  }, [npStyle])

  const tabNav = (
    <div className="mono" style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--color-text)', marginBottom: 26, overflowX: 'auto' }}>
      {TABS.map(tb => (
        <button
	key={tb.id}
	type="button"
	className="lf-tab-btn"
	onClick={() => selectTab(tb.id)}
	style={{ border: 'none', background: 'none', padding: '11px 14px', fontSize: 11.5, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer', whiteSpace: 'nowrap', color: tab === tb.id ? 'var(--color-text)' : 'var(--color-faded)', borderBottom: tab === tb.id ? '2px solid var(--color-accent)' : '2px solid transparent', marginBottom: -1, transition: 'color .14s' }}
        >
          {tb.label}
        </button>
      ))}
      {/* FEAT-multi-user-accounts 0e: 계정 설정은 대시보드 탭이 아니라 별도
          /settings 페이지 — 탭줄 끝에 진입 링크만 둔다. */}
      <a
	href="/settings/"
	className="lf-tab-btn"
	style={{ marginLeft: 'auto', padding: '11px 14px', fontSize: 11.5, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap', color: 'var(--color-faded)', textDecoration: 'none', borderBottom: '2px solid transparent', marginBottom: -1, transition: 'color .14s' }}
      >
        설정 ↗
      </a>
    </div>
  )

  // Keep-alive: render every visited tab once and keep it mounted; TabPanel hides
  // the inactive ones with display:none. Stable per-tab keys (NOT key={tab}) stop
  // React from unmounting a tab on switch, so its fetched data + UI state persist.
  // BucketBoard's research poll is gated on `active` so it goes quiet when hidden.
  const panels: { id: string, node: ReactNode }[] = [
    { id: 'overview', node: <OverviewDash npStyle={npStyle} setNpStyle={setNpStyle} onOpen={openDetail} goBucket={() => selectTab('bucket')} reviews={reviews} onOpenLyrics={openLyrics} /> },
    { id: 'reviews', node: <ReviewsTab reviews={reviews} onOpen={openDetail} /> },
    { id: 'bucket', node: <BucketBoard onOpen={openDetail} reviews={reviews} active={tab === 'bucket'} /> },
    { id: 'stats', node: <StatsTab onOpen={openDetail} onOpenLyrics={openStaticLyrics} /> },
    { id: 'integration', node: <SpotifyIntegrationTab /> },
  ]
  const content = (
    <div>
      {panels.map(p => (
        visited.has(p.id) ?
          <TabPanel key={p.id} active={p.id === tab}>{p.node}</TabPanel> :
          null
      ))}
    </div>
  )

  const body = (
    <div>
      {tabNav}
      {content}
    </div>
  )

  return (
    <div className="member-root" data-density={density}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <span className="mono" style={{ fontSize: 11, color: 'var(--color-subtle)' }}>
@
{profile.handle}
        </span>
        <SettingsMenu layout={layout} setLayout={setLayout} density={density} setDensity={setDensity} />
        <ThemeToggle />
      </div>

      {layout === 'sidebar' && (
        <div style={{ display: 'grid', gridTemplateColumns: '318px 1fr', gap: 30, alignItems: 'start' }} className="lf-sidebar-grid">
          <ProfileSidebar u={profile} />
          {body}
        </div>
      )}
      {layout === 'stacked' && (
        <>
          <ProfileHero u={profile} />
          <div style={{ maxWidth: 860, margin: '0 auto' }}>{body}</div>
        </>
      )}
      {layout === 'dashboard' && (
        <>
          <ProfileBar u={profile} />
          {body}
        </>
      )}

      {detail && <AlbumDetail album={detail} reviews={reviews} onClose={() => setDetail(null)} onMemoSaved={onMemoSaved} onOpenLyrics={openStaticLyrics} />}
      {lyrics && <LyricsViewer key={lyrics.trackId} spotifyTrackId={lyrics.trackId} initialProgressMs={lyrics.progressMs} initialProgressAtMs={lyrics.progressAtMs} initialDurationMs={lyrics.durationMs} initialAlbumCoverUrl={lyrics.albumCoverUrl} initialTrack={lyrics.track} initialArtist={lyrics.artist} canRefresh={lyrics.live} onClose={closeLyrics} />}
    </div>
  )
}

export default ProfileApp
