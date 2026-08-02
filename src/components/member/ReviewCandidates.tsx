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
import { fetchMyReviewCandidates } from '../album/reviews.api'
import { AlbumArt, SectionTitle, Stars } from './ui'

function CandidateCard({ c }: { c: ReviewCandidate }) {
	const open = () => openAlbum({ albumId: c.album_id, title: c.album_title, cover: c.album_cover_url })
	return (
		<article className="panel" style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center', background: 'var(--color-bg)' }}>
			<button type="button" onClick={open} title={c.album_title} style={{ flex: '0 0 auto', width: 56, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}>
				<AlbumArt url={c.album_cover_url} label={c.album_title} size={56} />
			</button>
			<div style={{ flex: 1, minWidth: 0 }}>
				<button
					type="button"
					onClick={open}
					className="serif italic"
					style={{ display: 'block', maxWidth: '100%', fontSize: 17, fontWeight: 500, lineHeight: 'var(--leading-tight)', padding: 0, border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
				>
					{c.album_title}
				</button>
				{c.artist_name && (
					<div className="sans" style={{ marginTop: 3, fontSize: 'var(--text-xs)', color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
						{c.artist_id ?
							<a href={artistHref(c.artist_id)} style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3, textDecorationColor: 'var(--color-faded)' }}>{c.artist_name}</a> :
							c.artist_name}
					</div>
				)}
				{/* What is already done, so the queue distinguishes "marked, not heard"
				    from "heard and rated, still to write". Stars renders 미평가 for null. */}
				<div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, minWidth: 0 }}>
					<Stars score={c.rating ?? null} size={13} />
					{c.comment && (
						<span className="sans" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.comment}</span>
					)}
				</div>
			</div>
			{/* ?album= prefills the editor's subject (same entry AlbumDetail uses). The
			    queue exists to remove a lookup, so handing the editor a blank subject
			    and making the owner find the album again would undo its whole point —
			    this is not the unified entry of Step 4, just the album carried through. */}
			<a href={`/write?album=${encodeURIComponent(c.album_id)}`} className="chip" style={{ flex: '0 0 auto', textDecoration: 'none' }}>평론 쓰기</a>
		</article>
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
				href="?tab=bucket"
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
			<SectionTitle kicker={rows.length > 0 ? `${rows.length}개` : undefined} title="평론 쓸 것" />
			{rows.length === 0 ?
				<NoCandidatesYet /> :
				(
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px,1fr))', gap: 12 }}>
						{rows.map(c => <CandidateCard key={c.album_id} c={c} />)}
					</div>
				)}
		</div>
	)
}
