// Member dashboard root island (/profile). Owns tab + theme + album-detail
// state. Reviews + profile stats are REAL (server-built, passed as props);
// other surfaces are sample (see lib/member.ts). Ported from app.jsx (the dev
// "tweaks panel" + prototype TopNav are dropped; the site header is the nav).
import type { ChartStyle } from './charts'
import type { NpStyle } from './NowPlaying'
import type { DetailTarget, MemberProfile, MemberReview } from '@lib/member'
import { useEffect, useState } from 'react'
import { AlbumDetail } from './AlbumDetail'
import { BucketBoard } from './BucketBoard'
import { LibraryTab } from './LibraryTab'
import { OverviewDash } from './OverviewDash'
import { ReviewsTab } from './ReviewsTab'
import { StatsTab } from './StatsTab'
import { Avatar, Stat } from './ui'

const TABS = [
  { id: 'overview', label: '개요' },
  { id: 'reviews', label: '평론' },
  { id: 'bucket', label: '평론 버킷' },
  { id: 'library', label: '라이브러리' },
  { id: 'stats', label: '통계' },
]

function StatGrid({ s }: { s: MemberProfile['stats'] }) {
  const items: [string, string | number][] = [
    ['평론', s.reviews],
    ['들은 앨범', s.albums.toLocaleString()],
    ['평균 평점', s.avgRating == null ? '—' : s.avgRating.toFixed(1)],
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px 14px' }}>
      {items.map(([l, v], i) => <Stat key={l} label={l} value={v} accent={i === 2} />)}
    </div>
  )
}

function ProfileSidebar({ u }: { u: MemberProfile }) {
  return (
    <aside style={{ position: 'sticky', top: 20, alignSelf: 'start', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="lf-panel" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Avatar size={80} name={u.name} />
        <div>
          <div className="lf-kicker" style={{ marginBottom: 6 }}>MEMBER · CRITIC</div>
          <h1 className="lf-serif" style={{ fontSize: 30, fontWeight: 500, letterSpacing: '-.02em', lineHeight: 1, margin: 0 }}>{u.name}</h1>
          <div className="lf-mono" style={{ fontSize: 12, color: 'var(--color-subtle)', marginTop: 5 }}>
@
{u.handle}
          </div>
        </div>
        <p className="lf-serif lf-italic" style={{ margin: 0, fontSize: 15, color: 'var(--color-subtle)', lineHeight: 1.55 }}>
“
{u.tagline}
”
        </p>
        <div className="lf-meta" style={{ display: 'flex', gap: 14 }}>
<span>{u.location}</span>
<span>
SINCE
{u.joined}
</span>
        </div>
        <a href="/write" className="lf-btn lf-btn-solid" style={{ textDecoration: 'none' }}>새 평론 쓰기</a>
      </div>
      <div className="lf-panel" style={{ padding: 22 }}><StatGrid s={u.stats} /></div>
    </aside>
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
    <button type="button" onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))} aria-label="테마 전환" className="lf-btn" style={{ padding: '7px 9px', borderRadius: 3 }}>
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

export function ProfileApp({ reviews, profile }: { reviews: MemberReview[], profile: MemberProfile }) {
  const [tab, setTab] = useState('overview')
  const [npStyle, setNpStyle] = useState<NpStyle>('banner')
  const [chartStyle, setChartStyle] = useState<ChartStyle>('bar')
  const [detail, setDetail] = useState<DetailTarget | null>(null)
  const openDetail = (a: DetailTarget) => setDetail(a)

  const tabNav = (
    <div className="lf-mono" style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--color-text)', marginBottom: 26, overflowX: 'auto' }}>
      {TABS.map(tb => (
        <button
	key={tb.id}
	type="button"
	onClick={() => setTab(tb.id)}
	style={{ border: 'none', background: 'none', padding: '11px 14px', fontSize: 11.5, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer', whiteSpace: 'nowrap', color: tab === tb.id ? 'var(--color-text)' : 'var(--color-faded)', borderBottom: tab === tb.id ? '2px solid var(--color-accent)' : '2px solid transparent', marginBottom: -1, transition: 'color .14s' }}
        >
          {tb.label}
        </button>
      ))}
    </div>
  )

  const content = (
    <div key={tab} className="lf-rise">
      {tab === 'overview' && <OverviewDash npStyle={npStyle} setNpStyle={setNpStyle} chartStyle={chartStyle} onOpen={openDetail} goBucket={() => setTab('bucket')} reviews={reviews} />}
      {tab === 'reviews' && <ReviewsTab reviews={reviews} onOpen={openDetail} />}
      {tab === 'bucket' && <BucketBoard onOpen={openDetail} />}
      {tab === 'library' && <LibraryTab onOpen={openDetail} />}
      {tab === 'stats' && <StatsTab chartStyle={chartStyle} setChartStyle={setChartStyle} />}
    </div>
  )

  return (
    <div className="member-root">
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <span className="lf-mono" style={{ fontSize: 11, color: 'var(--color-subtle)' }}>
@
{profile.handle}
        </span>
        <ThemeToggle />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '318px 1fr', gap: 30, alignItems: 'start' }} className="lf-sidebar-grid">
        <ProfileSidebar u={profile} />
        <div>
{tabNav}
{content}
        </div>
      </div>
      {detail && <AlbumDetail album={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

export default ProfileApp
