// FEAT-multi-user Phase 3a/3b — typed client for the member integrations API
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

// ── Spotify (FEAT-multi-user 3b-e) ─────────────────────────────────────────
// The front only builds the authorize URL and relays the callback `?code`;
// the code exchange + token custody are server-side (backend 3b-c). The
// redirect URI is a byte-exact constant shared with the backend's
// SPOTIFY_MEMBER_REDIRECT_URI and the Spotify dashboard registration — it is
// deliberately NOT derived from location.origin (the exchange would 400 on
// any mismatch, and local hosts can't be registered anyway).

export const SPOTIFY_REDIRECT_URI = 'https://www.ratemymusic.blog/settings/spotify/callback'
const SPOTIFY_AUTHORIZE_URL = 'https://accounts.spotify.com/authorize'
const SPOTIFY_SCOPES = 'user-read-currently-playing user-read-recently-played user-read-playback-state user-modify-playback-state'
const SPOTIFY_PLAYBACK_SCOPES = ['user-read-playback-state', 'user-modify-playback-state']
const SS_SPOTIFY_STATE = 'spotify_connect_state'

/**
 * Spotify OAuth client id — public by design (it rides the authorize URL).
 * Injected at build time; empty in envs where the owner hasn't set the
 * repo variable yet, in which case connect stays disabled.
 */
const SPOTIFY_CLIENT_ID = (import.meta.env.PUBLIC_SPOTIFY_CLIENT_ID ?? '') as string

export function spotifyConnectAvailable(): boolean {
	return SPOTIFY_CLIENT_ID.length > 0
}

/** Whether the stored grant is missing a scope required for player controls. */
export function spotifyGrantNeedsReconsent(scope: string | null | undefined): boolean {
	const grantedScopes = new Set((scope ?? '').split(/\s+/).filter(Boolean))
	return SPOTIFY_PLAYBACK_SCOPES.some(requiredScope => !grantedScopes.has(requiredScope))
}

/**
 * Build the authorize URL (and arm the CSRF state), or null when the
 * client id isn't configured in this build.
 */
export function buildSpotifyAuthorizeUrl(): string | null {
	if (!spotifyConnectAvailable())
		return null
	const state = crypto.randomUUID()
	sessionStorage.setItem(SS_SPOTIFY_STATE, state)
	const url = new URL(SPOTIFY_AUTHORIZE_URL)
	url.search = new URLSearchParams({
		client_id: SPOTIFY_CLIENT_ID,
		response_type: 'code',
		redirect_uri: SPOTIFY_REDIRECT_URI,
		scope: SPOTIFY_SCOPES,
		state,
	}).toString()
	return url.toString()
}

/** One-shot state check for the callback page: consumes the stored value. */
export function consumeSpotifyState(returned: string | null): boolean {
	const saved = sessionStorage.getItem(SS_SPOTIFY_STATE)
	sessionStorage.removeItem(SS_SPOTIFY_STATE)
	return !!returned && !!saved && returned === saved
}

/**
 * PUT /api/integrations/spotify failed; `status` distinguishes the callback
 * page's user-facing messages (400 code burned / 503 not configured / …).
 */
export class SpotifyConnectError extends Error {
	constructor(public status: number) {
		super(`spotify connect failed: ${status}`)
	}
}

/** Relay the callback `?code` for the server-side exchange. */
export async function connectSpotify(code: string): Promise<Integration> {
	const res = await apiFetch(`${BASE}/api/integrations/spotify`, {
		method: 'PUT',
		body: JSON.stringify({ code }),
	})
	if (!res || !res.ok)
		throw new SpotifyConnectError(res ? res.status : 0)
	return (await res.json()) as Integration
}

/** DELETE disconnect Spotify. Idempotent (204). */
export async function disconnectSpotify(): Promise<boolean> {
	const res = await apiFetch(`${BASE}/api/integrations/spotify`, { method: 'DELETE' })
	return !!res && res.status === 204
}
