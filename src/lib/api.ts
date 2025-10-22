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
