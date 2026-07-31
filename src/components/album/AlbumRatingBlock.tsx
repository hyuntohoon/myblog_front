// FEAT-multi-user-accounts Phase 1 — RYM-style community rating block on the
// album detail surface. Renders on BOTH the app-wide public overlay and the
// authed member modal (via AlbumDetailView.topSlot). Reads are public; the write
// panel appears only when signed in. Everything here is public-bundle-safe.
import type { AlbumRatingAggregate, MyAlbumState } from './reviews.api'
import { useEffect, useState } from 'react'
import { goLogin, isLoggedIn } from '@lib/auth'
import { isPlaceholderIdentity } from '@lib/member'
import { notifyAlbumStateChanged } from '@lib/entityEvents'
import { Stars } from '../member/ui'
import HalfStarInput from './HalfStarInput'
import {
	deleteMyReview,
	fetchAlbumReviews,
	fetchMyAlbumStates,
	fetchMyHandle,
	putMyAlbumState,
	RATING_COMMENT_MAX,
	RatingRateLimitError,
} from './reviews.api'

function fmtDate(iso: string): string {
	const d = new Date(iso)
	if (Number.isNaN(d.getTime()))
		return ''
	return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

const SECTION: React.CSSProperties = {
	marginTop: 22,
	paddingTop: 20,
	borderTop: '1px solid var(--color-border-soft)',
}

// Self-contained button styles — the app-wide album overlay can render on any
// page, so we must not depend on page-scoped button classes (research/settings).
const BTN_BASE: React.CSSProperties = { padding: '6px 13px', borderRadius: 4, cursor: 'pointer', lineHeight: 1.2 }
const BTN_PRIMARY: React.CSSProperties = { ...BTN_BASE, border: '1px solid var(--color-accent, #d8a13a)', background: 'var(--color-accent, #d8a13a)', color: '#fff' }
const BTN_QUIET: React.CSSProperties = { ...BTN_BASE, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-subtle)' }

export default function AlbumRatingBlock({ albumId }: { albumId: string }) {
	const [agg, setAgg] = useState<AlbumRatingAggregate | null>(null)
	// Handle-keyed "my rating" match (audit 2026-07-14) — the public contract's
	// author.id is the Cognito sub and is slated for removal; handle is the
	// stable public identity.
	const [myHandle, setMyHandle] = useState<string | null>(null)
	// My private state for this album (FEAT-album-review-authoring Step 1). Read
	// separately from the public aggregate: the mark is never in a public payload.
	const [myState, setMyState] = useState<MyAlbumState | null>(null)
	const [editing, setEditing] = useState(false)
	const [draftRating, setDraftRating] = useState(4)
	const [draftComment, setDraftComment] = useState('')
	const [saving, setSaving] = useState(false)
	const [marking, setMarking] = useState(false)
	const [err, setErr] = useState<string | null>(null)

	const authed = isLoggedIn()

	async function load() {
		const a = await fetchAlbumReviews(albumId)
		setAgg(a)
		return a
	}

	useEffect(() => {
		let alive = true
		setMyState(null)
		load().then(() => {
			if (alive && authed) {
				fetchMyHandle().then(h => alive && setMyHandle(h))
				fetchMyAlbumStates(albumId).then(s => alive && setMyState(s[0] ?? null))
			}
		})
		return () => {
			alive = false
		}
	}, [albumId])

	const reviews = agg?.reviews ?? []
	const myReview = myHandle ? reviews.find(r => r.author.handle === myHandle) ?? null : null
	const marked = myState?.review_candidate ?? false

	function startEdit() {
		setDraftRating(myReview ? Number(myReview.rating) : 4)
		setDraftComment(myReview?.comment ?? '')
		setErr(null)
		setEditing(true)
	}

	async function save() {
		setSaving(true)
		setErr(null)
		try {
			// Partial by design: no `review_candidate` key, so saving a rating
			// cannot disturb the mark this panel may not have loaded yet.
			const res = await putMyAlbumState(albumId, {
				rating: draftRating,
				comment: draftComment.trim() || null,
			})
			if (!res) {
				setErr('저장에 실패했습니다. 다시 시도해 주세요.')
				return
			}
			setMyState(res)
			if (!myHandle)
				fetchMyHandle().then(setMyHandle)
			await load()
			setEditing(false)
		}
		catch (e) {
			setErr(e instanceof RatingRateLimitError ? '오늘 남길 수 있는 평가 수를 초과했습니다.' : '저장에 실패했습니다.')
		}
		finally {
			setSaving(false)
		}
	}

	async function remove() {
		setSaving(true)
		const ok = await deleteMyReview(albumId)
		if (ok) {
			// The mark outlives the rating server-side, so re-read rather than
			// assuming the whole state is gone.
			await load()
			setMyState((await fetchMyAlbumStates(albumId))[0] ?? null)
		}
		setSaving(false)
		setEditing(false)
	}

	/**
	 * Flip the private editorial mark. Independent of the rating on purpose: it
	 * can be set before listening, and it is what makes a 평가 feel like picking
	 * a candidate rather than filing a verdict (RFC C6).
	 */
	async function toggleMark() {
		const next = !marked
		setMarking(true)
		setErr(null)
		try {
			const res = await putMyAlbumState(albumId, { review_candidate: next })
			// null on unmark means the state had nothing else left and the row is
			// gone — that IS the new state, not a failure.
			setMyState(res)
			notifyAlbumStateChanged({ albumId, reviewCandidate: next })
		}
		catch {
			setErr('평론 후보 표시를 바꾸지 못했습니다.')
		}
		finally {
			setMarking(false)
		}
	}

	const count = agg?.count ?? 0
	const average = agg?.average ?? null

	return (
		<div style={SECTION}>
			<div className="meta" style={{ marginBottom: 10 }}>커뮤니티 평점</div>

			<div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
				{average != null ?
					(
						<>
							<span className="serif" style={{ fontSize: 30, fontWeight: 500, lineHeight: 1 }}>{average.toFixed(1)}</span>
							<Stars score={average} size={17} />
							<span className="mono" style={{ fontSize: 11, color: 'var(--color-faded)' }}>
{count}
개 평가
       </span>
						</>
					) :
					<span className="sans" style={{ fontSize: 13.5, color: 'var(--color-subtle)' }}>아직 평가가 없습니다</span>}
			</div>

			{/* write panel — signed-in only */}
			{authed && (
				<div style={{ marginTop: 16 }}>
					{myReview && !editing ?
						(
							<div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
								<span className="mono" style={{ fontSize: 11, color: 'var(--color-faded)' }}>내 평점</span>
								<Stars score={Number(myReview.rating)} size={16} />
								{myReview.comment && (
<span className="sans" style={{ fontSize: 13, color: 'var(--color-subtle)' }}>
“
{myReview.comment}
”
</span>
)}
								<button type="button" onClick={startEdit} style={{ ...BTN_QUIET, fontSize: 12 }}>수정</button>
								<button type="button" onClick={remove} disabled={saving} style={{ ...BTN_QUIET, fontSize: 12 }}>삭제</button>
							</div>
						) :
						editing ?
							(
								<div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 460 }}>
									<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
										<HalfStarInput value={draftRating} onChange={setDraftRating} />
										<span className="mono" style={{ fontSize: 12, color: 'var(--color-subtle)' }}>{draftRating.toFixed(1)}</span>
									</div>
									<textarea
										value={draftComment}
										onChange={e => setDraftComment(e.target.value)}
										placeholder="한 줄 감상 (선택)"
										maxLength={RATING_COMMENT_MAX}
										rows={2}
										className="sans"
										style={{ width: '100%', resize: 'none', padding: '8px 10px', fontSize: 13, borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'inherit' }}
									/>
									{/* The counter is the format, made visible: a 평가 is one line,
									    so the remaining count should read as room, not as a limit
									    being approached. */}
									<div className="mono" style={{ fontSize: 11, color: 'var(--color-faded)', marginTop: -4, textAlign: 'right' }}>
										{draftComment.length}
										/
										{RATING_COMMENT_MAX}
									</div>
									{err && <div className="sans" style={{ fontSize: 12, color: 'var(--color-danger, #c0392b)' }}>{err}</div>}
									<div style={{ display: 'flex', gap: 8 }}>
										<button type="button" onClick={save} disabled={saving} style={{ ...BTN_PRIMARY, fontSize: 12.5 }}>{saving ? '저장 중…' : '저장'}</button>
										<button type="button" onClick={() => setEditing(false)} disabled={saving} style={{ ...BTN_QUIET, fontSize: 12.5 }}>취소</button>
									</div>
								</div>
							) :
							(
								<button type="button" onClick={startEdit} style={{ ...BTN_PRIMARY, fontSize: 12.5 }}>평가 남기기</button>
							)}

					{/* The private editorial mark. Outside the rating editor on purpose:
					    it must be reachable without opening one and without a star,
					    because it can be set before listening (RFC C6). Never shown to
					    anyone but its author — this whole panel is authed-only. */}
					<div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
						<button
							type="button"
							onClick={toggleMark}
							disabled={marking}
							aria-pressed={marked}
							style={{
								...BTN_BASE,
								fontSize: 12,
								border: `1px solid ${marked ? 'var(--color-accent, #d8a13a)' : 'var(--color-border)'}`,
								background: 'transparent',
								color: marked ? 'var(--color-accent, #d8a13a)' : 'var(--color-subtle)',
							}}
						>
							{marked ? '✓ 평론 쓸 것' : '평론 쓸 것으로 표시'}
						</button>
						<span className="mono" style={{ fontSize: 10.5, color: 'var(--color-faded)' }}>나만 봅니다</span>
					</div>
				</div>
			)}

			{/* login CTA — anonymous visitors used to get NO write affordance at all
			    (audit 2026-07-14); goLogin captures this page as the returnTo. */}
			{!authed && (
				<div style={{ marginTop: 16 }}>
					<button type="button" onClick={() => void goLogin(true)} style={{ ...BTN_QUIET, fontSize: 12.5 }}>로그인하고 평가 남기기</button>
				</div>
			)}

			{/* review list */}
			{reviews.length > 0 && (
				<ul style={{ listStyle: 'none', margin: '18px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
					{reviews.map((r) => {
						const placeholder = isPlaceholderIdentity(r.author.display_name, r.author.handle)
						return (
							<li key={r.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
								<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
									{/* runtime member URL (OQ6): works for every member immediately —
									    the static /members/[handle] page exists only post-redeploy. */}
									<a href={`/members/?u=${encodeURIComponent(r.author.handle)}`} className={placeholder ? 'mono' : 'sans'} style={{ fontSize: 13, fontWeight: 500 }}>{placeholder ? `@${r.author.handle}` : r.author.display_name}</a>
									<Stars score={Number(r.rating)} size={13} />
									<span className="mono" style={{ fontSize: 10, color: 'var(--color-faded)' }}>{fmtDate(r.created_at)}</span>
								</div>
								{r.comment && <p className="sans" style={{ margin: 0, fontSize: 13.5, color: 'var(--color-subtle)', lineHeight: 1.5 }}>{r.comment}</p>}
							</li>
						)
					})}
				</ul>
			)}
		</div>
	)
}
