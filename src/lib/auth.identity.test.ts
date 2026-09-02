/**
 * @vitest-environment-options { "url": "https://blog.test/" }
 */
// FIX-auth-identity-lifecycle Step 1 — token writes are conditional on the account
// boundary they were started under.
//
// The defect these pin: `refreshAccessTokenOnce()` used to write whatever Cognito
// returned, with no reference to who asked. A tab whose refresh was in flight when the
// user signed out therefore put a working access_token back into localStorage a moment
// after logout cleared it — the signed-out session came back to life, in a tab the user
// had already walked away from.
//
// Every case here is CROSS-TAB and every one of them is REVERSED: the account changes
// while the request is open, and the response arrives afterwards. A test that changed
// the account after the response resolved would pass against the old code.
import { beforeEach, describe, expect, it, vi } from 'vitest'

function idTokenFor(sub: string): string {
  return `header.${btoa(JSON.stringify({ sub }))}.signature`
}

function tokenResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

/** See authIdentity.test.ts — storage is updated first, the event lands separately. */
function otherTabWrote(key: string, value: string | null): void {
  const oldValue = localStorage.getItem(key)
  if (value === null)
    localStorage.removeItem(key)
  else localStorage.setItem(key, value)
  window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue: value }))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.resetModules()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('refreshAccessToken across an account boundary', () => {
  it('does not write the refreshed token when another tab logged out while it was in flight', async () => {
    localStorage.setItem('id_token', idTokenFor('user-a'))
    localStorage.setItem('access_token', 'at-a')
    localStorage.setItem('refresh_token', 'rt-a')
    const pending = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending.promise))
    const { refreshAccessToken } = await import('./auth')

    const inflight = refreshAccessToken()
    // …the other tab signs out while Cognito is still thinking.
    otherTabWrote('access_token', null)
    otherTabWrote('id_token', null)
    otherTabWrote('refresh_token', null)
    // …and only THEN does the refresh come back with a perfectly valid token.
    pending.resolve(tokenResponse({ access_token: 'at-resurrected', id_token: idTokenFor('user-a') }))

    await expect(inflight).resolves.toBeNull()
    expect(localStorage.getItem('access_token')).toBeNull()
    expect(localStorage.getItem('id_token')).toBeNull()
  })

  it('does not write account A\'s refreshed token after a switch to account B', async () => {
    localStorage.setItem('id_token', idTokenFor('user-a'))
    localStorage.setItem('refresh_token', 'rt-a')
    const pending = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending.promise))
    const { refreshAccessToken } = await import('./auth')

    const inflight = refreshAccessToken()
    otherTabWrote('id_token', idTokenFor('user-b'))
    otherTabWrote('refresh_token', 'rt-b')
    otherTabWrote('access_token', 'at-b')
    pending.resolve(tokenResponse({ access_token: 'at-a-late', id_token: idTokenFor('user-a') }))

    await expect(inflight).resolves.toBeNull()
    // B's session is untouched — neither the token nor the identity moved back to A.
    expect(localStorage.getItem('access_token')).toBe('at-b')
    expect(localStorage.getItem('id_token')).toBe(idTokenFor('user-b'))
  })

  it('refuses the commit even when the sibling tab\'s storage event has not arrived yet', async () => {
    // The generation is still the captured one because nothing told this tab anything.
    // Only the refresh credential moved, and the epoch check has to be enough on its own.
    localStorage.setItem('id_token', idTokenFor('user-a'))
    localStorage.setItem('refresh_token', 'rt-a')
    const pending = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending.promise))
    const { refreshAccessToken } = await import('./auth')
    const { getAuthGeneration } = await import('./authIdentity')
    const generationAtStart = getAuthGeneration()

    const inflight = refreshAccessToken()
    localStorage.removeItem('refresh_token') // sibling logged out; no event dispatched
    pending.resolve(tokenResponse({ access_token: 'at-resurrected' }))

    await expect(inflight).resolves.toBeNull()
    expect(getAuthGeneration()).toBe(generationAtStart)
    expect(localStorage.getItem('access_token')).toBeNull()
  })

  it('still commits normally when nothing moved', async () => {
    // The control. Without it, a check that always refused would pass every case above.
    localStorage.setItem('id_token', idTokenFor('user-a'))
    localStorage.setItem('refresh_token', 'rt-a')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      tokenResponse({ access_token: 'at-new', id_token: idTokenFor('user-a') }),
    ))
    const { refreshAccessToken } = await import('./auth')

    await expect(refreshAccessToken()).resolves.toBe('at-new')
    expect(localStorage.getItem('access_token')).toBe('at-new')
  })
})

describe('refreshAccessToken under a caller deadline', () => {
  it('rejects for the aborted caller while the shared refresh keeps running for the others', async () => {
    // Single-flighting is the reason this cannot simply forward the signal to fetch:
    // one widget's 15-second ceiling must not cancel the refresh three siblings on the
    // same page are still waiting on.
    localStorage.setItem('id_token', idTokenFor('user-a'))
    localStorage.setItem('refresh_token', 'rt-a')
    const pending = deferred<Response>()
    const fetchMock = vi.fn().mockReturnValue(pending.promise)
    vi.stubGlobal('fetch', fetchMock)
    const { refreshAccessToken } = await import('./auth')

    const impatient = new AbortController()
    const impatientCall = refreshAccessToken(impatient.signal)
    const patientCall = refreshAccessToken()

    impatient.abort(new DOMException('apiFetch timed out', 'TimeoutError'))
    await expect(impatientCall).rejects.toMatchObject({ name: 'TimeoutError' })

    pending.resolve(tokenResponse({ access_token: 'at-new' }))
    await expect(patientCall).resolves.toBe('at-new')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects immediately when the caller signal is already aborted', async () => {
    localStorage.setItem('refresh_token', 'rt-a')
    vi.stubGlobal('fetch', vi.fn())
    const { refreshAccessToken } = await import('./auth')

    const controller = new AbortController()
    controller.abort(new DOMException('gone', 'AbortError'))

    await expect(refreshAccessToken(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('starts a new refresh for the next caller once the shared one has settled', async () => {
    // The in-flight promise is cleared on the SHARED promise, not in a caller's
    // `finally`. Clearing it there would leave an aborted caller's exit deciding when
    // the next refresh may start, and a still-open refresh would be duplicated.
    localStorage.setItem('refresh_token', 'rt-a')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse({ access_token: 'at-1' }))
      .mockResolvedValueOnce(tokenResponse({ access_token: 'at-2' }))
    vi.stubGlobal('fetch', fetchMock)
    const { refreshAccessToken } = await import('./auth')

    await expect(refreshAccessToken()).resolves.toBe('at-1')
    await expect(refreshAccessToken()).resolves.toBe('at-2')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('handleCallback across an account boundary', () => {
  beforeEach(() => {
    vi.stubEnv('PUBLIC_COGNITO_DOMAIN', 'auth.blog.test')
    vi.stubEnv('PUBLIC_COGNITO_CLIENT_ID', 'client-1')
    vi.stubEnv('PUBLIC_COGNITO_REDIRECT_URI', 'https://blog.test/admin/callback')
  })

  function primeCallback(): void {
    sessionStorage.setItem('pkce_verifier', 'verifier-1')
    sessionStorage.setItem('oauth_state', 'state-1')
    window.history.replaceState({}, '', '/admin/callback?code=abc&state=state-1')
  }

  it('commits the exchanged tokens on the happy path', async () => {
    primeCallback()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tokenResponse({
      access_token: 'at-a',
id_token: idTokenFor('user-a'),
refresh_token: 'rt-a',
    })))
    const { handleCallback } = await import('./auth')

    await handleCallback()

    expect(localStorage.getItem('access_token')).toBe('at-a')
    const { getAuthIdentity } = await import('./authIdentity')
    expect(getAuthIdentity()).toBe('user-a')
  })

  it('throws instead of signing in when another tab logged out mid-exchange', async () => {
    primeCallback()
    const pending = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending.promise))
    const { handleCallback } = await import('./auth')

    const inflight = handleCallback()
    otherTabWrote('pb:auth-generation', 'logout-during-exchange')
    pending.resolve(tokenResponse({ access_token: 'at-a', id_token: idTokenFor('user-a'), refresh_token: 'rt-a' }))

    await expect(inflight).rejects.toThrow(/다른 탭에서 로그아웃/)
    expect(localStorage.getItem('access_token')).toBeNull()
    // The single-use PKCE material is gone either way — it must never be replayable.
    expect(sessionStorage.getItem('pkce_verifier')).toBeNull()
    expect(sessionStorage.getItem('oauth_state')).toBeNull()
  })
})

describe('logout', () => {
  beforeEach(() => {
    vi.stubEnv('PUBLIC_COGNITO_DOMAIN', 'auth.blog.test')
    vi.stubEnv('PUBLIC_COGNITO_CLIENT_ID', 'client-1')
    vi.stubEnv('PUBLIC_COGNITO_REDIRECT_URI', 'https://blog.test/admin/callback')
  })

  it('invalidates pending work and signals other tabs before the document goes away', async () => {
    localStorage.setItem('id_token', idTokenFor('user-a'))
    localStorage.setItem('access_token', 'at-a')
    localStorage.setItem('refresh_token', 'rt-a')
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign, hostname: 'blog.test' })
    const { logout } = await import('./auth')
    const { captureAuthEpoch, isAuthEpochCurrent, getAuthIdentity, ANONYMOUS_IDENTITY } = await import('./authIdentity')
    const epoch = captureAuthEpoch()

    logout()

    expect(isAuthEpochCurrent(epoch)).toBe(false)
    expect(getAuthIdentity()).toBe(ANONYMOUS_IDENTITY)
    // The cross-tab signal is written, so a sibling tab's in-flight refresh is
    // invalidated too rather than only this tab's.
    expect(localStorage.getItem('pb:auth-generation')).not.toBeNull()
    expect(assign).toHaveBeenCalledOnce()
  })
})
