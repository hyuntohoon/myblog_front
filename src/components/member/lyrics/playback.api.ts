// FEAT-lyrics-viewer Step 3 — one-shot live playback read.
//
// The RESEARCH-playback-product-architecture contract: track identity for the
// lyrics viewer comes from a client-side `GET /v1/me/player` (the now-playing
// snapshot stores no track id and can be ~1h stale). Same sanctioned pattern as
// `requestPlayback`'s existing api.spotify.com call — the only server hit is the
// async token mint, so rule #9 (no synchronous Spotify call on a user-facing
// endpoint) is not engaged. The token already carries `user-read-playback-state`.
//
// This is a ONE-SHOT read fired by an explicit user action (entry tap / manual
// refresh). It is never polled and never drives continuous progression (RFC
// non-goal); `progressMs` only seeds a single initial-focus computation.
import { getStreamingToken } from '@lib/spotifyPlayback'

const PLAYER_URL = 'https://api.spotify.com/v1/me/player'

export type LivePlayback =
	| { state: 'playing', trackId: string, progressMs: number | null } |
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

  let body: { is_playing?: boolean, progress_ms?: number | null, item?: { id?: string, type?: string } | null }
  try {
    body = await res.json()
  }
  catch {
    return { state: 'unavailable' }
  }

  const item = body?.item
  if (!body?.is_playing || !item?.id || item.type !== 'track')
    return { state: 'idle' }
  return {
    state: 'playing',
    trackId: String(item.id),
    progressMs: typeof body.progress_ms === 'number' ? body.progress_ms : null,
  }
}
