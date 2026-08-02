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
// refresh / 동기화), once on member-dashboard entry (FEAT-nowplaying-live-sync)
// to overlay the stale snapshot, and once per detected end-of-track by the
// lyrics viewer (auto re-sync — a single event-driven read, still never
// polled). `progressMs` + `readAtMs` seed the viewer's clock estimate;
// `durationMs` is what lets the viewer detect the track ending. The `playing`
// state also carries display metadata (track/artist/album/cover — plus the raw
// Spotify artist/album ids, member-player Step 3, resolved lazily to catalog
// ids by consumers) so the now-playing card can render the live moment without
// a second request. Per-member since member-player Step 2/3: the token mint is
// row-scoped to the signed-in member, so the former owner gate is gone.
import { getStreamingToken } from '@lib/spotifyPlayback'

const PLAYER_URL = 'https://api.spotify.com/v1/me/player'

/**
 * The fields a read carries when Spotify has a track loaded — whether it is
 * running or held. `playing` and `paused` share this shape exactly: a paused
 * player still reports its position, its track and its device.
 */
export interface LivePlaybackTrack {
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
		/** Spotify artist ids+names (catalog resolution is the consumer's job). */
		artists: Array<{ id: string, name: string }>
		album: string | null
		/** Spotify album id (catalog resolution is the consumer's job). */
		albumSpotifyId: string | null
		albumCoverUrl: string | null
		/**
		 * Active Connect device name (member-player Step 4 "playing elsewhere"
		 * hint) — comes free with the same `GET /me/player` body, so the hint
		 * refreshes exactly when the one-shot fires (D28: never polled).
		 */
	deviceName: string | null
  /**
   * Playback modes (member-player Step 6e). Like `deviceName`, these ride the
   * SAME `GET /me/player` body the one-shot already fetches — reading them costs
   * zero extra requests, so D28 holds by construction rather than by restraint.
   * `volumePercent` is null on devices that expose no volume API (speakers with
   * fixed output, some TVs); a null here means "no control", not "muted".
   */
  shuffle: boolean | null
  repeat: 'off' | 'context' | 'track' | null
  volumePercent: number | null
  /**
   * The album/playlist the player is running (`context.uri`/`context.type`),
   * or null for a bare `uris` playback. FEAT-lyrics-viewer-playback Step 3
   * needs it: a `context_uri` + `offset` jump is the only form that leaves the
   * context alive, and there is no other source for it — the queue endpoint
   * does not report a context.
   */
  contextUri: string | null
  contextType: string | null
}

export type LivePlayback =
	| ({ state: 'playing' } & LivePlaybackTrack) |
	/**
	 * FEAT-lyrics-sync-precision Step 2 — a track is loaded but held. Split out
	 * of `idle` because the lyrics viewer has to FREEZE at the real paused
	 * position: collapsing it into `idle` threw the position away, so the only
	 * way to freeze was to guess from an already-ageing estimate.
	 *
	 * Callers that only ask "is something playing?" must treat this exactly as
	 * they treat `idle` — it carries no new obligation, only new information.
	 */
	({ state: 'paused' } & LivePlaybackTrack) |
	{ state: 'idle' } |
	{ state: 'unavailable' }

/**
 * Read the current playback moment once.
 *
 * - `playing` — an actively playing music track (`item.type === 'track'`).
 * - `paused` — the same track payload, held. Was folded into `idle` until
 *   FEAT-lyrics-sync-precision Step 2.
 * - `idle` — 204 (no active device) or a non-track item (ad/podcast): nothing
 *   the viewer may open. The viewer treats this as "no active playback" —
 *   entry hidden, no recent-history fallback.
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
    device?: { name?: string | null, volume_percent?: number | null } | null
    shuffle_state?: boolean | null
    repeat_state?: string | null
    context?: { uri?: string | null, type?: string | null } | null
    item?: {
      id?: string
      type?: string
      duration_ms?: number | null
      name?: string | null
      artists?: Array<{ id?: string | null, name?: string | null } | null> | null
      album?: {
        id?: string | null
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
  // No music track loaded at all (204 handled above, ad/podcast, empty body) —
  // nothing the viewer may open, and nothing to freeze at.
  if (!item?.id || item.type !== 'track')
    return { state: 'idle' }
  const namedArtists = (item.artists ?? [])
    .flatMap(a => (a?.id && a?.name ? [{ id: a.id, name: a.name }] : []))
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
    state: body.is_playing ? 'playing' : 'paused',
    trackId: String(item.id),
    progressMs: typeof body.progress_ms === 'number' ? body.progress_ms : null,
    readAtMs: (requestStartMs + performance.now()) / 2,
    durationMs: typeof item.duration_ms === 'number' ? item.duration_ms : null,
    track: item.name ?? null,
    artist: artist || null,
    artists: namedArtists,
    album: item.album?.name ?? null,
    albumSpotifyId: item.album?.id ?? null,
    albumCoverUrl: cover?.url ?? null,
    deviceName: body.device?.name?.trim() || null,
    shuffle: typeof body.shuffle_state === 'boolean' ? body.shuffle_state : null,
    repeat: body.repeat_state === 'off' || body.repeat_state === 'context' || body.repeat_state === 'track' ? body.repeat_state : null,
    volumePercent: typeof body.device?.volume_percent === 'number' ? body.device.volume_percent : null,
    contextUri: body.context?.uri ?? null,
    contextType: body.context?.type ?? null,
  }
}
