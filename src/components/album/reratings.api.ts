// FEAT-album-rerating — typed client for 재평가 ("I withdrew my 평가 and will
// rate this album again after listening").
//
// Its own module for the same reason `plannedRatings.api.ts` is: storage is its
// own table (`pending_reratings`), and start/cancel carry no body — a row's
// existence IS the state. Deliberately NOT part of reviews.api.ts, which owns
// the rating itself: completing a 재평가 goes through THAT module's
// putMyAlbumState, and the server ends the 재평가 as a side effect of the star
// landing. There is no "finish rerating" call here, and adding one would create
// a second place for the two surfaces to disagree.
import type { components } from '@lib/api.gen'
import { apiFetch } from '@lib/api'

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string

/** My own open 재평가 — carries the withdrawn score (author-only). */
export type MyRerating = components['schemas']['Backend_MyReratingResponse']
/** Someone's open 재평가 as seen on a public profile — no withdrawn score. */
export type MemberRerating = components['schemas']['Backend_MemberReratingResponse']

/** MY open 재평가 list, most recently started first. Authed — logged out yields []. */
export async function fetchMyReratings(): Promise<MyRerating[]> {
	const res = await apiFetch(`${BASE}/api/me/reratings`)
	if (!res || !res.ok)
		return []
	const body = (await res.json()) as components['schemas']['Backend_MyReratingListResponse']
	return body.reratings ?? []
}

/**
 * Withdraw my 평가 for an album and open a 재평가. Idempotent.
 *
 * Returns 'conflict' when there is no 평가 to withdraw (409) — the album exists,
 * the rating never did. Callers must surface that rather than treating it as a
 * generic failure: it is the one refusal a member can act on ("평가부터 남기세요").
 */
export async function startRerating(albumId: string): Promise<'ok' | 'conflict' | 'error'> {
	const res = await apiFetch(`${BASE}/api/me/reratings/${albumId}`, { method: 'PUT' })
	if (res && res.status === 204)
		return 'ok'
	if (res && res.status === 409)
		return 'conflict'
	return 'error'
}

/** Cancel an open 재평가 — the withdrawn 평가 comes back. Idempotent. */
export async function cancelRerating(albumId: string): Promise<boolean> {
	const res = await apiFetch(`${BASE}/api/me/reratings/${albumId}`, { method: 'DELETE' })
	return !!res && res.status === 204
}
