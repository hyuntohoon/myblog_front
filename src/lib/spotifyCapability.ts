// Session-only Spotify capability probes (member-player Step 7a).
//
// The integration contract stores grants, not account tier. Spotify itself is
// therefore the authority for the two asymmetric capabilities: remote
// transport needs Premium, while library 좋아요 works for free accounts. Keep
// their last one-shot outcomes independently so one 403 can never erase the
// other capability. This is informational client state only — no API contract.

export const SPOTIFY_CAPABILITY_SESSION_KEY = 'myblog:spotify-capability-v1'

export type SpotifyTransportProbe = 'available' | 'no-capability'
export type SpotifyLibraryProbe = 'available' | 'scope-missing'

export interface SpotifyCapabilityStanding {
	transport?: SpotifyTransportProbe
	library?: SpotifyLibraryProbe
	updatedAt?: string
}

export function readSpotifyCapabilityStanding(): SpotifyCapabilityStanding {
	try {
		const raw = sessionStorage.getItem(SPOTIFY_CAPABILITY_SESSION_KEY)
		if (!raw)
			return {}
		const parsed = JSON.parse(raw) as SpotifyCapabilityStanding
		return parsed && typeof parsed === 'object' ? parsed : {}
	}
	catch {
		return {}
	}
}

function writeSpotifyCapabilityStanding(patch: Partial<SpotifyCapabilityStanding>): void {
	try {
		const next = { ...readSpotifyCapabilityStanding(), ...patch, updatedAt: new Date().toISOString() }
		sessionStorage.setItem(SPOTIFY_CAPABILITY_SESSION_KEY, JSON.stringify(next))
	}
	catch { /* private mode — the guide simply has no last-known probe */ }
}

export function rememberSpotifyTransportProbe(outcome: SpotifyTransportProbe): void {
	writeSpotifyCapabilityStanding({ transport: outcome })
}

export function rememberSpotifyLibraryProbe(outcome: SpotifyLibraryProbe): void {
	writeSpotifyCapabilityStanding({ library: outcome })
}
