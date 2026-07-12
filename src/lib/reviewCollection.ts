/**
 * Blog-collection → MemberReview[] mapper (profile→member merge PR2).
 *
 * The ONE implementation turning the build-time `blog` content collection into
 * the dashboard's 평론 rows. Shared by:
 *   - /profile (profile.astro server props), and
 *   - /profile-reviews.json (prerendered static JSON the /members/[handle]
 *     self-dashboard fetches at runtime for the owner)
 * so the two surfaces can never drift. Extracted verbatim from profile.astro.
 */
import type { CollectionEntry } from 'astro:content'
import type { MemberReview, MemberReviewType } from './member'

/** Strip markdown to a short plain-text excerpt fallback. */
function stripExcerpt(body: string | undefined): string {
	if (!body)
		return ''
	return body
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[#>*_`~-]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 160)
}

// All of the member's own posts (not just reviews) — typed for the 평론 tab.
// 트랙 리뷰 = musicReview.subject 'track'; 칼럼 = essay (no rating/album/review
// metadata); else 앨범 리뷰. Rating normalized to the canonical 0–5 scale.
export function buildMemberReviews(entries: CollectionEntry<'blog'>[]): MemberReview[] {
	return entries
		.filter(e => !e.data.draft)
		.sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime())
		.map((entry) => {
			const d = entry.data
			const mr = d.musicReview
			let value: number | null = null
			let scale: 5 | 10 = 5
			if (d.rating != null) {
				value = d.rating
				scale = d.ratingScale
			}
			else if (mr?.rating?.value != null) {
				value = mr.rating.value
				scale = mr.rating.scale
			}
			const rating = value == null ? null : scale === 10 ? value / 2 : value
			const isReview = d.rating != null || mr != null || d.albumIds.length > 0
			const type: MemberReviewType = mr?.subject === 'track' ? '트랙 리뷰' : isReview ? '앨범 리뷰' : '칼럼'
			const date = new Date(d.date)
			return {
				slug: d.slug ?? entry.id,
				postId: d.postId,
				type,
				album: mr?.title ?? d.title,
				artist: mr?.artists?.join(', ') ?? '',
				genre: mr?.genres?.[0] ?? d.category,
				year: date.getFullYear(),
				rating,
				date: date.toISOString(),
				excerpt: d.description || stripExcerpt(entry.body),
				cover: d.albumCover ?? d.image ?? mr?.cover?.src ?? null,
				albumIds: d.albumIds ?? [],
			} satisfies MemberReview
		})
}
