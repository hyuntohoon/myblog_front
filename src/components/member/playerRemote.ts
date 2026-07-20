import { getStreamingToken } from '@lib/spotifyPlayback'

export type RemoteResult = { ok: true } | { ok: false, reason: 'no-device' | 'restricted' | 'transient' }

/**
 * Spotify Connect controls use probe-model capability detection (RFC
 * FEAT-member-player Step 3): a control response, not account metadata,
 * establishes the session tier. Rule 9 requires every provider call to remain
 * client-side; the backend only mints the member token asynchronously.
 */
async function sendRemote(path: string): Promise<RemoteResult> {
	const tok = await getStreamingToken()
	if (!tok.ok) {
		return {
			ok: false,
			reason: tok.status === 'not_connected' || tok.status === 'unauthorized' ? 'restricted' : 'transient',
		}
	}

	let res: Response
	try {
		res = await fetch(`https://api.spotify.com/v1/me/player/${path}`, {
			method: 'PUT',
			headers: { Authorization: `Bearer ${tok.token}` },
			// A hung control PUT would otherwise pin the single-flight busy state
			// until the browser gives up; an abort lands in the transient branch.
			signal: AbortSignal.timeout(10_000),
		})
	}
	catch {
		return { ok: false, reason: 'transient' }
	}
	if (res.ok)
		return { ok: true }
	if (res.status === 404)
		return { ok: false, reason: 'no-device' }
	if (res.status === 403)
		return { ok: false, reason: 'restricted' }
	return { ok: false, reason: 'transient' }
}

export function pauseRemote(): Promise<RemoteResult> {
	return sendRemote('pause')
}

export function resumeRemote(): Promise<RemoteResult> {
	return sendRemote('play')
}

export function seekRemote(positionMs: number): Promise<RemoteResult> {
	return sendRemote(`seek?position_ms=${Math.round(positionMs)}`)
}
