// FEAT-multi-user-accounts Phase 1 — RYM-style community rating block on the
// album detail surface. Renders on BOTH the app-wide public overlay and the
// authed member modal (via AlbumDetailView.topSlot). Reads are public; the write
// panel appears only when signed in. Everything here is public-bundle-safe.
import type { AlbumReviewAggregate } from './reviews.api'
import { useEffect, useState } from 'react'
import { isLoggedIn } from '@lib/auth'
import { Stars } from '../member/ui'
import HalfStarInput from './HalfStarInput'
import {
	deleteMyReview,
	fetchAlbumReviews,
	fetchMyId,
	putMyReview,
	ReviewRateLimitError,
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
	const [agg, setAgg] = useState<AlbumReviewAggregate | null>(null)
	const [myId, setMyId] = useState<string | null>(null)
	const [editing, setEditing] = useState(false)
	const [draftRating, setDraftRating] = useState(4)
	const [draftComment, setDraftComment] = useState('')
	const [saving, setSaving] = useState(false)
	const [err, setErr] = useState<string | null>(null)

	const authed = isLoggedIn()

	async function load() {
		const a = await fetchAlbumReviews(albumId)
		setAgg(a)
		return a
	}

	useEffect(() => {
		let alive = true
		load().then(() => {
			if (alive && authed)
				fetchMyId().then(id => alive && setMyId(id))
		})
		return () => {
			alive = false
		}
	}, [albumId])

	const reviews = agg?.reviews ?? []
	const myReview = myId ? reviews.find(r => r.author.id === myId) ?? null : null

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
			const res = await putMyReview(albumId, draftRating, draftComment.trim() || null)
			if (!res) {
				setErr('저장에 실패했습니다. 다시 시도해 주세요.')
				return
			}
			// pick up my id from the write response if we didn't have it yet
			if (!myId)
				setMyId(res.author.id)
			await load()
			setEditing(false)
		}
		catch (e) {
			setErr(e instanceof ReviewRateLimitError ? '오늘 남길 수 있는 평가 수를 초과했습니다.' : '저장에 실패했습니다.')
		}
		finally {
			setSaving(false)
		}
	}

	async function remove() {
		setSaving(true)
		const ok = await deleteMyReview(albumId)
		if (ok)
			await load()
		setSaving(false)
		setEditing(false)
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
										maxLength={4000}
										rows={2}
										className="sans"
										style={{ width: '100%', resize: 'vertical', padding: '8px 10px', fontSize: 13, borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'inherit' }}
									/>
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
				</div>
			)}

			{/* review list */}
			{reviews.length > 0 && (
				<ul style={{ listStyle: 'none', margin: '18px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
					{reviews.map(r => (
						<li key={r.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
							<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
								<a href={`/members/${r.author.handle}/`} className="sans" style={{ fontSize: 13, fontWeight: 500 }}>{r.author.display_name}</a>
								<Stars score={Number(r.rating)} size={13} />
								<span className="mono" style={{ fontSize: 10, color: 'var(--color-faded)' }}>{fmtDate(r.created_at)}</span>
							</div>
							{r.comment && <p className="sans" style={{ margin: 0, fontSize: 13.5, color: 'var(--color-subtle)', lineHeight: 1.5 }}>{r.comment}</p>}
						</li>
					))}
				</ul>
			)}
		</div>
	)
}
