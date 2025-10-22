export async function safeFetch<T>(
	url: string,
	init?: RequestInit
): Promise<T | null> {
	const controller = new AbortController()
	const id = setTimeout(() => controller.abort(), 8000)
	try {
		const res = await fetch(url, { ...init, signal: controller.signal })
		if (!res.ok) return null
		return (await res.json()) as T
	} catch {
		return null
	} finally {
		clearTimeout(id)
	}
}

export type AddCategoryResult =
	| { ok: true; name: string; persisted: boolean }
	| { ok: false; error: string }

const API = import.meta.env.PUBLIC_API_URL as string | undefined

export async function addCategory(name: string): Promise<AddCategoryResult> {
	const trimmed = String(name ?? '').trim()
	if (!trimmed) return { ok: false, error: 'empty' }

	if (!API) return { ok: true, name: trimmed, persisted: false } // 낙관적 UI

	try {
		const r = await fetch(`${API}/categories`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: trimmed }),
		})
		if (!r.ok) throw new Error('api failed')
		const json = await r.json()
		return { ok: true, name: json.name ?? trimmed, persisted: true }
	} catch {
		return { ok: true, name: trimmed, persisted: false }
	}
}

export type Metrics = { likes: number; comments: number }

export async function fetchMetrics(
	slugs: string[]
): Promise<Record<string, Metrics>> {
	const API = import.meta.env.PUBLIC_API_URL as string | undefined
	if (!API || slugs.length === 0) return {}
	try {
		const r = await fetch(`${API}/api/metrics/batch`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ slugs }),
		})
		if (!r.ok) return {}
		const json = (await r.json()) as { data?: Record<string, Metrics> }
		return json.data ?? {}
	} catch {
		return {}
	}
}
