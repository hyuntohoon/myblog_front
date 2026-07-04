// FEAT-lyrics-viewer Step 3 — one-shot live playback read.
//
// The RESEARCH-playback-product-architecture contract: track identity for the
// lyrics viewer comes from a client-side `GET /v1/me/player` (the now-playing
// snapshot stores no track id and can be ~1h stale). Same sanctioned pattern as
// `requestPlayback`'s existing api.spotify.com call — the only server hit is the
// async token mint, so rule #9 (no synchronous Spotify call on a user-facing
// endpoint) is not engaged. The token already carries `user-read-playback-state`.
//
// This is a ONE-SHOT read: fired by an explicit user action (entry tap / manual
// refresh / 동기화), once on /profile entry (FEAT-nowplaying-live-sync,
// owner-only authed page) to overlay the stale snapshot, and once per detected
// end-of-track by the lyrics viewer (auto re-sync — a single event-driven read,
// still never polled). `progressMs` + `readAtMs` seed the viewer's clock
// estimate; `durationMs` is what lets the viewer detect the track ending. The
// `playing` state also carries display metadata (track/artist/album/cover) so
// the now-playing card can render the live moment without a second request.
import { getStreamingToken } from '@lib/spotifyPlayback'

const PLAYER_URL = 'https://api.spotify.com/v1/me/player'

export type LivePlayback =
	| {
		state: 'playing'
		trackId: string
		progressMs: number | null
		/**
		 * Wall-clock instant (performance.now() timeline) `progressMs` was
		 * measured at — the request window's midpoint, since Spotify stamps the
		 * progress somewhere inside it. Anchoring the clock estimate against
		 * this instead of "whenever the caller got around to it" is what keeps
		 * lyrics from lagging by the request + lyrics-load latency.
		 */
		readAtMs: number
		durationMs: number | null
		track: string | null
		artist: string | null
		album: string | null
		albumCoverUrl: string | null
	} |
	{ state: 'idle' } |
	{ state: 'unavailable' }

/**
 * Read the current playback moment once.
 *
 * - `playing` — an actively playing music track (`item.type === 'track'`).
 * - `idle` — 204 (no active device), paused, or a non-track item (ad/podcast):
 *   nothing the viewer may open. The viewer treats this as "no active playback"
 *   — entry hidden, no recent-history fallback.
 * - `unavailable` — token mint failed (dormant/unauthorized/error) or the read
 *   itself failed; distinct from idle so callers never *hide* the entry over a
 *   transient failure.
 */
export async function readLivePlayback(): Promise<LivePlayback> {
  const tok = await getStreamingToken()
  if (!tok.ok)
    return { state: 'unavailable' }

  const requestStartMs = performance.now()
  let res: Response
  try {
    res = await fetch(PLAYER_URL, { headers: { Authorization: `Bearer ${tok.token}` } })
  }
  catch {
    return { state: 'unavailable' }
  }
  if (res.status === 204)
    return { state: 'idle' }
  if (!res.ok)
    return { state: 'unavailable' }

  let body: {
    is_playing?: boolean
    progress_ms?: number | null
    item?: {
      id?: string
      type?: string
      duration_ms?: number | null
      name?: string | null
      artists?: Array<{ name?: string | null } | null> | null
      album?: {
        name?: string | null
        images?: Array<{ url?: string | null, width?: number | null } | null> | null
      } | null
    } | null
  }
  try {
    body = await res.json()
  }
  catch {
    return { state: 'unavailable' }
  }

  const item = body?.item
  if (!body?.is_playing || !item?.id || item.type !== 'track')
    return { state: 'idle' }
  const artist = (item.artists ?? [])
    .map(a => a?.name)
    .filter((n): n is string => Boolean(n))
    .join(', ')
  // Smallest cover that still fills the largest card slot (116px @2x ≈ 232);
  // Spotify orders images largest-first, so sort ascending and fall back to the
  // largest when nothing reaches the threshold.
  const images = (item.album?.images ?? [])
    .filter((i): i is { url: string, width?: number | null } => Boolean(i?.url))
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
  const cover = images.find(i => (i.width ?? 0) >= 232) ?? images[images.length - 1]
  return {
    state: 'playing',
    trackId: String(item.id),
    progressMs: typeof body.progress_ms === 'number' ? body.progress_ms : null,
    readAtMs: (requestStartMs + performance.now()) / 2,
    durationMs: typeof item.duration_ms === 'number' ? item.duration_ms : null,
    track: item.name ?? null,
    artist: artist || null,
    album: item.album?.name ?? null,
    albumCoverUrl: cover?.url ?? null,
  }
}
