// FEAT-global-search — the 평론(reviews) search index, shared by the /search page
// island and the header dropdown. Fetched once from the build-time
// /search-index.json (emitted by src/pages/search-index.json.ts) and filtered
// client-side. Replaces Pagefind's body index for review search.

export interface ReviewHit {
	slug: string
	album: string
	artist: string
	genres: string[]
	year: number
	rating: number | null
	bestNew: boolean
	cover: string | null
	excerpt: string
	body: string
}

let cache: ReviewHit[] | null = null
let inflight: Promise<ReviewHit[]> | null = null

/** Fetch the review index once (memoized for the page lifetime). Empty on error. */
export function loadReviews(): Promise<ReviewHit[]> {
	if (cache)
		return Promise.resolve(cache)
	if (!inflight) {
		inflight = fetch('/search-index.json')
			.then(r => (r.ok ? (r.json() as Promise<ReviewHit[]>) : []))
			.then((d) => {
				cache = d
				return d
			})
			.catch(() => [])
	}
	return inflight
}

/** Substring match over album / artist / genres / excerpt / body. */
export function filterReviews(idx: ReviewHit[], q: string): ReviewHit[] {
	const n = q.trim().toLowerCase()
	if (!n)
		return []
	return idx.filter(r =>
		r.album.toLowerCase().includes(n) ||
		r.artist.toLowerCase().includes(n) ||
		r.genres.some(g => g.toLowerCase().includes(n)) ||
		r.excerpt.toLowerCase().includes(n) ||
		r.body.toLowerCase().includes(n),
	)
}
