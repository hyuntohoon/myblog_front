// Characterization tests for the fetch client (`@lib/api`). These pin the CURRENT
// behavior of apiFetch/safeFetch so REFACTOR Step 2 (single client + timeout +
// cancellation) can prove it preserves the 401→refresh contract. NOT aspirational:
// where today's apiFetch has no timeout/abort, that absence is asserted here and
// Step 2 will intentionally flip those cases.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `@lib/api` imports getAccessToken/refreshAccessToken/goLogin from ./auth; mock
// the whole module so no real Cognito/storage runs.
vi.mock('./auth', () => ({
  getAccessToken: vi.fn(),
  refreshAccessToken: vi.fn(),
  goLogin: vi.fn(),
}))

const { getAccessToken, refreshAccessToken, goLogin } = await import('./auth')
const { apiFetch, safeFetch } = await import('./api')

const mockGetToken = vi.mocked(getAccessToken)
const mockRefresh = vi.mocked(refreshAccessToken)
const mockGoLogin = vi.mocked(goLogin)

function res(status: number, body: unknown = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status })
}

beforeEach(() => {
  vi.restoreAllMocks()
  mockGetToken.mockReset()
  mockRefresh.mockReset()
  mockGoLogin.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiFetch', () => {
  it('sends the Bearer token + Content-Type and returns the response on 200', async () => {
    mockGetToken.mockReturnValue('tok-1')
    const fetchMock = vi.fn().mockResolvedValue(res(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const r = await apiFetch('/api/x', { method: 'GET' })

    expect(r?.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('omits Authorization when no token is present', async () => {
    mockGetToken.mockReturnValue(null)
    const fetchMock = vi.fn().mockResolvedValue(res(200))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/api/x')

    const [, init] = fetchMock.mock.calls[0]
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('on 401 refreshes once and retries with the new token, returning the retry response', async () => {
    mockGetToken.mockReturnValue('stale')
    mockRefresh.mockResolvedValue('fresh')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(401))
      .mockResolvedValueOnce(res(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const r = await apiFetch('/api/x')

    expect(mockRefresh).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(r?.status).toBe(200)
    // retry carries the refreshed token
    const [, retryInit] = fetchMock.mock.calls[1]
    expect((retryInit.headers as Record<string, string>).Authorization).toBe('Bearer fresh')
    expect(mockGoLogin).not.toHaveBeenCalled()
  })

  it('on 401 with a failed refresh redirects to login and returns null', async () => {
    mockGetToken.mockReturnValue('stale')
    mockRefresh.mockResolvedValue(null)
    const fetchMock = vi.fn().mockResolvedValue(res(401))
    vi.stubGlobal('fetch', fetchMock)

    const r = await apiFetch('/api/x')

    expect(r).toBeNull()
    expect(mockGoLogin).toHaveBeenCalledWith(true)
    expect(fetchMock).toHaveBeenCalledTimes(1) // no retry when refresh fails
  })

  it('on 401 where the refreshed retry is still 401, redirects to login and returns null', async () => {
    mockGetToken.mockReturnValue('stale')
    mockRefresh.mockResolvedValue('fresh-but-rejected')
    const fetchMock = vi.fn().mockResolvedValue(res(401))
    vi.stubGlobal('fetch', fetchMock)

    const r = await apiFetch('/api/x')

    expect(r).toBeNull()
    expect(mockGoLogin).toHaveBeenCalledWith(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns null on a transport error without forcing re-login', async () => {
    mockGetToken.mockReturnValue('tok')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const r = await apiFetch('/api/x')

    expect(r).toBeNull()
    expect(mockGoLogin).not.toHaveBeenCalled()
  })

  // REFACTOR Step 2: apiFetch now bounds every call with a timeout — it injects
  // its own AbortSignal even when the caller passes none.
  it('injects an AbortSignal (its own timeout) even when the caller omits one', async () => {
    mockGetToken.mockReturnValue('tok')
    const fetchMock = vi.fn().mockResolvedValue(res(200))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/api/x')

    const [, init] = fetchMock.mock.calls[0]
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.signal.aborted).toBe(false)
  })

  it('aborts and returns null when the request exceeds the default timeout', async () => {
    vi.useFakeTimers()
    mockGetToken.mockReturnValue('tok')
    // a fetch that only settles when its signal aborts (a wedged request)
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }))
    vi.stubGlobal('fetch', fetchMock)

    const p = apiFetch('/api/x')
    await vi.advanceTimersByTimeAsync(15000)
    const r = await p

    expect(r).toBeNull()
    expect(mockGoLogin).not.toHaveBeenCalled() // a timeout is not an auth failure
    vi.useRealTimers()
  })

  it('honors a caller timeoutMs override', async () => {
    vi.useFakeTimers()
    mockGetToken.mockReturnValue('tok')
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }))
    vi.stubGlobal('fetch', fetchMock)

    const p = apiFetch('/api/x', { timeoutMs: 100 })
    await vi.advanceTimersByTimeAsync(100)
    expect(await p).toBeNull()
    vi.useRealTimers()
  })

  it('cancels the request and returns null when a caller signal aborts', async () => {
    mockGetToken.mockReturnValue('tok')
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }))
    vi.stubGlobal('fetch', fetchMock)

    const ac = new AbortController()
    const p = apiFetch('/api/x', { signal: ac.signal })
    ac.abort()
    const r = await p

    expect(r).toBeNull()
    expect(mockGoLogin).not.toHaveBeenCalled()
  })

  it('returns null immediately when the caller signal is already aborted', async () => {
    mockGetToken.mockReturnValue('tok')
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        if (init?.signal?.aborted)
          reject(new DOMException('aborted', 'AbortError'))
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }))
    vi.stubGlobal('fetch', fetchMock)

    const ac = new AbortController()
    ac.abort()
    const r = await apiFetch('/api/x', { signal: ac.signal })

    expect(r).toBeNull()
  })
})

describe('safeFetch', () => {
  it('returns parsed JSON on a 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { v: 42 })))
    const out = await safeFetch<{ v: number }>('/x')
    expect(out).toEqual({ v: 42 })
  })

  it('returns null on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(500)))
    const out = await safeFetch('/x')
    expect(out).toBeNull()
  })

  it('returns null (does not throw) on a transport error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))
    const out = await safeFetch('/x')
    expect(out).toBeNull()
  })

  it('aborts via its 8s timeout and returns null when fetch never settles', async () => {
    vi.useFakeTimers()
    // fetch that only rejects when its signal aborts (mimics a hung request)
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const p = safeFetch('/x')
    await vi.advanceTimersByTimeAsync(8000)
    const out = await p

    expect(out).toBeNull()
    // safeFetch DID pass an abort signal (unlike apiFetch)
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
    vi.useRealTimers()
  })
})
