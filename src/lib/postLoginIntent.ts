// FIX-auth-identity-lifecycle Step 2 — the one place an action a visitor started
// while logged out is parked until they come back signed in.
//
// WHY this is not the Pocket blob it replaces. `pb:resume` was written by
// `AddToBucketMenu` and read by ONE component (`PocketResume`) mounted on the
// home page, because the Cognito callback used to force `location.replace('/')`.
// That stopped being true: `callback.client.ts` returns to `consumeReturnTo()`,
// the page the visitor was actually on. So an anonymous 담기 on `/review/[slug]`
// wrote an intent nobody read — it either expired thirty minutes later, or
// ambushed the visitor with a bucket picker the next time they happened to open
// home. Both comments in the old module still described the
// `location.replace('/')` world, which is why several audits walked past it.
//
// The shape follows from that. One store, a TAGGED union over `kind` so a second
// resumable action needs no second private key, and exactly one consumer
// (`components/auth/PostLoginResume`, mounted in `layout.astro`) so the resume
// happens wherever the callback lands rather than only on one route.
//
// THREE gates, and an intent that fails any of them is dropped, never replayed:
//   - the TTL — an intent the visitor walked away from is not a promise;
//   - the account boundary — see `capturedIdentity` below;
//   - the tag — an unknown `kind` (an older or newer bundle, a hand-edited blob)
//     is dropped rather than guessed at.
//
// And a fourth thing, which is ownership rather than a gate: a record names the
// TAB that parked it, and only that tab drains it. See `tabId` on StoredIntent —
// Step 3's production clickthrough is what put it here.
//
// Browser-only module (`localStorage` + `Date.now()`); every entry point is
// SSR-guarded and every storage access is wrapped, so a disabled-storage browser
// degrades to "the handoff just doesn't resume" instead of throwing.
import { ANONYMOUS_IDENTITY, getAuthIdentity, LOCAL_DEV_IDENTITY } from '@lib/authIdentity'

export const POST_LOGIN_INTENT_KEY = 'pb:post-login-intent'

/**
 * The Pocket-only predecessor. Read once and removed on every drain so an intent
 * parked by the previous bundle still resumes across the deploy that replaces it
 * (a 30-minute window) and cannot linger in storage afterwards.
 */
export const LEGACY_POCKET_INTENT_KEY = 'pb:resume'

/**
 * Per-tab id, in sessionStorage so it is scoped to one tab and survives the
 * Cognito round trip — the same property `pkce_verifier` and the return path
 * already rely on, since leaving for the hosted UI and coming back is a
 * navigation within this tab, not a new one.
 */
const INTENT_TAB_KEY = 'pb:intent-tab'

/**
 * This tab's id. `create` is false for reads so a page that never parked
 * anything does not write to storage just by loading.
 * Returns null when sessionStorage is unavailable — the ownership check then
 * degrades to "anyone may resume", which is where this started.
 */
function thisTabId(create = false): string | null {
	if (typeof sessionStorage === 'undefined')
		return null
	try {
		const existing = sessionStorage.getItem(INTENT_TAB_KEY)
		if (existing || !create)
			return existing
		const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
		sessionStorage.setItem(INTENT_TAB_KEY, id)
		return id
	}
	catch {
		return null
	}
}

/** A parked intent is silently dropped after this. */
const TTL_MS = 30 * 60 * 1000 // 30 min

/** What to add to a bucket — a thin descriptor, never a content copy. */
export interface BucketAddIntent {
  kind: 'bucket-add'
  itemType: 'album' | 'track' | 'review'
  /** DB album id (album adds); null otherwise. */
  albumId: string | null
  /** DB track id (track adds); null otherwise. */
  trackId: string | null
  /** DB post id (review adds — `review_target_id`); null otherwise. */
  reviewTargetId: string | null
  /** Display title, for the picker header. */
  title: string
}

// There is deliberately no target bucket here. An anonymous visitor has no
// buckets loaded, so the resume always re-opens the picker and asks — it never
// guesses a destination or creates a default one. The predecessor carried a
// `bucketId` for this, but nothing ever read it (not the resume component, not
// the picker, whose `AddTarget` has no such field), so it read as a supported
// option that silently did nothing. Adding one means teaching the picker to
// accept a preselected destination, not reviving the field.

/**
 * Reopen the rating editor for an album. Display fields are optional header
 * seeding for the app-wide album overlay, which fetches the album anyway — they
 * exist so the resumed overlay paints immediately instead of flashing blank.
 */
export interface RateAlbumIntent {
  kind: 'rate-album'
  albumId: string
  title: string
  artist: string | null
  cover: string | null
  year: number | null
}

export type PostLoginIntent = BucketAddIntent | RateAlbumIntent

/** The caller-supplied intent — exactly one target id per kind. */
export type PostLoginIntentInput =
	| { kind: 'bucket-add', itemType: 'album', albumId: string, title: string } |
	{ kind: 'bucket-add', itemType: 'track', trackId: string, title: string } |
	{ kind: 'bucket-add', itemType: 'review', reviewTargetId: string, title: string } |
	{ kind: 'rate-album', albumId: string, title: string, artist?: string | null, cover?: string | null, year?: number | null }

interface StoredIntent {
  /** epoch ms at capture — the TTL gate. */
  ts: number
  /**
   * `getAuthIdentity()` at capture. The usual value is the anonymous sentinel —
   * that is the whole point of this store — and any sign-in may resume that.
   *
   * It is recorded because it is NOT always anonymous. `isLoggedIn()` goes false
   * the moment the access token expires while account A's `id_token` is still in
   * storage, so an intent can be captured under A's real identity; resuming it
   * after B signs in would file A's album into B's bucket. A capture that names
   * a real account therefore resumes only for that account.
   */
  capturedIdentity: string
  /**
   * The tab that parked this, or null for a capture that could not name one
   * (a legacy blob, or sessionStorage unavailable) — those stay resumable by
   * any tab, which is the old behaviour, kept as the degraded path.
   *
   * WHY. The consumer is mounted in `layout.astro`, so it runs in EVERY open
   * tab, and each one re-attempts the drain when the account changes. The
   * intent lives in localStorage, which every tab shares. Signing in therefore
   * raced: the tab that had been sitting open, already hydrated and listening
   * for `storage`, drained it a beat before the tab returning from Cognito had
   * even parsed its new document. Production, 2026-09-02: with no other tab
   * open the picker came back on the page the visitor left; with one other tab
   * open on `/canon/` the picker opened THERE and the tab they were actually
   * looking at showed nothing. Naming the owner is what makes the resume land
   * where the action was started.
   */
  tabId: string | null
  intent: PostLoginIntent
}

function normalize(input: PostLoginIntentInput): PostLoginIntent {
  if (input.kind === 'rate-album') {
    return {
      kind: 'rate-album',
      albumId: input.albumId,
      title: input.title,
      artist: input.artist ?? null,
      cover: input.cover ?? null,
      year: input.year ?? null,
    }
  }
  return {
    kind: 'bucket-add',
    itemType: input.itemType,
    albumId: input.itemType === 'album' ? input.albumId : null,
    trackId: input.itemType === 'track' ? input.trackId : null,
    reviewTargetId: input.itemType === 'review' ? input.reviewTargetId : null,
    title: input.title,
  }
}

/** Park a pending action. Overwrites any previous intent (last write wins). */
export function writePostLoginIntent(input: PostLoginIntentInput): void {
  if (typeof localStorage === 'undefined')
    return
  const stored: StoredIntent = {
    ts: Date.now(),
    capturedIdentity: getAuthIdentity(),
    tabId: thisTabId(true),
    intent: normalize(input),
  }
  try {
    localStorage.setItem(POST_LOGIN_INTENT_KEY, JSON.stringify(stored))
  }
  catch { /* quota / disabled storage — the handoff just won't resume */ }
}

/** Read a key without touching it. Never throws. */
function peekRaw(key: string): string | null {
  try {
    return localStorage.getItem(key)
  }
  catch {
    return null
  }
}

/** Remove a key. Never throws. */
function dropRaw(key: string): void {
  try {
    localStorage.removeItem(key)
  }
  catch { /* ignore */ }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

function parseIntent(v: Record<string, unknown>): PostLoginIntent | null {
  if (v.kind === 'rate-album') {
    const albumId = str(v.albumId)
    if (!albumId)
      return null
    return {
      kind: 'rate-album',
      albumId,
      title: str(v.title) ?? '앨범',
      artist: str(v.artist),
      cover: str(v.cover),
      year: typeof v.year === 'number' ? v.year : null,
    }
  }
  if (v.kind !== 'bucket-add')
    return null // unknown tag — dropped, not guessed at
  const title = str(v.title)
  if (v.itemType === 'track') {
    const trackId = str(v.trackId)
    return trackId ? { kind: 'bucket-add', itemType: 'track', albumId: null, trackId, reviewTargetId: null, title: title ?? '트랙' } : null
  }
  if (v.itemType === 'review') {
    const reviewTargetId = str(v.reviewTargetId)
    return reviewTargetId ? { kind: 'bucket-add', itemType: 'review', albumId: null, trackId: null, reviewTargetId, title: title ?? '평론' } : null
  }
  if (v.itemType === 'album') {
    const albumId = str(v.albumId)
    return albumId ? { kind: 'bucket-add', itemType: 'album', albumId, trackId: null, reviewTargetId: null, title: title ?? '앨범' } : null
  }
  return null
}

function parseStored(raw: string): StoredIntent | null {
  try {
    const v = JSON.parse(raw) as Record<string, unknown>
    if (!v || typeof v.ts !== 'number' || typeof v.intent !== 'object' || v.intent === null)
      return null
    const intent = parseIntent(v.intent as Record<string, unknown>)
    if (!intent)
      return null
    return { ts: v.ts, capturedIdentity: str(v.capturedIdentity) ?? ANONYMOUS_IDENTITY, tabId: str(v.tabId), intent }
  }
  catch {
    return null
  }
}

/**
 * The predecessor's flat shape: `{ ts, itemType, albumId, trackId,
 * reviewTargetId, title }`, with no `kind` and no captured identity (and a
 * `bucketId` nothing read, which is simply ignored).
 * It was only ever written from the logged-out branch of `AddToBucketMenu`, so
 * anonymous is the honest identity to give it. A blob older than Step 6 of
 * FEAT-pocket-buckit carries no `itemType` at all and was an album add.
 */
function parseLegacy(raw: string): StoredIntent | null {
  try {
    const v = JSON.parse(raw) as Record<string, unknown>
    if (!v || typeof v.ts !== 'number')
      return null
    const itemType = v.itemType === 'track' || v.itemType === 'review' ? v.itemType : 'album'
    const intent = parseIntent({ ...v, kind: 'bucket-add', itemType })
    return intent ? { ts: v.ts, capturedIdentity: ANONYMOUS_IDENTITY, tabId: null, intent } : null
  }
  catch {
    return null
  }
}

/**
 * May work parked under `captured` commit for whoever is signed in now?
 *
 * A logged-out capture is the normal handoff and any sign-in may complete it.
 * A capture that names a real account is that account's alone.
 */
function identityMayResume(captured: string): boolean {
  if (captured === ANONYMOUS_IDENTITY || captured === LOCAL_DEV_IDENTITY)
    return true
  return captured === getAuthIdentity()
}

/** Is this record ours to drain? An unowned one is anyone's — see `tabId`. */
function ownedByThisTab(tabId: string | null): boolean {
  return tabId === null || tabId === thisTabId()
}

/**
 * Single-drain read: fetch + REMOVE, so a double mount (React StrictMode), a
 * reload, or a second visit never replays the action twice. Returns null when
 * absent, malformed, past its TTL, captured under a different account, or
 * parked by a different tab.
 *
 * Removal is conditional, which is the one thing to be careful about here.
 * Every outcome clears what it read EXCEPT a live record belonging to another
 * tab: clearing that is precisely the bug this guards, since the non-owner
 * would consume the intent and the owner would find an empty slot. A corrupt
 * blob is still removed before it is parsed, so it cannot wedge the slot; an
 * expired one is removed by whoever notices, owner or not, so a tab that never
 * comes back cannot leave a record behind past its TTL.
 */
export function drainPostLoginIntent(): PostLoginIntent | null {
  if (typeof localStorage === 'undefined')
    return null
  const raw = peekRaw(POST_LOGIN_INTENT_KEY)
  const legacyRaw = peekRaw(LEGACY_POCKET_INTENT_KEY)
  const stored = raw ? parseStored(raw) : legacyRaw ? parseLegacy(legacyRaw) : null

  // Leave a live record that belongs to another tab exactly where it is.
  if (stored && Date.now() - stored.ts <= TTL_MS && !ownedByThisTab(stored.tabId))
    return null

  dropRaw(POST_LOGIN_INTENT_KEY)
  dropRaw(LEGACY_POCKET_INTENT_KEY)
  if (!stored)
    return null
  if (Date.now() - stored.ts > TTL_MS)
    return null
  if (!identityMayResume(stored.capturedIdentity))
    return null
  return stored.intent
}
