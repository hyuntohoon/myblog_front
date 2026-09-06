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
//   · every DURABLY resolved URI is memoised for the tab's lifetime — for
//     SPOTIFY. `tracks.spotify_id` is NOT NULL + UNIQUE, so a hit can never go
//     stale. **THAT REASONING DOES NOT CARRY TO YOUTUBE** and the cache is
//     provider-keyed and TTL'd for it — see the YOUTUBE block below;
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
// ── YOUTUBE (FEAT-youtube-playback-provider Step A4) ─────────────────────────
//
// THE MEMO IS UNSOUND FOR YOUTUBE IN BOTH DIRECTIONS, and the positive one is
// the easier to miss.
//
// The header above justifies durable memoisation with "ids are immutable, so a
// hit can never go stale". True of `tracks.spotify_id`. False of a YouTube
// mapping, which is a row a human wrote and three separate mechanisms can
// change underneath us:
//
//   · the Step-A5 refresh job flips `verify_state` when a video dies;
//   · III.E.4 retention DELETES the row at 30 days;
//   · a member re-points it through A3's confirm UI.
//
// So a cached `youtube:video:…` can outlive its row just as a cached miss can.
// Two consequences, both implemented below:
//
//   1. THE CACHE IS KEYED BY (provider, trackId). A single-provider key would
//      let a Spotify hit answer a YouTube question and vice versa.
//   2. YOUTUBE ENTRIES CARRY A TTL well under the 30-day retention window, so a
//      tab left open overnight cannot serve a mapping the sweep has deleted.
//      Spotify entries keep the unbounded lifetime the header argues for —
//      their premise is still true.
//
// And the THIRD state finally exists. With OQ8 answered, `resolve` distinguishes
// three answers where it used to give two:
//
//   200  plays.
//   410  MAPPED BUT UNPLAYABLE — dead, expired, or no longer embeddable. Drives
//        the "wrong video, pick another" affordance. **NEVER memoised durably**:
//        the A5 job or a re-pick can clear it at any moment, and a durable miss
//        would make a fixed mapping look permanently broken for the rest of the
//        tab.
//   404  NEVER MAPPED. Keeps today's durable-miss behaviour.
//
// The A3 mutations must invalidate the entry outright — `invalidateUri` below —
// because a re-pick is precisely the case where the old value is wrong and the
// TTL has not expired.
import { getAuthHeader } from '@lib/auth'

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string | undefined
const RESOLVE_PATH = '/api/playback/resolve'

/** Concurrency for the idle prefetch. Low on purpose: it must never crowd out a play tap. */
const PREFETCH_CONCURRENCY = 4

/** The providers this module can resolve. `spotify` is the default everywhere. */
export type UriProvider = 'spotify' | 'youtube'

/**
 * How long a YOUTUBE entry may be trusted.
 *
 * Well under the 30-day III.E.4 retention window that the Step-A5 job enforces —
 * a tab left open overnight must not serve a mapping the sweep has since
 * deleted. 30 minutes is short enough that a stale entry is a nuisance rather
 * than a broken feature, and long enough that scrolling a queue does not
 * re-resolve on every pass.
 *
 * SPOTIFY ENTRIES ARE NOT AGED. Their premise — `tracks.spotify_id` is NOT NULL
 * and UNIQUE — is still true, and putting an expiry on them would add requests
 * for nothing.
 */
const YOUTUBE_TTL_MS = 30 * 60 * 1000

interface CacheEntry {
	/** The URI, or `null` for a durably remembered miss. */
	value: string | null
	/** `undefined` = never expires (Spotify). Otherwise an epoch-ms deadline. */
	expiresAt?: number
}

/**
 * `${provider}:${trackId}` → entry. PROVIDER-KEYED: a single-provider key would
 * let a Spotify hit answer a YouTube question, which is exactly the bug this
 * module's original comment ruled out on a premise that no longer holds.
 *
 * `value: null` is a DURABLY remembered miss — a 404 ("never mapped"), or a 200
 * whose body carries no uri. A transient failure never lands here, and neither
 * does a 410: a mapped-but-dead row can be fixed by the A5 job or a re-pick at
 * any moment, so remembering it would outlive its cause.
 */
const cache = new Map<string, CacheEntry>()
/** cache key → in-flight promise, so a prefetch and a play tap share one request. */
const inflight = new Map<string, Promise<UriResolution>>()

function cacheKey(provider: UriProvider, trackId: string): string {
  return `${provider}:${trackId}`
}

/** Read through the TTL. An expired entry is evicted and reads as a miss. */
function readCache(provider: UriProvider, trackId: string): CacheEntry | undefined {
  const key = cacheKey(provider, trackId)
  const hit = cache.get(key)
  if (hit === undefined)
    return undefined
  if (hit.expiresAt !== undefined && Date.now() >= hit.expiresAt) {
    cache.delete(key)
    return undefined
  }
  return hit
}

/**
 * Forget what we know about one (provider, track).
 *
 * Called by A3's confirm and unmap actions. A re-pick is PRECISELY the case the
 * TTL cannot cover: the old value is wrong the instant the write lands, and
 * waiting up to `YOUTUBE_TTL_MS` to notice would make the fix look like it did
 * not take.
 */
export function invalidateUri(trackId: string, provider: UriProvider = 'youtube'): void {
  cache.delete(cacheKey(provider, trackId))
  inflight.delete(cacheKey(provider, trackId))
}

/**
 * What one resolve attempt actually learned.
 *
 * The distinction `unmapped` vs `transient` is the whole point: only the first is
 * a fact about the track, and only the first may be cached.
 */
export type UriResolution =
	| { kind: 'uri', uri: string } |
	/**
	 * NEVER MAPPED — a 404. The catalog has no id for this track on this
	 * provider. Durable: safe to remember for the tab.
	 */
	{ kind: 'unmapped' } |
	/**
	 * MAPPED BUT UNPLAYABLE — a 410 (OQ8). The row exists and is dead, expired
	 * past retention, or no longer embeddable.
	 *
	 * Distinct from `unmapped` because the UI answers differ — this one offers
	 * "pick another video", that one offers "map one" — and because THIS IS NOT
	 * MEMOISED. The A5 refresh job or a member re-pick can clear it at any
	 * moment; a durable miss would make a fixed mapping look permanently broken
	 * for the rest of the tab.
	 */
	{ kind: 'gone' } |
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
export function cachedUri(trackId: string, provider: UriProvider = 'spotify'): string | null | undefined {
  return readCache(provider, trackId)?.value
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

async function fetchUri(trackId: string, provider: UriProvider): Promise<UriResolution> {
  if (!BASE)
    return { kind: 'transient' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS)
  try {
    // `provider` is omitted for spotify, not sent as `provider=spotify`. The
    // parameter is additive and defaults server-side, and the no-parameter call
    // is the shape every shipped caller uses — keeping it byte-identical is what
    // makes this change unable to affect the incumbent.
    const q = provider === 'spotify' ? '' : `&provider=${encodeURIComponent(provider)}`
    const url = `${BASE}${RESOLVE_PATH}?type=track&id=${encodeURIComponent(trackId)}${q}`
    const res = await fetch(url, { headers: { ...getAuthHeader() }, signal: controller.signal })
    if (!res.ok) {
      // 404 = never mapped, a durable fact about the track.
      // 410 = mapped but unplayable (OQ8). Also a fact, but a REVOCABLE one —
      //       the A5 job or a re-pick can clear it — so it is reported and not
      //       remembered.
      // Everything else — 5xx, a gateway error, a 401 mid-refresh — is about this
      // moment, and remembering it would outlive the cause.
      if (res.status === 404)
        return { kind: 'unmapped' }
      if (res.status === 410)
        return { kind: 'gone' }
      return { kind: 'transient' }
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
export function resolveUriDetailed(
  trackId: string,
  provider: UriProvider = 'spotify',
): Promise<UriResolution> {
  const key = cacheKey(provider, trackId)
  const hit = readCache(provider, trackId)
  if (hit !== undefined)
    return Promise.resolve(hit.value === null ? { kind: 'unmapped' } : { kind: 'uri', uri: hit.value })
  const running = inflight.get(key)
  if (running)
    return running
  const p = fetchUri(trackId, provider).then((result) => {
    // A YouTube entry expires; a Spotify one does not. See YOUTUBE_TTL_MS.
    const expiresAt = provider === 'youtube' ? Date.now() + YOUTUBE_TTL_MS : undefined
    if (result.kind === 'uri')
      cache.set(key, { value: result.uri, expiresAt })
    else if (result.kind === 'unmapped')
      cache.set(key, { value: null, expiresAt })
    // 'transient' and 'gone' are deliberately NOT cached — see the header. A
    // 'gone' row is revocable by the A5 job or a re-pick, so remembering it
    // would make a fixed mapping look permanently broken for the tab.
    inflight.delete(key)
    return result
  })
  inflight.set(key, p)
  return p
}

/**
 * Resolve one id to a URI or null.
 *
 * Kept for the callers that genuinely cannot act on the distinction (the idle
 * prefetch, a single-row lookup). A null here still means "not playable right
 * now"; it just no longer means "and never ask again".
 */
export async function resolveUri(
  trackId: string,
  provider: UriProvider = 'spotify',
): Promise<string | null> {
  const r = await resolveUriDetailed(trackId, provider)
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
export async function resolveTail(
  rows: readonly TailRow[],
  provider: UriProvider = 'spotify',
): Promise<ResolvedTail> {
  const results = await Promise.all(rows.map(row => resolveUriDetailed(row.trackId, provider)))
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
export async function prefetchUris(
  trackIds: string[],
  provider: UriProvider = 'spotify',
): Promise<void> {
  const todo = trackIds.filter(
    id => readCache(provider, id) === undefined && !inflight.has(cacheKey(provider, id)),
  )
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < todo.length) {
      const id = todo[cursor++]
      await resolveUri(id, provider)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(PREFETCH_CONCURRENCY, todo.length) }, () => worker()),
  )
}
