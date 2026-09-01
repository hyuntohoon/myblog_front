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
	/** ARCH-entity-interaction-v2 E7 — first linked DB album id, null when none. */
	albumId: string | null
}

let cache: ReviewHit[] | null = null
let inflight: Promise<ReviewHit[]> | null = null

/**
 * Fetch the review index once (memoized for the page lifetime).
 *
 * FIX-user-flow-state-consistency leg 3 — this used to resolve `[]` on any
 * transport or non-2xx response. Two things were wrong with that. The failure
 * was indistinguishable from "no reviews match", so both search surfaces
 * rendered a dead backend as 검색 결과 없음; and because the rejected fetch
 * stayed parked in `inflight` while `cache` was never filled, the very first
 * failure pinned the 평론 facet empty for the rest of the page's life — every
 * later query reused the resolved-empty promise and never went back to the
 * network. It now rejects and drops the memo, so the caller can say what
 * happened and the next query reconnects.
 */
export function loadReviews(): Promise<ReviewHit[]> {
	if (cache)
		return Promise.resolve(cache)
	if (!inflight) {
		inflight = fetch('/search-index.json')
			.then((r) => {
				if (!r.ok)
					throw new Error(`HTTP ${r.status}`)
				return r.json() as Promise<ReviewHit[]>
			})
			.then((d) => {
				cache = d
				return d
			})
			.catch((err) => {
				inflight = null
				throw err
			})
	}
	return inflight
}

/** Test seam — drop the memoized index so a case starts from a cold fetch. */
export function resetReviewIndex(): void {
	cache = null
	inflight = null
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
