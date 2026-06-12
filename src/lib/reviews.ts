/**
 * Shared review-index helpers (RFC FEAT-reviews-redesign).
 *
 * `ReviewCard` is the JSON-safe, normalized shape the `/reviews` page serializes
 * server-side and hands to the React island (`ReviewsIndex.tsx`). Keep it plain
 * (ISO date strings, no class instances) so Astro can serialize it as props.
 */
import type { CollectionEntry } from 'astro:content'

export interface ReviewCard {
  slug: string
  album: string
  artist: string
  /**
   * Real tier-0 genres from album_genres frontmatter (FEAT-genre-system Step 6).
   * May be empty — a rating-only post or an unlabeled album has no genres; the
   * category is NOT used as a fake genre fallback anymore.
   */
  genres: string[]
  category: string
  /** STAB-5 review tags (seeded vocabulary); drives the tag filter + card badges. */
  tags: string[]
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

/** Distinct review tags across all reviews, in first-seen order (for the tag rail). */
export function allTags(reviews: ReviewCard[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of reviews) {
    for (const t of r.tags) {
      if (t && !seen.has(t)) {
        seen.add(t)
        out.push(t)
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

/**
 * Build the normalized, date-desc `ReviewCard[]` from a `blog` collection.
 *
 * Review selection (RFC): a post is a review when it has a top-level rating,
 * musicReview metadata, or linked albums; drafts excluded. The JSON-safe array
 * is what both the home (`/`) and `/reviews` pages hand to the React island.
 */
export function buildReviewCards(entries: CollectionEntry<'blog'>[]): ReviewCard[] {
  return entries
    .filter(
      e =>
        !e.data.draft &&
        (e.data.rating != null || e.data.musicReview != null || e.data.albumIds.length > 0),
    )
    .sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime())
    .map((entry) => {
      const d = entry.data
      const mr = d.musicReview
      // Canonical rating is top-level (publish service writes rating + ratingScale,
      // 0–5 range); fall back to the legacy nested musicReview.rating. Normalize 0–5.
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
      const date = new Date(d.date)
      return {
        slug: d.slug ?? entry.id,
        album: mr?.title ?? d.title,
        artist: mr?.artists?.join(', ') ?? '',
        genres: mr?.genres ?? [],
        category: d.category,
        tags: d.tags ?? [],
        date: date.toISOString(),
        year: date.getFullYear(),
        rating,
        bestNew: d.bestNew,
        cover: d.albumCover ?? d.image ?? mr?.cover?.src ?? null,
        excerpt: d.description || stripExcerpt(entry.body),
      } satisfies ReviewCard
    })
}
