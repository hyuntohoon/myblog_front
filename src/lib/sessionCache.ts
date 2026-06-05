// FEAT-music-edge-cache Step 3 — in-session GET cache for public music reads.
//
// Two tiers, both $0 and client-only: a per-page in-memory Map (instant) backed
// by sessionStorage (survives in-tab navigation / back-forward within the tab).
// Layers under the CloudFront edge + browser HTTP cache — this kills redundant
// refetches the HTTP cache can miss (e.g. re-running the same search, reopening
// the same album in the same session).
//
// Success-only by construction: callers pass an async producer, and a throw
// (network error, or an absorb-pending by-spotify 404) is propagated WITHOUT
// being cached, so the writer's click-again-after-sync retry still re-fetches.
//
// TTLs mirror the server `max-age` (search 60s, detail 300s); staleness budget
// is "minutes" (owner-accepted), so no active invalidation.

export const SEARCH_TTL_MS = 60_000
export const DETAIL_TTL_MS = 300_000

const KEY_PREFIX = 'mbc:' // myblog-cache

interface Entry { v: unknown, exp: number }

const mem = new Map<string, Entry>()

function readEntry(key: string, now: number): unknown | undefined {
	const hit = mem.get(key)
	if (hit) {
		if (hit.exp > now)
			return hit.v
		mem.delete(key)
	}
	try {
		const raw = sessionStorage.getItem(key)
		if (raw) {
			const parsed = JSON.parse(raw) as Entry
			if (parsed.exp > now) {
				mem.set(key, parsed)
				return parsed.v
			}
			sessionStorage.removeItem(key)
		}
	}
	catch {
		// sessionStorage unavailable (private mode / quota) — memory tier still works.
	}
	return undefined
}

function writeEntry(key: string, v: unknown, ttlMs: number): void {
	const entry: Entry = { v, exp: Date.now() + ttlMs }
	mem.set(key, entry)
	try {
		sessionStorage.setItem(key, JSON.stringify(entry))
	}
	catch {
		// Ignore quota/availability errors — memory tier is enough.
	}
}

/**
 * Return a cached value for `url`, else run `producer()`, cache its resolved
 * value for `ttlMs`, and return it. A rejected `producer()` is NOT cached.
 */
export async function cached<T>(url: string, ttlMs: number, producer: () => Promise<T>): Promise<T> {
	const key = KEY_PREFIX + url
	const hit = readEntry(key, Date.now())
	if (hit !== undefined)
		return hit as T
	const value = await producer()
	writeEntry(key, value, ttlMs)
	return value
}
