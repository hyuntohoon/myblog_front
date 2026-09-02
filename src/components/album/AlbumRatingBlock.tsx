// FEAT-multi-user-accounts Phase 1 — RYM-style community rating block on the
// album detail surface. Renders on BOTH the app-wide public overlay and the
// authed member modal (via AlbumDetailView.topSlot). Reads are public; the write
// panel appears only when signed in. Everything here is public-bundle-safe.
import type { MyRerating } from './reratings.api'
import type { AlbumRatingAggregate, MyAlbumState } from './reviews.api'
import { useEffect, useRef, useState } from 'react'
import { goLogin, isLoggedIn } from '@lib/auth'
import { isPlaceholderIdentity } from '@lib/member'
import { notifyAlbumStateChanged } from '@lib/entityEvents'
import { isOwnerUser } from '@lib/owner'
import { writePostLoginIntent } from '@lib/postLoginIntent'
import { Stars } from '../member/ui'
import HalfStarInput from './HalfStarInput'
import { cancelRerating, fetchMyReratings, startRerating } from './reratings.api'
import {
	deleteMyReview,
	fetchAlbumReviews,
	fetchMyAlbumStates,
	fetchMyHandle,
	putAlbumBestNew,
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

/**
 * Thin display identity, forwarded into a parked `rate-album` intent so the
 * resumed overlay paints its header immediately instead of flashing blank.
 */
export interface RatingAlbumDisplay {
	title?: string
	artist?: string
	cover?: string | null
	year?: number | null
}

export default function AlbumRatingBlock({ albumId, openRating = false, display }: {
	albumId: string
	/**
	 * FIX-auth-identity-lifecycle Step 2 — open the editor once my current 평가
	 * has loaded. Set only by the post-login resume, completing a "로그인하고 평가
	 * 남기기" the visitor started while logged out.
	 */
	openRating?: boolean
	display?: RatingAlbumDisplay
}) {
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
	/**
	 * The editor's copy of the 평론 후보 mark. `null` means UNTOUCHED in this
	 * editing session, and that is the whole point of the tri-state: `marked`
	 * comes from an authed read that may not have landed yet, so seeding a
	 * boolean here and posting it back would let a fast 저장 clear a real mark
	 * with a default. Untouched ⇒ the key is omitted from the PUT entirely,
	 * preserving the partial-write property this panel has always relied on.
	 */
	const [markDraft, setMarkDraft] = useState<boolean | null>(null)
	const [err, setErr] = useState<string | null>(null)
	// Owner-only affordance (isOwnerUser is fail-closed — a member never sees
	// this even briefly). Resolved separately from `authed` since any signed-in
	// member passes that check post multi-user.
	const [isOwner, setIsOwner] = useState(false)
	const [bestNewSaving, setBestNewSaving] = useState(false)
	// FEAT-album-rerating: MY open 재평가 for this album, if any. Read from the
	// author-only list because it carries the withdrawn score — the public album
	// payload has no idea a 재평가 exists, by design.
	const [rerating, setRerating] = useState<MyRerating | null>(null)
	// The resume must not open the editor before `myReview` exists, or startEdit()
	// seeds the 4-star default over a 평가 the member already has. Flipped once the
	// authed reads for THIS album have settled.
	const [mineLoaded, setMineLoaded] = useState(false)

	const authed = isLoggedIn()

	async function load() {
		const a = await fetchAlbumReviews(albumId)
		setAgg(a)
		return a
	}

	useEffect(() => {
		let alive = true
		setMyState(null)
		setRerating(null)
		setMineLoaded(false)
		load().then(() => {
			if (alive && authed) {
				// `mineLoaded` waits on the two reads startEdit() seeds from — the
				// handle (which decides `myReview`) and the stored state. The owner
				// and 재평가 reads only paint extra affordances.
				const handle = fetchMyHandle().then(h => alive && setMyHandle(h))
				const state = fetchMyAlbumStates(albumId).then(s => alive && setMyState(s[0] ?? null))
				fetchMyReratings().then(rs => alive && setRerating(rs.find(r => r.album_id === albumId) ?? null))
				isOwnerUser().then(v => alive && setIsOwner(v))
				// A failed read still settles: the resume opening an empty editor is a
				// far better outcome than the visitor's click vanishing a second time.
				Promise.allSettled([handle, state]).then(() => alive && setMineLoaded(true))
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
		setMarkDraft(null)
		setErr(null)
		setEditing(true)
	}

	// The resume's auto-open. A ref, not state: it must fire exactly once per
	// album, and it is deliberately gated on `mineLoaded` rather than on mount —
	// `startEdit` seeds the draft from `myReview`, which does not exist yet when
	// the block first paints. Reset per album so reopening the overlay on a
	// different one during the same page life re-arms it.
	const autoOpened = useRef(false)
	useEffect(() => {
		autoOpened.current = false
	}, [albumId])
	useEffect(() => {
		if (!openRating || !authed || !mineLoaded || autoOpened.current)
			return
		autoOpened.current = true
		startEdit()
		// Deps are deliberately the three gates and nothing else: `startEdit` reads
		// render-time state, and re-running on its identity would reopen an editor
		// the member had just closed.
	}, [openRating, authed, mineLoaded])

	async function save() {
		setSaving(true)
		setErr(null)
		try {
			// Partial by design: the `review_candidate` key appears ONLY when the
			// author actually moved the checkbox in this session (markDraft !== null),
			// so saving a rating still cannot disturb a mark this panel may not have
			// loaded yet. FEAT-album-review-authoring Step 4 / OQ14 — the mark now
			// rides the same write as the 평가 because that is what "put it in the
			// entry" means: the RFC added C6 to connect 평가 to 평론 후보, and with the
			// two on separate controls the connection was never made once (1 mark
			// ever, 0 of 38 rated rows marked, prod 2026-09-03).
			const res = await putMyAlbumState(albumId, {
				rating: draftRating,
				comment: draftComment.trim() || null,
				...(markDraft === null ? {} : { review_candidate: markDraft }),
			})
			if (!res) {
				setErr('저장에 실패했습니다. 다시 시도해 주세요.')
				return
			}
			setMyState(res)
			if (!myHandle)
				fetchMyHandle().then(setMyHandle)
			await load()
			notifyAlbumStateChanged({ albumId, reviewCandidate: res.review_candidate ?? false, rating: res.rating ?? null })
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
		setErr(null)
		try {
			await deleteMyReview(albumId)
			// DELETE touches only the public rating/comment facets. Preserve the
			// already-loaded private mark instead of turning an ambiguous failed
			// follow-up read into a false unmark.
			await load()
			setMyState(prev => prev?.review_candidate ? { ...prev, rating: null, comment: null } : null)
			notifyAlbumStateChanged({ albumId, rating: null })
		}
		catch {
			setErr('삭제에 실패했습니다. 다시 시도해 주세요.')
		}
		finally {
			setSaving(false)
		}
	}

	/**
	 * Withdraw this 평가 and open a 재평가. The star really goes — that is the
	 * point — so the panel falls back to its "평가 남기기" state, with the 재평가
	 * 중 strip below carrying the withdrawn score until it is redone or cancelled.
	 *
	 * Completing it is NOT a call from here: saving a new star through the normal
	 * editor ends the 재평가 server-side, in the same transaction. Nothing on this
	 * screen has to remember to clean up.
	 */
	async function beginRerating() {
		setSaving(true)
		setErr(null)
		const result = await startRerating(albumId)
		if (result === 'ok') {
			setEditing(false)
			await load()
			setMyState((await fetchMyAlbumStates(albumId))[0] ?? null)
			setRerating((await fetchMyReratings()).find(r => r.album_id === albumId) ?? null)
			notifyAlbumStateChanged({ albumId, rating: null })
		}
		else {
			setErr(result === 'conflict' ? '되돌릴 평가가 없습니다.' : '재평가를 시작하지 못했습니다.')
		}
		setSaving(false)
	}

	/** Undo a 재평가 — the withdrawn 평가 comes back exactly as it was. */
	async function undoRerating() {
		setSaving(true)
		setErr(null)
		const ok = await cancelRerating(albumId)
		if (ok) {
			setRerating(null)
			await load()
			const restored = (await fetchMyAlbumStates(albumId))[0] ?? null
			setMyState(restored)
			notifyAlbumStateChanged({ albumId, rating: restored?.rating ?? null })
		}
		else {
			setErr('재평가를 취소하지 못했습니다.')
		}
		setSaving(false)
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

	/**
	 * Owner-only: mark/unmark this album BEST NEW. Writes `albums.best_new` —
	 * the same column the post editor's "BEST NEW MUSIC" button sets — so it is
	 * an album-wide property, not a personal pick, and shows the same on
	 * everyone's screen immediately after.
	 */
	async function toggleBestNew() {
		if (!agg)
			return
		const next = !agg.best_new
		setBestNewSaving(true)
		setErr(null)
		const res = await putAlbumBestNew(albumId, next)
		if (res == null)
			setErr('BEST NEW 표시를 바꾸지 못했습니다.')
		else
			setAgg({ ...agg, best_new: res })
		setBestNewSaving(false)
	}

	const count = agg?.count ?? 0
	const average = agg?.average ?? null

	return (
		<section className="album-rating">
			<div className="album-rating__summary">
				{agg?.best_new && <span className="mono album-rating__best-new-badge">BEST NEW ALBUM</span>}
				<div className="album-rating__community">
					<span className="meta album-rating__label">커뮤니티</span>
				{average != null ?
					(
						<div className="album-rating__community-value">
							<span className="serif album-rating__average">{average.toFixed(1)}</span>
							<Stars score={average} size={17} />
							<span className="mono album-rating__count">
								{count}
								명
							</span>
						</div>
					) :
					<span className="sans album-rating__empty">아직 평가가 없습니다</span>}
				</div>
			</div>

			{/* write panel — signed-in only */}
			{authed && (
				<div className="album-rating__mine">
					{myReview && !editing ?
						(
							<div className="album-rating__mine-row">
								<span className="meta album-rating__label">내 평가</span>
								<span className="serif album-rating__my-score">{Number(myReview.rating).toFixed(1)}</span>
								<Stars score={Number(myReview.rating)} size={16} />
								{myReview.comment && (
<span className="serif italic album-rating__my-comment">
“
{myReview.comment}
”
</span>
)}
								<div className="album-rating__row-actions">
									<button type="button" onClick={startEdit} className="album-modal__button album-modal__button--quiet">수정</button>
									<button type="button" onClick={remove} disabled={saving} className="album-modal__button album-modal__button--quiet">삭제</button>
								</div>
							</div>
						) :
						editing ?
							(
								<div className="album-rating__editor">
									<div className="album-rating__editor-score">
										<span className="meta album-rating__label">내 평가</span>
										<HalfStarInput value={draftRating} onChange={setDraftRating} />
										<span className="serif album-rating__draft-score">{draftRating.toFixed(1)}</span>
									</div>
									<textarea
										value={draftComment}
										onChange={e => setDraftComment(e.target.value)}
										placeholder="한 줄 감상 (선택)"
										maxLength={RATING_COMMENT_MAX}
										// 3, not 2 (entrance audit 2026-08-02). The 60-char cap was
										// sized off a 460px desktop overlay, where 60 chars wrap to
										// 2 lines. In the 390px modal the box is 280px wide and the
										// same 60 chars need 3 — so a full-length 한줄평 scrolled and
										// its last line was clipped mid-glyph while being typed.
										// Widening the box is the fix rather than cutting the cap:
										// the cap is the FORMAT (one line, 이동진 준거), and 60 still
										// renders as one line where a saved 평가 is read.
										rows={3}
										className="sans album-rating__textarea"
									/>
									{/* The counter is the format, made visible: a 평가 is one line,
									    so the remaining count should read as room, not as a limit
									    being approached. */}
									<div className="mono album-rating__counter">
										{draftComment.length}
										/
										{RATING_COMMENT_MAX}
									</div>
									{/* OQ9/OQ14 — the 평론 후보 mark, inside the write flow.
									    Owner-only: 평론 belongs to editors (하드 룰 1), so
									    "나중에 평론으로 쓴다" is not a thing a member can mean.
									    It saves with the 평가 in one PUT; the standalone
									    toggle below covers the other half of C6 (mark it
									    before listening, with no star), and the two never
									    show at once. */}
									{isOwner && (
										<label className="sans album-rating__mark-check">
											<input
												type="checkbox"
												checked={markDraft ?? marked}
												onChange={e => setMarkDraft(e.target.checked)}
												disabled={saving}
											/>
											<span>나중에 평론으로 쓴다</span>
											<span className="mono album-rating__private-note">나만 봅니다</span>
										</label>
									)}
									{err && <div className="sans album-rating__error">{err}</div>}
									<div className="album-rating__editor-actions">
										<button type="button" onClick={save} disabled={saving} className="album-modal__button album-modal__button--primary">{saving ? '저장 중…' : '저장'}</button>
										<button type="button" onClick={() => setEditing(false)} disabled={saving} className="album-modal__button album-modal__button--quiet">취소</button>
										{/* 재평가 lives inside the 수정 panel (owner decision): it is a
										    thing you do TO an existing 평가, so it belongs where that
										    평가 is being edited — not as a fourth always-visible button
										    that invites a mis-click on a score you meant to keep. */}
										{myReview && (
											<button type="button" onClick={beginRerating} disabled={saving} className="album-modal__button album-modal__button--quiet">재평가</button>
										)}
									</div>
								</div>
							) :
							(
								<button type="button" onClick={startEdit} className="album-modal__button album-modal__button--primary">평가 남기기</button>
							)}
					{err && !editing && <div className="sans album-rating__error">{err}</div>}

					{/* 재평가 중 (FEAT-album-rerating). Shown wherever the album is opened,
					    not only on the profile: the withdrawn score is the one thing a
					    member cannot recover from anywhere else, and 취소 has to be
					    reachable from the same screen that took it away. */}
					{rerating && (
						<div className="album-rating__mark">
							<span className="meta album-rating__label">재평가 중</span>
							<span className="mono album-rating__private-note">
								이전
								{' '}
								{Number(rerating.previous_rating).toFixed(1)}
							</span>
							<button type="button" onClick={undoRerating} disabled={saving} className="album-modal__button album-modal__button--quiet">재평가 취소</button>
						</div>
					)}

					{/* The private editorial mark. Outside the rating editor on purpose:
					    it must be reachable without opening one and without a star,
					    because it can be set before listening (RFC C6). Never shown to
					    anyone but its author — this whole panel is authed-only.

					    FEAT-album-review-authoring Step 4 adds two conditions.
					    OWNER-ONLY: this was rendered for every signed-in member, and
					    marking an album "평론 쓸 것" is meaningless for someone 하드 룰 1
					    forbids from writing one — exactly the "쓸 수 없는 평론 항목을
					    보여주지 않는다" rule C1 states. And hidden WHILE EDITING, because
					    the editor now carries the same state as a checkbox; two live
					    controls for one boolean on one screen is how they disagree. */}
					{isOwner && !editing && (
					<div className="album-rating__mark">
						<button
							type="button"
							onClick={toggleMark}
							disabled={marking}
							aria-pressed={marked}
							className={`album-modal__button album-modal__button--quiet${marked ? ' is-marked' : ''}`}
						>
							{marked ? '✓ 평론 쓸 것' : '평론 쓸 것으로 표시'}
						</button>
						<span className="mono album-rating__private-note">나만 봅니다</span>
					</div>
					)}

					{/* Owner-only. BEST NEW is an album-wide property (same column the
					    writer's "BEST NEW MUSIC" button sets), not a personal pick — so
					    unlike the mark above, this is public and visible to everyone the
					    moment it's toggled. */}
					{isOwner && agg && (
						<div className="album-rating__mark">
							<button
								type="button"
								onClick={toggleBestNew}
								disabled={bestNewSaving}
								aria-pressed={agg.best_new}
								className={`album-modal__button album-modal__button--quiet${agg.best_new ? ' is-marked' : ''}`}
							>
								{agg.best_new ? '✓ BEST NEW ALBUM' : 'BEST NEW ALBUM으로 표시'}
							</button>
						</div>
					)}
				</div>
			)}

			{/* login CTA — anonymous visitors used to get NO write affordance at all
			    (audit 2026-07-14); goLogin captures this page as the returnTo.
			    FIX-auth-identity-lifecycle Step 2: returning to the page was never
			    enough on its own — the overlay this panel lives in is client state
			    and is gone after the round trip, so the click still ended nowhere.
			    Parking a `rate-album` intent is what makes the return land back on
			    this editor. */}
			{!authed && (
				<div className="album-rating__login">
					<button
						type="button"
						onClick={() => {
							writePostLoginIntent({
								kind: 'rate-album',
								albumId,
								title: display?.title || '앨범',
								artist: display?.artist ?? null,
								cover: display?.cover ?? null,
								year: display?.year ?? null,
							})
							void goLogin(true)
						}}
						className="album-modal__button album-modal__button--quiet"
					>
						로그인하고 평가 남기기
					</button>
				</div>
			)}

			{/* review list */}
			{reviews.length > 0 && (
				<ul className="album-rating__reviews">
					{reviews.map((r) => {
						const placeholder = isPlaceholderIdentity(r.author.display_name, r.author.handle)
						return (
							<li key={r.id} className="album-rating__review">
								<div className="album-rating__review-head">
									{/* runtime member URL (OQ6): works for every member immediately —
									    the static /members/[handle] page exists only post-redeploy. */}
									<a href={`/members/?u=${encodeURIComponent(r.author.handle)}`} className={`${placeholder ? 'mono' : 'sans'} album-rating__review-author`}>{placeholder ? `@${r.author.handle}` : r.author.display_name}</a>
									<Stars score={Number(r.rating)} size={13} />
									<span className="mono album-rating__review-date">{fmtDate(r.created_at)}</span>
								</div>
								{r.comment && <p className="sans album-rating__review-comment">{r.comment}</p>}
							</li>
						)
					})}
				</ul>
			)}
		</section>
	)
}
