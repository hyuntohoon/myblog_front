// FEAT-lyrics-viewer-playback Step 2 — one-shot read of the playback queue.
//
// Same sanctioned client-side pattern as `playback.api.ts`: the only server hit
// is the async token mint, then a direct `GET api.spotify.com/v1/me/player/queue`
// from the browser. rule #9 (no synchronous Spotify call on a user-facing
// backend endpoint) is not engaged.
//
// OQ1 (RFC) was answered 2026-08-01 and the RFC's premise was WRONG. It read
// `STREAMING_SCOPES` in `scripts/spotify_bootstrap_token.py` and concluded the
// browser's token lacks `user-read-currently-playing`, so the queue endpoint
// would 403 and cost the owner a re-consent. Probed against the LIVE stored
// grant instead: the token actually carries both documented scopes and the
// endpoint returns 200 (19 queued items, and 200 even while paused). Members
// are covered too — the member connect URL (`integrations.api.ts`) has asked
// for `user-read-currently-playing` all along. No re-consent, no new scope.
//
// A 403 is therefore NOT expected — but it stays a first-class outcome, because
// a legacy member grant is the one shape that could still lack the scope, and
// the RFC's rule for this screen is that a failure degrades the panel and never
// closes the viewer.
//
// This is a ONE-SHOT read: once when the queue screen opens, and once more if
// the viewer's track identity changes while it is open. No interval (D28).
import { getStreamingToken } from '@lib/spotifyPlayback'

const QUEUE_URL = 'https://api.spotify.com/v1/me/player/queue'

/** Matches `apiFetch`'s ceiling — the queue is a foreground read behind a tap. */
const TIMEOUT_MS = 8000

export interface QueueEntry {
	/** Spotify id. Used as the react key and to mark the playing row. */
	id: string
	/**
	 * Spotify uri (`spotify:track:…`). Step 3 sends this to jump. Nullable
	 * defensively — a row with no uri has nothing to send and stays inert
	 * rather than looking tappable and failing.
	 */
	uri: string | null
	name: string
	/** Joined artist names, or null for an entry that has none (episode). */
	artist: string | null
	/**
	 * What KIND of thing this is (E4). Episodes really are in the member's queue
	 * and are kept, but they are not tappable: `readLivePlayback` classifies an
	 * episode as `idle`, so a jump to one would hand the session a track it then
	 * reports as "nothing playing". Until this field existed the row rendered as a
	 * button purely because Spotify happens to give episodes a uri, and the two
	 * models contradicted each other in the member's hands.
	 *
	 * Anything that is not explicitly an episode is a track: an unknown future
	 * `type` stays tappable rather than silently going inert.
	 */
	mediaType: 'track' | 'episode'
}

export type QueueResult =
	| { ok: true, current: QueueEntry | null, items: QueueEntry[] } |
	/** Token mint failed — Spotify is not connected/usable at all right now. */
	{ ok: false, reason: 'token' } |
	/** 403: the grant lacks a scope. Durable — a retry cannot clear it. */
	{ ok: false, reason: 'no-capability' } |
	/**
	 * 404: no active device. Recoverable — opening Spotify makes the same read
	 * work, so this one DOES get a 다시 시도 (ARCH-playback-authority-convergence
	 * Step 3; it used to be folded into `no-capability` and told the member their
	 * account could not see a queue).
	 */
	{ ok: false, reason: 'no-active-device' } |
	{ ok: false, reason: 'transient' }

interface RawEntry {
	id?: string | null
	uri?: string | null
	name?: string | null
	/** `'track' | 'episode'` from Spotify. Absent on nothing it documents, read defensively. */
	type?: string | null
	artists?: Array<{ name?: string | null } | null> | null
}

/**
 * Map one raw queue entry, or null when it carries nothing renderable.
 *
 * Episodes are kept rather than filtered: they really are in the member's
 * queue, and dropping them would make the list silently disagree with the
 * Spotify app. They simply have no `artists`, which the row renders as an
 * empty subtitle.
 */
function toEntry(raw: RawEntry | null | undefined): QueueEntry | null {
	if (!raw?.id || !raw.name)
		return null
	const artist = (raw.artists ?? [])
		.map(a => a?.name)
		.filter((n): n is string => Boolean(n))
		.join(', ')
	return {
		id: String(raw.id),
		uri: raw.uri ? String(raw.uri) : null,
		name: String(raw.name),
		artist: artist || null,
		mediaType: raw.type === 'episode' ? 'episode' : 'track',
	}
}

/** Read the member's playback queue once. Never throws. */
export async function readQueue(): Promise<QueueResult> {
	const tok = await getStreamingToken()
	if (!tok.ok)
		return { ok: false, reason: 'token' }

	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
	let res: Response
	try {
		res = await fetch(QUEUE_URL, {
			headers: { Authorization: `Bearer ${tok.token}` },
			signal: controller.signal,
		})
	}
	catch {
		// Network failure or our own timeout abort — both transient.
		return { ok: false, reason: 'transient' }
	}
	finally {
		clearTimeout(timer)
	}

	if (res.status === 403)
		return { ok: false, reason: 'no-capability' }
	if (res.status === 404)
		return { ok: false, reason: 'no-active-device' }
	// 204 = no active device. Not a failure: an empty queue is a real, sayable
	// state, and it is what the screen already renders for `items: []`.
	if (res.status === 204)
		return { ok: true, current: null, items: [] }
	if (!res.ok)
		return { ok: false, reason: 'transient' }

	let body: { currently_playing?: RawEntry | null, queue?: Array<RawEntry | null> | null }
	try {
		body = await res.json()
	}
	catch {
		return { ok: false, reason: 'transient' }
	}
	return {
		ok: true,
		current: toEntry(body?.currently_playing),
		items: (body?.queue ?? []).flatMap((raw) => {
			const e = toEntry(raw)
			return e ? [e] : []
		}),
	}
}
