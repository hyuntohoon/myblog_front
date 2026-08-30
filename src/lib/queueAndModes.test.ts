// FEAT-member-player Steps 6c + 6e.
//
// Two properties here are easy to break by "tidying up", and both fail silently:
//
//   - 6c does NOT ladder to an in-page device. Queueing onto a device that is not
//     playing is meaningless, so a 404 must stay a 404 with a "start playing first"
//     message — never a silent hand-off that parks a queue nobody is hearing.
//   - a volume 403 must NOT degrade the session tier. Real Connect targets accept
//     transport and reject volume, and Spotify answers with the same 403 it uses
//     for "not Premium". Folding the two together hides play/pause because a
//     speaker has no volume API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as authLib from '@lib/auth'
import { __resetPlaybackState, isSdkLoaded, queueTrack, sendPlaybackMode, sendPlayerCommand } from '@lib/spotifyPlayback'

vi.mock('@lib/auth', () => ({ isLoggedIn: vi.fn(() => true), getAuthHeader: vi.fn(() => ({})) }))

const TOKEN_URL = 'https://backend.test/api/playback/spotify-token'
const RESOLVE_URL = 'https://backend.test/api/playback/resolve'
const PLAYER = 'https://api.spotify.com/v1/me/player'

interface Call { url: string, init?: RequestInit }
let calls: Call[]

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

function install(routes: { token?: () => Response, resolve?: () => Response, queue?: () => Response, mode?: () => Response }): void {
  const r = {
    token: () => json({ access_token: 'tok', expires_in: 3600 }),
    resolve: () => json({ uri: 'spotify:track:t1' }),
    queue: () => json({}, 204),
    mode: () => json({}, 204),
    ...routes,
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (url.startsWith(TOKEN_URL))
      return r.token()
    if (url.startsWith(RESOLVE_URL))
      return r.resolve()
    if (url.startsWith(`${PLAYER}/queue`))
      return r.queue()
    if (url.startsWith(PLAYER))
      return r.mode()
    throw new Error(`unstubbed fetch: ${url}`)
  }))
}

beforeEach(() => {
  calls = []
  __resetPlaybackState()
  vi.mocked(authLib).isLoggedIn.mockReturnValue(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  __resetPlaybackState()
  vi.clearAllMocks()
})

describe('6c — 다음에 듣기', () => {
  it('posts the resolved track uri to the queue endpoint', async () => {
    install({})

    await expect(queueTrack({ trackId: 'trk1' })).resolves.toEqual({ ok: true })
    const q = calls.find(c => c.url.startsWith(`${PLAYER}/queue`))
    expect(q?.init?.method).toBe('POST')
    expect(q?.url).toContain(`uri=${encodeURIComponent('spotify:track:t1')}`)
  })

  it('does NOT fall back to an in-page device on 404 — it says to start playing', async () => {
    install({ queue: () => json({}, 404) })

    const r = await queueTrack({ trackId: 'trk1' })
    expect(r).toMatchObject({ ok: false, reason: 'no-active-device' })
    expect(r.ok === false && r.message).toContain('먼저 재생을 시작')
    // the tell: no SDK download, so no device was raised behind the user's back
    expect(isSdkLoaded()).toBe(false)
    expect(calls.filter(c => c.url.startsWith(`${PLAYER}/play`))).toHaveLength(0)
  })

  it('reports Premium for a 403 rather than a generic failure', async () => {
    install({ queue: () => json({}, 403) })

    await expect(queueTrack({ trackId: 'trk1' })).resolves.toMatchObject({ ok: false, reason: 'no-capability' })
  })

  it('never queues an unresolvable track', async () => {
    install({ resolve: () => json({}, 404) })

    await expect(queueTrack({ trackId: 'trk1' })).resolves.toMatchObject({ ok: false, reason: 'unresolvable' })
    expect(calls.filter(c => c.url.startsWith(`${PLAYER}/queue`))).toHaveLength(0)
  })

  it('a visitor costs no request at all', async () => {
    install({})
    vi.mocked(authLib).isLoggedIn.mockReturnValue(false)

    await expect(queueTrack({ trackId: 'trk1' })).resolves.toMatchObject({ ok: false, reason: 'token' })
    expect(calls).toHaveLength(0)
  })
})

describe('6e — playback modes', () => {
  it('sends shuffle state as a query param', async () => {
    install({})

    await expect(sendPlaybackMode({ kind: 'shuffle', on: true })).resolves.toEqual({ ok: true })
    expect(calls.find(c => c.url.includes('/shuffle'))?.url).toContain('state=true')
  })

  it('sends the repeat mode verbatim', async () => {
    install({})

    await expect(sendPlaybackMode({ kind: 'repeat', mode: 'track' })).resolves.toEqual({ ok: true })
    expect(calls.find(c => c.url.includes('/repeat'))?.url).toContain('state=track')
  })

  it('clamps volume into 0-100', async () => {
    install({})

    await sendPlaybackMode({ kind: 'volume', percent: 140 })
    await sendPlaybackMode({ kind: 'volume', percent: -20 })
    const vols = calls.filter(c => c.url.includes('/volume')).map(c => c.url)
    expect(vols[0]).toContain('volume_percent=100')
    expect(vols[1]).toContain('volume_percent=0')
  })

  it('a volume 403 is a DEVICE limit, not a capability loss', async () => {
    // The regression this guards: reading this as no-capability degrades the tier
    // and hides play/pause because a speaker has no volume API.
    install({ mode: () => json({}, 403) })

    await expect(sendPlaybackMode({ kind: 'volume', percent: 50 }))
      .resolves
      .toEqual({ ok: false, reason: 'unsupported-on-device' })
  })

  it('a shuffle 403 IS a capability loss — those are Premium features, not device features', async () => {
    install({ mode: () => json({}, 403) })

    await expect(sendPlaybackMode({ kind: 'shuffle', on: true }))
      .resolves
      .toEqual({ ok: false, reason: 'no-capability' })
  })
})

// ── ARCH-playback-authority-convergence Step 3, E1 ───────────────────────────
//
// 403 and 404 were ONE reason (`no-capability`) on every transport command, and
// the session answered it by degrading the tier and writing the transport probe
// the settings matrix reads as "보통 Premium이 아닐 때". So a member whose phone
// had gone to sleep — a 404, recoverable by opening the app — was told their
// account could not control playback, and nothing ever cleared it.
//
// `sendPlayerCommand`'s own header already said this was wrong ("a transport
// command racing a device change 404s and the bar reads as 'no capability' when
// the real answer is 'wrong device'"). This pins the split at the provider, which
// is the only place both codes are still visible.
describe('transport capability splits 403 from 404', () => {
  it('403 is no-capability — durable, the account cannot do this', async () => {
    install({ mode: () => json({}, 403) })

    await expect(sendPlayerCommand({ kind: 'next' }))
      .resolves
      .toEqual({ ok: false, reason: 'no-capability' })
  })

  it('404 is no-active-device — recoverable, there is just nowhere to send it', async () => {
    install({ mode: () => json({}, 404) })

    await expect(sendPlayerCommand({ kind: 'next' }))
      .resolves
      .toEqual({ ok: false, reason: 'no-active-device' })
  })

  it('carries the split through sendPlaybackMode, volume included', async () => {
    // A missing device is a missing device whatever the command. Only 403 gets the
    // volume-specific reading, and folding 404 into `unsupported-on-device` would
    // tell the member their speaker has no volume knob when it is simply asleep.
    install({ mode: () => json({}, 404) })

    await expect(sendPlaybackMode({ kind: 'volume', percent: 50 }))
      .resolves
      .toEqual({ ok: false, reason: 'no-active-device' })
    await expect(sendPlaybackMode({ kind: 'shuffle', on: true }))
      .resolves
      .toEqual({ ok: false, reason: 'no-active-device' })
  })
})
