// FEAT-multi-user-accounts — runtime member surface at /members/ (OQ6 option a,
// audit 2026-07-14). The static /members/[handle] pages are prebuilt from the
// reviewer-only index at deploy time, so a runtime-created user (or an empty
// index) left EVERY member page 404ing — a new member could not see their own
// profile at all. This island fills that hole without SSR:
//
//   /members/            → member directory (runtime GET /api/members — the
//                          first community-discovery surface)
//   /members/?u=<handle> → any member's profile, rendered at runtime via the
//                          existing MemberProfile island (unknown handle →
//                          its 'missing' state); ?tab= deep links keep working
//   /members/?me         → resolve self via /api/me, then swap to ?u=<handle>
//                          (not logged in → goLogin, which captures returnTo)
//
// The static pages stay canonical for SEO when they exist; links point here so
// they always work.
import type { MemberSummary } from '../album/reviews.api'
import { useEffect, useState } from 'react'
import { goLogin, isLoggedIn } from '@lib/auth'
import { isPlaceholderIdentity } from '@lib/member'
import { fetchMembers } from '../album/reviews.api'
import { getMe } from './me.api'
import MemberProfile from './MemberProfile'

function Initial({ name, size = 44 }: { name: string, size?: number }) {
	return (
		<div
			aria-hidden="true"
			style={{ width: size, height: size, borderRadius: '50%', flex: '0 0 auto', display: 'grid', placeItems: 'center', background: 'var(--color-border-soft)', color: 'var(--color-subtle)', fontSize: size * 0.4, fontWeight: 600 }}
		>
			{(name.trim()[0] ?? '?').toUpperCase()}
		</div>
	)
}

function Directory() {
	const [members, setMembers] = useState<MemberSummary[] | null>(null)

	useEffect(() => {
		let alive = true
		void fetchMembers().then(m => alive && setMembers(m))
		return () => {
			alive = false
		}
	}, [])

	return (
		<div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 20px 80px' }}>
			<header style={{ borderBottom: '1px solid var(--color-text)', paddingBottom: 16, marginBottom: 24 }}>
				<h1 className="serif" style={{ fontSize: 'clamp(26px, 5vw, 36px)', fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>회원</h1>
				<p className="sans" style={{ fontSize: 13.5, color: 'var(--color-subtle)', marginTop: 8 }}>앨범을 평가한 회원들 — 프로필에서 평가와 지금 듣는 곡을 볼 수 있어요.</p>
			</header>

			{members == null && <p className="sans" style={{ fontSize: 13.5, color: 'var(--color-subtle)' }}>불러오는 중…</p>}
			{members != null && members.length === 0 && (
				<p className="sans" style={{ fontSize: 13.5, color: 'var(--color-subtle)' }}>
					아직 앨범을 평가한 회원이 없습니다. 첫 평가를 남기면 여기에 등장해요.
				</p>
			)}
			{members != null && members.length > 0 && (
				<ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
					{members.map((m) => {
						const placeholder = isPlaceholderIdentity(m.display_name, m.handle)
						return (
							<li key={m.handle}>
								<a
									href={`/members/?u=${encodeURIComponent(m.handle)}`}
									style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 8px', borderRadius: 6, textDecoration: 'none' }}
								>
									{m.avatar_url ?
										<img src={m.avatar_url} alt="" width={44} height={44} loading="lazy" style={{ borderRadius: '50%', objectFit: 'cover', flex: '0 0 auto' }} /> :
										<Initial name={placeholder ? m.handle : m.display_name} />}
									<span style={{ minWidth: 0 }}>
										{!placeholder && <span className="sans" style={{ display: 'block', fontSize: 14.5, fontWeight: 500, color: 'var(--color-text)' }}>{m.display_name}</span>}
										<span className="mono" style={{ display: 'block', fontSize: 11, color: 'var(--color-faded)', marginTop: placeholder ? 0 : 2 }}>
											@
											{m.handle}
											{' · '}
											{m.review_count}
											개 평가
										</span>
									</span>
								</a>
							</li>
						)
					})}
				</ul>
			)}
		</div>
	)
}

export default function MembersHub() {
	// Resolved once from the URL on mount (client:only island — no SSR pass).
	const [view, setView] = useState<
		{ kind: 'directory' } | { kind: 'profile', handle: string } | { kind: 'resolving' } | { kind: 'login' } | null
	>(null)

	useEffect(() => {
		const params = new URLSearchParams(window.location.search)
		const u = params.get('u')
		if (u) {
			setView({ kind: 'profile', handle: u })
			return
		}
		if (!params.has('me')) {
			setView({ kind: 'directory' })
			return
		}
		// ?me — swap to ?u=<own handle> so the URL becomes shareable/reloadable;
		// every other param (?tab= deep link) is preserved.
		if (!isLoggedIn()) {
			setView({ kind: 'login' })
			void goLogin(true)
			return
		}
		setView({ kind: 'resolving' })
		void getMe().then((me) => {
			if (me == null) {
				// 401/transport — token stale; goLogin captures this URL as returnTo.
				setView({ kind: 'login' })
				void goLogin(true)
				return
			}
			const url = new URL(window.location.href)
			url.searchParams.delete('me')
			url.searchParams.set('u', me.handle)
			window.history.replaceState(null, '', url)
			setView({ kind: 'profile', handle: me.handle })
		})
	}, [])

	if (view == null || view.kind === 'resolving' || view.kind === 'login') {
		return (
			<div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 20px' }}>
				<p className="sans" style={{ fontSize: 13.5, color: 'var(--color-subtle)' }}>
					{view?.kind === 'login' ? '로그인으로 이동 중…' : '불러오는 중…'}
				</p>
			</div>
		)
	}
	if (view.kind === 'profile')
		return <MemberProfile handle={view.handle} />
	return <Directory />
}
