// Shared album-detail fetch + in-memory cache + intent prefetch.
//
// GET /api/music/albums/{id} (myblog_music, DB-only — no synchronous Spotify
// call) is already edge-cached on CloudFront (FEAT-music-edge-cache, album-detail
// only), so a cache MISS costs ~1s (origin Lambda + Neon) while an edge HIT is
// ~0.24s. This module turns the first open of an album from a blocking miss into
// a warm hit by:
//   · an in-memory Map — re-opening the same album is instant, no network;
//   · inflight dedup — a hover-prefetch and the click that follows share one
//     request instead of racing two;
//   · prefetchAlbumDetail() — fire-and-forget warming on pointer intent (hover /
//     tap-start) so the edge + browser + memory caches are hot before the modal
//     opens.
// Path-based (not query) on purpose: the CloudFront Free plan strips query
// strings, so a `?ids=` batch endpoint could not be edge-cached — per-album
// paths cache once and are reused everywhere.

export interface MusicTrack { id: string, title: string, track_no: number | null, duration_sec: number | null, feat_artist_names: string[] }
export interface MusicArtist { id: string, name: string, photo_url: string | null, genres: string[], popularity: number | null }
export interface MusicAlbumOut { id: string, title: string, release_date: string | null, cover_url: string | null, album_type: string | null, label: string | null }
export interface AlbumDetail { album: MusicAlbumOut, artists: MusicArtist[], tracks: MusicTrack[] }

const cache = new Map<string, AlbumDetail>()
const inflight = new Map<string, Promise<AlbumDetail | null>>()

/** Synchronous cache peek — lets a modal paint the warm body on the first frame. */
export function getCachedAlbumDetail(id: string): AlbumDetail | null {
  return cache.get(id) ?? null
}

/**
 * Fetch (or reuse) an album's detail. Resolves null on failure — callers keep
 *  their header (DetailTarget already has cover/title/artist) and degrade.
 */
export function fetchAlbumDetail(id: string): Promise<AlbumDetail | null> {
  const hit = cache.get(id)
  if (hit)
    return Promise.resolve(hit)
  const pending = inflight.get(id)
  if (pending)
    return pending
  const base = import.meta.env.PUBLIC_API_URL as string
  const p = fetch(`${base}/api/music/albums/${id}`)
    .then(r => (r.ok ? r.json() as Promise<AlbumDetail> : null))
    .then((d) => {
      if (d)
        cache.set(id, d)
      return d
    })
    .catch(() => null)
    .finally(() => inflight.delete(id))
  inflight.set(id, p)
  return p
}

/** Fire-and-forget warm on pointer intent. No-op when already cached / in flight. */
export function prefetchAlbumDetail(id: string | undefined | null): void {
  if (!id || cache.has(id) || inflight.has(id))
    return
  void fetchAlbumDetail(id)
}
