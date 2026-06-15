// FEAT-artist-page — build the "평론한 앨범" (reviewed-albums) overlay for an
// artist hub from the `blog` content collection at build time. The site's reviews
// are MDX in the collection (each frontmatter carries artistIds[] + albumIds[]),
// so this needs NO runtime backend call — it mirrors lib/reviews.ts derivations
// but keys on the artist and exposes the linked album id for catalog dimming.

import type { CollectionEntry } from 'astro:content'

export interface ArtistReviewCard {
	/**
	 * First linked album DB id — matches the music /albums catalog `id` so the
	 *  hub can split reviewed vs catalog. null when the review links no album.
	 */
	albumId: string | null
	album: string
	year: number | null
	/** Single display genre (tier-0). Empty when the review carries none. */
	genre: string | null
	/** Normalized 0–5 (scale 10 → /2); null when unrated. */
	rating: number | null
	bestNew: boolean
	/** Editorial pull quote (the dek). May be '' — the card hides it then. */
	pull: string
	/** → /review/{slug}/ */
	slug: string
	cover: string | null
}

function normalizeRating(d: CollectionEntry<'blog'>['data']): number | null {
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
	return value == null ? null : scale === 10 ? value / 2 : value
}

/**
 * Reviewed-album cards for one artist, newest first. A blog entry is a review
 *  iff it is non-draft and has a rating / musicReview / linked album.
 */
export function buildArtistReviews(
	entries: CollectionEntry<'blog'>[],
	artistId: string,
): ArtistReviewCard[] {
	return entries
		.filter(
			e =>
				!e.data.draft &&
				(e.data.artistIds ?? []).includes(artistId) &&
				(e.data.rating != null || e.data.musicReview != null || e.data.albumIds.length > 0),
		)
		.sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime())
		.map((entry) => {
			const d = entry.data
			const mr = d.musicReview
			const date = new Date(d.date)
			return {
				albumId: d.albumIds?.[0] ?? null,
				album: mr?.title ?? d.title,
				year: Number.isNaN(date.getTime()) ? null : date.getFullYear(),
				genre: mr?.genres?.[0] ?? null,
				rating: normalizeRating(d),
				bestNew: d.bestNew,
				pull: d.description ?? '',
				slug: d.slug ?? entry.id,
				cover: d.albumCover ?? d.image ?? mr?.cover?.src ?? null,
			} satisfies ArtistReviewCard
		})
}
