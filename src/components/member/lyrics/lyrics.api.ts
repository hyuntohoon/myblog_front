// FEAT-lyrics-viewer Step 2 — typed client for the authenticated lyrics read.
// GET /api/lyrics/{spotify_track_id} is JWT-gated (NOT the edge_guard-only
// /api/library/* tier): lyrics carry the corpus RFC's "never in any shared
// response" bar, so reads ride apiFetch (Bearer + refresh-once) only.
import { apiFetch } from '@lib/api'
import type { components } from '@lib/api.gen'

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string

export type LyricsResponse = components['schemas']['Backend_LyricsResponse']
export type LyricsSegment = components['schemas']['Backend_LyricsSegment']
export type LyricsTranslationInfo = components['schemas']['Backend_LyricsTranslationInfo']

/**
 * Fetch the normalized lyric segments for a Spotify track id.
 *
 * An unknown id (404 — the id resolves to no catalog track) reads the same as
 * "no lyric linked yet" to the viewer, so it is normalized to `unavailable`
 * here instead of surfacing as an error state.
 */
export async function getLyrics(spotifyTrackId: string): Promise<LyricsResponse> {
  const res = await apiFetch(`${BASE}/api/lyrics/${encodeURIComponent(spotifyTrackId)}`, { method: 'GET' })
  if (!res)
    throw new Error('network error (no response)')
  if (res.status === 404)
    return { availability: 'unavailable', normalizer_version: 0, trackable: false }
  if (!res.ok)
    throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<LyricsResponse>
}

/**
 * Enqueue a Korean-translation request for one track (FEAT-lyrics-translation).
 * Idempotent while pending; the response is the row's fresh lifecycle state.
 */
export async function requestTranslation(spotifyTrackId: string): Promise<LyricsTranslationInfo> {
  const res = await apiFetch(`${BASE}/api/lyrics/${encodeURIComponent(spotifyTrackId)}/translation-request`, { method: 'POST' })
  if (!res)
    throw new Error('network error (no response)')
  if (!res.ok)
    throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<LyricsTranslationInfo>
}
