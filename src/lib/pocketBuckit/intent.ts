// FEAT-pocket-buckit Step 5 — the public-page sign-in handoff (technical-validation
// OQ11). An anonymous "add to bucket" can't write: every bucket mutation needs a
// Cognito JWT (POST /api/buckets/{id}/items is a JWT route, not edge_guard). So
// instead of failing the drop, we stash a THIN pending-intent — a descriptor, NOT
// a content copy — trigger the existing Cognito PKCE login, and, because the
// callback forces `location.replace('/')`, a single-drain resume-checker on home
// completes the add after auth. The server reads the owner from the verified JWT
// `sub`, never from this blob. Mirrors the design.ts persistence pattern (SSR
// guard + corrupt → silent drop). Browser-only module (uses Date.now()).

export const POCKET_INTENT_KEY = 'pb:resume'

/** A stale intent (left behind, never resumed) is silently dropped after this. */
const TTL_MS = 30 * 60 * 1000 // 30 min

export interface PocketIntent {
  /** epoch ms at capture — the TTL gate. */
  ts: number
  /**
   * What to add. v1 is album-only: creation stays album-only until the Step-6
   * relax (the backend rejects non-album INSERTs with 422), so the handoff only
   * ever carries an album.
   */
  itemType: 'album'
  /** DB album id to add after sign-in. */
  albumId: string
  /** display title, for the resume confirmation surface. */
  title: string
  /**
   * Target bucket id, or null = "ask". An anonymous user has no buckets loaded,
   * so the resume re-opens the picker rather than guessing a destination (no
   * silent default-bucket create in v1).
   */
  bucketId: string | null
}

/** Stash a pending add. Overwrites any previous intent (last write wins). */
export function writePocketIntent(intent: Omit<PocketIntent, 'ts'>): void {
  if (typeof localStorage === 'undefined')
    return
  try {
    localStorage.setItem(POCKET_INTENT_KEY, JSON.stringify({ ...intent, ts: Date.now() }))
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
    if (!v || v.itemType !== 'album' || typeof v.albumId !== 'string' || typeof v.ts !== 'number')
      return null
    if (Date.now() - v.ts > TTL_MS)
      return null
    return {
      ts: v.ts,
      itemType: 'album',
      albumId: v.albumId,
      title: typeof v.title === 'string' ? v.title : '앨범',
      bucketId: typeof v.bucketId === 'string' ? v.bucketId : null,
    }
  }
  catch {
    return null
  }
}
