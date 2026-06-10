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

/**
 * Authed fetch. On 401, tries the refresh_token flow once. If refresh succeeds,
 * retries the original request with the new access_token. If refresh fails,
 * redirects to login and returns null.
 *
 * Network/transport errors return null without forcing a re-login (the caller
 * can decide whether to retry).
 */
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response | null> {
	try {
		const token = getAccessToken()
		let res = await fetch(path, { ...options, headers: buildHeaders(options, token) })

		if (res.status === 401) {
			const refreshed = await refreshAccessToken()
			if (refreshed) {
				res = await fetch(path, { ...options, headers: buildHeaders(options, refreshed) })
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
}
