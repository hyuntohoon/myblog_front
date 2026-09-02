// FIX-auth-identity-lifecycle Step 1 — `apiFetch`'s deadline covers the 401 refresh.
//
// The defect: `apiFetch` advertises a 15-second ceiling and composes one AbortController
// over the original request AND the post-refresh retry — but the refresh BETWEEN them
// was awaited bare. `refreshAccessToken()` issued its own unsignalled fetch, so a
// Cognito token endpoint that accepted the connection and never answered held the call
// open indefinitely, past a ceiling the caller had been promised.
//
// The second half is subtler and is the one that would hurt a user: on that path the
// refresh eventually returned null, and `apiFetch` read null as "the session is dead"
// and redirected to login. A slow network could therefore sign someone out.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./auth', () => ({
  getAccessToken: vi.fn(),
  refreshAccessToken: vi.fn(),
  goLogin: vi.fn(),
}))

const { getAccessToken, refreshAccessToken, goLogin } = await import('./auth')
const { apiFetch } = await import('./api')

const mockGetToken = vi.mocked(getAccessToken)
const mockRefresh = vi.mocked(refreshAccessToken)
const mockGoLogin = vi.mocked(goLogin)

function res(status: number, body: unknown = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status })
}

/**
 * A refresh that never answers on its own and can only be ended by the signal.
 *
 * It mirrors the real `refreshAccessToken` contract in the part that is easy to get
 * wrong: a signal that is ALREADY aborted rejects at once rather than waiting for an
 * `abort` event that has, by definition, been and gone. A stub that only listened
 * would hang exactly where the caller-abort case needs it to reject — which is how
 * this helper came to exist.
 */
function hangingRefresh() {
  return vi.fn((signal?: AbortSignal) => new Promise<string | null>((_resolve, reject) => {
    if (!signal)
      return
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  }))
}

beforeEach(() => {
  vi.restoreAllMocks()
  mockGetToken.mockReset()
  mockRefresh.mockReset()
  mockGoLogin.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('apiFetch — the 401 refresh runs under the caller deadline', () => {
  it('passes the composed signal to the refresh so it is bounded at all', async () => {
    mockGetToken.mockReturnValue('at-old')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(401)))
    mockRefresh.mockResolvedValue('at-new')

    await apiFetch('/api/thing')

    const signal = mockRefresh.mock.calls[0]?.[0]
    expect(signal).toBeInstanceOf(AbortSignal)
  })

  it('gives up on a hung refresh at the timeout instead of waiting forever', async () => {
    vi.useFakeTimers()
    mockGetToken.mockReturnValue('at-old')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(401)))
    // A token endpoint that accepted the connection and then went quiet.
    mockRefresh.mockImplementation(hangingRefresh())

    const call = apiFetch('/api/thing')
    let settled = false
    void call.then(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(14_000)
    expect(settled).toBe(false) // still inside the advertised ceiling

    await vi.advanceTimersByTimeAsync(2_000)
    await expect(call).resolves.toBeNull()
  })

  it('does NOT redirect to login when the deadline is what ended the refresh', async () => {
    vi.useFakeTimers()
    mockGetToken.mockReturnValue('at-old')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(401)))
    mockRefresh.mockImplementation(hangingRefresh())

    const call = apiFetch('/api/thing')
    await vi.advanceTimersByTimeAsync(16_000)
    await call

    expect(mockGoLogin).not.toHaveBeenCalled()
  })

  it('does NOT redirect to login when the CALLER aborted during the refresh', async () => {
    mockGetToken.mockReturnValue('at-old')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(401)))
    mockRefresh.mockImplementation(hangingRefresh())
    const controller = new AbortController()

    const call = apiFetch('/api/thing', { signal: controller.signal })
    controller.abort(new DOMException('user navigated away', 'AbortError'))

    await expect(call).resolves.toBeNull()
    expect(mockGoLogin).not.toHaveBeenCalled()
  })

  it('still redirects when Cognito genuinely refuses the refresh', async () => {
    // The control that keeps the three cases above honest: suppressing the redirect
    // unconditionally would satisfy all of them and break the actual re-login path.
    mockGetToken.mockReturnValue('at-old')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(401)))
    mockRefresh.mockResolvedValue(null)

    await expect(apiFetch('/api/thing')).resolves.toBeNull()
    expect(mockGoLogin).toHaveBeenCalledWith(true)
  })

  it('still redirects when the retry after a successful refresh is itself a 401', async () => {
    mockGetToken.mockReturnValue('at-old')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(401)))
    mockRefresh.mockResolvedValue('at-new')

    await expect(apiFetch('/api/thing')).resolves.toBeNull()
    expect(mockGoLogin).toHaveBeenCalledWith(true)
  })
})
