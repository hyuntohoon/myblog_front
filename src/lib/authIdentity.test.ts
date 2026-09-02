/**
 * @vitest-environment-options { "url": "https://blog.test/" }
 */
// FIX-auth-identity-lifecycle Step 1 — the auth lifecycle source itself.
//
// The URL override matters. jsdom defaults to localhost, where both this module and
// `auth.ts` take their dev-bypass branch and every account collapses to one sentinel —
// a suite left on the default would be asserting about a code path production never
// runs. `https://blog.test/` puts these tests on the deployed branch.
//
// Everything here is shaped CROSS-TAB, because that is where the defect lives: a
// same-tab logout navigates the document away and takes its pending work with it,
// while a second tab keeps running under an account that no longer exists.
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** An id_token whose payload carries `sub` — only the payload segment is ever read. */
function idTokenFor(sub: string): string {
  return `header.${btoa(JSON.stringify({ sub }))}.signature`
}

/**
 * What the browser does when ANOTHER tab writes to localStorage: this tab's storage is
 * already updated when the event arrives, and the event is a separate, later delivery.
 * Keeping those two halves separate is the point — the gap between them is a real
 * window in which this tab still believes the old account is current.
 */
function otherTabWrote(key: string, value: string | null): void {
  const oldValue = localStorage.getItem(key)
  if (value === null)
    localStorage.removeItem(key)
  else localStorage.setItem(key, value)
  window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue: value }))
}

async function freshIdentity() {
  vi.resetModules()
  return import('./authIdentity')
}

beforeEach(() => {
  localStorage.clear()
})

describe('auth identity', () => {
  it('reads the Cognito sub from the stored id_token at load', async () => {
    localStorage.setItem('id_token', idTokenFor('user-a'))
    const { getAuthIdentity, getAuthGeneration } = await freshIdentity()

    expect(getAuthIdentity()).toBe('user-a')
    expect(getAuthGeneration()).toBe(0)
  })

  it('reports anon, not a crash, for a malformed id_token', async () => {
    localStorage.setItem('id_token', 'not-a-jwt')
    const { getAuthIdentity, ANONYMOUS_IDENTITY } = await freshIdentity()

    expect(getAuthIdentity()).toBe(ANONYMOUS_IDENTITY)
  })

  it('follows an account switch made in another tab and bumps the generation', async () => {
    localStorage.setItem('id_token', idTokenFor('user-a'))
    const { getAuthIdentity, getAuthGeneration, subscribeAuthIdentity } = await freshIdentity()
    const seen: Array<[string, number]> = []
    subscribeAuthIdentity((identity, generation) => seen.push([identity, generation]))

    otherTabWrote('id_token', idTokenFor('user-b'))

    expect(getAuthIdentity()).toBe('user-b')
    expect(getAuthGeneration()).toBe(1)
    expect(seen).toEqual([['user-b', 1]])
  })

  it('follows a logout made in another tab', async () => {
    localStorage.setItem('id_token', idTokenFor('user-a'))
    const { getAuthIdentity, ANONYMOUS_IDENTITY } = await freshIdentity()

    otherTabWrote('id_token', null)

    expect(getAuthIdentity()).toBe(ANONYMOUS_IDENTITY)
  })

  it('bumps the generation on an explicit invalidation even when the identity string does not move', async () => {
    // anon → anon. Nothing about the identity changed, but pending work still has to
    // be cancelled: this is the shape of a logout from a tab that was never signed in
    // on this device, and of a second logout racing the first.
    const { getAuthGeneration, subscribeAuthIdentity } = await freshIdentity()
    const seen: number[] = []
    subscribeAuthIdentity((_identity, generation) => seen.push(generation))

    otherTabWrote('pb:auth-generation', 'bump-1')

    expect(getAuthGeneration()).toBe(1)
    expect(seen).toEqual([1])
  })

  it('ignores storage events for unrelated keys', async () => {
    localStorage.setItem('id_token', idTokenFor('user-a'))
    const { getAuthGeneration, subscribeAuthIdentity } = await freshIdentity()
    const seen: number[] = []
    subscribeAuthIdentity((_identity, generation) => seen.push(generation))

    otherTabWrote('pb:design', '{"order":"name"}')

    expect(getAuthGeneration()).toBe(0)
    expect(seen).toEqual([])
  })

  it('reacts to a whole-storage clear, which arrives with a null key', async () => {
    localStorage.setItem('id_token', idTokenFor('user-a'))
    const { getAuthIdentity, ANONYMOUS_IDENTITY } = await freshIdentity()

    localStorage.clear()
    window.dispatchEvent(new StorageEvent('storage', { key: null }))

    expect(getAuthIdentity()).toBe(ANONYMOUS_IDENTITY)
  })
})

describe('auth epoch', () => {
  it('stays current while nothing moves', async () => {
    localStorage.setItem('id_token', idTokenFor('user-a'))
    localStorage.setItem('refresh_token', 'rt-a')
    const { captureAuthEpoch, isAuthEpochCurrent } = await freshIdentity()

    expect(isAuthEpochCurrent(captureAuthEpoch())).toBe(true)
  })

  it('goes stale once another tab switches accounts', async () => {
    localStorage.setItem('id_token', idTokenFor('user-a'))
    localStorage.setItem('refresh_token', 'rt-a')
    const { captureAuthEpoch, isAuthEpochCurrent } = await freshIdentity()
    const epoch = captureAuthEpoch()

    otherTabWrote('id_token', idTokenFor('user-b'))

    expect(isAuthEpochCurrent(epoch)).toBe(false)
  })

  it('goes stale in the window BEFORE the storage event is delivered', async () => {
    // The half the generation cannot cover. Another tab has already cleared the
    // tokens, but this tab has not been told yet — `generation` and `identity` are
    // both still exactly what they were at capture. Only the refresh credential
    // has changed underneath, and that alone must be enough to refuse the commit.
    localStorage.setItem('id_token', idTokenFor('user-a'))
    localStorage.setItem('refresh_token', 'rt-a')
    const { captureAuthEpoch, isAuthEpochCurrent, getAuthGeneration, getAuthIdentity } = await freshIdentity()
    const epoch = captureAuthEpoch()

    localStorage.removeItem('refresh_token') // no event dispatched

    expect(getAuthGeneration()).toBe(epoch.generation)
    expect(getAuthIdentity()).toBe(epoch.identity)
    expect(isAuthEpochCurrent(epoch)).toBe(false)
  })

  it('goes stale after an explicit invalidation that leaves the identity unchanged', async () => {
    const { captureAuthEpoch, isAuthEpochCurrent, invalidateAuthGeneration } = await freshIdentity()
    const epoch = captureAuthEpoch()

    invalidateAuthGeneration()

    expect(isAuthEpochCurrent(epoch)).toBe(false)
  })

  it('invalidation writes a changing cross-tab signal so siblings actually get an event', async () => {
    const { invalidateAuthGeneration } = await freshIdentity()

    invalidateAuthGeneration()
    const first = localStorage.getItem('pb:auth-generation')
    invalidateAuthGeneration()
    const second = localStorage.getItem('pb:auth-generation')

    expect(first).not.toBeNull()
    // A rewrite with an identical value fires no storage event at all, so a constant
    // sentinel here would silently stop reaching other tabs on the second logout.
    expect(second).not.toBe(first)
  })
})
