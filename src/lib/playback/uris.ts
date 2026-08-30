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
//   · every DURABLY resolved URI is memoised for the tab's lifetime (ids are
//     immutable — `tracks.spotify_id` is NOT NULL + UNIQUE, so a hit can never go
//     stale);
//   · in-flight requests are deduped, so a prefetch racing a play tap costs one;
//   · the panel prefetches its visible queue at low concurrency while idle, so the
//     steady state at play time is ZERO requests;
//   · play time resolves only the misses, and a miss that fails is reported to the
//     caller rather than failing the whole play.
//
// THE REAL FIX IS ONE FIELD, and it is deliberately not taken here because it is
// cross-repo and this step is front-only: surface `tracks.spotify_id` on playback
// bucket items in the tree payload. Then `queueUris` is `map(r => 'spotify:track:'+id)`,
// this module deletes, and the request count is zero even cold. Recorded in the RFC
// as the follow-up rather than left as a comment nobody reads.
//
// ARCH-playback-authority-convergence Step 1 changed two things here.
//
// (1) NEGATIVE CACHING IS NOW DURABLE-ONLY. Every failure used to become a
// remembered `null` for the tab's lifetime — including a dropped connection and a
// 500. One transient blip therefore made a perfectly good track permanently
// unplayable until the member reloaded the page, and nothing in the UI could say
// why. A miss is only remembered when the answer is *about the track*: a 404, or a
// 200 whose body carries no uri. Network failures, timeouts and 5xx are not
// remembered at all — the in-flight dedupe below is what stops a retry storm, not
// the cache.
//
// (2) RESOLUTION IS IDENTITY-ALIGNED. `resolveTail` used to hand back a bare,
// `.filter()`ed `string[]`, which silently destroyed the correspondence between the
// rows asked about and the URIs returned: ask for [A,B,C] with A unresolvable and
// Spotify is told to play [B,C] while the caller still believes A is playing. It
// now returns the rows that resolved, each still carrying its `itemId`, so the
// caller can name what actually started.
import { getAuthHeader } from '@lib/auth'

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string | undefined
const RESOLVE_PATH = '/api/playback/resolve'

/** Concurrency for the idle prefetch. Low on purpose: it must never crowd out a play tap. */
const PREFETCH_CONCURRENCY = 4

/**
 * trackId → URI. `null` is a DURABLY remembered miss (404, or a 200 with no uri —
 * the track has no Spotify id), so a dead row is asked about once per tab rather
 * than on every play. A transient failure never lands here.
 */
const cache = new Map<string, string | null>()
/** trackId → in-flight promise, so a prefetch and a play tap share one request. */
const inflight = new Map<string, Promise<UriResolution>>()

/**
 * What one resolve attempt actually learned.
 *
 * The distinction `unmapped` vs `transient` is the whole point: only the first is
 * a fact about the track, and only the first may be cached.
 */
export type UriResolution =
	| { kind: 'uri', uri: string } |
	/** The catalog has no Spotify id for this track. Durable — safe to remember. */
	{ kind: 'unmapped' } |
	/** Network, timeout, 5xx, or no API base. Says nothing about the track. */
	{ kind: 'transient' }

/** One row of a tail, before and after resolution. */
export interface TailRow { itemId: string, trackId: string }
export interface ResolvedTailRow extends TailRow { uri: string }

/**
 * A tail's resolution, with identity preserved.
 *
 * `resolved` is in the requested order, minus what could not be resolved;
 * `failed` carries those, so a caller can both play what it can AND say what it
 * could not. Callers MUST take their notion of "what is now playing" from
 * `resolved[0]`, never from the row they asked to start at.
 */
export interface ResolvedTail { resolved: ResolvedTailRow[], failed: TailRow[] }

/** Test seam — the store is module-level, so a test that resolves must be able to reset it. */
export function __resetUriCache(): void {
  cache.clear()
  inflight.clear()
}

/** What is already known, without touching the network. Used by the play path's fast case. */
export function cachedUri(trackId: string): string | null | undefined {
  return cache.get(trackId)
}

/**
 * Matches `apiFetch`'s ceiling, and `queue.api.ts` in this same tree.
 *
 * CLAUDE.md requires an explicit timeout on every outbound request and this one
 * never had it. It mattered less while this only warmed a cache in the
 * background; ARCH-playback-authority-convergence Step 3 puts it on a USER
 * GESTURE (`openPlaybackLyrics` awaits it on a cache miss), so a hung request
 * became 가사 doing nothing, forever, with no spinner and no sentence.
 */
const RESOLVE_TIMEOUT_MS = 8000

async function fetchUri(trackId: string): Promise<UriResolution> {
  if (!BASE)
    return { kind: 'transient' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS)
  try {
    const url = `${BASE}${RESOLVE_PATH}?type=track&id=${encodeURIComponent(trackId)}`
    const res = await fetch(url, { headers: { ...getAuthHeader() }, signal: controller.signal })
    if (!res.ok) {
      // 404 is the endpoint's answer for "no such mapping" and is a fact about the
      // track. Everything else — 5xx, a gateway error, a 401 mid-refresh — is about
      // this moment, and remembering it would outlive the cause.
      return res.status === 404 ? { kind: 'unmapped' } : { kind: 'transient' }
    }
    const body = (await res.json()) as { uri?: string | null }
    const uri = body?.uri
    return uri ? { kind: 'uri', uri } : { kind: 'unmapped' }
  }
  catch {
    // Network/parse failure — and our own abort — say nothing about the track,
    // so none of them is a miss and none is memoised.
    return { kind: 'transient' }
  }
  finally {
    clearTimeout(timer)
  }
}

/** Resolve one id, memoising only durable answers and deduping in flight. Never throws. */
export function resolveUriDetailed(trackId: string): Promise<UriResolution> {
  const hit = cache.get(trackId)
  if (hit !== undefined)
    return Promise.resolve(hit === null ? { kind: 'unmapped' } : { kind: 'uri', uri: hit })
  const running = inflight.get(trackId)
  if (running)
    return running
  const p = fetchUri(trackId).then((result) => {
    if (result.kind === 'uri')
      cache.set(trackId, result.uri)
    else if (result.kind === 'unmapped')
      cache.set(trackId, null)
    // 'transient' is deliberately NOT cached — see the header.
    inflight.delete(trackId)
    return result
  })
  inflight.set(trackId, p)
  return p
}

/**
 * Resolve one id to a URI or null.
 *
 * Kept for the callers that genuinely cannot act on the distinction (the idle
 * prefetch, a single-row lookup). A null here still means "not playable right
 * now"; it just no longer means "and never ask again".
 */
export async function resolveUri(trackId: string): Promise<string | null> {
  const r = await resolveUriDetailed(trackId)
  return r.kind === 'uri' ? r.uri : null
}

/**
 * Resolve a tail, preserving order AND row identity.
 *
 * Partial resolution is the deliberate choice: a queue row whose track has no
 * Spotify id is a catalog gap, and refusing to play the other 39 tracks because of
 * it would be the worse failure. What changed in Step 1 is that the dropped rows
 * are now *reported* instead of vanishing, because the caller's own "current item"
 * is derived from what actually starts.
 *
 * Cached ids never hit the network, so the common case (panel open → prefetched →
 * tap row 3) issues no requests at all.
 */
export async function resolveTail(rows: readonly TailRow[]): Promise<ResolvedTail> {
  const results = await Promise.all(rows.map(row => resolveUriDetailed(row.trackId)))
  const resolved: ResolvedTailRow[] = []
  const failed: TailRow[] = []
  rows.forEach((row, i) => {
    const r = results[i]
    if (r.kind === 'uri')
      resolved.push({ ...row, uri: r.uri })
    else failed.push(row)
  })
  return { resolved, failed }
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
