/**
 * Site nav lists shared by the header and footer (FEAT-public-surfaces-before-first-review Step 1).
 *
 * Reviews, Best New Music and Canon are built from 평론 (the `blog` collection),
 * so with 0 평론 they lead a logged-out visitor to three empty pages. Those links
 * carry `reviewBuilt` and are dropped while the build has 0 평론; the routes stay
 * reachable by URL. Publishing the first 평론 commits an `.mdx` to this repo, so
 * the deploy that ships it also brings the links back — no flag to flip.
 */

export interface NavLink {
  title: string
  url: string
  reviewBuilt?: boolean
}

export interface FooterLink {
  label: string
  ko: string
  href: string
  reviewBuilt?: boolean
}

export const HEADER_NAV: NavLink[] = [
  { title: 'Reviews', url: '/reviews', reviewBuilt: true },
  // The public genre map (FEAT-genre-system) — a real route, not a filter.
  { title: 'Genres', url: '/genres' },
  // Best New Music is a filter on the reviews index (?bnm=1), not a route.
  { title: 'Best New Music', url: '/reviews?bnm=1', reviewBuilt: true },
  // The ≥4.0★ canon hall (FEAT-home-redesign) — a real route, computed from reviews.
  { title: 'Canon', url: '/canon', reviewBuilt: true },
  // The owner's public review buckets (FEAT-public-bucket-multiuser A4) — read-only.
  { title: 'Collection', url: '/collection' },
]

export const FOOTER_BROWSE: FooterLink[] = [
  { label: 'Reviews', ko: '평론', href: '/reviews', reviewBuilt: true },
  { label: 'Genres', ko: '장르', href: '/genres' },
  { label: 'Canon', ko: '명반', href: '/canon', reviewBuilt: true },
  { label: 'Collection', ko: '컬렉션', href: '/collection' },
]

/** Drop 평론-built links while there are 0 평론; otherwise return the list unchanged. */
export function visibleLinks<T extends { reviewBuilt?: boolean }>(links: T[], reviewCount: number): T[] {
  return reviewCount > 0 ? links : links.filter(l => !l.reviewBuilt)
}
