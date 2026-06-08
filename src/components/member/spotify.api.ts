// FEAT-member-dashboard Step 3 — typed client for the Spotify listening surfaces.
// All data comes from the worker-fed cache (spotify_recent_albums /
// spotify_now_playing); the backend never calls Spotify synchronously (rule #9).
// Reads ride the edge_guard GET proxy; the manual refresh is a Cognito-JWT POST
// that only enqueues an SQS job. Mirrors components/member/library.api.ts.
import { apiFetch } from '@lib/api'
import type { components } from '@lib/api.gen'

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string

export type RecentlyListenedItem = components['schemas']['Backend_RecentlyListenedItem']
export type NowPlaying = components['schemas']['Backend_NowPlayingResponse']
export type RecentTrackItem = components['schemas']['Backend_RecentTrackItem']
export type ListenedAlbumItem = components['schemas']['Backend_ListenedAlbumItem']
type RecentlyListenedResponse = components['schemas']['Backend_RecentlyListenedResponse']
type RecentTracksResponse = components['schemas']['Backend_RecentTracksResponse']
type ListenedAlbumsResponse = components['schemas']['Backend_ListenedAlbumsResponse']
type SpotifyConnectionResponse = components['schemas']['Backend_SpotifyConnectionResponse']

/** Recently-listened albums + when the worker last synced the cache (D31 poll anchor). */
export interface RecentlyListened {
  items: RecentlyListenedItem[]
  lastSyncedAt: string | null
}

/**
 * Recently-played tracks (FEAT-member-dashboard-realdata D-B) — track-level cache;
 *  item[0] is the "최근 재생" latest-played fallback for the now-playing surface.
 */
export interface RecentTracks {
  items: RecentTrackItem[]
  lastSyncedAt: string | null
}

/** Spotify connection status — token validity, not mere presence (D30). */
export interface SpotifyConnection {
  /** a refresh token is stored */
  connected: boolean
  /** the worker's last refresh hit invalid_grant → "재인증 필요" */
  needsReauth: boolean
  /** ISO8601 of when the token last worked, or null */
  lastSuccessfulRefreshAt: string | null
}

// FEAT-spotify-library-sync — types derived from the merged contract (api.gen.ts).
// The per-album row + sync result alias the generated Backend_* schemas directly;
// SpotifyLibraryState is the normalized view the getter returns (server-optional
// fields defaulted) — same wire-type/view split as RecentlyListened above.

/** Per-album sync row (one spotify_library_albums row joined to its album). */
export type SpotifyLibraryAlbumState = components['schemas']['Backend_SpotifyLibraryAlbumState']

/** POST /api/buckets/spotify-library/sync — { status: 'queued' | 'debounced' }. */
export type SpotifyLibrarySyncResult = components['schemas']['Backend_SpotifyLibrarySyncResponse']

/** Normalized GET /api/buckets/spotify-library/state view (optionals defaulted). */
export interface SpotifyLibraryState {
  bucket_id: string | null
  last_synced_at: string | null
  /** the stored Spotify token is invalid → re-auth needed before writes work */
  needs_reauth: boolean
  /** backend mirror of SPOTIFY_LIBRARY_WRITES_ENABLED — false = review/plan-only */
  writes_enabled: boolean
  albums: SpotifyLibraryAlbumState[]
}

async function asJson<T>(res: Response | null): Promise<T> {
  if (!res)
    throw new Error('network error (no response)')
  if (!res.ok)
    throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

/**
 * GET /api/library/recently-listened — distinct recently-played albums, newest first,
 *  plus last_synced_at so the UI can poll for a refresh completing (D31).
 */
export async function listRecentlyListened(): Promise<RecentlyListened> {
  const res = await apiFetch(`${BASE}/api/library/recently-listened`, { method: 'GET' })
  const data = await asJson<RecentlyListenedResponse>(res)
  return { items: data.items ?? [], lastSyncedAt: data.last_synced_at ?? null }
}

/** GET /api/library/now-playing — currently-playing snapshot (cache; may be stale). */
export async function getNowPlayingData(): Promise<NowPlaying> {
  const res = await apiFetch(`${BASE}/api/library/now-playing`, { method: 'GET' })
  return asJson<NowPlaying>(res)
}

/**
 * GET /api/library/recent-tracks (D-B) — recently-played at track granularity,
 *  newest first. Worker-fed cache; never calls Spotify (rule #9). Row 0 is the
 *  "최근 재생" latest-played fallback when nothing is currently playing.
 */
export async function listRecentTracks(): Promise<RecentTracks> {
  const res = await apiFetch(`${BASE}/api/library/recent-tracks`, { method: 'GET' })
  const data = await asJson<RecentTracksResponse>(res)
  return { items: data.items ?? [], lastSyncedAt: data.last_synced_at ?? null }
}

/**
 * GET /api/library/listened-albums (D-A) — the cumulative listened-album archive,
 *  aggregated from the durable play-event log (per-album play_count + first/last
 *  play), most-recently-played first. Distinct from the recently-listened CACHE.
 */
export async function listListenedAlbums(limit = 200): Promise<ListenedAlbumItem[]> {
  const res = await apiFetch(`${BASE}/api/library/listened-albums?limit=${limit}`, { method: 'GET' })
  const data = await asJson<ListenedAlbumsResponse>(res)
  return data.items ?? []
}

/** GET /api/library/spotify-connection — connection status incl. token validity (D30). */
export async function getSpotifyConnection(): Promise<SpotifyConnection> {
  const res = await apiFetch(`${BASE}/api/library/spotify-connection`, { method: 'GET' })
  const data = await asJson<SpotifyConnectionResponse>(res)
  return {
    connected: Boolean(data.connected),
    needsReauth: Boolean(data.needs_reauth),
    lastSuccessfulRefreshAt: data.last_successful_refresh_at ?? null,
  }
}

/** POST /api/library/refresh-recent — enqueue an async Spotify re-sync (rule #9). */
export async function refreshRecent(): Promise<void> {
  const res = await apiFetch(`${BASE}/api/library/refresh-recent`, { method: 'POST' })
  if (!res || !res.ok)
    throw new Error(res ? `HTTP ${res.status}` : 'network error (no response)')
}

/**
 * POST /api/buckets/spotify-library/sync — enqueue an async Spotify-library
 * reconcile (Cognito-JWT). Rule #9: this only ENQUEUES; the worker does the
 * Spotify reads/writes out of band. Returns { status: 'queued' | 'debounced' }.
 */
export async function syncSpotifyLibrary(): Promise<SpotifyLibrarySyncResult> {
  const res = await apiFetch(`${BASE}/api/buckets/spotify-library/sync`, { method: 'POST' })
  return asJson<SpotifyLibrarySyncResult>(res)
}

/**
 * GET /api/buckets/spotify-library/state — the special bucket's sync state:
 * last_synced_at (poll anchor), needs_reauth / writes_enabled banners, and the
 * per-album source/state map (keyed by album_id) for the cover badges. Rides the
 * edge_guard GET proxy; worker-fed, never calls Spotify (rule #9).
 */
export async function getSpotifyLibraryState(): Promise<SpotifyLibraryState> {
  const res = await apiFetch(`${BASE}/api/buckets/spotify-library/state`, { method: 'GET' })
  const data = await asJson<components['schemas']['Backend_SpotifyLibraryStateResponse']>(res)
  return {
    bucket_id: data.bucket_id ?? null,
    last_synced_at: data.last_synced_at ?? null,
    needs_reauth: Boolean(data.needs_reauth),
    writes_enabled: Boolean(data.writes_enabled),
    albums: data.albums ?? [],
  }
}
