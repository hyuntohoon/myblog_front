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
import { syncAuthIdentity } from '@lib/authIdentity'
import { __resetPlaybackState, __setRemoteConfirmSchedule, getStreamingToken, isSdkLoaded, play } from '@lib/spotifyPlayback'

vi.mock('@lib/auth', () => ({
  isLoggedIn: vi.fn(() => true),
  getAuthHeader: vi.fn(() => ({})),
  refreshAccessToken: vi.fn(),
}))

const TOKEN_URL = 'https://backend.test/api/playback/spotify-token'
const RESOLVE_URL = 'https://backend.test/api/playback/resolve'
const PLAY_URL = 'https://api.spotify.com/v1/me/player/play'
const PLAYER_URL = 'https://api.spotify.com/v1/me/player'
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
  /** rung 1's read-back of what its 204 did (`GET /me/player`). */
  player?: () => Response
}

function install(routes: Routes): void {
  const r = {
    token: () => json({ access_token: 'tok', expires_in: 3600 }),
    resolve: () => json({ uri: 'spotify:album:alb1' }),
    playNoDevice: () => json({}, 204),
    playWithDevice: () => json({}, 204),
    // Default: the read fails, which is "unknown" and keeps the 204's answer.
    player: () => json({}, 500),
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
    if (url === PLAYER_URL)
      return r.player()
    throw new Error(`unstubbed fetch: ${url}`)
  }))
}

/**
 * Stand in for the Web Playback SDK. `window.Spotify` being present short-circuits
 * the script injection, so a test that reaches rung 2 never pulls the real 1 MB
 * bundle — and `isSdkLoaded()` stays a truthful negative signal for the tests that
 * assert rung 2 was NOT reached.
 */
interface FakePlayer {
  disconnected: boolean
  emit: (event: string, payload: unknown) => void
}
let players: FakePlayer[]

/**
 * `readyAfterMs` models the real SDK's lag between `connect()` and `ready` (a
 * websocket handshake plus a `check_scope` call). `never` is the 2026-10-07 shape:
 * `connect()` resolves `true` and `ready` simply never comes — no error event.
 */
function fakeSdk(opts: { failWith?: string, readyAfterMs?: number, never?: boolean } = {}): void {
  ;(window as unknown as { Spotify: unknown }).Spotify = {
    Player: class implements FakePlayer {
      private listeners: Record<string, (p: unknown) => void> = {}
      disconnected = false
      constructor() {
        players.push(this)
      }

      addListener(event: string, cb: (p: unknown) => void) {
        this.listeners[event] = cb
        return true
      }

      emit(event: string, payload: unknown) {
        this.listeners[event]?.(payload)
      }

      disconnect() {
        this.disconnected = true
      }

      async connect() {
        // Async, like the real one — the ladder must await 'ready', not assume it.
        await Promise.resolve()
        if (opts.never)
          return true
        if (opts.failWith)
          this.emit(opts.failWith, { message: opts.failWith })
        else if (opts.readyAfterMs)
          setTimeout(() => this.emit('ready', { device_id: DEVICE_ID }), opts.readyAfterMs)
        else
          this.emit('ready', { device_id: DEVICE_ID })
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
  players = []
  __resetPlaybackState()
  __setRemoteConfirmSchedule([0, 0, 0])
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

// OPS-project-stabilization Step 2A, 2026-10-09: the owner's Mac desktop app stayed
// the active Connect device, answered PUT /play 204, and loaded nothing (`item: null`).
// The bar showed the song; nothing sounded.
describe('rung 1 read-back — a 204 from a device that plays nothing', () => {
  const ghost = () => json({ is_playing: false, item: null, device: { name: 'MacBook' } })
  const playerReads = () => calls.filter(c => c.url === PLAYER_URL)

  it('hands a device that accepted and never started to rung 2', async () => {
    install({ player: ghost })
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
    expect(attempts[1].init?.body).toBe(attempts[0].init?.body)
    // Bounded: exactly the schedule, then it gives up on the device.
    expect(playerReads()).toHaveLength(3)
  })

  it('treats "no playback anywhere" (204 on every read) the same way', async () => {
    install({ player: () => json({}, 204) })
    fakeSdk()

    await expect(play({ kind: 'track', trackId: 't1' })).resolves.toMatchObject({ rung: 'in-page' })
  })

  it('does not count the previous song still playing as this play starting', async () => {
    install({
      resolve: () => json({ uri: 'spotify:track:new' }),
      player: () => json({ is_playing: true, item: { uri: 'spotify:track:old' } }),
    })
    fakeSdk()

    await expect(play({ kind: 'track', trackId: 't1' })).resolves.toMatchObject({ rung: 'in-page' })
  })

  it('stays remote after one read when the device is playing what was sent', async () => {
    install({ player: () => json({ is_playing: true, context: { uri: 'spotify:album:alb1' }, item: { uri: 'spotify:track:x' } }) })
    fakeSdk()

    await expect(play({ kind: 'album', albumId: 'alb1' })).resolves.toMatchObject({ ok: true, rung: 'remote' })
    expect(playerReads()).toHaveLength(1)
    expect(playCalls()).toHaveLength(1)
    expect(isSdkLoaded()).toBe(false)
  })

  it('waits out a device that starts on the second read', async () => {
    const states = [
      json({ is_playing: false, item: { uri: 'spotify:track:a' } }),
      json({ is_playing: true, item: { uri: 'spotify:track:a' } }),
    ]
    install({ player: () => states.shift() ?? json({}, 500) })
    fakeSdk()

    await expect(play({ kind: 'uris', uris: ['spotify:track:a', 'spotify:track:b'] })).resolves.toMatchObject({ rung: 'remote' })
    expect(playerReads()).toHaveLength(2)
  })

  it('accepts a relinked track (Spotify plays a market copy of the sent uri)', async () => {
    install({ player: () => json({ is_playing: true, item: { uri: 'spotify:track:copy', linked_from: { uri: 'spotify:track:a' } } }) })
    fakeSdk()

    await expect(play({ kind: 'uris', uris: ['spotify:track:a'] })).resolves.toMatchObject({ rung: 'remote' })
  })

  it('a jump inside a context is confirmed by the offset track', async () => {
    install({ player: () => json({ is_playing: true, context: { uri: 'spotify:album:z' }, item: { uri: 'spotify:track:o' } }) })
    fakeSdk()

    await expect(play({ kind: 'context', contextUri: 'spotify:album:z', offsetUri: 'spotify:track:o' })).resolves.toMatchObject({ rung: 'remote' })
  })

  it('keeps the 204 when the read itself fails — a failed read is not evidence', async () => {
    install({ player: () => json({}, 429) })
    fakeSdk()

    await expect(play({ kind: 'album', albumId: 'alb1' })).resolves.toMatchObject({ rung: 'remote' })
    expect(playerReads()).toHaveLength(1)
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

describe('rung 2 — a device that never readies (OPS-project-stabilization Step 2A)', () => {
  // Before the bound, `play()` never settled here, so the session's `busy` never
  // cleared and ▶ stayed disabled with no notice. Each case runs next to a control
  // that readies just inside the bound, so a green result cannot come from a harness
  // that times everything out.
  const STARTER = '이 브라우저에서 Spotify 재생기를 시작하지 못했어요'

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  async function settle(intent: Parameters<typeof play>[0], ms: number) {
    let outcome: Awaited<ReturnType<typeof play>> | 'pending' = 'pending'
    void play(intent).then((r) => {
      outcome = r
    })
    await vi.advanceTimersByTimeAsync(ms)
    return outcome
  }

  it('control: a device that readies inside the bound still plays in-page', async () => {
    install({ playNoDevice: () => json({}, 404) })
    fakeSdk({ readyAfterMs: 14_000 })

    expect(await settle({ kind: 'album', albumId: 'alb1' }, 14_500)).toMatchObject({ ok: true, rung: 'in-page' })
  })

  it('gives up with a sentence of its own, not the token copy, and frees the button', async () => {
    install({ playNoDevice: () => json({}, 404) })
    fakeSdk({ never: true })

    let outcome: Awaited<ReturnType<typeof play>> | 'pending' = 'pending'
    void play({ kind: 'album', albumId: 'alb1' }).then((r) => {
      outcome = r
    })
    await vi.advanceTimersByTimeAsync(14_900)
    expect(outcome).toBe('pending')
    await vi.advanceTimersByTimeAsync(200)
    expect(players).toHaveLength(1)
    expect(players[0].disconnected).toBe(true)
    expect(outcome).toMatchObject({ ok: false, reason: 'transient', message: expect.stringContaining(STARTER) })
    expect(playCalls().filter(c => c.url.includes('device_id='))).toHaveLength(0)
  })

  it('a player that readies AFTER giving up is not adopted as the device', async () => {
    install({ playNoDevice: () => json({}, 404) })
    fakeSdk({ readyAfterMs: 20_000 })

    expect(await settle({ kind: 'album', albumId: 'alb1' }, 15_100)).toMatchObject({ ok: false, reason: 'transient' })
    await vi.advanceTimersByTimeAsync(10_000)
    // Had the late `ready` been adopted, this play would skip the connect and PUT
    // straight to the stale device id.
    fakeSdk({ never: true })
    expect(await settle({ kind: 'album', albumId: 'alb1' }, 15_100)).toMatchObject({ ok: false, reason: 'transient' })
    expect(playCalls().filter(c => c.url.includes('device_id='))).toHaveLength(0)
  })

  it('bounds the SDK download too, and a failed script load can be retried', async () => {
    install({ playNoDevice: () => json({}, 404) })
    // No window.Spotify: the real script path. Nothing ever loads it in jsdom.
    expect(await settle({ kind: 'album', albumId: 'alb1' }, 15_100)).toMatchObject({ ok: false, reason: 'transient' })

    const script = document.querySelector('script[data-spotify-sdk]')
    script?.dispatchEvent(new Event('error'))
    expect(document.querySelector('script[data-spotify-sdk]')).toBeNull()
    fakeSdk()
    expect(await settle({ kind: 'album', albumId: 'alb1' }, 100)).toMatchObject({ ok: true, rung: 'in-page' })
  })

  it('an SDK auth rejection says so and re-mints for the next try', async () => {
    install({ playNoDevice: () => json({}, 404) })
    fakeSdk({ failWith: 'authentication_error' })

    const outcome = await settle({ kind: 'album', albumId: 'alb1' }, 100)
    expect(outcome).toMatchObject({ ok: false, reason: 'transient', message: expect.stringContaining('재생 인증을 거절했어요') })
    expect(players[0].disconnected).toBe(true)

    const mints = calls.filter(c => c.url.startsWith(TOKEN_URL)).length
    await settle({ kind: 'album', albumId: 'alb1' }, 100)
    expect(calls.filter(c => c.url.startsWith(TOKEN_URL)).length).toBeGreaterThan(mints)
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
    install({ token: () => json({ detail: 'Spotify playback not configured' }, 503) })
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

  // OPS-project-stabilization Step 2A, real-device gate 2026-10-06: API Gateway
  // answers a throttled Lambda 503 with its own body. That is transient — `error`,
  // which the live read retries — not the route's "not configured" `dormant`.
  it.each([
    ['an API Gateway throttle', () => json({ message: 'Service Unavailable' }, 503)],
    ['an auth-guard JWKS outage', () => json({ detail: 'Auth service unavailable' }, 503)],
    ['a non-JSON body', () => new Response('Service Unavailable', { status: 503 })],
  ])('a 503 from %s is a transient error, not dormant', async (_label, token) => {
    install({ token })
    fakeSdk()

    await expect(getStreamingToken()).resolves.toEqual({ ok: false, status: 'error', httpStatus: 503 })
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

describe('member streaming-token boundary', () => {
  it('never reuses a cached token after account invalidation', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ access_token: 'member-a', expires_in: 3600 })).mockResolvedValueOnce(json({ access_token: 'member-b', expires_in: 3600 }))
    vi.stubGlobal('fetch', fetcher)
    expect(await getStreamingToken()).toMatchObject({ token: 'member-a' })
    syncAuthIdentity(true)
    expect(await getStreamingToken()).toMatchObject({ token: 'member-b' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not share or cache an old account mint while the new one is pending', async () => {
    let oldResolve!: (response: Response) => void
    const fetcher = vi.fn().mockReturnValueOnce(new Promise<Response>((resolve) => {
      oldResolve = resolve
    })).mockResolvedValueOnce(json({ access_token: 'member-b', expires_in: 3600 }))
    vi.stubGlobal('fetch', fetcher)
    const old = getStreamingToken()
    syncAuthIdentity(true)
    expect(await getStreamingToken()).toMatchObject({ token: 'member-b' })
    oldResolve(json({ access_token: 'member-a', expires_in: 3600 }))
    expect(await old).toMatchObject({ ok: false })
    expect(await getStreamingToken()).toMatchObject({ token: 'member-b' })
  })

  it('bounds a stalled mint and allows the next entry to retry', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce(json({ access_token: 'recovered', expires_in: 3600 }))
      vi.stubGlobal('fetch', fetcher)
      const stalled = getStreamingToken()
      await vi.advanceTimersByTimeAsync(8_000)
      expect(await stalled).toMatchObject({ ok: false, status: 'error' })
      expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
      expect(await getStreamingToken()).toMatchObject({ token: 'recovered' })
    }
    finally {
      vi.useRealTimers()
    }
  })
})
