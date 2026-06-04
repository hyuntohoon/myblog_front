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
type RecentlyListenedResponse = components['schemas']['Backend_RecentlyListenedResponse']
type SpotifyConnectionResponse = components['schemas']['Backend_SpotifyConnectionResponse']

/** Recently-listened albums + when the worker last synced the cache (D31 poll anchor). */
export interface RecentlyListened {
  items: RecentlyListenedItem[]
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
