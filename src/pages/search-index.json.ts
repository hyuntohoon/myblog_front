// FEAT-global-search — build-time 평론(reviews) search index. The global search's
// first-class facet searches the critic's published reviews; reviews live in the
// `blog` content collection (build-time), so we emit a static JSON the /search
// island fetches once and filters client-side (replacing Pagefind's body index).
// Respects content.config `searchIndex:false` (hide-from-search). Flat-per-review
// — fine to hundreds of reviews; revisit a chunked index past ~500.
import type { APIRoute } from 'astro'
import { buildReviewCards } from '@lib/reviews'
import { getCollection } from 'astro:content'

/** Strip markdown to a plain searchable string (fenced code + syntax removed). */
function strip(md: string | undefined): string {
	return (md ?? '')
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/[#>*_`~[\]()!-]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

export const prerender = true

export const GET: APIRoute = async () => {
	const entries = (await getCollection('blog')).filter(e => e.data.searchIndex !== false)
	const bodyBySlug = new Map(entries.map(e => [e.data.slug ?? e.id, strip(e.body)]))
	const index = buildReviewCards(entries).map(c => ({
		slug: c.slug,
		album: c.album,
		artist: c.artist,
		genres: c.genres,
		year: c.year,
		rating: c.rating,
		bestNew: c.bestNew,
		cover: c.cover,
		excerpt: c.excerpt,
		body: bodyBySlug.get(c.slug) ?? '',
	}))
	return new Response(JSON.stringify(index), {
		headers: { 'Content-Type': 'application/json' },
	})
}
