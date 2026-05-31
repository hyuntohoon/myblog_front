/**
 * Shared review-index helpers (RFC FEAT-reviews-redesign).
 *
 * `ReviewCard` is the JSON-safe, normalized shape the `/reviews` page serializes
 * server-side and hands to the React island (`ReviewsIndex.tsx`). Keep it plain
 * (ISO date strings, no class instances) so Astro can serialize it as props.
 */
export interface ReviewCard {
  slug: string
  album: string
  artist: string
  /** Array-aware genres (forward-compat with FEAT-genre-taxonomy); falls back to [category]. */
  genres: string[]
  category: string
  /** ISO date string (JSON-safe). */
  date: string
  year: number
  /** Normalized to a 0–5 scale for partial-stars; null when unrated. */
  rating: number | null
  bestNew: boolean
  cover: string | null
  excerpt: string
}

/**
 * Featured selection (RFC decision, 2026-05-31):
 * latest Best New Music first; fill remaining slots to 3 with the highest-rated
 * of the rest; if there is no BNM at all, fall back to the latest 3. Never short.
 *
 * `reviews` is expected pre-sorted date-desc (so BNM picks are the latest).
 */
export function selectFeatured(reviews: ReviewCard[]): ReviewCard[] {
  const bnm = reviews.filter(r => r.bestNew)
  if (bnm.length === 0)
return reviews.slice(0, 3)
  const rest = reviews
    .filter(r => !r.bestNew)
    .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1))
  return [...bnm, ...rest].slice(0, 3)
}

/** Distinct genres across all reviews, in first-seen order (for the chip rail). */
export function allGenres(reviews: ReviewCard[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of reviews) {
    for (const g of r.genres) {
      if (g && !seen.has(g)) {
        seen.add(g)
        out.push(g)
      }
    }
  }
  return out
}

/** Distinct years across all reviews, newest first (for the year <select>). */
export function allYears(reviews: ReviewCard[]): number[] {
  const seen = new Set<number>()
  for (const r of reviews) seen.add(r.year)
  return [...seen].sort((a, b) => b - a)
}
