// FEAT-multi-user-accounts Phase 1 — typed client for the album 평가 (rating)
// API (backend). Reads are public (bare fetch, no token); the write/delete are
// Cognito-JWT via apiFetch. Mirrors components/member/me.api.ts.
//
// The file and the paths keep the word "review" because they are named after
// the route (`/api/reviews/*`), which the owner deliberately did not rename —
// the symbols below follow the vocabulary instead (평론 = review, 평가 = rating;
// RFC FEAT-album-review-authoring 충돌 #11).
//
// Step 1 added a SECOND, private shape alongside the public one: my own state
// for an album, carrying the editorial-candidate mark. Keep them apart — the
// public aggregate must never be a source of mark data, and the state must
// never be rendered on someone else's screen.
import type { components } from '@lib/api.gen'
import { apiFetch } from '@lib/api'

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string

export type AlbumRatingAggregate = components['schemas']['Backend_AlbumRatingAggregateResponse']
export type AlbumRating = components['schemas']['Backend_AlbumRatingResponse']
export type MemberProfile = components['schemas']['Backend_MemberProfileResponse']
export type MemberRating = components['schemas']['Backend_MemberRatingResponse']
export type MemberSummary = components['schemas']['Backend_MemberSummary']
/** MY state for one album — includes the PRIVATE editorial mark. Author-only. */
export type MyAlbumState = components['schemas']['Backend_MyAlbumStateResponse']
/** One row of MY "평론 쓸 것" queue — same private class as the mark. Author-only. */
export type ReviewCandidate = components['schemas']['Backend_ReviewCandidateResponse']

/**
 * The one-liner ceiling, mirroring the server's RATING_COMMENT_MAX. Kept in
 * sync by hand: the server is the rule (it 422s past this), and this constant
 * only exists so the input can stop the user before a round trip.
 */
export const RATING_COMMENT_MAX = 60

export class RatingRateLimitError extends Error {}

/** Public: live aggregate (avg/count) + rating list for an album. */
export async function fetchAlbumReviews(albumId: string): Promise<AlbumRatingAggregate | null> {
	try {
		const res = await fetch(`${BASE}/api/reviews/albums/${albumId}`)
		if (!res.ok)
			return null
		return (await res.json()) as AlbumRatingAggregate
	}
	catch {
		return null
	}
}

/**
 * Patch MY state for an album. PARTIAL: pass only what you mean to change.
 *
 * Omitting a key leaves that facet alone — which is the point. The bucket board
 * flips `review_candidate` without holding the rating, and the album panel
 * saves a rating without holding the mark; neither can wipe the other's facet.
 * Passing `rating: null` / `comment: null` explicitly means "clear it".
 *
 * Returns the resulting state, or null only when the state has no facet left
 * (204, the row is gone). Transport and non-ok responses throw so callers never
 * announce a write that the server did not confirm. Throws the distinct
 * RatingRateLimitError on 429.
 */
export async function putMyAlbumState(
	albumId: string,
	changes: Partial<components['schemas']['Backend_AlbumRatingUpsertRequest']>,
): Promise<MyAlbumState | null> {
	const res = await apiFetch(`${BASE}/api/reviews/albums/${albumId}`, {
		method: 'PUT',
		body: JSON.stringify(changes),
	})
	if (!res)
		throw new Error('Album state update failed')
	if (res.status === 429)
		throw new RatingRateLimitError()
	if (!res.ok)
		throw new Error(`Album state update failed (${res.status})`)
	if (res.status === 204)
		return null
	return (await res.json()) as MyAlbumState
}

/**
 * Owner-only: mark/unmark this album BEST NEW from the rating surface.
 *
 * Writes the same `albums.best_new` the writer sets at publish time — see
 * `PUT /api/reviews/albums/{album_id}/best-new` (require_owner). Callers must
 * gate the affordance with `isOwnerUser()` first: the server 403s a non-owner,
 * this just keeps the UI honest. Returns null on any failure.
 */
export async function putAlbumBestNew(albumId: string, bestNew: boolean): Promise<boolean | null> {
	const res = await apiFetch(`${BASE}/api/reviews/albums/${albumId}/best-new`, {
		method: 'PUT',
		body: JSON.stringify({ best_new: bestNew }),
	})
	if (!res || !res.ok)
		return null
	const body = (await res.json()) as components['schemas']['Backend_AlbumBestNewResponse']
	return body.best_new
}

/**
 * MY states, private mark included. `albumId` filters to one album; omit it for
 * the whole set (the bucket board's single read). Authed — logged out yields [].
 */
export async function fetchMyAlbumStates(albumId?: string): Promise<MyAlbumState[]> {
	const qs = albumId ? `?album_id=${encodeURIComponent(albumId)}` : ''
	const res = await apiFetch(`${BASE}/api/me/album-states${qs}`)
	if (!res || !res.ok)
		return []
	const body = (await res.json()) as components['schemas']['Backend_MyAlbumStateListResponse']
	return body.states ?? []
}

/**
 * MY "평론 쓸 것" queue — the albums I marked, newest change first (Step 2).
 *
 * A separate read from fetchMyAlbumStates rather than a filter over it: the
 * queue lists albums that may be in no bucket and carry no rating, so each row
 * has to arrive with its own title/cover/artist, which the state shape has no
 * reason to carry. Authed and author-scoped — logged out yields [].
 */
export async function fetchMyReviewCandidates(): Promise<ReviewCandidate[]> {
	const res = await apiFetch(`${BASE}/api/me/review-candidates`)
	if (!res || !res.ok)
		return []
	const body = (await res.json()) as components['schemas']['Backend_ReviewCandidateListResponse']
	return body.candidates ?? []
}

/**
 * Delete my 평가 (star + one-liner) for an album. True on 204.
 *
 * The private mark survives on the server if one is set — this removes what is
 * public, not the whole state.
 */
export async function deleteMyReview(albumId: string): Promise<boolean> {
	const res = await apiFetch(`${BASE}/api/reviews/albums/${albumId}`, { method: 'DELETE' })
	if (!res)
		throw new Error('Album rating delete failed')
	if (!res.ok || res.status !== 204)
		throw new Error(`Album rating delete failed (${res.status})`)
	return true
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
