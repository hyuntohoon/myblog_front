/**
 * FEAT-album-review-authoring Step 2 — the profile's 평가 이력 statistics.
 *
 * Everything here is derived, not fetched. GET /api/members/{handle} already
 * returns the member's WHOLE rating feed (it is not paginated), and every value
 * C5 asks for — 개수 · 평균 · 별점 분포 · 정렬 — is a fold over rows we already
 * hold. So Step 2 adds no endpoint, no column and no index for the history side;
 * the only backend work it needed was the "평론 쓸 것" queue (RFC OQ7, 2026-08-02).
 *
 * This replaces `computeStats` in lib/member.ts, which was dead AND wrong-shaped:
 * it folded MemberReview[] — 평론 posts from the build-time blog collection —
 * whose `albums` count deliberately excluded 칼럼 and de-duplicated by a
 * "title|artist" string. A 평가 history needs none of that: one row IS one album
 * (UNIQUE (user_id, album_id)), and there are no columns in it.
 *
 * If the feed ever becomes paginated these stats must move server-side — a fold
 * over one page would silently report the page's average as the member's.
 */
import type { MemberRating } from '../components/album/reviews.api'

/** Rating scale: 0.5–5.0 in half steps (the DB CHECK), lowest bucket first. */
export const RATING_BUCKETS: readonly number[] = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]

export type RatingSortKey = 'recent' | 'score' | 'name'

export const RATING_SORTS: readonly { v: RatingSortKey, label: string }[] = [
	{ v: 'recent', label: '최신' },
	{ v: 'score', label: '별점' },
	{ v: 'name', label: '이름' },
]

export interface RatingStats {
	/** Albums rated. One row is one album, so this is also the row count. */
	count: number
	/** Mean rating to one decimal; null when nothing is rated yet. */
	average: number | null
	/** Rows per half-step, index-aligned with RATING_BUCKETS. */
	distribution: number[]
	/** The tallest bucket's height — the bars' scale denominator. 0 when empty. */
	peak: number
}

/** Half-step index for a rating, or -1 if it is off-scale (never, given the CHECK). */
function bucketIndex(rating: number): number {
	const i = Math.round(rating * 2) - 1
	return i >= 0 && i < RATING_BUCKETS.length ? i : -1
}

export function computeRatingStats(rows: readonly MemberRating[]): RatingStats {
	const distribution = RATING_BUCKETS.map(() => 0)
	let sum = 0
	let count = 0
	for (const r of rows) {
		const v = Number(r.rating)
		if (!Number.isFinite(v))
			continue
		const i = bucketIndex(v)
		if (i < 0)
			continue
		distribution[i] += 1
		sum += v
		count += 1
	}
	return {
		count,
		average: count === 0 ? null : Math.round((sum / count) * 10) / 10,
		distribution,
		peak: distribution.reduce((m, n) => Math.max(m, n), 0),
	}
}

/**
 * Sort a rating feed. Returns a new array — the caller's feed is the fetched
 * response and stays in its server order (newest first).
 *
 * 이름순 is album title first, artist second (owner decision 2026-08-02, OQ7):
 * a member scanning for one album looks for its title, and the artist only
 * decides ties. Collated with ko-KR so 한글 sorts by 가나다 rather than by code
 * point, which would scatter 한글 after every Latin title.
 */
export function sortRatings(rows: readonly MemberRating[], key: RatingSortKey): MemberRating[] {
	const out = rows.slice()
	const byName = (a: MemberRating, b: MemberRating) =>
		(a.album_title ?? '').localeCompare(b.album_title ?? '', 'ko-KR') ||
		(a.artist_name ?? '').localeCompare(b.artist_name ?? '', 'ko-KR')
	const byRecent = (a: MemberRating, b: MemberRating) =>
		new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
	if (key === 'name')
		return out.sort(byName)
	if (key === 'score') {
		// Equal stars fall back to 이름, not to feed order: two 4.5s next to each
		// other in an arbitrary order read as a glitch while scanning by score.
		return out.sort((a, b) => (Number(b.rating) - Number(a.rating)) || byName(a, b))
	}
	return out.sort(byRecent)
}
