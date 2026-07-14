// src/lib/owner.ts — the shared "am I the owner?" signal (multi-user surface
// audit 2026-07-14). `isLoggedIn()` alone must never gate owner-only
// affordances: any member is "logged in" post multi-user, and using it as an
// owner proxy renders controls that just 403 on click. The server's
// `require_owner` stays the real gate — this only keeps the UI honest.
import { getAccessToken } from '@lib/auth'
import { OWNER_HANDLE } from '@lib/member'
import { getMe } from '../components/member/me.api'

// Cached per access token so every header/tile/tray consumer shares ONE
// /api/me round trip per session (and a re-login as a different account in
// the same tab can't reuse a stale answer).
let cachedFor: string | null = null
let cached: Promise<boolean> | null = null

/**
 * Resolves true only when the signed-in account is the owner
 * (`getMe().handle === OWNER_HANDLE`). Logged out, unresolved, or any
 * transport/401 error → false (fail-closed, matching the backend gate).
 */
export function isOwnerUser(): Promise<boolean> {
	if (typeof window === 'undefined')
		return Promise.resolve(false)
	const token = getAccessToken()
	if (!token)
		return Promise.resolve(false)
	if (cachedFor !== token || cached == null) {
		cachedFor = token
		cached = getMe()
			.then(me => me != null && me.handle === OWNER_HANDLE)
			.catch(() => false)
	}
	return cached
}

/**
 * The signed-in user's own profile surface: the owner keeps the /profile
 * dashboard (lyrics dock + writer workflow live there until profile-merge
 * PR3); members get their runtime member page.
 */
export const MEMBER_SELF_URL = '/members/?me'

export async function selfPageHref(): Promise<string> {
	return (await isOwnerUser()) ? '/profile' : MEMBER_SELF_URL
}
