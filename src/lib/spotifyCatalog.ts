// Spotify-id → catalog-id resolution against the DB-only music API
// (member-player Step 3; lifted from releaseShared so the NowPlaying live path
// can reuse it — RFC-ui-surface-unification's playback plumb). Both endpoints
// are plain catalog reads: a miss (404) resolves to null, callers degrade to
// text/no-nav. Results are promise-cached per id for the page lifetime.
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

const artistCache = new Map<string, Promise<string | null>>()

/** Catalog artist id for a Spotify artist id, or null when not in the catalog. */
export function resolveDbArtistId(spotifyId: string): Promise<string | null> {
  const hit = artistCache.get(spotifyId)
  if (hit)
    return hit
  const p = fetch(`${BASE}/api/music/artists/by-spotify/${encodeURIComponent(spotifyId)}`)
    .then(r => (r.ok ? r.json() as Promise<{ id?: string | null }> : null))
    .then(j => j?.id ?? null)
    .catch(() => null)
  artistCache.set(spotifyId, p)
  return p
}
