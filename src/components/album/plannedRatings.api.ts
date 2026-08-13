// FEAT-rating-smart-collections Step 4 — typed client for 평가 예정 ("plan to
// rate"). Strictly separate from reviews.api.ts's rating/review-candidate
// calls: storage is its own table (`planned_ratings`, Option B), and mark/
// unmark carry no body — a row's existence IS the mark.
import type { components } from '@lib/api.gen'
import { apiFetch } from '@lib/api'

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string

export type PlannedRating = components['schemas']['Backend_PlannedRatingResponse']

/** MY 평가 예정 queue, most recently planned first. Authed — logged out yields []. */
export async function fetchMyPlannedRatings(): Promise<PlannedRating[]> {
	const res = await apiFetch(`${BASE}/api/me/planned-ratings`)
	if (!res || !res.ok)
		return []
	const body = (await res.json()) as components['schemas']['Backend_PlannedRatingListResponse']
	return body.planned ?? []
}

/** Mark an album as 평가 예정. Idempotent — marking twice is a no-op. True on success. */
export async function markPlannedRating(albumId: string): Promise<boolean> {
	const res = await apiFetch(`${BASE}/api/me/planned-ratings/${albumId}`, { method: 'PUT' })
	return !!res && res.status === 204
}

/** Unmark. Idempotent — unmarking something never planned is also a no-op. */
export async function unmarkPlannedRating(albumId: string): Promise<boolean> {
	const res = await apiFetch(`${BASE}/api/me/planned-ratings/${albumId}`, { method: 'DELETE' })
	return !!res && res.status === 204
}
