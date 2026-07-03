// ARCH-entity-interaction-contract Step 3 — THE contract point for entity
// navigation hrefs. Every artist/review href in `components/` and `scripts/`
// is built here; hand-rolled `/artist/${…}` / `/review/${…}` template literals
// outside this file and `pages/` must not exist (grep-gated in the RFC).
// Registered in docs/frontend/component-map.md.
//
// Canonical form is TRAILING SLASH (RFC OQ3, probed 2026-07-03): the site is
// Astro directory output on S3+CloudFront, and the viewer-request function
// serves the slashless form too (200, no redirect) — so slashless links are
// not broken, but they split the CloudFront cache key and the URL space.
// One canonical form ends that drift.

/** Href to an artist hub page. `id` is the music-catalog artist id. */
export function artistHref(id: string): string {
	return `/artist/${id}/`
}

/** Href to a published review page. `slug` is the post slug. */
export function reviewHref(slug: string): string {
	return `/review/${slug}/`
}
