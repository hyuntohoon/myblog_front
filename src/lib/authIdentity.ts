// FIX-auth-identity-lifecycle Step 1 — the one place that answers "who is logged in
// right now, and how many times has that answer changed?".
//
// WHY this exists. Before it, three modules each decided identity for themselves and
// each decided it ONCE: `auth.ts` refreshed tokens and wrote the result unconditionally,
// `bucketStore.ts` froze the Cognito `sub` in a module constant at import, and
// `playback/ownership.ts` keyed its lease and bus off the origin with no account in
// them at all. Every async operation started under account A therefore committed under
// whoever happened to be current when it resolved.
//
// The durable exposure is CROSS-TAB, which is why this module's cross-tab half is not
// an extra. `logout()` navigates the document away, so a same-tab delayed completion
// has only the few hundred ms before unload. But a second tab keeps running: its
// in-flight refresh resolves after this tab logged out and writes the tokens straight
// back into `localStorage`, and its frozen Pocket scope keeps painting account A's tree
// while `id_token` already says B.
//
// The model is deliberately small:
//   - `identity` — the Cognito `sub`, or a sentinel when there is no token;
//   - `generation` — a monotonic counter, bumped whenever identity changes OR another
//     tab explicitly invalidates (logout). It only ever moves forward, so a captured
//     value is a total order, not a guess;
//   - an `AuthEpoch` — captured when async work BEGINS, checked before it commits.
//
// The epoch carries the refresh credential as well as the generation because the two
// fail differently. The generation catches "something changed"; the credential catches
// the window where this tab has not yet been told — a `storage` event is delivered
// asynchronously, so a refresh that resolves in that gap would still look current.
// Comparing the credential the operation actually used against what is stored now
// closes it without waiting for any event.

/**
 * Cross-tab invalidation signal. Logout writes it; every other tab sees the
 * `storage` event and bumps its own generation. The VALUE is meaningless — only the
 * write matters — but it must differ every time or the browser fires no event.
 */
const GENERATION_KEY = 'pb:auth-generation'

const ACCESS_KEY = 'access_token'
const ID_KEY = 'id_token'
const REFRESH_KEY = 'refresh_token'

/** Storage keys whose change can mean the account changed. */
const WATCHED_KEYS = new Set<string>([ACCESS_KEY, ID_KEY, REFRESH_KEY, GENERATION_KEY])

/** No token at all — logged out. */
export const ANONYMOUS_IDENTITY = 'anon'
/** Localhost, where both services bypass JWT validation and there is no real `sub`. */
export const LOCAL_DEV_IDENTITY = 'local-dev'

const inBrowser = typeof window !== 'undefined'

function isLocalHost(): boolean {
  if (!inBrowser)
    return false
  const h = location.hostname
  return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local')
}

/** The `sub` claim of the stored id_token, or null when absent/malformed. */
function subFromIdToken(): string | null {
  if (!inBrowser)
    return null
  try {
    const idToken = localStorage.getItem(ID_KEY)
    if (!idToken)
      return null
    const payload = JSON.parse(atob(idToken.split('.')[1])) as { sub?: unknown }
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null
  }
  catch {
    return null // malformed token → treat as no identity
  }
}

/**
 * Read the current identity from storage.
 *
 * The token is consulted BEFORE the localhost sentinel, which is the one behavioural
 * difference from the `userScope()` this replaced. On a real dev machine there is no
 * id_token (auth is bypassed), so the sentinel still wins and dev behaviour is
 * unchanged; but a test that plants an id_token can now exercise a real account
 * boundary instead of being collapsed into `local-dev` by the jsdom hostname.
 */
function readIdentity(): string {
  const sub = subFromIdToken()
  if (sub)
    return sub
  if (isLocalHost())
    return LOCAL_DEV_IDENTITY
  return ANONYMOUS_IDENTITY
}

function readRefreshCredential(): string | null {
  if (!inBrowser)
    return null
  try {
    return localStorage.getItem(REFRESH_KEY)
  }
  catch {
    return null
  }
}

let identity = readIdentity()
let generation = 0

type IdentityListener = (identity: string, generation: number) => void
const listeners = new Set<IdentityListener>()

function emit(): void {
  // Copied before iterating: a listener may unsubscribe itself (the Pocket provider
  // does, on unmount) and mutating the live Set mid-iteration would skip a sibling.
  for (const cb of [...listeners]) {
    try {
      cb(identity, generation)
    }
    catch {
      // One bad subscriber must not stop the account boundary from reaching the rest.
    }
  }
}

/** The Cognito `sub` currently in effect, or a sentinel (`anon` / `local-dev`). */
export function getAuthIdentity(): string {
  return identity
}

/** Monotonic counter; every identity change or explicit invalidation moves it forward. */
export function getAuthGeneration(): number {
  return generation
}

/**
 * A snapshot of "who we are and what credential we are using", taken when an async
 * auth operation begins. Pass it to {@link isAuthEpochCurrent} before committing.
 */
export interface AuthEpoch {
  generation: number
  identity: string
  /** The refresh_token in effect at capture; null when logged out (e.g. a callback). */
  refreshCredential: string | null
}

export function captureAuthEpoch(): AuthEpoch {
  return { generation, identity, refreshCredential: readRefreshCredential() }
}

/**
 * Is it still safe for work captured at `epoch` to commit?
 *
 * All three must still hold. Generation and identity catch a change this tab has been
 * told about; the credential catches one it has not — see the module note.
 */
export function isAuthEpochCurrent(epoch: AuthEpoch): boolean {
  const sameBoundary = epoch.generation === generation && epoch.identity === identity
  return sameBoundary && epoch.refreshCredential === readRefreshCredential()
}

/**
 * Re-read identity from storage and, if it moved, bump the generation and notify.
 * Call after any same-tab write to the auth tokens. Returns whether anything changed.
 *
 * `force` bumps and notifies even when the identity string is unchanged — used for an
 * explicit invalidation (a logout from anon to anon still has to cancel pending work).
 */
export function syncAuthIdentity(force = false): boolean {
  const next = readIdentity()
  if (next === identity && !force)
    return false
  identity = next
  generation += 1
  emit()
  return true
}

/**
 * Invalidate every pending auth-scoped operation, here and in every other tab.
 *
 * Called by `logout()` BEFORE it clears the tokens and navigates away, so a sibling
 * tab's in-flight refresh has already lost its right to commit by the time it resolves.
 */
export function invalidateAuthGeneration(): void {
  syncAuthIdentity(true)
  if (!inBrowser)
    return
  try {
    // A changing value is required: the browser fires no `storage` event when a key is
    // rewritten with the value it already holds.
    localStorage.setItem(GENERATION_KEY, `${Date.now()}:${Math.random().toString(36).slice(2)}`)
  }
  catch {
    // Storage unavailable — this tab is still correct; siblings fall back to the
    // credential half of the epoch check, which needs no event.
  }
}

/**
 * Subscribe to account-boundary changes. The callback runs after identity and
 * generation have both been updated, so a subscriber may read either safely.
 */
export function subscribeAuthIdentity(cb: IdentityListener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

if (inBrowser) {
  // `storage` fires only in OTHER tabs, which is exactly the case this guards. The
  // same tab calls `syncAuthIdentity()` / `invalidateAuthGeneration()` directly.
  window.addEventListener('storage', (event) => {
    // A whole-storage clear (`localStorage.clear()`) arrives with `key === null`.
    if (event.key !== null && !WATCHED_KEYS.has(event.key))
      return
    syncAuthIdentity(event.key === GENERATION_KEY)
  })
}

/** Test seam — restore the module to a freshly-imported state. */
export function __resetAuthIdentity(): void {
  identity = readIdentity()
  generation = 0
  listeners.clear()
}
