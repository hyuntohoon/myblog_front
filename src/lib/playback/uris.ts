// FEAT-playback-bucket-player Step 6 — DB track id → Spotify URI, for the tail.
//
// WHY THIS FILE EXISTS AT ALL — and why it should eventually stop existing.
//
// T2's play rule is `play({kind:'uris', uris:[n…end]})`: starting at position n
// re-issues OUR OWN tail so Spotify's queue is never written and there is nothing
// to reconcile. That intent takes provider URIs. The queue projection, though,
// carries DB track ids (`BoardAlbum.trackId`) — the bucket tree payload has never
// included a Spotify id for a member row.
//
// The RFC assumed the tail was already URIs and did not cost this out. Audited at
// step time (the "re-verify Current state" rule): the only resolver that exists is
// `GET /api/playback/resolve?type=track&id=<one>` — strictly one id per request.
//
// So the tail costs one request per uncached track, and a 40-track album expansion
// is a 40-request play tap. That is the wrong shape for a user-facing action, and
// this module exists to make it *not happen in practice* rather than to pretend it
// is fine:
//
//   · every resolved URI is memoised for the tab's lifetime (ids are immutable —
//     `tracks.spotify_id` is NOT NULL + UNIQUE, so a hit can never go stale);
//   · in-flight requests are deduped, so a prefetch racing a play tap costs one;
//   · the panel prefetches its visible queue at low concurrency while idle, so the
//     steady state at play time is ZERO requests;
//   · play time resolves only the misses, and a miss that fails is dropped from the
//     tail rather than failing the whole play.
//
// THE REAL FIX IS ONE FIELD, and it is deliberately not taken here because it is
// cross-repo and this step is front-only: surface `tracks.spotify_id` on playback
// bucket items in the tree payload. Then `queueUris` is `map(r => 'spotify:track:'+id)`,
// this module deletes, and the request count is zero even cold. Recorded in the RFC
// as the follow-up rather than left as a comment nobody reads.
import { getAuthHeader } from '@lib/auth'

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string | undefined
const RESOLVE_PATH = '/api/playback/resolve'

/** Concurrency for the idle prefetch. Low on purpose: it must never crowd out a play tap. */
const PREFETCH_CONCURRENCY = 4

/**
 * trackId → URI. `null` is a REMEMBERED miss (the track has no Spotify id / 404),
 * so a dead row is asked about once per tab rather than on every play.
 */
const cache = new Map<string, string | null>()
/** trackId → in-flight promise, so a prefetch and a play tap share one request. */
const inflight = new Map<string, Promise<string | null>>()

/** Test seam — the store is module-level, so a test that resolves must be able to reset it. */
export function __resetUriCache(): void {
  cache.clear()
  inflight.clear()
}

/** What is already known, without touching the network. Used by the play path's fast case. */
export function cachedUri(trackId: string): string | null | undefined {
  return cache.get(trackId)
}

async function fetchUri(trackId: string): Promise<string | null> {
  if (!BASE)
    return null
  try {
    const url = `${BASE}${RESOLVE_PATH}?type=track&id=${encodeURIComponent(trackId)}`
    const res = await fetch(url, { headers: { ...getAuthHeader() } })
    if (!res.ok)
      return null
    const body = (await res.json()) as { uri?: string | null }
    return body?.uri ?? null
  }
  catch {
    // Network/parse failure is a miss, not a throw: the caller's job is to play
    // what it can, and one unreachable row must not take the tail down with it.
    return null
  }
}

/** Resolve one id, memoised and deduped. Never throws. */
export function resolveUri(trackId: string): Promise<string | null> {
  const hit = cache.get(trackId)
  if (hit !== undefined)
    return Promise.resolve(hit)
  const running = inflight.get(trackId)
  if (running)
    return running
  const p = fetchUri(trackId).then((uri) => {
    cache.set(trackId, uri)
    inflight.delete(trackId)
    return uri
  })
  inflight.set(trackId, p)
  return p
}

/**
 * Resolve a tail, preserving order and DROPPING unresolvable rows.
 *
 * Dropping rather than failing is the deliberate choice: a queue row whose track
 * has no Spotify id is a catalog gap, and refusing to play the other 39 tracks
 * because of it would be the worse failure. The caller can compare lengths when it
 * needs to know something was skipped.
 *
 * Cached ids never hit the network, so the common case (panel open → prefetched →
 * tap row 3) issues no requests at all.
 */
export async function resolveTail(trackIds: string[]): Promise<string[]> {
  const resolved = await Promise.all(trackIds.map(id => resolveUri(id)))
  return resolved.filter((u): u is string => !!u)
}

/**
 * Warm the cache for a queue, at low concurrency, ignoring failures.
 *
 * Called when the panel shows a queue — by the time a row is tapped the tail is
 * usually already known, which is what keeps `resolveTail` off the network. Returns
 * when the walk finishes; callers fire-and-forget.
 */
export async function prefetchUris(trackIds: string[]): Promise<void> {
  const todo = trackIds.filter(id => cache.get(id) === undefined && !inflight.has(id))
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < todo.length) {
      const id = todo[cursor++]
      await resolveUri(id)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(PREFETCH_CONCURRENCY, todo.length) }, () => worker()),
  )
}
