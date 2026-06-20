// FEAT-genre-artist-distribution Step 6 — typed client for the /profile 분석 버킷.
// Two co-equal sources (좋아요 saved tracks / 재생 play history) return the SAME
// DistributionResponse shape, so the chart is source-agnostic (통일성). All reads
// ride the edge_guard GET proxy; classify is a Cognito-JWT POST that only enqueues
// an SQS catalog-sync job (the worker does the Spotify read — rule #9).
import { apiFetch } from '@lib/api'
import type { components } from '@lib/api.gen'

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string

export type Distribution = components['schemas']['Backend_DistributionResponse']
export type DistEntry = components['schemas']['Backend_DistItem']
export type SavedTrack = components['schemas']['Backend_SavedTrackItem']
export type ClassifyResult = components['schemas']['Backend_ClassifyResponse']
type SavedTracksResponse = components['schemas']['Backend_SavedTracksResponse']

async function asJson<T>(res: Response | null): Promise<T> {
	if (!res)
		throw new Error('network error (no response)')
	if (!res.ok)
		throw new Error(`HTTP ${res.status}`)
	return res.json() as Promise<T>
}

async function getDistribution(path: string): Promise<Distribution> {
	const res = await apiFetch(`${BASE}/api/library/${path}`, { method: 'GET' })
	return asJson<Distribution>(res)
}

export const getSavedGenreDistribution = (): Promise<Distribution> => getDistribution('saved-tracks/genre-distribution')
export const getSavedArtistDistribution = (): Promise<Distribution> => getDistribution('saved-tracks/artist-distribution')
export const getPlayedGenreDistribution = (): Promise<Distribution> => getDistribution('play-events/genre-distribution')
export const getPlayedArtistDistribution = (): Promise<Distribution> => getDistribution('play-events/artist-distribution')

export interface SavedTracks {
	items: SavedTrack[]
	total: number
	lastSyncedAt: string | null
}

/** GET /api/library/saved-tracks — the owner's 좋아요 tracks, most-recently-liked first. */
export async function listSavedTracks(limit = 60): Promise<SavedTracks> {
	const res = await apiFetch(`${BASE}/api/library/saved-tracks?limit=${limit}`, { method: 'GET' })
	const data = await asJson<SavedTracksResponse>(res)
	return { items: data.items ?? [], total: data.total ?? 0, lastSyncedAt: data.last_synced_at ?? null }
}

/**
 * POST /api/library/saved-tracks/classify (Cognito-JWT) — enqueue the catalog-absent
 * 미분류 albums for catalog sync (→ S1 genres → the track inherits a genre). Rule #9:
 * only enqueues; the worker does the Spotify read. Returns { enqueued, skipped_needs_backfill }.
 */
export async function classifySavedTracks(): Promise<ClassifyResult> {
	const res = await apiFetch(`${BASE}/api/library/saved-tracks/classify`, { method: 'POST' })
	return asJson<ClassifyResult>(res)
}
