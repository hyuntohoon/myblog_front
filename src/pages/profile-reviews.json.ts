// profile→member merge PR2 — build-time 평론 rows as static JSON.
//
// The owner's 평론 live in the `blog` content collection (build-time only), but
// the /members/[handle] self-dashboard is a runtime island. Same pattern as
// search-index.json.ts: prerender the full MemberReview[] once per build and
// let SelfDashboard fetch it lazily (owner-only, after the authed self check).
// The data is already public — every row is a published review page — so a
// static world-readable JSON leaks nothing the site doesn't.
import type { APIRoute } from 'astro'
import { buildMemberReviews } from '@lib/reviewCollection'
import { getCollection } from 'astro:content'

export const prerender = true

export const GET: APIRoute = async () => {
	const reviews = buildMemberReviews(await getCollection('blog'))
	return new Response(JSON.stringify(reviews), {
		headers: { 'Content-Type': 'application/json' },
	})
}
