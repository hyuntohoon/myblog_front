// FEAT-member-player Step 5 — pins the play ladder.
//
// The defect this step exists to fix was silent and structural: six play surfaces
// were split across two paths by build date, and the four the owner actually used
// omitted `device_id`, so a cold start (nothing playing anywhere) 404'd and simply
// did nothing. These tests pin the three properties that make that impossible to
// reintroduce:
//
//   - the 404 is a HAND-OFF, not a dead end (rung 1 -> rung 2)
//   - the two rungs differ by `device_id` and NOTHING ELSE (same body, same endpoint)
//   - a play that cannot possibly sound never downloads the ~1 MB SDK
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as authLib from '@lib/auth'
import { __resetPlaybackState, getStreamingToken, isSdkLoaded, play } from '@lib/spotifyPlayback'

vi.mock('@lib/auth', () => ({
  isLoggedIn: vi.fn(() => true),
  getAuthHeader: vi.fn(() => ({})),
  refreshAccessToken: vi.fn(),
}))

const TOKEN_URL = 'https://backend.test/api/playback/spotify-token'
const RESOLVE_URL = 'https://backend.test/api/playback/resolve'
const PLAY_URL = 'https://api.spotify.com/v1/me/player/play'
const DEVICE_ID = 'device-abc'

interface Call { url: string, init?: RequestInit }
let calls: Call[]

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

/**
 * A route table the tests tweak per case. `playWithDevice` / `playNoDevice` are the
 * two rungs; distinguishing them by the query string is the point of the whole suite.
 */
interface Routes {
  token?: () => Response
  resolve?: () => Response
  playNoDevice?: () => Response
  playWithDevice?: () => Response
}

function install(routes: Routes): void {
  const r = {
    token: () => json({ access_token: 'tok', expires_in: 3600 }),
    resolve: () => json({ uri: 'spotify:album:alb1' }),
    playNoDevice: () => json({}, 204),
    playWithDevice: () => json({}, 204),
    ...routes,
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (url.startsWith(TOKEN_URL))
      return r.token()
    if (url.startsWith(RESOLVE_URL))
      return r.resolve()
    if (url.startsWith(PLAY_URL))
      return url.includes('device_id=') ? r.playWithDevice() : r.playNoDevice()
    throw new Error(`unstubbed fetch: ${url}`)
  }))
}

/**
 * Stand in for the Web Playback SDK. `window.Spotify` being present short-circuits
 * the script injection, so a test that reaches rung 2 never pulls the real 1 MB
 * bundle — and `isSdkLoaded()` stays a truthful negative signal for the tests that
 * assert rung 2 was NOT reached.
 */
function fakeSdk(opts: { failWith?: string } = {}): void {
  ;(window as unknown as { Spotify: unknown }).Spotify = {
    Player: class {
      private listeners: Record<string, (p: unknown) => void> = {}
      addListener(event: string, cb: (p: unknown) => void) {
        this.listeners[event] = cb
        return true
      }

      disconnect() {}
      async connect() {
        // Async, like the real one — the ladder must await 'ready', not assume it.
        await Promise.resolve()
        if (opts.failWith)
          this.listeners[opts.failWith]?.({ message: opts.failWith })
        else
          this.listeners.ready?.({ device_id: DEVICE_ID })
        return true
      }
    },
  }
}

function playCalls(): Call[] {
  return calls.filter(c => c.url.startsWith(PLAY_URL))
}

beforeEach(() => {
  calls = []
  __resetPlaybackState()
  vi.mocked(authLib).isLoggedIn.mockReturnValue(true)
  vi.mocked(authLib).getAuthHeader.mockReturnValue({})
  vi.mocked(authLib).refreshAccessToken.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (window as unknown as { Spotify?: unknown }).Spotify
  document.querySelectorAll('script[data-spotify-sdk]').forEach(s => s.remove())
  __resetPlaybackState()
  vi.clearAllMocks()
})

describe('rung 1 — an active Connect device', () => {
  it('plays remotely, undegraded, and never loads the SDK', async () => {
    install({})
    fakeSdk()

    await expect(play({ kind: 'album', albumId: 'alb1' })).resolves.toMatchObject({
      ok: true,
      rung: 'remote',
      degraded: false,
    })
    expect(playCalls()).toHaveLength(1)
    expect(playCalls()[0].url).not.toContain('device_id=')
    expect(isSdkLoaded()).toBe(false)
  })
})

describe('rung 2 — cold start (the defect this step fixes)', () => {
  it('treats the 404 as a hand-off and plays in-page, marked degraded', async () => {
    install({ playNoDevice: () => json({}, 404) })
    fakeSdk()

    await expect(play({ kind: 'album', albumId: 'alb1' })).resolves.toMatchObject({
      ok: true,
      rung: 'in-page',
      degraded: true,
    })
    const attempts = playCalls()
    expect(attempts).toHaveLength(2)
    expect(attempts[0].url).not.toContain('device_id=')
    expect(attempts[1].url).toContain(`device_id=${DEVICE_ID}`)
  })

  it('sends an IDENTICAL body on both rungs — the two paths differ by device_id alone', async () => {
    install({ playNoDevice: () => json({}, 404) })
    fakeSdk()

    await play({ kind: 'album', albumId: 'alb1' })

    const [remote, inPage] = playCalls()
    expect(remote.init?.body).toBe(inPage.init?.body)
    expect(remote.init?.method).toBe(inPage.init?.method)
    expect(JSON.parse(String(remote.init?.body))).toEqual({ context_uri: 'spotify:album:alb1' })
  })

  it('resolves the catalog id ONCE, not per rung', async () => {
    install({ playNoDevice: () => json({}, 404) })
    fakeSdk()

    await play({ kind: 'album', albumId: 'alb1' })

    expect(calls.filter(c => c.url.startsWith(RESOLVE_URL))).toHaveLength(1)
  })

  it('reports no-capability when the SDK rejects the account (non-Premium)', async () => {
    install({ playNoDevice: () => json({}, 404) })
    fakeSdk({ failWith: 'account_error' })

    await expect(play({ kind: 'album', albumId: 'alb1' })).resolves.toMatchObject({
      ok: false,
      reason: 'no-capability',
    })
  })

  it('does NOT claim no-capability for a transient SDK failure', async () => {
    // A Premium listener on a flaky network must never be told to upgrade.
    install({ playNoDevice: () => json({}, 404) })
    fakeSdk({ failWith: 'initialization_error' })

    await expect(play({ kind: 'album', albumId: 'alb1' })).resolves.toMatchObject({
      ok: false,
      reason: 'transient',
    })
  })
})

describe('short-circuits before any cost', () => {
  it('a visitor mints no token and resolves nothing', async () => {
    install({})
    vi.mocked(authLib).isLoggedIn.mockReturnValue(false)

    await expect(play({ kind: 'album', albumId: 'alb1' })).resolves.toMatchObject({
      ok: false,
      reason: 'token',
      status: 'unauthorized',
    })
    expect(calls).toHaveLength(0)
  })

  it('a dormant (503) account never reaches the resolve or the SDK', async () => {
    install({ token: () => json({}, 503) })
    fakeSdk()

    await expect(play({ kind: 'album', albumId: 'alb1' })).resolves.toMatchObject({
      ok: false,
      reason: 'token',
      status: 'dormant',
    })
    expect(calls.filter(c => c.url.startsWith(RESOLVE_URL))).toHaveLength(0)
    expect(playCalls()).toHaveLength(0)
    expect(isSdkLoaded()).toBe(false)
  })

  it('an unresolvable item never attempts a play', async () => {
    install({ resolve: () => json({}, 404) })
    fakeSdk()

    await expect(play({ kind: 'album', albumId: 'alb1' })).resolves.toMatchObject({
      ok: false,
      reason: 'unresolvable',
    })
    expect(playCalls()).toHaveLength(0)
  })
})

describe('pre-resolved intents (the lyrics queue jump)', () => {
  it('sends context + offset without touching the catalog resolve', async () => {
    install({})
    fakeSdk()

    await expect(play({ kind: 'context', contextUri: 'spotify:album:a', offsetUri: 'spotify:track:t' }))
      .resolves
      .toMatchObject({ ok: true, rung: 'remote' })
    expect(calls.filter(c => c.url.startsWith(RESOLVE_URL))).toHaveLength(0)
    expect(JSON.parse(String(playCalls()[0].init?.body))).toEqual({
      context_uri: 'spotify:album:a',
      offset: { uri: 'spotify:track:t' },
    })
  })

  it('carries a uris tail through to rung 2 unchanged', async () => {
    install({ playNoDevice: () => json({}, 404) })
    fakeSdk()

    const uris = ['spotify:track:b', 'spotify:track:c']
    await expect(play({ kind: 'uris', uris })).resolves.toMatchObject({ ok: true, rung: 'in-page' })
    expect(JSON.parse(String(playCalls()[1].init?.body))).toEqual({ uris })
  })
})

describe('token expiry mid-session', () => {
  it('refreshes an expired Cognito token once, then retries the streaming-token mint', async () => {
    vi.mocked(authLib).getAuthHeader.mockReturnValueOnce({ Authorization: 'Bearer stale' }).mockReturnValueOnce({ Authorization: 'Bearer stale' }).mockReturnValue({ Authorization: 'Bearer fresh' })
    vi.mocked(authLib).refreshAccessToken.mockResolvedValue('fresh')
    install({
      token: vi.fn().mockReturnValueOnce(json({}, 401)).mockReturnValueOnce(json({ access_token: 'streaming-fresh', expires_in: 3600 })),
    })

    await expect(getStreamingToken()).resolves.toMatchObject({ ok: true, token: 'streaming-fresh' })
    expect(vi.mocked(authLib).refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(calls.filter(c => c.url.startsWith(TOKEN_URL))).toHaveLength(2)
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer stale')
    expect((calls[1].init?.headers as Record<string, string>).Authorization).toBe('Bearer fresh')
  })

  it('does not retry or redirect when Cognito refresh fails', async () => {
    vi.mocked(authLib).getAuthHeader.mockReturnValue({ Authorization: 'Bearer stale' })
    vi.mocked(authLib).refreshAccessToken.mockResolvedValue(null)
    install({ token: () => json({}, 401) })

    await expect(getStreamingToken()).resolves.toEqual({ ok: false, status: 'unauthorized', httpStatus: 401 })
    expect(vi.mocked(authLib).refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(calls.filter(c => c.url.startsWith(TOKEN_URL))).toHaveLength(1)
  })

  it('stops after the one post-refresh retry when that mint is still unauthorized', async () => {
    vi.mocked(authLib).getAuthHeader.mockReturnValueOnce({ Authorization: 'Bearer stale' }).mockReturnValueOnce({ Authorization: 'Bearer stale' }).mockReturnValue({ Authorization: 'Bearer fresh' })
    vi.mocked(authLib).refreshAccessToken.mockResolvedValue('fresh')
    install({ token: () => json({}, 401) })

    await expect(getStreamingToken()).resolves.toEqual({ ok: false, status: 'unauthorized', httpStatus: 401 })
    expect(vi.mocked(authLib).refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(calls.filter(c => c.url.startsWith(TOKEN_URL))).toHaveLength(2)
  })

  it('retries with an access token refreshed by another request without refreshing again', async () => {
    vi.mocked(authLib).getAuthHeader.mockReturnValueOnce({ Authorization: 'Bearer stale' }).mockReturnValueOnce({ Authorization: 'Bearer already-fresh' })
    install({
      token: vi.fn().mockReturnValueOnce(json({}, 401)).mockReturnValueOnce(json({ access_token: 'streaming-fresh', expires_in: 3600 })),
    })

    await expect(getStreamingToken()).resolves.toMatchObject({ ok: true, token: 'streaming-fresh' })
    expect(vi.mocked(authLib).refreshAccessToken).not.toHaveBeenCalled()
    expect(calls.filter(c => c.url.startsWith(TOKEN_URL))).toHaveLength(2)
    expect((calls[1].init?.headers as Record<string, string>).Authorization).toBe('Bearer already-fresh')
  })

  it('shares a stale-token recovery mint across concurrent callers', async () => {
    let releaseFirst: (() => void) | undefined
    const firstResponse = new Promise<Response>((resolve) => {
      releaseFirst = () => resolve(json({}, 401))
    })
    vi.mocked(authLib).getAuthHeader.mockReturnValueOnce({ Authorization: 'Bearer stale' }).mockReturnValueOnce({ Authorization: 'Bearer stale' }).mockReturnValue({ Authorization: 'Bearer fresh' })
    vi.mocked(authLib).refreshAccessToken.mockResolvedValue('fresh')
    install({
      token: vi.fn().mockReturnValueOnce(firstResponse).mockReturnValueOnce(json({ access_token: 'streaming-fresh', expires_in: 3600 })),
    })

    const first = getStreamingToken()
    const second = getStreamingToken()
    releaseFirst?.()

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ ok: true, token: 'streaming-fresh' }),
      expect.objectContaining({ ok: true, token: 'streaming-fresh' }),
    ])
    expect(vi.mocked(authLib).refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(calls.filter(c => c.url.startsWith(TOKEN_URL))).toHaveLength(2)
  })

  it('re-mints once on a 401 and retries the same rung', async () => {
    let first = true
    install({
      playNoDevice: () => {
        if (first) {
          first = false
          return json({}, 401)
        }
        return json({}, 204)
      },
    })
    fakeSdk()

    await expect(play({ kind: 'album', albumId: 'alb1' })).resolves.toMatchObject({ ok: true, rung: 'remote' })
    expect(playCalls()).toHaveLength(2)
    expect(playCalls()[1].url).not.toContain('device_id=')
  })
})
