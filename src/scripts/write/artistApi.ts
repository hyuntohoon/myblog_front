// FEAT-writer-lowfreq-redesign Step 4 — typed fetch helpers for the writer's
// artist drill-in panel. All three endpoints are DB-only and unauthenticated
// (catalog reads), so plain fetch is fine.

import type { components } from '../../lib/api.gen'

const API_BASE = import.meta.env.PUBLIC_API_URL as string

export type ArtistHero = components['schemas']['Music_ArtistHero']
export type TopTrackItem = components['schemas']['Music_TrackItem']
export type AlbumListItem = components['schemas']['Music_AlbumItem']

export type ArtistHeroResult =
	| { ok: true, hero: ArtistHero } |
	{ ok: false, status: number }

async function getHero(url: string): Promise<ArtistHeroResult> {
	try {
		const r = await fetch(url)
		if (r.status === 404)
			return { ok: false, status: 404 }
		if (!r.ok)
			return { ok: false, status: r.status }
		const hero = await r.json() as ArtistHero
		return { ok: true, hero }
	}
	catch {
		return { ok: false, status: 0 }
	}
}

export function fetchArtistHero(artistId: string): Promise<ArtistHeroResult> {
	return getHero(`${API_BASE}/api/music/artists/${encodeURIComponent(artistId)}`)
}

export function fetchArtistHeroBySpotify(spotifyId: string): Promise<ArtistHeroResult> {
	return getHero(`${API_BASE}/api/music/artists/by-spotify/${encodeURIComponent(spotifyId)}`)
}

export async function fetchArtistTopTracks(artistId: string, limit = 10): Promise<TopTrackItem[]> {
	try {
		const r = await fetch(
			`${API_BASE}/api/music/artists/${encodeURIComponent(artistId)}/top-tracks?limit=${limit}`,
		)
		if (!r.ok)
			return []
		return await r.json() as TopTrackItem[]
	}
	catch {
		return []
	}
}

export async function fetchArtistAlbums(artistId: string, limit = 24): Promise<AlbumListItem[]> {
	try {
		const r = await fetch(
			`${API_BASE}/api/music/artists/${encodeURIComponent(artistId)}/albums?limit=${limit}`,
		)
		if (!r.ok)
			return []
		const data = await r.json() as { type?: string, items?: AlbumListItem[] }
		return data.items ?? []
	}
	catch {
		return []
	}
}
