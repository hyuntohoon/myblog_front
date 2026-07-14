// FEAT-genre-artist-distribution Step 6 — typed client for the member 분석 버킷.
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
export type FillGenresResult = components['schemas']['Backend_FillGenresResponse']
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

// ── 임포트(평생): lifetime stream-history analytics (FEAT-listening-history-import) ──
// The imported Spotify Extended Streaming History — true lifetime play counts AND
// listening time (ms), which no Spotify API exposes. Every endpoint takes a
// count↔time `metric`; album/genre/era are coverage-GATED (the residual 미분류 rides
// the `unclassified`/`unresolved` field). All edge_guard GET reads (DB-only — rule #9).
// FEAT-analysis-explore: every panel also takes an optional [from, to) `Range` (the
// front maps presets/dropdowns → raw UTC ISO instants), plus the item drill-down + clock.
export type StreamRank = components['schemas']['Backend_StreamRankResponse']
export type StreamRankItem = components['schemas']['Backend_StreamRankItem']
export type StreamAlbumRank = components['schemas']['Backend_StreamAlbumRankResponse']
export type Retrospective = components['schemas']['Backend_RetrospectiveResponse']
export type StreamItemDetail = components['schemas']['Backend_StreamItemDetailResponse']
export type StreamClock = components['schemas']['Backend_StreamClockResponse']
export type StreamClockCell = components['schemas']['Backend_StreamClockCell']
export type StreamMetric = 'count' | 'time'
export type DrillType = 'artist' | 'album' | 'track'

/** A half-open listening window [from, to); null bound = open. UTC ISO instants. */
export interface Range { from: string | null, to: string | null }

/**
 * Build a `?…` query from the given params, dropping null/undefined/empty. URLSearchParams
 * percent-encodes safely; the range bounds are UTC `…Z` instants (no `+`), so they survive
 * cleanly. Returns '' when no params, so callers can append unconditionally.
 */
function streamQuery(params: Record<string, string | number | null | undefined>): string {
	const sp = new URLSearchParams()
	for (const [k, v] of Object.entries(params)) {
		if (v !== null && v !== undefined && v !== '')
			sp.set(k, String(v))
	}
	const s = sp.toString()
	return s ? `?${s}` : ''
}

function rangeParams(range?: Range | null): Record<string, string> {
	const out: Record<string, string> = {}
	if (range?.from)
		out.from = range.from
	if (range?.to)
		out.to = range.to
	return out
}

async function getStream<T>(path: string): Promise<T> {
	const res = await apiFetch(`${BASE}/api/library/stream-history/${path}`, { method: 'GET' })
	return asJson<T>(res)
}

export const getStreamTopTracks = (metric: StreamMetric, range?: Range): Promise<StreamRank> => getStream(`top-tracks${streamQuery({ metric, limit: 15, ...rangeParams(range) })}`)
export const getStreamTopArtists = (metric: StreamMetric, range?: Range): Promise<StreamRank> => getStream(`top-artists${streamQuery({ metric, limit: 15, ...rangeParams(range) })}`)
export const getStreamTopAlbums = (metric: StreamMetric, range?: Range): Promise<StreamAlbumRank> => getStream(`top-albums${streamQuery({ metric, limit: 12, ...rangeParams(range) })}`)
export const getStreamGenreDistribution = (metric: StreamMetric, range?: Range): Promise<StreamRank> => getStream(`genre-distribution${streamQuery({ metric, ...rangeParams(range) })}`)
export const getStreamEraDistribution = (metric: StreamMetric, range?: Range): Promise<StreamRank> => getStream(`era-distribution${streamQuery({ metric, ...rangeParams(range) })}`)
// Retrospective stays lifetime (it IS the all-time per-year + on-this-day companion); no range.
export const getStreamRetrospective = (): Promise<Retrospective> => getStream(`retrospective${streamQuery({ limit: 20 })}`)

/** Drill-down for one entity (artist_name | catalog album_id | track uri), honouring the range. */
export const getStreamItem = (type: DrillType, id: string, metric: StreamMetric, range?: Range): Promise<StreamItemDetail> => getStream(`item${streamQuery({ type, id, metric, ...rangeParams(range) })}`)
/** Hour×weekday (KST) listening clock, honouring the range. */
export const getStreamClock = (metric: StreamMetric, range?: Range): Promise<StreamClock> => getStream(`clock${streamQuery({ metric, ...rangeParams(range) })}`)

export interface SavedTracks {
	items: SavedTrack[]
	total: number
	lastSyncedAt: string | null
}

/**
 * GET /api/library/saved-tracks — the owner's 좋아요 tracks, most-recently-liked
 * first. The backend caps `limit` at 500/call and accepts an `offset`, so the
 * Liked Tracks workbench paginate-accumulates to its ~1000-row ceiling.
 */
export async function listSavedTracks(limit = 60, offset = 0): Promise<SavedTracks> {
	const res = await apiFetch(`${BASE}/api/library/saved-tracks?limit=${limit}&offset=${offset}`, { method: 'GET' })
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

/**
 * POST /api/library/saved-tracks/fill-genres (Cognito-JWT) — enqueue an on-demand
 * genre-backfill run. A local 5-min poller claims it and runs the existing
 * backfill_genres.py --incremental --label --execute (S1→S2→S3) — the same pipeline
 * as the daily 04:00 run. Rule #9: only enqueues; the LLM (claude -p) runs on the
 * owner's laptop via the poller. Returns { status: 'queued' | 'already_pending' }.
 */
export async function fillGenres(): Promise<FillGenresResult> {
	const res = await apiFetch(`${BASE}/api/library/saved-tracks/fill-genres`, { method: 'POST' })
	return asJson<FillGenresResult>(res)
}
