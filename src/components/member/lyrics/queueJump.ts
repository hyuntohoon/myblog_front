// FEAT-lyrics-viewer-playback Step 3 — the queue jump fallback chain.
//
// The one property this module exists to protect is that the explicit `uris`
// fallback carries the whole visible tail. A lone-track fallback would replace
// Spotify's playback context and silently discard every queued row after it.
import type { PlayOutcome, PlayRung } from '@lib/spotifyPlayback'
import type { QueueEntry } from './queue.api'
import { play } from '@lib/spotifyPlayback'

/** The album/playlist the player is running, as read by `readLivePlayback`. */
export interface JumpContext { uri: string, type: string }

export type JumpOutcome =
	/**
	 * `rung`/`degraded` are carried, not dropped. They are the ladder's answer to
	 * "where did the sound actually come from", and the session patches them onto
	 * the shared state — a jump that lands on rung 2 has to say 음질 제한 exactly
	 * like `playFrom` does, and has to tell every mirror tab that the owner now
	 * holds an in-page device (ARCH-playback-authority-convergence Step 1: a mirror
	 * whose `ownerRung` stayed `null` kept a live transport and never offered the
	 * takeover the Global Player offers two inches away).
	 */
	| { ok: true, via: 'context' | 'uris', rung: PlayRung, degraded: boolean } |
	/** The row carried no uri — there was never anything to send. */
	{ ok: false, reason: 'nothing-to-send' } |
	{ ok: false, reason: 'no-capability' } |
	{ ok: false, reason: 'token' } |
	{ ok: false, reason: 'transient' }

export async function jumpToQueueIndex(items: QueueEntry[], index: number, context: JumpContext | null): Promise<JumpOutcome> {
	const tapped = items[index]
	if (!tapped?.uri)
		return { ok: false, reason: 'nothing-to-send' }
	// E4 backstop. The row renders inert for an episode, so this is unreachable
	// from the UI — it is here because the harm is one layer down, not in the
	// button: `readLivePlayback` classifies a playing episode as `idle`, so a jump
	// to one would leave the session adopting "nothing is playing" over a player
	// that is audibly running. The tail below still CARRIES episodes, which is the
	// Step 2 invariant: what plays next is the order on screen.
	if (tapped.mediaType === 'episode')
		return { ok: false, reason: 'nothing-to-send' }

	// This is a plain slice of what is ON SCREEN — the queue screen renders
	// `재생 중` separately from the numbered rows, so "everything after the tap"
	// needs no second request and no matching heuristic. Spotify's `uris` accepts
	// far more than the ~20 entries this endpoint ever returns, so the tail always
	// fits one request.
	const tail = items.slice(index).flatMap(i => (i.uri ? [i.uri] : []))

	if (context && (context.type === 'album' || context.type === 'playlist')) {
		const r: PlayOutcome = await play({
			kind: 'context',
			contextUri: context.uri,
			offsetUri: tapped.uri,
		})
		if (r.ok)
			return { ok: true, via: 'context', rung: r.rung, degraded: r.degraded }
		// Fall through on ANY failure, including a legitimate 403 for a
		// user-added row that is not part of the album/playlist context.
	}

	const r = await play({ kind: 'uris', uris: tail })
	if (r.ok)
		return { ok: true, via: 'uris', rung: r.rung, degraded: r.degraded }
	// The ladder's richer failure set collapses back to this module's three, which is
	// all its callers render. 'unresolvable'/'unavailable' cannot occur here — both
	// intents carry provider URIs already, so nothing is resolved on this path.
	return { ok: false, reason: r.reason === 'no-capability' ? 'no-capability' : r.reason === 'token' ? 'token' : 'transient' }
}
