// FEAT-pocket-buckit Step 5 — the public-page sign-in handoff (technical-validation
// OQ11). An anonymous "add to bucket" can't write: every bucket mutation needs a
// Cognito JWT (POST /api/buckets/{id}/items is a JWT route, not edge_guard). So
// instead of failing the drop, we stash a THIN pending-intent — a descriptor, NOT
// a content copy — trigger the existing Cognito PKCE login, and, because the
// callback forces `location.replace('/')`, a single-drain resume-checker on home
// completes the add after auth. The server reads the owner from the verified JWT
// `sub`, never from this blob. Mirrors the design.ts persistence pattern (SSR
// guard + corrupt → silent drop). Browser-only module (uses Date.now()).
//
// FEAT-pocket-buckit Step 6 — generalized to carry a TRACK as well as an album
// (the Step-6 relax made `item_type='track'` writable). The intent is a tagged
// union over `itemType`: an album intent carries `albumId`, a track intent carries
// `trackId`; the unused id is null. The resume re-opens the SAME AddToBucketMenu
// for whichever kind was stashed.

export const POCKET_INTENT_KEY = 'pb:resume'

/** A stale intent (left behind, never resumed) is silently dropped after this. */
const TTL_MS = 30 * 60 * 1000 // 30 min

export interface PocketIntent {
  /** epoch ms at capture — the TTL gate. */
  ts: number
  /** Which membership kind to add after sign-in. */
  itemType: 'album' | 'track'
  /** DB album id (album intents); null for track intents. */
  albumId: string | null
  /** DB track id (track intents); null for album intents. */
  trackId: string | null
  /** display title, for the resume confirmation surface. */
  title: string
  /**
   * Target bucket id, or null = "ask". An anonymous user has no buckets loaded,
   * so the resume re-opens the picker rather than guessing a destination (no
   * silent default-bucket create in v1).
   */
  bucketId: string | null
}

/** The caller-supplied intent (a tagged union — exactly one target id per kind). */
export type PocketIntentInput =
	| { itemType: 'album', albumId: string, title: string, bucketId: string | null } |
	{ itemType: 'track', trackId: string, title: string, bucketId: string | null }

/** Stash a pending add. Overwrites any previous intent (last write wins). */
export function writePocketIntent(input: PocketIntentInput): void {
  if (typeof localStorage === 'undefined')
    return
  const intent: PocketIntent = {
    ts: Date.now(),
    itemType: input.itemType,
    albumId: input.itemType === 'album' ? input.albumId : null,
    trackId: input.itemType === 'track' ? input.trackId : null,
    title: input.title,
    bucketId: input.bucketId,
  }
  try {
    localStorage.setItem(POCKET_INTENT_KEY, JSON.stringify(intent))
  }
  catch { /* quota / disabled storage — the handoff just won't resume */ }
}

/**
 * Single-drain read: fetch + REMOVE atomically, so a double mount (React
 * StrictMode), a reload, or a second home visit never replays the add twice.
 * Returns null when absent, malformed, the wrong kind, or past its TTL.
 */
export function drainPocketIntent(): PocketIntent | null {
  if (typeof localStorage === 'undefined')
    return null
  let raw: string | null = null
  try {
    raw = localStorage.getItem(POCKET_INTENT_KEY)
  }
  catch {
    return null
  }
  if (!raw)
    return null
  // Remove BEFORE parsing so a corrupt blob can't wedge the slot forever.
  try {
    localStorage.removeItem(POCKET_INTENT_KEY)
  }
  catch { /* ignore */ }
  try {
    const v = JSON.parse(raw) as Partial<PocketIntent>
    if (!v || typeof v.ts !== 'number' || Date.now() - v.ts > TTL_MS)
      return null
    const title = typeof v.title === 'string' ? v.title : '항목'
    const bucketId = typeof v.bucketId === 'string' ? v.bucketId : null
    if (v.itemType === 'track' && typeof v.trackId === 'string') {
      return { ts: v.ts, itemType: 'track', albumId: null, trackId: v.trackId, title: title || '트랙', bucketId }
    }
    // Default/album path (covers legacy blobs written before Step 6 with no itemType).
    if (typeof v.albumId === 'string') {
      return { ts: v.ts, itemType: 'album', albumId: v.albumId, trackId: null, title: title || '앨범', bucketId }
    }
    return null
  }
  catch {
    return null
  }
}
