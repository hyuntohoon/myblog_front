// FEAT-multi-user-accounts Phase 1 — public member profile at /members/[handle].
// Public and self-dashboard member profile root, fed by the public reviews API.
// Album titles open the app-wide read-only overlay
// via openAlbum (no member DetailTarget). Seeded from getStaticPaths props so the
// header paints before the runtime feed fetch resolves.
//
// profile→member merge PR1 (OQ5 Option 1): when the AUTHED /api/me handle equals
// the page handle, the member sees their private dashboard tabs (개요 / My
// Buckit / 분석 버킷 / 연동) here, lazy-loaded via React.lazy so anonymous
// visitors never download the dashboard chunks. The public 평가 list stays for
// every viewer. PRIVACY: isSelf comes only from the authed response — token
// presence merely gates the attempt (and avoids apiFetch's login redirect for
// anonymous visitors); any error/401 leaves the page fully public.
import type { MemberNowPlaying, MemberProfile as Profile } from '../album/reviews.api'
import { lazy, Suspense, useEffect, useState } from 'react'
import { isLoggedIn } from '@lib/auth'
import { openAlbum } from '@lib/entityEvents'
import { artistHref } from '@lib/entityLinks'
import { isPlaceholderIdentity } from '@lib/member'
import { fetchMemberNowPlaying, fetchMemberProfile } from '../album/reviews.api'
import { getMe } from './me.api'
import { AlbumArt, Cover, SectionTitle, Stars } from './ui'

// Bundle guard: the dashboard (and everything it drags in — BucketBoard,
// OverviewDash, LikedBoard, member.css …) loads only after isSelf is confirmed
// AND a dashboard tab is first visited.
const SelfDashboard = lazy(() => import('./SelfDashboard'))

// Dashboard tab ids are the authoritative ?tab= deep-link values (same
// convention as the /buckets → ?tab=bucket link). 평론 hosts the runtime
// review feed since merge PR2; 'ratings' is the public 평가한 앨범 list every
// viewer gets.
const DASH_TABS = [
	{ id: 'overview', label: '개요' },
	{ id: 'reviews', label: '평론' },
	{ id: 'bucket', label: 'My Buckit' },
	{ id: 'stats', label: '분석 버킷' },
	{ id: 'integration', label: '연동' },
]
const DASH_TAB_IDS = DASH_TABS.map(t => t.id)
const RATINGS_TAB = 'ratings'

/** Initial tab from `?tab=<id>` — dashboard ids only; anything else → public list. */
function initialTab(): string {
	if (typeof window === 'undefined')
		return RATINGS_TAB
	try {
		const q = new URLSearchParams(window.location.search).get('tab')
		if (q && DASH_TAB_IDS.includes(q))
			return q
	}
	catch { /* ignore */ }
	return RATINGS_TAB
}

function fmtDate(iso: string): string {
	const d = new Date(iso)
	if (Number.isNaN(d.getTime()))
		return ''
	return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

function Avatar({ url, name, size = 64 }: { url?: string | null, name: string, size?: number }) {
	if (url) {
		return <img src={url} alt={name} width={size} height={size} style={{ borderRadius: '50%', objectFit: 'cover', flex: '0 0 auto' }} />
	}
	const initial = (name.trim()[0] ?? '?').toUpperCase()
	return (
		<div
			aria-hidden="true"
			style={{ width: size, height: size, borderRadius: '50%', flex: '0 0 auto', display: 'grid', placeItems: 'center', background: 'var(--color-border-soft)', color: 'var(--color-subtle)', fontSize: size * 0.4, fontWeight: 600 }}
		>
			{initial}
		</div>
	)
}

// The member's public now-playing strip (FEAT-multi-user Phase 3a follow-on).
// Rendered ONLY with an actively playing scrobble — 미연동/idle/fetch failure all
// resolve to null upstream (fetchMemberNowPlaying) and the section never mounts.
function NowPlayingStrip({ np }: { np: MemberNowPlaying }) {
	return (
		<section
			aria-label="지금 듣는 중"
			style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', border: '1px solid var(--color-border-soft)', borderRadius: 6 }}
		>
			{np.image_url ?
				(
					<img
						src={np.image_url}
						alt={np.album ?? np.track ?? 'Last.fm'}
						loading="lazy"
						decoding="async"
						style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 4, display: 'block', flex: '0 0 auto', border: '1px solid var(--color-border)' }}
					/>
				) :
				<Cover label={np.album ?? np.track ?? 'Last.fm'} size={56} radius={4} />}
			<div style={{ minWidth: 0, flex: 1 }}>
				<div className="kicker" style={{ marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--color-accent)' }}>
					● 지금 듣는 중
					{/* Provenance (audit OQ7): Last.fm connects are unverified usernames — the
					    public surface says where the data comes from. Spotify is OAuth-proven. */}
					{np.source && (
						<span style={{ color: 'var(--color-faded)', textTransform: 'none', letterSpacing: 0 }}>
							{np.source === 'lastfm' ? ` · via Last.fm${np.source_username ? ` @${np.source_username}` : ''}` : ' · via Spotify'}
						</span>
					)}
				</div>
				<div className="serif italic" style={{ fontSize: 17, fontWeight: 500, lineHeight: 'var(--leading-tight)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{np.track}</div>
				<div className="sans" style={{ fontSize: 12.5, color: 'var(--color-subtle)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
					{[np.artist, np.album].filter(Boolean).join(' — ')}
				</div>
			</div>
		</section>
	)
}

export default function MemberProfile({ handle, displayName, avatarUrl }: { handle: string, displayName?: string, avatarUrl?: string | null }) {
	const [profile, setProfile] = useState<Profile | null>(null)
	const [state, setState] = useState<'loading' | 'ok' | 'missing'>('loading')
	const [np, setNp] = useState<MemberNowPlaying | null>(null)
	// Self-view (merge PR1). isSelf flips true only on an authed /api/me whose
	// handle matches this page; dashSeen latches once a dashboard tab was
	// visited so the lazy chunk mounts exactly once and then stays (keep-alive).
	const [isSelf, setIsSelf] = useState(false)
	const [tab, setTab] = useState<string>(initialTab)
	const [dashSeen, setDashSeen] = useState(false)

	useEffect(() => {
		let alive = true
		fetchMemberProfile(handle).then((p) => {
			if (!alive)
				return
			setProfile(p)
			setState(p ? 'ok' : 'missing')
		})
		fetchMemberNowPlaying(handle).then((r) => {
			if (alive)
				setNp(r)
		})
		return () => {
			alive = false
		}
	}, [handle])

	useEffect(() => {
		// Token presence gates the ATTEMPT only (anonymous visitors make no authed
		// call and can never be redirected to login); the authed response decides.
		// getMe() is null on 401/transport error → the page simply stays public.
		if (!isLoggedIn())
			return
		let alive = true
		getMe().then((me) => {
			if (alive && me != null && me.handle === handle)
				setIsSelf(true)
		})
		return () => {
			alive = false
		}
	}, [handle])

	const dashActive = isSelf && DASH_TAB_IDS.includes(tab)
	useEffect(() => {
		if (dashActive)
			setDashSeen(true)
	}, [dashActive])

	// Dashboard URL sync uses replaceState so the active tab is shareable and
	// reload-stable. The public list is the default view → no ?tab= param.
	const selectTab = (id: string) => {
		setTab(id)
		try {
			const url = new URL(window.location.href)
			if (id === RATINGS_TAB)
				url.searchParams.delete('tab')
			else
				url.searchParams.set('tab', id)
			url.hash = ''
			window.history.replaceState(null, '', url)
		}
		catch { /* ignore */ }
	}

	const display = profile?.display_name ?? displayName
	const placeholder = isPlaceholderIdentity(display, handle)
	const name = placeholder ? handle : display ?? handle
	const avatar = profile?.avatar_url ?? avatarUrl
	const reviews = profile?.reviews ?? []
	const activeNavId = dashActive ? tab : RATINGS_TAB

	return (
		<div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 20px 80px' }}>
			{/* D4 (RFC-ui-surface-unification): container fixed 1200 — no width jump between tabs; public list reads in a 680 column. */}
			<header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
				<Avatar url={avatar} name={name} />
				<div style={{ minWidth: 0 }}>
					{!placeholder && <h1 className="serif italic" style={{ fontSize: 26, fontWeight: 500, margin: 0, lineHeight: 'var(--leading-tight)' }}>{name}</h1>}
					<div className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-faded)', marginTop: placeholder ? 0 : 6 }}>
						@
{handle}
						{profile && (
<>
{' · '}
{profile.review_count}
개 평가
</>
)}
					</div>
				</div>
			</header>

			{/* Self-only dashboard tab nav. */}
			{isSelf && (
				<nav className="mono" style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--color-text)', marginTop: 26, overflowX: 'auto' }} aria-label="내 대시보드">
					{[{ id: RATINGS_TAB, label: '평가' }, ...DASH_TABS].map(tb => (
						<button
							key={tb.id}
							type="button"
							className="lf-tab-btn"
							onClick={() => selectTab(tb.id)}
							style={{ border: 'none', background: 'none', padding: '11px 14px', fontSize: 11.5, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer', whiteSpace: 'nowrap', color: activeNavId === tb.id ? 'var(--color-text)' : 'var(--color-faded)', borderBottom: activeNavId === tb.id ? '2px solid var(--color-accent)' : '2px solid transparent', marginBottom: -1, transition: 'color .14s' }}
						>
							{tb.label}
						</button>
					))}
					<a
						href="/settings/"
						className="lf-tab-btn"
						style={{ marginLeft: 'auto', padding: '11px 14px', fontSize: 11.5, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap', color: 'var(--color-faded)', textDecoration: 'none', borderBottom: '2px solid transparent', marginBottom: -1, transition: 'color .14s' }}
					>
						설정 ↗
					</a>
				</nav>
			)}

			{!dashActive && (
				<div style={{ maxWidth: 680 }}>
					{np && <NowPlayingStrip np={np} />}

					<section style={{ marginTop: 34 }}>
						<SectionTitle title="평가한 앨범" />

						{state === 'loading' && <div className="meta">불러오는 중…</div>}
						{state === 'missing' && <div className="sans" style={{ fontSize: 'var(--text-base)', color: 'var(--color-subtle)' }}>존재하지 않는 사용자입니다.</div>}
						{state === 'ok' && reviews.length === 0 && <div className="sans" style={{ fontSize: 'var(--text-base)', color: 'var(--color-subtle)' }}>아직 남긴 평가가 없습니다.</div>}

						<ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
							{reviews.map(r => (
								<li key={r.id} style={{ display: 'flex', gap: 14 }}>
									<button
										type="button"
										onClick={() => openAlbum({ albumId: r.album_id, title: r.album_title, cover: r.album_cover_url })}
										title={r.album_title}
										style={{ width: 64, flex: '0 0 auto', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
									>
										<AlbumArt url={r.album_cover_url} label={r.album_title} size={64} />
									</button>
									<div style={{ minWidth: 0, flex: 1 }}>
										<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
											<button
												type="button"
												onClick={() => openAlbum({ albumId: r.album_id, title: r.album_title, cover: r.album_cover_url })}
												className="serif italic"
												style={{ fontSize: 'var(--text-md)', fontWeight: 500, lineHeight: 'var(--leading-snug)', padding: 0, border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}
											>
												{r.album_title}
											</button>
											<Stars score={Number(r.rating)} size={14} />
											<span className="mono" style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-faded)' }}>{fmtDate(r.created_at)}</span>
										</div>
										{r.artist_name && (
											<div className="sans" style={{ marginTop: 4, fontSize: 'var(--text-xs)', color: 'var(--color-subtle)' }}>
												{r.artist_id ?
													<a href={artistHref(r.artist_id)} style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3, textDecorationColor: 'var(--color-faded)' }}>{r.artist_name}</a> :
													r.artist_name}
											</div>
										)}
										{r.comment && <p className="sans" style={{ margin: '4px 0 0', fontSize: 'var(--text-base)', color: 'var(--color-subtle)', lineHeight: 'var(--leading-normal)' }}>{r.comment}</p>}
									</div>
								</li>
							))}
						</ul>
					</section>
				</div>
			)}

			{/* Mounted after first dashboard-tab visit, then kept mounted (hidden via
			    tab=null) so tab state survives switching back to the public list. */}
			{isSelf && dashSeen && (
				<Suspense fallback={<div className="meta" style={{ marginTop: 30 }}>불러오는 중…</div>}>
					<SelfDashboard handle={handle} publicReviews={profile?.reviews} tab={dashActive ? tab : null} onSelectTab={selectTab} />
				</Suspense>
			)}
		</div>
	)
}
