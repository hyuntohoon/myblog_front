import { getAccessToken, goLogin, refreshAccessToken } from './auth'

export async function safeFetch<T>(
	url: string,
	init?: RequestInit,
): Promise<T | null> {
	const controller = new AbortController()
	const id = setTimeout(() => controller.abort(), 8000)
	try {
		const res = await fetch(url, { ...init, signal: controller.signal })
		if (!res.ok)
return null
		return (await res.json()) as T
	}
 catch {
		return null
	}
 finally {
		clearTimeout(id)
	}
}

export interface Metrics { likes: number, comments: number }

export async function fetchMetrics(
	slugs: string[],
): Promise<Record<string, Metrics>> {
	const API = import.meta.env.PUBLIC_BACKEND_API_URL as string | undefined
	if (!API || slugs.length === 0)
return {}
	try {
		const r = await fetch(`${API}/api/metrics/batch`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ slugs }),
		})
		if (!r.ok)
return {}
		const json = (await r.json()) as { data?: Record<string, Metrics> }
		return json.data ?? {}
	}
 catch {
		return {}
	}
}

function buildHeaders(options: RequestInit, token: string | null): HeadersInit {
	const h: Record<string, string> = {
		...(options.headers as Record<string, string> || {}),
		'Content-Type': 'application/json',
	}
	if (token)
		h.Authorization = `Bearer ${token}`
	return h
}

export interface ApiFetchOptions extends RequestInit {
	/**
	 * Abort the request — its 401 refresh AND its post-refresh retry — after this
	 * many ms. Default {@link DEFAULT_TIMEOUT_MS}. A caller `signal` (e.g. search
	 * cancellation) composes WITH this: whichever fires first aborts the fetch.
	 */
	timeoutMs?: number
}

// Default per-call ceiling. Generous enough for a cold Lambda + refresh retry,
// tight enough that a wedged request surfaces as a null instead of hanging the
// UI forever (REFACTOR Step 2 — apiFetch previously had no timeout at all).
const DEFAULT_TIMEOUT_MS = 15000

/**
 * Authed fetch. On 401, tries the refresh_token flow once. If refresh succeeds,
 * retries the original request with the new access_token. If refresh fails,
 * redirects to login and returns null.
 *
 * Every call is bounded by a timeout (default {@link DEFAULT_TIMEOUT_MS}); a
 * caller-supplied `signal` composes with it so a superseded request (e.g.
 * search-as-you-type) can be cancelled explicitly. A timeout, a caller abort,
 * and any network/transport error all return null without forcing a re-login
 * (the caller decides whether to retry) — only a genuine 401-after-refresh does.
 */
export async function apiFetch(path: string, options: ApiFetchOptions = {}): Promise<Response | null> {
	const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: callerSignal, ...init } = options

	// One controller drives BOTH the original request and the post-refresh retry,
	// composed from the caller's signal (if any) + a timeout. Composed manually
	// rather than via AbortSignal.any/timeout for jsdom-test parity.
	const controller = new AbortController()
	const onCallerAbort = () => controller.abort(callerSignal?.reason)
	if (callerSignal) {
		if (callerSignal.aborted)
			controller.abort(callerSignal.reason)
		else
			callerSignal.addEventListener('abort', onCallerAbort, { once: true })
	}
	const timer = setTimeout(
		() => controller.abort(new DOMException('apiFetch timed out', 'TimeoutError')),
		timeoutMs,
	)

	try {
		const token = getAccessToken()
		let res = await fetch(path, { ...init, headers: buildHeaders(init, token), signal: controller.signal })

		if (res.status === 401) {
			// The refresh is awaited UNDER this call's deadline (FIX-auth-identity-lifecycle
			// Step 1). It used to be awaited bare: `refreshAccessToken()` issued its own
			// unsignalled fetch, so a Cognito token endpoint that simply never answered
			// held the caller well past the ceiling this function advertises. Passing the
			// composed signal makes it reject on timeout or caller abort — which the outer
			// catch turns into `null`, deliberately WITHOUT `goLogin`: a missed deadline is
			// not evidence that the session is invalid, and redirecting on it would throw
			// the user out of a still-good session over a slow network.
			const refreshed = await refreshAccessToken(controller.signal)
			if (refreshed) {
				res = await fetch(path, { ...init, headers: buildHeaders(init, refreshed), signal: controller.signal })
				if (res.status !== 401)
					return res
			}
			console.warn('Auth refresh failed — redirecting to login')
			goLogin(true)
			return null
		}

		return res
	}
	catch (err) {
		console.error('API fetch error:', err)
		return null
	}
	finally {
		clearTimeout(timer)
		callerSignal?.removeEventListener('abort', onCallerAbort)
	}
}
