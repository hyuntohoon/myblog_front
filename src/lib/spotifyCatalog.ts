// Spotify-id → catalog-id resolution against the DB-only music API
// (member-player Step 3; lifted from releaseShared so the NowPlaying live path
// can reuse it — RFC-ui-surface-unification's playback plumb). Both endpoints
// are plain catalog reads: a miss (404) resolves to null, callers degrade to
// text/no-nav. Results are promise-cached per id for the page lifetime.
import type { components } from './api.gen'
import { apiFetch } from './api'

type AlbumSyncRequest = components['schemas']['Music_AlbumSyncRequest']

const BASE = import.meta.env.PUBLIC_API_URL as string

const albumCache = new Map<string, Promise<string | null>>()

/** Catalog album id for a Spotify album id, or null when not in the catalog. */
export function resolveDbAlbumId(spotifyId: string): Promise<string | null> {
  const hit = albumCache.get(spotifyId)
  if (hit)
    return hit
  const p = fetch(`${BASE}/api/music/albums/by-spotify/${encodeURIComponent(spotifyId)}`)
    .then(r => (r.ok ? r.json() as Promise<{ album?: { id?: string } }> : null))
    .then(j => j?.album?.id ?? null)
    .catch(() => null)
  albumCache.set(spotifyId, p)
  return p
}

/** One uncached by-spotify read — the absorb poll must see a fresh 404→200. */
async function lookupDbAlbumId(spotifyId: string): Promise<string | null> {
  try {
    const r = await fetch(`${BASE}/api/music/albums/by-spotify/${encodeURIComponent(spotifyId)}`, { cache: 'no-store' })
    if (!r.ok)
      return null
    const j = await r.json() as { album?: { id?: string } }
    return j?.album?.id ?? null
  }
  catch {
    return null
  }
}

const ABSORB_POLL_MS = 2000
const ABSORB_TIMEOUT_MS = 30000
const absorbInflight = new Map<string, Promise<string | null>>()

/**
 * Bring a Spotify album the catalog does not have yet into it, on an explicit
 * member click: POST /api/music/sync-requests (music enqueues to SQS; the
 * worker does the Spotify fetch + upsert — the request path never calls
 * Spotify), then poll the DB-only by-spotify read until the row lands. by-spotify
 * 404s stay uncached at the edge precisely so this poll can observe the flip.
 * Resolves the catalog album id, or null on a refused request / timeout (the
 * enqueued sync still lands later; a re-click then resolves on the first read).
 * Concurrent calls for one id share a single request.
 */
export function absorbSpotifyAlbum(spotifyId: string, opts: { pollMs?: number, timeoutMs?: number } = {}): Promise<string | null> {
  const pending = absorbInflight.get(spotifyId)
  if (pending)
    return pending
  const pollMs = opts.pollMs ?? ABSORB_POLL_MS
  const timeoutMs = opts.timeoutMs ?? ABSORB_TIMEOUT_MS
  const p = (async () => {
    const existing = await lookupDbAlbumId(spotifyId)
    if (existing)
      return existing
    const payload: AlbumSyncRequest = { album_ids: [spotifyId], market: 'KR' }
    const accepted = await apiFetch(`${BASE}/api/music/sync-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!accepted || accepted.status !== 202)
      return null
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, pollMs))
      const id = await lookupDbAlbumId(spotifyId)
      if (id)
        return id
    }
    return null
  })()
    .catch(() => null)
    .then((id) => {
      // A resolved id is permanent; seed the read cache so other surfaces skip the miss.
      if (id)
        albumCache.set(spotifyId, Promise.resolve(id))
      return id
    })
    .finally(() => absorbInflight.delete(spotifyId))
  absorbInflight.set(spotifyId, p)
  return p
}

const artistCache = new Map<string, Promise<string | null>>()
const resolvedArtistIds = new Map<string, string | null>()

/** Catalog artist id for a Spotify artist id, or null when not in the catalog. */
export function resolveDbArtistId(spotifyId: string): Promise<string | null> {
  const hit = artistCache.get(spotifyId)
  if (hit)
    return hit
  const p = fetch(`${BASE}/api/music/artists/by-spotify/${encodeURIComponent(spotifyId)}`)
    .then(r => (r.ok ? r.json() as Promise<{ id?: string | null }> : null))
    .then(j => j?.id ?? null)
    .catch(() => null)
    .then((id) => {
      resolvedArtistIds.set(spotifyId, id)
      return id
    })
  artistCache.set(spotifyId, p)
  return p
}

/**
 * Synchronous read of an already-resolved artist id (E1 Rule 0, G5).
 * `resolveDbArtistId` is a promise — a drag source that awaited it at
 * `dragstart` could fire after the id it captured has gone stale. This is
 * the only id read a drag source may use: undefined (not yet resolved) must
 * be treated exactly like a null id — not draggable.
 */
export function getResolvedDbArtistId(spotifyId: string): string | null | undefined {
  return resolvedArtistIds.get(spotifyId)
}
