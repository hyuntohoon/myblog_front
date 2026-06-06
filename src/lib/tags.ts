// STAB-5 Step 4: the canonical review-tag vocabulary.
//
// Single authoritative source for the five curated review tags, seeded at
// build time to mirror the prod `tags` data-seed (album review / track review /
// reissue / best album / year-end list). The writer's tag picker reads this
// directly instead of `GET /api/tags`, so this repo carries no runtime
// dependency on the backend tags endpoint — same build-time-seed approach as
// `sections.ts` (Step 3).
//
// Read-only — tags are seeded server-side; there is no public create path. The
// backend rejects any tag name not in this seeded set (400). Keep this list in
// lockstep with the prod seed (and the OQ2 vocabulary in the STAB-5 RFC).
//
// Cross-cutting M:N axis (release format / editorial accolade / list form),
// distinct from the single-FK section — a post can carry zero or many tags.

export interface ReviewTag {
	slug: string
	label: string
}

export const REVIEW_TAGS: readonly ReviewTag[] = [
	{ slug: 'album-review', label: 'album review' },
	{ slug: 'track-review', label: 'track review' },
	{ slug: 'reissue', label: 'reissue' },
	{ slug: 'best-album', label: 'best album' },
	{ slug: 'year-end-list', label: 'year-end list' },
] as const

// Labels only — the writer picker emits the label as each post `tags[]` entry,
// and the backend resolves tags by *name* (= label), mirroring how the section
// picker emits the section label as `category`.
export const REVIEW_TAG_LABELS: readonly string[] = REVIEW_TAGS.map(t => t.label)
