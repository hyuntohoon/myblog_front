// FEAT-multi-user-accounts Phase 1 — public member profile at /members/[handle].
// A SEPARATE React root from the authed owner ProfileApp (this is public, feeds
// off the public reviews API). Album titles open the app-wide read-only overlay
// via openAlbum (no member DetailTarget). Seeded from getStaticPaths props so the
// header paints before the runtime feed fetch resolves.
import type { MemberNowPlaying, MemberProfile as Profile } from '../album/reviews.api'
import { useEffect, useState } from 'react'
import { openAlbum } from '@lib/entityEvents'
import { fetchMemberNowPlaying, fetchMemberProfile } from '../album/reviews.api'
import { Cover, Stars } from './ui'

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
				<div className="kicker" style={{ marginBottom: 4, whiteSpace: 'nowrap', color: 'var(--color-accent)' }}>● 지금 듣는 중</div>
				<div className="serif italic" style={{ fontSize: 17, fontWeight: 500, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{np.track}</div>
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

	const name = profile?.display_name ?? displayName ?? handle
	const avatar = profile?.avatar_url ?? avatarUrl
	const reviews = profile?.reviews ?? []

	return (
		<div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 20px 80px' }}>
			<header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
				<Avatar url={avatar} name={name} />
				<div style={{ minWidth: 0 }}>
					<h1 className="serif italic" style={{ fontSize: 26, fontWeight: 500, margin: 0, lineHeight: 1.15 }}>{name}</h1>
					<div className="mono" style={{ fontSize: 11, color: 'var(--color-faded)', marginTop: 6 }}>
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

			{np && <NowPlayingStrip np={np} />}

			<section style={{ marginTop: 30, paddingTop: 20, borderTop: '1px solid var(--color-border-soft)' }}>
				<div className="meta" style={{ marginBottom: 14 }}>평가한 앨범</div>

				{state === 'loading' && <div className="meta">불러오는 중…</div>}
				{state === 'missing' && <div className="sans" style={{ fontSize: 13.5, color: 'var(--color-subtle)' }}>존재하지 않는 사용자입니다.</div>}
				{state === 'ok' && reviews.length === 0 && <div className="sans" style={{ fontSize: 13.5, color: 'var(--color-subtle)' }}>아직 남긴 평가가 없습니다.</div>}

				<ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
					{reviews.map(r => (
						<li key={r.id} style={{ display: 'flex', gap: 14 }}>
							<button
								type="button"
								onClick={() => openAlbum({ albumId: r.album_id, title: r.album_title, cover: r.album_cover_url })}
								title={r.album_title}
								style={{ flex: '0 0 auto', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
							>
								<img
									src={r.album_cover_url ?? ''}
									alt={r.album_title}
									width={64}
									height={64}
									style={{ borderRadius: 3, objectFit: 'cover', background: 'var(--color-border-soft)', display: 'block' }}
								/>
							</button>
							<div style={{ minWidth: 0, flex: 1 }}>
								<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
									<button
										type="button"
										onClick={() => openAlbum({ albumId: r.album_id, title: r.album_title, cover: r.album_cover_url })}
										className="serif"
										style={{ fontSize: 16, fontWeight: 500, padding: 0, border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}
									>
										{r.album_title}
									</button>
									<Stars score={Number(r.rating)} size={14} />
									<span className="mono" style={{ fontSize: 10, color: 'var(--color-faded)' }}>{fmtDate(r.created_at)}</span>
								</div>
								{r.comment && <p className="sans" style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--color-subtle)', lineHeight: 1.5 }}>{r.comment}</p>}
							</div>
						</li>
					))}
				</ul>
			</section>
		</div>
	)
}
