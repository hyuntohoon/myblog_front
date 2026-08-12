// Covers the refreshAccessToken() in-flight singleflight guard: a page can mount
// many widgets that each call apiFetch independently, so when the access token
// expires they all 401 at once. Without sharing one refresh attempt, each fires
// its own POST to Cognito's token endpoint, and the first to fail for any reason
// forces a re-login even though a sibling's refresh may have succeeded. Mirrors
// the inflightMint pattern in spotifyPlayback.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'

function tokenResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status })
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('refreshAccessToken', () => {
  it('returns null without calling fetch when no refresh_token is stored', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { refreshAccessToken } = await import('./auth')

    const result = await refreshAccessToken()

    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('exchanges the stored refresh_token and persists the new access/id tokens', async () => {
    localStorage.setItem('refresh_token', 'rt-1')
    const fetchMock = vi.fn().mockResolvedValue(tokenResponse(200, { access_token: 'at-new', id_token: 'idt-new' }))
    vi.stubGlobal('fetch', fetchMock)
    const { refreshAccessToken } = await import('./auth')

    const result = await refreshAccessToken()

    expect(result).toBe('at-new')
    expect(localStorage.getItem('access_token')).toBe('at-new')
    expect(localStorage.getItem('id_token')).toBe('idt-new')
    // the stored refresh_token is kept as-is — Cognito does not rotate it
    expect(localStorage.getItem('refresh_token')).toBe('rt-1')
  })

  it('concurrent callers share a single in-flight refresh instead of each POSTing', async () => {
    localStorage.setItem('refresh_token', 'rt-1')
    let resolveFetch!: (r: Response) => void
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((resolve) => {
      resolveFetch = resolve
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { refreshAccessToken } = await import('./auth')

    // three concurrent callers, as three widgets on the same page would produce
    const p1 = refreshAccessToken()
    const p2 = refreshAccessToken()
    const p3 = refreshAccessToken()

    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch(tokenResponse(200, { access_token: 'at-shared' }))
    const [r1, r2, r3] = await Promise.all([p1, p2, p3])

    expect(r1).toBe('at-shared')
    expect(r2).toBe('at-shared')
    expect(r3).toBe('at-shared')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('clears the in-flight guard after completion so a later call refreshes again', async () => {
    localStorage.setItem('refresh_token', 'rt-1')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse(200, { access_token: 'at-first' }))
      .mockResolvedValueOnce(tokenResponse(200, { access_token: 'at-second' }))
    vi.stubGlobal('fetch', fetchMock)
    const { refreshAccessToken } = await import('./auth')

    const first = await refreshAccessToken()
    const second = await refreshAccessToken()

    expect(first).toBe('at-first')
    expect(second).toBe('at-second')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns null and clears the guard when the token endpoint rejects the refresh', async () => {
    localStorage.setItem('refresh_token', 'rt-1')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse(400, { error: 'invalid_grant' }))
      .mockResolvedValueOnce(tokenResponse(200, { access_token: 'at-retry' }))
    vi.stubGlobal('fetch', fetchMock)
    const { refreshAccessToken } = await import('./auth')

    const failed = await refreshAccessToken()
    expect(failed).toBeNull()

    const retried = await refreshAccessToken()
    expect(retried).toBe('at-retry')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns null on a transport error without throwing', async () => {
    localStorage.setItem('refresh_token', 'rt-1')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const { refreshAccessToken } = await import('./auth')

    const result = await refreshAccessToken()

    expect(result).toBeNull()
  })
})
