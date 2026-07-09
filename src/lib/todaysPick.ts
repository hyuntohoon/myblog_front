// FEAT-today-buckit Step 6 — typed client for the owner-curated "song of the
// day" store (backend service). The GETs are PUBLIC (edge_guard catch-all —
// plain fetch, no auth, so logged-out visitors can read the pick + history);
// PUT/DELETE are owner-only (Cognito-JWT routes at the API Gateway, gated by
// require_owner in the Lambda). Mirrors components/member/integrations.api.ts.
import { apiFetch } from '@lib/api'
import type { components } from '@lib/api.gen'

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string

export type DailyPick = components['schemas']['Backend_DailyPickItem']
export type UpsertTodaysPick = components['schemas']['Backend_UpsertTodaysPickRequest']

/** Today's pick, or null on a no-pick day. Public (edge_guard). */
export async function getTodaysPick(): Promise<DailyPick | null> {
	// Plain fetch — this is a public read; apiFetch would attempt token refresh
	// + goLogin on a 401 that a logged-out visitor never triggers anyway, but
	// keeping the public read token-free is clearer and matches TodayAlbumBuckit.
	try {
		const res = await fetch(`${BASE}/api/todays-pick`)
		if (!res.ok)
			return null
		return (await res.json()) as DailyPick | null
	}
	catch {
		return null
	}
}

/** Date-desc history of past picks. Public (edge_guard). */
export async function getTodaysPickHistory(limit = 50, before?: string): Promise<DailyPick[]> {
	const params = new URLSearchParams({ limit: String(limit) })
	if (before)
		params.set('before', before)
	try {
		const res = await fetch(`${BASE}/api/todays-pick/history?${params}`)
		if (!res.ok)
			return []
		return (await res.json()) as DailyPick[]
	}
	catch {
		return []
	}
}

/** PUT today's pick (upsert — re-POST overwrites the same day). Owner-only. */
export async function putTodaysPick(payload: UpsertTodaysPick): Promise<DailyPick | null> {
	const res = await apiFetch(`${BASE}/api/todays-pick`, {
		method: 'PUT',
		body: JSON.stringify(payload),
	})
	if (!res || !res.ok)
		return null
	return (await res.json()) as DailyPick
}

/** DELETE today's pick ("unpost today"). Owner-only. Returns true iff removed. */
export async function deleteTodaysPick(): Promise<boolean> {
	const res = await apiFetch(`${BASE}/api/todays-pick`, { method: 'DELETE' })
	// 204 = removed; 404 = nothing posted today. Treat 404 as "already empty".
	return !!res && (res.status === 204 || res.status === 404)
}
