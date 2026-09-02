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
import type { RatingSortKey } from '@lib/ratingStats'
import type { MemberRerating } from '../album/reratings.api'
import type { MemberNowPlaying, MemberRating, MyAlbumState, MemberProfile as Profile } from '../album/reviews.api'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { isLoggedIn } from '@lib/auth'
import { ENT_ALBUM_STATE_CHANGED, notifyAlbumStateChanged, openAlbum } from '@lib/entityEvents'
import type { AlbumStateChangedDetail } from '@lib/entityEvents'
import { artistHref } from '@lib/entityLinks'
import { isPlaceholderIdentity, OWNER_HANDLE } from '@lib/member'
import { RATING_SORTS, sortRatings } from '@lib/ratingStats'
import HalfStarInput from '../album/HalfStarInput'
import { cancelRerating, fetchMyReratings, startRerating } from '../album/reratings.api'
import { fetchMemberNowPlaying, fetchMemberProfile, putMyAlbumState, RATING_COMMENT_MAX, RatingRateLimitError } from '../album/reviews.api'
import { boardTabHref } from './dashboardLinks'
import { getMe } from './me.api'
import { RatingStats } from './RatingStats'
import { AlbumArt, Cover, SectionTitle, Seg, Stars } from './ui'

// Bundle guard: the dashboard (and everything it drags in — BucketBoard,
// OverviewDash, LikedBoard, member.css …) loads only after isSelf is confirmed
// AND a dashboard tab is first visited.
const SelfDashboard = lazy(() => import('./SelfDashboard'))

// Dashboard tab ids are the authoritative ?tab= deep-link values. Note the
// convention is /members/?me&tab=<id> (see buckets.astro) — `tab` alone is not
// an address, because /members/ needs ?u=/?me to know whose profile to mount.
// Build these hrefs with boardTabHref/dashboardTabHref, never by hand. 평론 hosts the runtime
// review feed since merge PR2; 'ratings' is the public 평가한 앨범 list every
// viewer gets.
//
// FEAT-album-review-authoring Step 4 (충돌 #2 + C1's permission rule): 평론 is
// OWNER-ONLY. For a member it was a tab named 평론 that showed their 평가 — the
// vocabulary collision the RFC's terminology table exists to remove — and it
// carried live authoring affordances (ReviewCandidates' 평론 쓰기 →, the draft
// cards' /write?id=) that only the owner can act on. 하드 룰 1 says 평론 belongs
// to editors, so a member has nothing to write there and nothing to read there
// that the public 평가 tab does not already give them.
const DASH_TABS = [
	{ id: 'overview', label: '개요' },
	{ id: 'reviews', label: '평론', ownerOnly: true },
	{ id: 'bucket', label: 'My Buckit' },
	{ id: 'stats', label: '분석 버킷' },
	{ id: 'integration', label: '연동' },
] as const
const RATINGS_TAB = 'ratings'

/** The dashboard tabs this viewer may actually use. */
function dashTabsFor(isOwner: boolean) {
	return DASH_TABS.filter(t => isOwner || !('ownerOnly' in t && t.ownerOnly))
}

/**
 * Initial tab from `?tab=<id>` — dashboard ids only; anything else → public list.
 *
 * Deliberately NOT owner-aware: this runs at mount, before `handle` is compared
 * to OWNER_HANDLE. A member deep-linking `?tab=reviews` therefore holds that id
 * in state, and `dashActive` below is what refuses to activate it — they land on
 * the public 평가 list with 평가 highlighted, rather than on a blank dashboard.
 */
function initialTab(): string {
	if (typeof window === 'undefined')
		return RATINGS_TAB
	try {
		const q = new URLSearchParams(window.location.search).get('tab')
		if (q && DASH_TABS.some(t => t.id === q))
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

/**
 * The 평가한 앨범 empty state (Step 2 — the empty case is a designed surface, not
 * a fallback string: prod holds zero ratings on the day this ships, so this is
 * what the screen actually IS for a while).
 *
 * Split by who is looking. On your own profile the message has somewhere to send
 * you — the whole diagnosis behind this RFC is that the owner files albums and
 * never rates them, so the useful pointer is at the pile itself (My Buckit), and
 * the useful reassurance is that a star alone is a complete 평가. On someone
 * else's profile there is nothing to prompt: it is a plain fact about them.
 */
/**
 * The 한줄평 cell for one row of "평가한 앨범". Every row here already carries a
 * rating (the public feed is `rating IS NOT NULL`-filtered), so a comment can
 * always be added without a star-rating gate, unlike MemoRatingBlock's dashboard
 * input. Author-only: `isSelf` is required to even attempt a click, since
 * writing here means PUT /api/reviews/albums/{album_id} as the acting member —
 * this component must never render its edit affordance on someone else's row.
 *
 * A filled-in comment stays static text here — editing an existing rating or
 * comment goes through the row's "수정" affordance (RatingEditPanel below),
 * which edits both facets together, mirroring AlbumRatingBlock's edit panel
 * on the album overlay.
 *
 * A visitor's "없음" case must say so explicitly (owner feedback, 2026-08-19):
 * blank space next to a star rating reads as "not loaded yet", not "no
 * comment" — same reasoning as Stars' 미평가 text for a null score.
 */
function RatingCommentCell({ albumId, comment, isSelf, onSaved }: {
	albumId: string
	comment: string | null | undefined
	isSelf: boolean
	onSaved: (state: MyAlbumState | null) => void
}) {
	const [editing, setEditing] = useState(false)
	const [value, setValue] = useState('')
	const [saving, setSaving] = useState(false)
	const [err, setErr] = useState<string | null>(null)

	if (comment) {
		return <p className="sans" style={{ margin: '4px 0 0', fontSize: 'var(--text-base)', color: 'var(--color-subtle)', lineHeight: 'var(--leading-normal)' }}>{comment}</p>
	}
	if (!isSelf) {
		return <p className="sans" style={{ margin: '4px 0 0', fontSize: 'var(--text-base)', color: 'var(--color-faded)', lineHeight: 'var(--leading-normal)' }}>한 줄 감상 없음</p>
	}

	async function commit() {
		const trimmed = value.trim()
		setSaving(true)
		setErr(null)
		try {
			const res = await putMyAlbumState(albumId, { comment: trimmed || null })
			onSaved(res)
			setEditing(false)
		}
		catch (e) {
			setErr(e instanceof RatingRateLimitError ? '오늘 남길 수 있는 평가 수를 초과했습니다.' : '저장하지 못했습니다.')
		}
		finally {
			setSaving(false)
		}
	}

	if (!editing) {
		return (
			<button
				type="button"
				onClick={() => {
					setValue('')
					setEditing(true)
				}}
				className="sans"
				style={{ display: 'block', marginTop: 4, padding: 0, border: 'none', background: 'none', cursor: 'pointer', fontSize: 'var(--text-base)', color: 'var(--color-faded)', textAlign: 'left' }}
			>
				한 줄 감상 남기기
			</button>
		)
	}

	return (
		<div style={{ marginTop: 4 }}>
			<input
				type="text"
				autoFocus
				value={value}
				onChange={e => setValue(e.target.value)}
				onBlur={() => void commit()}
				onKeyDown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault()
						void commit()
					}
					else if (e.key === 'Escape') {
						setEditing(false)
					}
				}}
				maxLength={RATING_COMMENT_MAX}
				disabled={saving}
				placeholder="한 줄 감상 (선택)"
				className="sans"
				style={{ width: '100%', maxWidth: 360, fontSize: 'var(--text-base)', padding: '4px 0', border: 'none', borderBottom: '1px solid var(--color-border)', background: 'none', color: 'inherit' }}
			/>
			{err && <div className="mono" style={{ marginTop: 4, fontSize: 10.5, color: 'var(--color-danger, #c0392b)' }}>{err}</div>}
		</div>
	)
}

/**
 * Edit panel for a row of "평가한 앨범" — star + 한줄평 together, same shape as
 * AlbumRatingBlock's "수정" panel on the album overlay, so the write path
 * behaves the same wherever it's reached from. Author-only (mounted only when
 * the row's edit toggle is on, which is itself gated isSelf by the caller).
 */
function RatingEditPanel({ r, onCancel, onSaved, onRerated }: {
	r: MemberRating
	onCancel: () => void
	onSaved: (patch: { rating: number, comment: string | null }) => void
	/** The 평가 was withdrawn — the caller drops the row and refetches the profile. */
	onRerated: () => void
}) {
	const [draftRating, setDraftRating] = useState(r.rating)
	const [draftComment, setDraftComment] = useState(r.comment ?? '')
	const [saving, setSaving] = useState(false)
	const [err, setErr] = useState<string | null>(null)

	/**
	 * 재평가 — withdraw this 평가 so the album can be listened to again and rated
	 * fresh. Placed inside the 수정 panel rather than beside 수정 on the row: it
	 * destroys the score this row exists to show, so it should take the same two
	 * deliberate clicks an edit does, not one stray one.
	 */
	async function rerate() {
		setSaving(true)
		setErr(null)
		const result = await startRerating(r.album_id)
		if (result === 'ok') {
			onRerated()
			return
		}
		setErr(result === 'conflict' ? '되돌릴 평가가 없습니다.' : '재평가를 시작하지 못했습니다.')
		setSaving(false)
	}

	async function save() {
		setSaving(true)
		setErr(null)
		try {
			const res = await putMyAlbumState(r.album_id, { rating: draftRating, comment: draftComment.trim() || null })
			if (!res) {
				setErr('저장하지 못했습니다.')
				return
			}
			onSaved({ rating: res.rating ?? draftRating, comment: res.comment ?? null })
		}
		catch (e) {
			setErr(e instanceof RatingRateLimitError ? '오늘 남길 수 있는 평가 수를 초과했습니다.' : '저장하지 못했습니다.')
		}
		finally {
			setSaving(false)
		}
	}

	return (
		<div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
				<HalfStarInput value={draftRating} onChange={setDraftRating} size={20} />
				<span className="mono" style={{ fontSize: 11, color: 'var(--color-subtle)' }}>{draftRating.toFixed(1)}</span>
			</div>
			<input
				type="text"
				autoFocus
				value={draftComment}
				onChange={e => setDraftComment(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault()
						void save()
					}
					else if (e.key === 'Escape') {
						onCancel()
					}
				}}
				maxLength={RATING_COMMENT_MAX}
				disabled={saving}
				placeholder="한 줄 감상 (선택)"
				className="sans"
				style={{ width: '100%', fontSize: 'var(--text-base)', padding: '4px 0', border: 'none', borderBottom: '1px solid var(--color-border)', background: 'none', color: 'inherit' }}
			/>
			{err && <div className="mono" style={{ fontSize: 10.5, color: 'var(--color-danger, #c0392b)' }}>{err}</div>}
			<div style={{ display: 'flex', gap: 8 }}>
				<button type="button" onClick={() => void save()} disabled={saving} className="sans" style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid var(--color-accent, #d8a13a)', background: 'var(--color-accent, #d8a13a)', color: '#fff', fontSize: 12, cursor: 'pointer' }}>
					{saving ? '저장 중…' : '저장'}
				</button>
				<button type="button" onClick={onCancel} disabled={saving} className="sans" style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-subtle)', fontSize: 12, cursor: 'pointer' }}>
					취소
				</button>
				<button type="button" onClick={() => void rerate()} disabled={saving} className="sans" style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-subtle)', fontSize: 12, cursor: 'pointer' }}>
					재평가
				</button>
			</div>
		</div>
	)
}

/**
 * 재평가 중 — albums whose 평가 was withdrawn and is being redone
 * (FEAT-album-rerating).
 *
 * PUBLIC (owner decision): the list appears on anyone's profile. What is NOT
 * public is the withdrawn score — `previous_rating` exists only on the author's
 * own `GET /api/me/reratings` payload, so it is passed in separately here rather
 * than read off the public profile response. Rendering it from `mine` is the
 * only path; a visitor's `mine` is empty and the hint simply does not appear.
 *
 * Rating again happens in the album overlay (owner decision), not inline: the
 * whole premise is that you went and listened again, so the surface that
 * re-rates should be the one with the tracklist and the player on it.
 */
function ReratingSection({ reratings, mine, isSelf, onCancelled }: {
	reratings: MemberRerating[]
	mine: Map<string, number>
	isSelf: boolean
	onCancelled: (albumId: string) => void | Promise<void>
}) {
	const [busy, setBusy] = useState<string | null>(null)

	if (reratings.length === 0)
		return null

	return (
		<section style={{ marginTop: 34 }}>
			<SectionTitle title="재평가 중" />
			<ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
				{reratings.map(r => (
					<li key={r.album_id} style={{ display: 'flex', gap: 14 }}>
						<button
							type="button"
							onClick={() => openAlbum({ albumId: r.album_id, title: r.album_title, cover: r.album_cover_url })}
							title={r.album_title}
							style={{ width: 48, flex: '0 0 auto', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
						>
							<AlbumArt url={r.album_cover_url} label={r.album_title} size={48} />
						</button>
						<div style={{ minWidth: 0, flex: 1 }}>
							<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
								<button
									type="button"
									onClick={() => openAlbum({ albumId: r.album_id, title: r.album_title, cover: r.album_cover_url })}
									className="serif italic"
									style={{ fontSize: 'var(--text-base)', fontWeight: 500, padding: 0, border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}
								>
									{r.album_title}
								</button>
								{/* Author-only: the withdrawn score never reaches a visitor. */}
								{isSelf && mine.has(r.album_id) && (
									<span className="mono" style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-faded)' }}>
										이전
										{' '}
										{mine.get(r.album_id)!.toFixed(1)}
									</span>
								)}
								<span className="mono" style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-faded)' }}>{fmtDate(r.created_at)}</span>
								{isSelf && (
									<button
										type="button"
										disabled={busy !== null}
										onClick={async () => {
											setBusy(r.album_id)
											if (await cancelRerating(r.album_id)) {
												await onCancelled(r.album_id)
											}
											setBusy(null)
										}}
										className="sans"
										style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', fontSize: 'var(--text-2xs)', color: 'var(--color-faded)' }}
									>
										재평가 취소
									</button>
								)}
							</div>
							{r.artist_name && (
								<div className="sans" style={{ marginTop: 4, fontSize: 'var(--text-xs)', color: 'var(--color-subtle)' }}>
									{r.artist_id ?
										<a href={artistHref(r.artist_id)} style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3, textDecorationColor: 'var(--color-faded)' }}>{r.artist_name}</a> :
										r.artist_name}
								</div>
							)}
							{isSelf && (
								<div className="sans" style={{ marginTop: 4, fontSize: 'var(--text-xs)', color: 'var(--color-faded)' }}>
									다시 듣고 앨범을 열어 새로 평가하세요.
								</div>
							)}
						</div>
					</li>
				))}
			</ul>
		</section>
	)
}

function NoRatingsYet({ isSelf }: { isSelf: boolean }) {
	if (!isSelf) {
		return (
			<div className="sans" style={{ fontSize: 'var(--text-base)', color: 'var(--color-subtle)' }}>아직 남긴 평가가 없습니다.</div>
		)
	}
	return (
		<div style={{ padding: '22px 20px', border: '1px dashed var(--color-border)', borderRadius: 6 }}>
			<p className="serif" style={{ margin: 0, fontSize: 'var(--text-md)', lineHeight: 'var(--leading-snug)' }}>아직 남긴 평가가 없어요.</p>
			<p className="sans" style={{ margin: '8px 0 0', fontSize: 'var(--text-base)', color: 'var(--color-subtle)', lineHeight: 'var(--leading-normal)' }}>
				앨범을 열고 별점만 눌러도 한 개입니다. 한 줄은 쓰고 싶을 때만 쓰면 돼요.
			</p>
			<a
				href={boardTabHref()}
				className="mono"
				style={{ display: 'inline-block', marginTop: 14, fontSize: 'var(--text-2xs)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-accent)', textDecoration: 'none', borderBottom: '1px solid currentColor', paddingBottom: 2 }}
			>
				담아둔 앨범부터 보기 →
			</a>
		</div>
	)
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
	const profileFetchSeq = useRef(0)
	const [cancelSyncErrorAlbumId, setCancelSyncErrorAlbumId] = useState<string | null>(null)
	const cancelConfirmSeq = useRef(0)
	const cancelRetryToken = useRef(0)
	const cancelRetryInFlight = useRef<string | null>(null)
	const [cancelRetryingAlbumId, setCancelRetryingAlbumId] = useState<string | null>(null)
	const forwardedCancelEvents = useRef(new Set<string>())
	// Local row edits already patch/reload this profile. Their synchronous global
	// event still has to reach other React roots, but must not cause a duplicate
	// profile request here.
	const localRatingEvent = useRef<string | null>(null)

	useEffect(() => {
		let alive = true
		const seq = ++profileFetchSeq.current
		fetchMemberProfile(handle).then((p) => {
			if (!alive || seq !== profileFetchSeq.current)
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
			if (seq === profileFetchSeq.current)
				profileFetchSeq.current += 1
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

	/**
	 * Re-read the profile after a 재평가 starts or is cancelled — an album moves
	 * BETWEEN the two lists, so patching one of them in place would leave the
	 * other stale.
	 */
	async function reloadProfile(): Promise<{ profile: Profile | null, fresh: boolean }> {
		const seq = ++profileFetchSeq.current
		const p = await fetchMemberProfile(handle)
		const fresh = seq === profileFetchSeq.current
		if (fresh && p) {
			setProfile(p)
			setState('ok')
		}
		return { profile: p, fresh }
	}

	async function confirmCancelledRating(albumId: string): Promise<boolean> {
		const attempt = ++cancelConfirmSeq.current
		const { profile: confirmed } = await reloadProfile()
		const restoredRow = confirmed?.reviews?.find(row => row.album_id === albumId && row.rating != null)
		const reratingGone = !(confirmed?.reratings ?? []).some(row => row.album_id === albumId)
		if (confirmed && restoredRow && reratingGone) {
			if (!forwardedCancelEvents.current.has(albumId)) {
				forwardedCancelEvents.current.add(albumId)
				notifyLocalRatingChange({ albumId, rating: Number(restoredRow.rating) })
			}
			if (attempt === cancelConfirmSeq.current)
				setCancelSyncErrorAlbumId(null)
			return true
		}
		if (attempt === cancelConfirmSeq.current)
			setCancelSyncErrorAlbumId(albumId)
		return false
	}

	async function retryCancelledRating(albumId: string): Promise<void> {
		if (cancelRetryInFlight.current === albumId)
			return
		const token = ++cancelRetryToken.current
		cancelRetryInFlight.current = albumId
		setCancelRetryingAlbumId(albumId)
		try {
			await confirmCancelledRating(albumId)
		}
		finally {
			if (token === cancelRetryToken.current) {
				cancelRetryInFlight.current = null
				setCancelRetryingAlbumId(null)
			}
		}
	}

	function notifyLocalRatingChange(detail: AlbumStateChangedDetail) {
		localRatingEvent.current = detail.albumId
		notifyAlbumStateChanged(detail)
	}

	useEffect(() => {
		if (!isSelf)
			return
		const onAlbumStateChanged = (event: Event) => {
			const detail = (event as CustomEvent<AlbumStateChangedDetail>).detail
			// undefined means a mark-only update. null is meaningful: a rating was
			// deleted, and the profile count/stats must be refreshed.
			if (!detail || detail.rating === undefined)
				return
			if (localRatingEvent.current === detail.albumId) {
				localRatingEvent.current = null
				return
			}
				void reloadProfile()
		}
		window.addEventListener(ENT_ALBUM_STATE_CHANGED, onAlbumStateChanged)
		return () => window.removeEventListener(ENT_ALBUM_STATE_CHANGED, onAlbumStateChanged)
	}, [handle, isSelf])

	// The profile being viewed is the owner's. Same page-vs-OWNER_HANDLE comparison
	// SelfDashboard already branches its 평론 source on — one signal, one spelling.
	const isOwner = handle === OWNER_HANDLE
	const visibleDashTabs = dashTabsFor(isOwner)
	const dashActive = isSelf && visibleDashTabs.some(t => t.id === tab)
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
	// Step 2 — 정렬 (OQ7: 최신 · 별점 · 이름). Client-side: the feed is the whole
	// history in one response, so sorting it needs no round trip and no index.
	const [sort, setSort] = useState<RatingSortKey>('recent')
	// 한줄 감상 유무 필터 — 오너 요청: "평가한 앨범에서 한줄 감상이 있는 것과
	// 없는 것을 구분". Client-side, same reasoning as 정렬 above.
	const [commentOnly, setCommentOnly] = useState(false)
	const filteredReviews = commentOnly ? reviews.filter(r => r.comment) : reviews
	const sortedReviews = useMemo(() => sortRatings(filteredReviews, sort), [filteredReviews, sort])
	// Which row's "수정" panel is open — at most one at a time, mirroring the
	// single-editor pattern on AlbumRatingBlock.
	const [editingId, setEditingId] = useState<string | null>(null)
	// FEAT-album-rerating. The LIST comes from the public profile payload (anyone
	// may see it); this map is the author-only half — album_id → withdrawn score,
	// read from /api/me/reratings and never present for a visitor.
	const reratings = profile?.reratings ?? []
	const [myWithdrawn, setMyWithdrawn] = useState<Map<string, number>>(new Map())

	// FEAT-album-rerating: the withdrawn scores behind MY open 재평가. Author-only
	// by construction — the endpoint is JWT-scoped to the caller, so this stays
	// empty on someone else's profile and the 이전 ★ hint never renders there.
	useEffect(() => {
		if (!isSelf)
			return
		let alive = true
		fetchMyReratings().then((rs) => {
			if (alive)
				setMyWithdrawn(new Map(rs.map(r => [r.album_id, Number(r.previous_rating)])))
		})
		return () => {
			alive = false
		}
	}, [isSelf, profile])

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
					{[{ id: RATINGS_TAB, label: '평가' }, ...visibleDashTabs].map(tb => (
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

					{state === 'ok' && <RatingStats ratings={reviews} />}

					<ReratingSection
						reratings={reratings}
						mine={myWithdrawn}
						isSelf={isSelf}
						onCancelled={async (albumId) => {
							const restored = myWithdrawn.get(albumId)
							forwardedCancelEvents.current.delete(albumId)
							// DELETE 204 confirms the rerating is gone. Remove that stale row
							// immediately, and use the author-only withdrawn score to update
							// other roots while the public profile catches up.
							setProfile(p => (p ? { ...p, reratings: (p.reratings ?? []).filter(row => row.album_id !== albumId) } : p))
							setMyWithdrawn((current) => {
								const next = new Map(current)
								next.delete(albumId)
								return next
							})
							if (restored != null) {
								forwardedCancelEvents.current.add(albumId)
								notifyLocalRatingChange({ albumId, rating: restored })
							}
							await confirmCancelledRating(albumId)
						}}
					/>
					{cancelSyncErrorAlbumId && (
						<div className="sans" role="alert" style={{ marginTop: 12, fontSize: 'var(--text-xs)', color: 'var(--color-danger, #c0392b)' }}>
							재평가 취소는 완료됐지만 평가 목록을 확인하지 못했습니다.
							{' '}
							<button
								type="button"
								onClick={() => void retryCancelledRating(cancelSyncErrorAlbumId)}
								disabled={cancelRetryingAlbumId === cancelSyncErrorAlbumId}
								className="sans"
								style={{ padding: 0, border: 'none', borderBottom: '1px solid currentColor', background: 'none', color: 'inherit', cursor: 'pointer' }}
							>
								{cancelRetryingAlbumId === cancelSyncErrorAlbumId ? '확인 중…' : '다시 확인'}
							</button>
						</div>
					)}

					<section style={{ marginTop: 34 }}>
						<SectionTitle
							title="평가한 앨범"
							// The sort control appears only with something to sort — on an
							// empty history it would be three dead buttons above a message
							// explaining there is nothing there. Same gate for the 감상 필터.
							right={reviews.length > 1 ?
								(
									<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
										<button
											type="button"
											aria-pressed={commentOnly}
											onClick={() => setCommentOnly(v => !v)}
											className="mono"
											style={{
												border: '1px solid var(--color-border)',
												padding: '6px 11px',
												fontSize: 11,
												letterSpacing: '0.06em',
												textTransform: 'uppercase',
												cursor: 'pointer',
												background: commentOnly ? 'var(--color-text)' : 'transparent',
												color: commentOnly ? 'var(--color-bg)' : 'var(--color-text)',
												transition: 'all .14s',
											}}
										>
											감상 있는 것만
										</button>
										<Seg value={sort} onChange={v => setSort(v as RatingSortKey)} options={[...RATING_SORTS]} />
									</div>
								) :
								undefined}
						/>

						{state === 'loading' && <div className="meta">불러오는 중…</div>}
						{state === 'missing' && <div className="sans" style={{ fontSize: 'var(--text-base)', color: 'var(--color-subtle)' }}>존재하지 않는 사용자입니다.</div>}
						{state === 'ok' && reviews.length === 0 && <NoRatingsYet isSelf={isSelf} />}
						{state === 'ok' && reviews.length > 0 && sortedReviews.length === 0 && (
							<div className="sans" style={{ fontSize: 'var(--text-base)', color: 'var(--color-subtle)' }}>한 줄 감상을 남긴 평가가 없습니다.</div>
						)}

						<ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
							{sortedReviews.map(r => (
								<li key={r.id} style={{ display: 'flex', gap: 14 }}>
									<button
										type="button"
										onClick={() => openAlbum({ albumId: r.album_id, title: r.album_title, cover: r.album_cover_url })}
										title={r.album_title}
										style={{ position: 'relative', width: 64, flex: '0 0 auto', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
									>
										<AlbumArt url={r.album_cover_url} label={r.album_title} size={64} />
										{/* 한줄 감상 유무 마커 — BucketBoard의 평론함/미평가 배지와 같은
										    상호배타 패턴(항상 둘 중 하나만 뜬다). */}
										<span
											aria-hidden="true"
											title={r.comment ? '한 줄 감상 있음' : '한 줄 감상 없음'}
											style={{
												position: 'absolute',
												top: 4,
												right: 4,
												width: 8,
												height: 8,
												borderRadius: '50%',
												boxShadow: '0 0 0 1px var(--color-bg)',
												background: r.comment ? 'var(--color-accent)' : 'transparent',
												border: r.comment ? 'none' : '1px solid var(--color-border)',
											}}
										/>
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
											{editingId !== r.id && <Stars score={Number(r.rating)} size={14} />}
											<span className="mono" style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-faded)' }}>{fmtDate(r.created_at)}</span>
											{isSelf && editingId !== r.id && (
												<button
													type="button"
													onClick={() => setEditingId(r.id)}
													className="sans"
													style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', fontSize: 'var(--text-2xs)', color: 'var(--color-faded)' }}
												>
													수정
												</button>
											)}
										</div>
										{r.artist_name && (
											<div className="sans" style={{ marginTop: 4, fontSize: 'var(--text-xs)', color: 'var(--color-subtle)' }}>
												{r.artist_id ?
													<a href={artistHref(r.artist_id)} style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3, textDecorationColor: 'var(--color-faded)' }}>{r.artist_name}</a> :
													r.artist_name}
											</div>
										)}
										{editingId === r.id ?
											(
												<RatingEditPanel
													r={r}
													onCancel={() => setEditingId(null)}
													onRerated={() => {
														setEditingId(null)
												void reloadProfile()
														notifyLocalRatingChange({ albumId: r.album_id, rating: null })
													}}
													onSaved={(patch) => {
														setProfile(p => (p ? { ...p, reviews: (p.reviews ?? []).map(row => row.album_id === r.album_id ? { ...row, ...patch } : row) } : p))
														setEditingId(null)
														notifyLocalRatingChange({ albumId: r.album_id, rating: patch.rating })
													}}
												/>
											) :
											(
												<RatingCommentCell
													albumId={r.album_id}
													comment={r.comment}
													isSelf={isSelf}
													onSaved={(confirmed) => {
													if (confirmed) {
														setProfile(p => (p ? { ...p, reviews: (p.reviews ?? []).map(row => row.album_id === r.album_id ? { ...row, rating: confirmed.rating ?? row.rating, comment: confirmed.comment ?? null } : row) } : p))
													}
													else {
														void reloadProfile()
													}
													notifyLocalRatingChange({ albumId: r.album_id, reviewCandidate: confirmed?.review_candidate, rating: confirmed?.rating ?? null })
													}}
												/>
											)}
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
