// STAB-5 Step 3: the canonical public section taxonomy.
//
// Single authoritative source for the four curated sections, seeded at build
// time to mirror the shared_db V13 `sections` seed (Reviews / Best New Music /
// Features / Tracks). This collapses the previously competing vocabularies
// (writer `SECTIONS` array, `categories.json` zod enum, the frontmatter-derived
// `categories.json.ts` endpoint) into one place.
//
// Build-time on purpose: the writer picker reads this directly instead of
// `GET /api/sections`, so this repo carries no runtime dependency on the
// backend sections endpoint (Lane A) and the two lanes merge independently.
//
// Read-only — sections are seeded by migration; there is no public create path.
// Keep this list in lockstep with the migration seed (myblog_shared_db V13).

export interface Section {
	slug: string
	label: string
}

export const SECTIONS: readonly Section[] = [
	{ slug: 'reviews', label: 'Reviews' },
	{ slug: 'best-new-music', label: 'Best New Music' },
	{ slug: 'features', label: 'Features' },
	{ slug: 'tracks', label: 'Tracks' },
] as const

// Labels only — the writer picker emits the label as the post `category` and
// `content.config.ts` uses it as the frontmatter enum (wire format unchanged
// from the old hardcoded `SECTIONS` string array, so Step 3 stays contract-neutral).
export const SECTION_LABELS: readonly string[] = SECTIONS.map(s => s.label)
