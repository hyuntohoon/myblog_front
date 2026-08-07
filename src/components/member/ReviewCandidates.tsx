// FEAT-album-review-authoring Step 2 — the "평론 쓸 것" queue (RFC C6, harvest half).
//
// Step 1 shipped placing and clearing the mark on the album and bucket surfaces;
// this is where the marks gather. It replaces what the owner does by hand today:
// keeping a bucket literally named `To Review` and moving albums between buckets
// to mean "stage" (RFC 하드 룰 3-3 — a bucket name is a label, never a fact).
//
// PRIVATE. It sits in the 평론 tab, which mounts only inside the self-dashboard
// behind the authed self check, and it is fed by a JWT-scoped endpoint with no
// handle parameter. A mark others could see becomes a promise, and a promise
// can't be marked lightly.
//
// Placement: the 평론 tab already reads 초안 → 발행된 평론. The queue is the stage
// before a 초안 exists, so it goes on top and the tab reads as one pipeline.
import type { ReviewCandidate } from '../album/reviews.api'
import { useEffect, useState } from 'react'
import { openAlbum } from '@lib/entityEvents'
import { artistHref } from '@lib/entityLinks'
import { HomeAlbumCardAdapter } from '@components/home/HomeAlbumCardAdapter'
import { fetchMyReviewCandidates } from '../album/reviews.api'
import { boardTabHref } from './dashboardLinks'
import { SectionTitle, Stars } from './ui'

const CANDIDATE_CARD_CSS = `
.review-candidate-card .album-card{--album-card-cover-size:56px}
.review-candidate-card .album-card__cover{border-radius:3px}
.review-candidate-card .album-card__title{font-size:17px;line-height:var(--leading-tight)}
.review-candidate-card .album-card__badge{max-width:calc(100% - 8px);left:4px;bottom:4px;padding:2px 4px;border-radius:3px;background:color-mix(in srgb,var(--color-bg) 88%,transparent);backdrop-filter:blur(3px)}
.review-candidate-card .album-card__badge .unrated{font-size:9px;color:var(--color-subtle)}
.review-candidate-card .album-card__secondary{display:flex;align-items:center;gap:10px;min-width:0}
.review-candidate-card .review-candidate-comment{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--color-subtle)}
.review-candidate-card .review-candidate-write{flex:0 0 auto;margin-left:auto;color:inherit;text-decoration:none}
`

/** Private review-queue adapter. Editorial state stays entirely in the slots. */
export function ReviewCandidateAlbumCardAdapter({ c }: { c: ReviewCandidate }) {
	const open = () => openAlbum({ albumId: c.album_id, title: c.album_title, cover: c.album_cover_url })
	return (
		<div className="panel review-candidate-card" style={{ padding: 12, background: 'var(--color-bg)' }}>
			<HomeAlbumCardAdapter
				data={{
					catalogAlbumId: c.album_id,
					spotifyAlbumId: null,
					title: c.album_title,
					artist: c.artist_name ?? null,
					artistId: c.artist_id ?? null,
					cover: c.album_cover_url ?? null,
					year: null,
				}}
				layout="row"
				capabilities={{
					open,
					...(c.artist_id ? { artistOpen: () => window.location.assign(artistHref(c.artist_id!)) } : {}),
				}}
				badge={<Stars score={c.rating ?? null} size={11} />}
				secondaryLine={(
					<span className="sans" style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', fontSize: 'var(--text-xs)' }}>
						{c.comment && <span className="review-candidate-comment">{c.comment}</span>}
						<a href={`/write?album=${encodeURIComponent(c.album_id)}`} className="chip review-candidate-write">평론 쓰기 →</a>
					</span>
				)}
			/>
		</div>
	)
}

/**
 * The empty case, which on the day this ships IS the case: prod holds zero marks
 * (RFC Step 2 실측 2026-08-02). It is rendered rather than hidden on purpose —
 * the mark is two days old and the owner has not used it once, so a section that
 * disappears when unused can never teach that it exists. It says what the mark
 * is for and points at the two places that can set it.
 */
function NoCandidatesYet() {
	return (
		<div style={{ padding: '20px', border: '1px dashed var(--color-border)', borderRadius: 6 }}>
			<p className="sans" style={{ margin: 0, fontSize: 'var(--text-base)', color: 'var(--color-subtle)', lineHeight: 'var(--leading-normal)' }}>
				평론으로 쓰고 싶은 앨범에 표시를 남겨 두면 여기 모입니다. 표시는 나만 보이고, 아직 안 들은 앨범에도 찍어둘 수 있어요.
			</p>
			<a
				href={boardTabHref()}
				className="mono"
				style={{ display: 'inline-block', marginTop: 12, fontSize: 'var(--text-2xs)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-accent)', textDecoration: 'none', borderBottom: '1px solid currentColor', paddingBottom: 2 }}
			>
				버킷에서 표시하기 →
			</a>
		</div>
	)
}

export function ReviewCandidates() {
	const [rows, setRows] = useState<ReviewCandidate[] | null>(null)
	useEffect(() => {
		let alive = true
		fetchMyReviewCandidates()
			.then(r => alive && setRows(r))
			// An empty queue and a failed read look the same to the eye, so a failure
			// resolves to empty rather than an error box: this section is never the
			// reason someone came to the tab.
			.catch(() => alive && setRows([]))
		return () => {
			alive = false
		}
	}, [])

	// Nothing at all until the first read lands — a section that appears empty and
	// then fills in reads as a bug.
	if (rows == null)
		return null

	return (
		<div style={{ marginBottom: 30 }}>
			<style>{CANDIDATE_CARD_CSS}</style>
			<SectionTitle kicker={rows.length > 0 ? `${rows.length}개` : undefined} title="평론 쓸 것" />
			{rows.length === 0 ?
				<NoCandidatesYet /> :
				(
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px,1fr))', gap: 12 }}>
						{rows.map(c => <ReviewCandidateAlbumCardAdapter key={c.album_id} c={c} />)}
					</div>
				)}
		</div>
	)
}
