// FEAT-lyrics-viewer Step 3 — one-shot live playback read.
//
// The RESEARCH-playback-product-architecture contract: track identity comes
// from a client-side Spotify read; the now-playing snapshot stores no track id
// and can be ~1h stale. The only server hit is the asynchronous per-member token
// mint, so rule #9 (no synchronous Spotify call on a user-facing endpoint) is
// not engaged.
//
// Members with the earlier grant lack `user-read-playback-state`. A 403 from
// `/me/player` therefore falls back exactly once to the already-granted
// `/me/player/currently-playing`; its source tag keeps display continuity while
// preventing callers from presenting controls the grant cannot support.
import { getStreamingToken } from '@lib/spotifyPlayback'

const PLAYER_URL = 'https://api.spotify.com/v1/me/player'
const CURRENTLY_PLAYING_URL = 'https://api.spotify.com/v1/me/player/currently-playing'

interface LiveTrackPlayback {
	trackId: string
	progressMs: number | null
	/**
	 * Wall-clock instant (performance.now() timeline) `progressMs` was
	 * measured at — the request window's midpoint, since Spotify stamps the
	 * progress somewhere inside it.
	 */
	readAtMs: number
	durationMs: number | null
	track: string | null
	artist: string | null
	album: string | null
	albumCoverUrl: string | null
	source: 'player' | 'currently-playing'
}

export type LivePlayback =
	| ({ state: 'playing' } & LiveTrackPlayback) |
	({ state: 'paused' } & LiveTrackPlayback) |
	{ state: 'idle' } |
	{ state: 'unavailable' }

interface SpotifyPlaybackBody {
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

async function parsePlayback(res: Response, requestStartMs: number, source: LiveTrackPlayback['source']): Promise<LivePlayback> {
	if (res.status === 204)
		return { state: 'idle' }
	if (!res.ok)
		return { state: 'unavailable' }

	let body: SpotifyPlaybackBody
	try {
		body = await res.json() as SpotifyPlaybackBody
	}
	catch {
		return { state: 'unavailable' }
	}

	const item = body?.item
	if (!item?.id || item.type !== 'track')
		return { state: 'idle' }
	if (body.is_playing !== true && body.is_playing !== false)
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
		state: body.is_playing ? 'playing' : 'paused',
		trackId: String(item.id),
		progressMs: typeof body.progress_ms === 'number' ? body.progress_ms : null,
		readAtMs: (requestStartMs + performance.now()) / 2,
		durationMs: typeof item.duration_ms === 'number' ? item.duration_ms : null,
		track: item.name ?? null,
		artist: artist || null,
		album: item.album?.name ?? null,
		albumCoverUrl: cover?.url ?? null,
		source,
	}
}

/**
 * Read the current playback moment once.
 *
 * `playing` and `paused` expose a music track. A 204, missing item, or non-track
 * item is `idle`; provider/token failures are `unavailable` so callers never
 * hide retryable UI over a transient failure. This function never schedules a
 * follow-up read or polling loop.
 */
export async function readLivePlayback(): Promise<LivePlayback> {
	const tok = await getStreamingToken()
	if (!tok.ok)
		return { state: 'unavailable' }

	let requestStartMs = performance.now()
	let res: Response
	try {
		res = await fetch(PLAYER_URL, { headers: { Authorization: `Bearer ${tok.token}` } })
	}
	catch {
		return { state: 'unavailable' }
	}

	if (res.status !== 403)
		return parsePlayback(res, requestStartMs, 'player')

	requestStartMs = performance.now()
	try {
		res = await fetch(CURRENTLY_PLAYING_URL, { headers: { Authorization: `Bearer ${tok.token}` } })
	}
	catch {
		return { state: 'unavailable' }
	}
	return parsePlayback(res, requestStartMs, 'currently-playing')
}
