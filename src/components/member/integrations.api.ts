// FEAT-multi-user Phase 3a — typed client for the member integrations API
// (backend). GET rides the edge_guard GET proxy; PUT/DELETE are Cognito-JWT routes
// at the API Gateway. Mirrors components/member/me.api.ts.
import { apiFetch } from '@lib/api'
import type { components } from '@lib/api.gen'

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string

export type Integration = components['schemas']['Backend_IntegrationResponse']
export type LastfmNowPlaying = components['schemas']['Backend_LastfmNowPlayingResponse']

export async function getIntegrations(): Promise<Integration[]> {
	const res = await apiFetch(`${BASE}/api/integrations`)
	if (!res || !res.ok)
		return []
	const body = (await res.json()) as components['schemas']['Backend_IntegrationsResponse']
	return body.integrations ?? []
}

/** PUT connect/replace the Last.fm username. Returns the row, or null on failure. */
export async function connectLastfm(username: string): Promise<Integration | null> {
	const res = await apiFetch(`${BASE}/api/integrations/lastfm`, {
		method: 'PUT',
		body: JSON.stringify({ username }),
	})
	if (!res || !res.ok)
		return null
	return (await res.json()) as Integration
}

/** DELETE disconnect Last.fm. Idempotent (204). */
export async function disconnectLastfm(): Promise<boolean> {
	const res = await apiFetch(`${BASE}/api/integrations/lastfm`, { method: 'DELETE' })
	return !!res && res.status === 204
}

/** The caller's current Last.fm now-playing (worker-written), or null. */
export async function getLastfmNowPlaying(): Promise<LastfmNowPlaying | null> {
	const res = await apiFetch(`${BASE}/api/integrations/lastfm/now-playing`)
	if (!res || !res.ok)
		return null
	return (await res.json()) as LastfmNowPlaying
}
