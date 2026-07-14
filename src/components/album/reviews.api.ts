// FEAT-multi-user-accounts Phase 1 — typed client for the public album-reviews
// API (backend). Reads are public (bare fetch, no token); the write/delete are
// Cognito-JWT via apiFetch. Mirrors components/member/me.api.ts.
import type { components } from '@lib/api.gen'
import { apiFetch } from '@lib/api'

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string

export type AlbumReviewAggregate = components['schemas']['Backend_AlbumReviewAggregateResponse']
export type AlbumReview = components['schemas']['Backend_AlbumReviewResponse']
export type MemberProfile = components['schemas']['Backend_MemberProfileResponse']
export type MemberReview = components['schemas']['Backend_MemberReviewResponse']
export type MemberSummary = components['schemas']['Backend_MemberSummary']

export class ReviewRateLimitError extends Error {}

/** Public: live aggregate (avg/count) + review list for an album. */
export async function fetchAlbumReviews(albumId: string): Promise<AlbumReviewAggregate | null> {
	try {
		const res = await fetch(`${BASE}/api/reviews/albums/${albumId}`)
		if (!res.ok)
			return null
		return (await res.json()) as AlbumReviewAggregate
	}
	catch {
		return null
	}
}

/** Upsert my review (create or edit). Throws ReviewRateLimitError on 429. */
export async function putMyReview(
	albumId: string,
	rating: number,
	comment: string | null,
): Promise<AlbumReview | null> {
	const body: components['schemas']['Backend_AlbumReviewUpsertRequest'] = { rating, comment }
	const res = await apiFetch(`${BASE}/api/reviews/albums/${albumId}`, {
		method: 'PUT',
		body: JSON.stringify(body),
	})
	if (!res)
		return null
	if (res.status === 429)
		throw new ReviewRateLimitError()
	if (!res.ok)
		return null
	return (await res.json()) as AlbumReview
}

/** Delete my own review for an album. True on 204. */
export async function deleteMyReview(albumId: string): Promise<boolean> {
	const res = await apiFetch(`${BASE}/api/reviews/albums/${albumId}`, { method: 'DELETE' })
	return !!res && res.status === 204
}

/** Public: a member's profile + newest-first review feed. */
export async function fetchMemberProfile(handle: string): Promise<MemberProfile | null> {
	try {
		const res = await fetch(`${BASE}/api/members/${handle}`)
		if (!res.ok)
			return null
		return (await res.json()) as MemberProfile
	}
	catch {
		return null
	}
}

export type MemberNowPlaying = components['schemas']['Backend_MemberNowPlayingResponse']

/**
 * Public: a member's now-playing (DB cache read; Last.fm + Spotify merged
 * server-side, `source`/`source_username` carry provenance while playing —
 * Last.fm connects are unverified usernames, so the surface says where the
 * data comes from). Returns null on any failure or when nothing is playing —
 * the profile hides the section entirely (미연동 and idle are indistinguishable
 * by design; integration status is private).
 */
export async function fetchMemberNowPlaying(handle: string): Promise<MemberNowPlaying | null> {
	try {
		const res = await fetch(`${BASE}/api/members/${handle}/now-playing`)
		if (!res.ok)
			return null
		const np = (await res.json()) as MemberNowPlaying
		return np.is_playing ? np : null
	}
	catch {
		return null
	}
}

/**
 * The signed-in member's own handle (to find "my review" in a public list —
 *  handle-keyed since audit 2026-07-14, prepping the removal of the Cognito-sub
 *  `author.id` from the public review contract). null when logged out /
 *  unprovisioned. Rides the edge_guard GET proxy + lazy-create.
 */
export async function fetchMyHandle(): Promise<string | null> {
	const res = await apiFetch(`${BASE}/api/me`)
	if (!res || !res.ok)
		return null
	const me = (await res.json()) as components['schemas']['Backend_MeResponse']
	return me.handle ?? null
}

/** Public: member index (build-time getStaticPaths for /members/[handle]). */
export async function fetchMembers(): Promise<MemberSummary[]> {
	try {
		const res = await fetch(`${BASE}/api/members`)
		if (!res.ok)
			return []
		const data = (await res.json()) as components['schemas']['Backend_MemberListResponse']
		return data.members ?? []
	}
	catch {
		return []
	}
}
