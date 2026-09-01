// FIX-user-flow-state-consistency leg 4 — the Release Radar's tracked-artist
// calls, as a module the artist hub can reach.
//
// Tracking an artist was only ever possible from inside `/releases` — either by
// previewing a bucket or by importing Spotify follows. The artist hub, which is
// where a reader actually decides they care about an artist, had no way to say
// so. These are the same three endpoints `ReleaseRadar` calls; that component
// keeps its own call sites because its flows (bulk preview, Spotify import, the
// feed load it shares a Promise.all with) are not this call shape, and it has
// no test coverage to refactor against.
import type { components } from './api.gen'
import { apiFetch } from './api'

export type TrackedArtist = components['schemas']['Backend_TrackedArtistResponse']
type AddResponse = components['schemas']['Backend_AddTrackedArtistsResponse']

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string

/** The signed-in reader's tracked artists, or null when the read failed. */
export async function listTrackedArtists(signal?: AbortSignal): Promise<TrackedArtist[] | null> {
  const res = await apiFetch(`${BASE}/api/me/tracked-artists`, { signal })
  if (!res || !res.ok)
    return null
  return await res.json() as TrackedArtist[]
}

export type TrackResult =
	| { ok: true, added: number, alreadyTracked: number } |
	{ ok: false, reason: 'limit' | 'failed' }

/** Track one artist. 429 is the daily add limit, which is not a failure to retry. */
export async function trackArtist(artistId: string): Promise<TrackResult> {
  const res = await apiFetch(`${BASE}/api/me/tracked-artists`, {
    method: 'POST',
    body: JSON.stringify({ artist_ids: [artistId] }),
  })
  if (res?.status === 429)
    return { ok: false, reason: 'limit' }
  if (!res || !res.ok)
    return { ok: false, reason: 'failed' }
  const body = await res.json() as AddResponse
  return { ok: true, added: body.added ?? 0, alreadyTracked: body.already_tracked ?? 0 }
}

/** Untrack one artist. A 404 means it is already gone, which is the goal state. */
export async function untrackArtist(artistId: string): Promise<boolean> {
  const res = await apiFetch(`${BASE}/api/me/tracked-artists/${artistId}`, { method: 'DELETE' })
  return !!res && (res.ok || res.status === 404)
}
