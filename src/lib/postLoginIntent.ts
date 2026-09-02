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
    intent: normalize(input),
  }
  try {
    localStorage.setItem(POST_LOGIN_INTENT_KEY, JSON.stringify(stored))
  }
  catch { /* quota / disabled storage — the handoff just won't resume */ }
}

/** Read a key and remove it, whatever it holds. Never throws. */
function takeRaw(key: string): string | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(key)
  }
  catch {
    return null
  }
  // Remove BEFORE parsing so a corrupt blob cannot wedge the slot forever.
  try {
    localStorage.removeItem(key)
  }
  catch { /* ignore */ }
  return raw
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
    return { ts: v.ts, capturedIdentity: str(v.capturedIdentity) ?? ANONYMOUS_IDENTITY, intent }
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
    return intent ? { ts: v.ts, capturedIdentity: ANONYMOUS_IDENTITY, intent } : null
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

/**
 * Single-drain read: fetch + REMOVE atomically, so a double mount (React
 * StrictMode), a reload, or a second visit never replays the action twice.
 * Returns null when absent, malformed, past its TTL, or captured under a
 * different account.
 *
 * Both keys are cleared on every call — a legacy blob that fails a gate must not
 * survive to ambush a later visit.
 */
export function drainPostLoginIntent(): PostLoginIntent | null {
  if (typeof localStorage === 'undefined')
    return null
  const raw = takeRaw(POST_LOGIN_INTENT_KEY)
  const legacyRaw = takeRaw(LEGACY_POCKET_INTENT_KEY)
  const stored = raw ? parseStored(raw) : legacyRaw ? parseLegacy(legacyRaw) : null
  if (!stored)
    return null
  if (Date.now() - stored.ts > TTL_MS)
    return null
  if (!identityMayResume(stored.capturedIdentity))
    return null
  return stored.intent
}
