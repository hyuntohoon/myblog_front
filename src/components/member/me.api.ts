// FEAT-multi-user-accounts 0e — typed client for the member self-profile API
// (backend 0d). GET lazy-provisions the users row on first authed call and
// rides the edge_guard GET proxy; PATCH/DELETE are Cognito-JWT routes at the
// API Gateway. Mirrors components/member/spotify.api.ts.
import { apiFetch } from '@lib/api'
import type { components } from '@lib/api.gen'

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string

export type Me = components['schemas']['Backend_MeResponse']
type UpdateMeRequest = components['schemas']['Backend_UpdateMeRequest']

/** Mirrors backend ck_users_handle_format (V36). */
export const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/

export class HandleTakenError extends Error {}
export class OwnerUndeletableError extends Error {}

export async function getMe(): Promise<Me | null> {
	const res = await apiFetch(`${BASE}/api/me`)
	if (!res || !res.ok)
		return null
	return (await res.json()) as Me
}

/** PATCH profile edits. Throws HandleTakenError on a handle conflict (409). */
export async function updateMe(patch: UpdateMeRequest): Promise<Me | null> {
	const res = await apiFetch(`${BASE}/api/me`, {
		method: 'PATCH',
		body: JSON.stringify(patch),
	})
	if (!res)
		return null
	if (res.status === 409)
		throw new HandleTakenError()
	if (!res.ok)
		return null
	return (await res.json()) as Me
}

/**
 * Account deletion (Cognito user first, then the member row — backend 0d).
 * Throws OwnerUndeletableError for the blog-admin identity (403). Returns
 * false on transport/5xx so the caller can offer a retry (the backend flow
 * converges on retry by design).
 */
export async function deleteMe(): Promise<boolean> {
	const res = await apiFetch(`${BASE}/api/me`, { method: 'DELETE' })
	if (!res)
		return false
	if (res.status === 403)
		throw new OwnerUndeletableError()
	return res.status === 204
}
