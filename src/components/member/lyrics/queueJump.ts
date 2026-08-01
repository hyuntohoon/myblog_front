// FEAT-lyrics-viewer-playback Step 3 — the queue jump fallback chain.
//
// The one property this module exists to protect is that the explicit `uris`
// fallback carries the whole visible tail. A lone-track fallback would replace
// Spotify's playback context and silently discard every queued row after it.
import type { PlayerCommandOutcome } from '@lib/spotifyPlayback'
import type { QueueEntry } from './queue.api'
import { sendPlayerCommand } from '@lib/spotifyPlayback'

/** The album/playlist the player is running, as read by `readLivePlayback`. */
export interface JumpContext { uri: string, type: string }

export type JumpOutcome =
	| { ok: true, via: 'context' | 'uris' } |
	/** The row carried no uri — there was never anything to send. */
	{ ok: false, reason: 'nothing-to-send' } |
	{ ok: false, reason: 'no-capability' } |
	{ ok: false, reason: 'token' } |
	{ ok: false, reason: 'transient' }

export async function jumpToQueueIndex(items: QueueEntry[], index: number, context: JumpContext | null): Promise<JumpOutcome> {
	const tapped = items[index]
	if (!tapped?.uri)
		return { ok: false, reason: 'nothing-to-send' }

	// This is a plain slice of what is ON SCREEN — the queue screen renders
	// `재생 중` separately from the numbered rows, so "everything after the tap"
	// needs no second request and no matching heuristic. Spotify's `uris` accepts
	// far more than the ~20 entries this endpoint ever returns, so the tail always
	// fits one request.
	const tail = items.slice(index).flatMap(i => (i.uri ? [i.uri] : []))

	if (context && (context.type === 'album' || context.type === 'playlist')) {
		const r: PlayerCommandOutcome = await sendPlayerCommand({
			kind: 'play-context',
			contextUri: context.uri,
			offsetUri: tapped.uri,
		})
		if (r.ok)
			return { ok: true, via: 'context' }
		// Fall through on ANY failure, including a legitimate 403 for a
		// user-added row that is not part of the album/playlist context.
	}

	const r = await sendPlayerCommand({ kind: 'play-uris', uris: tail })
	if (r.ok)
		return { ok: true, via: 'uris' }
	return { ok: false, reason: r.reason }
}
