// FEAT-lyrics-viewer-playback OQ4 — `sendPlayerCommand` dispatches
// MYBLOG_PLAYBACK_CHANGED so a transport command issued on one surface reaches
// the others (and lands in FEAT-lyrics-sync-precision's `'command'` residual
// series, which until now had only ever observed `sendConnectPlay`).
//
// Three properties here are load-bearing and all fail silently if "tidied":
//
//   - a FAILED command must dispatch nothing. Listeners treat the event as
//     "the playhead moved"; firing it on a 403 makes every surface re-read to
//     confirm a state that never changed.
//   - shuffle/repeat/volume must dispatch nothing. They move neither the
//     playhead nor the track, and the lyrics viewer — which has no volume
//     control — would pay one read per slider move.
//   - one command ⇒ exactly ONE event, including the 401 re-mint retry path.
//     A second event is a second read on every listening surface.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as authLib from '@lib/auth'
import { __resetPlaybackState, MYBLOG_PLAYBACK_CHANGED, sendPlaybackMode, sendPlayerCommand } from '@lib/spotifyPlayback'

vi.mock('@lib/auth', () => ({ isLoggedIn: vi.fn(() => true), getAuthHeader: vi.fn(() => ({})) }))

const TOKEN_URL = 'https://backend.test/api/playback/spotify-token'
const PLAYER = 'https://api.spotify.com/v1/me/player'

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

let events: number
let onEvent: () => void

/** `player` answers every /me/player/* call; the token route always mints. */
function install(player: () => Response): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith(TOKEN_URL))
      return json({ access_token: 'tok', expires_in: 3600 })
    if (url.startsWith(PLAYER))
      return player()
    throw new Error(`unstubbed fetch: ${url}`)
  }))
}

beforeEach(() => {
  events = 0
  onEvent = () => {
    events += 1
  }
  window.addEventListener(MYBLOG_PLAYBACK_CHANGED, onEvent)
  __resetPlaybackState()
  vi.mocked(authLib).isLoggedIn.mockReturnValue(true)
})

afterEach(() => {
  window.removeEventListener(MYBLOG_PLAYBACK_CHANGED, onEvent)
  vi.unstubAllGlobals()
  __resetPlaybackState()
  vi.clearAllMocks()
})

describe('transport commands announce themselves (OQ4)', () => {
  it.each(['play', 'pause', 'next', 'previous'] as const)('a successful %s dispatches exactly one event', async (kind) => {
    install(() => json({}, 204))

    await expect(sendPlayerCommand({ kind })).resolves.toEqual({ ok: true })
    expect(events).toBe(1)
  })

  it('a seek dispatches — the playhead moved even though the track did not', async () => {
    install(() => json({}, 204))

    await sendPlayerCommand({ kind: 'seek', positionMs: 42_000 })
    expect(events).toBe(1)
  })

  it.each([
    { label: 'no-capability (403)', status: 403 },
    { label: 'no active device (404)', status: 404 },
    { label: 'transient (500)', status: 500 },
  ])('a command that fails with $label dispatches nothing', async ({ status }) => {
    install(() => json({}, status))

    await expect(sendPlayerCommand({ kind: 'pause' })).resolves.toMatchObject({ ok: false })
    expect(events).toBe(0)
  })

  it('the 401 re-mint retry still dispatches only once', async () => {
    // The retry loop runs the request twice; the event belongs to the command,
    // not to the attempt.
    let n = 0
    install(() => json({}, ++n === 1 ? 401 : 204))

    await expect(sendPlayerCommand({ kind: 'play' })).resolves.toEqual({ ok: true })
    expect(events).toBe(1)
  })

  it('a visitor dispatches nothing — the command never leaves', async () => {
    install(() => json({}, 204))
    vi.mocked(authLib).isLoggedIn.mockReturnValue(false)

    await expect(sendPlayerCommand({ kind: 'pause' })).resolves.toMatchObject({ ok: false, reason: 'token' })
    expect(events).toBe(0)
  })
})

describe('modes stay silent (OQ4)', () => {
  it.each([
    { label: 'shuffle', cmd: { kind: 'shuffle', on: true } as const },
    { label: 'repeat', cmd: { kind: 'repeat', mode: 'track' } as const },
    { label: 'volume', cmd: { kind: 'volume', percent: 50 } as const },
  ])('$label changes playback settings, not the playhead — no event', async ({ cmd }) => {
    install(() => json({}, 204))

    await expect(sendPlaybackMode(cmd)).resolves.toEqual({ ok: true })
    expect(events).toBe(0)
  })
})
