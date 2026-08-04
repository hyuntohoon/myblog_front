// Playback Step 8 preflight audit — pins the rung-2 natural-completion signal.
//
// Before this, `ensureConnectedDevice()` registered SDK listeners for
// `ready`/`initialization_error`/`authentication_error`/`account_error` only —
// never `player_state_changed`, the SDK's own push event for "the track
// changed", which fires on a natural end-of-track auto-advance with no command
// of ours involved. Nothing anywhere detected that, so a finished track never
// left the UI/queue (confirmed: `onCompleted()` had zero callers in the whole
// repo). This wires that event into the SAME `MYBLOG_PLAYBACK_CHANGED` signal
// every other trigger already uses — not a new mechanism, and not polling: a
// push event fired zero times when nothing changes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as authLib from '@lib/auth'
import { __resetPlaybackState, MYBLOG_PLAYBACK_CHANGED, play } from '@lib/spotifyPlayback'

vi.mock('@lib/auth', () => ({ isLoggedIn: vi.fn(() => true), getAuthHeader: vi.fn(() => ({})) }))

const TOKEN_URL = 'https://backend.test/api/playback/spotify-token'
const RESOLVE_URL = 'https://backend.test/api/playback/resolve'
const PLAY_URL = 'https://api.spotify.com/v1/me/player/play'
const DEVICE_ID = 'device-abc'

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

function install(): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith(TOKEN_URL))
      return json({ access_token: 'tok', expires_in: 3600 })
    if (url.startsWith(RESOLVE_URL))
      return json({ uri: 'spotify:album:alb1' })
    if (url.startsWith(PLAY_URL))
      return url.includes('device_id=') ? json({}, 204) : json({}, 404) // force rung 2
    throw new Error(`unstubbed fetch: ${url}`)
  }))
}

/** Same shape as `playLadder.test.ts`'s `fakeSdk`, plus a way to fire events from the test. */
let fireStateChanged: (state: { track_window: { current_track: { id: string | null } } } | null) => void

function fakeSdk(): void {
  ;(window as unknown as { Spotify: unknown }).Spotify = {
    Player: class {
      private listeners: Record<string, (p: unknown) => void> = {}
      addListener(event: string, cb: (p: unknown) => void) {
        this.listeners[event] = cb
        if (event === 'player_state_changed')
          fireStateChanged = cb as typeof fireStateChanged
        return true
      }

      disconnect() {}
      async connect() {
        await Promise.resolve()
        this.listeners.ready?.({ device_id: DEVICE_ID })
        return true
      }
    },
  }
}

function waitForEvents(): Promise<CustomEvent[]> {
  const seen: CustomEvent[] = []
  const onEvent = (e: Event) => seen.push(e as CustomEvent)
  window.addEventListener(MYBLOG_PLAYBACK_CHANGED, onEvent)
  return Promise.resolve().then(() => {
    window.removeEventListener(MYBLOG_PLAYBACK_CHANGED, onEvent)
    return seen
  })
}

beforeEach(() => {
  __resetPlaybackState()
  vi.mocked(authLib).isLoggedIn.mockReturnValue(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (window as unknown as { Spotify?: unknown }).Spotify
  document.querySelectorAll('script[data-spotify-sdk]').forEach(s => s.remove())
  __resetPlaybackState()
  vi.clearAllMocks()
})

describe('rung 2 player_state_changed → MYBLOG_PLAYBACK_CHANGED', () => {
  it('fires on a genuine track change (the natural-completion signal)', async () => {
    install()
    fakeSdk()
    await play({ kind: 'album', albumId: 'alb1' }) // cold start → rung 2, SDK connected

    const onEvent = vi.fn()
    window.addEventListener(MYBLOG_PLAYBACK_CHANGED, onEvent)

    fireStateChanged({ track_window: { current_track: { id: 'SPOT-NEXT' } } })

    expect(onEvent).toHaveBeenCalledTimes(1)
    window.removeEventListener(MYBLOG_PLAYBACK_CHANGED, onEvent)
  })

  it('does NOT fire again when the SDK re-reports the same track (position/volume-only updates)', async () => {
    install()
    fakeSdk()
    await play({ kind: 'album', albumId: 'alb1' })

    fireStateChanged({ track_window: { current_track: { id: 'SPOT-SAME' } } })
    const onEvent = vi.fn()
    window.addEventListener(MYBLOG_PLAYBACK_CHANGED, onEvent)
    fireStateChanged({ track_window: { current_track: { id: 'SPOT-SAME' } } })

    expect(onEvent).not.toHaveBeenCalled()
    window.removeEventListener(MYBLOG_PLAYBACK_CHANGED, onEvent)
  })

  it('fires again once the track actually changes a second time', async () => {
    install()
    fakeSdk()
    await play({ kind: 'album', albumId: 'alb1' })

    fireStateChanged({ track_window: { current_track: { id: 'SPOT-A' } } })
    const onEvent = vi.fn()
    window.addEventListener(MYBLOG_PLAYBACK_CHANGED, onEvent)
    fireStateChanged({ track_window: { current_track: { id: 'SPOT-B' } } })

    expect(onEvent).toHaveBeenCalledTimes(1)
    window.removeEventListener(MYBLOG_PLAYBACK_CHANGED, onEvent)
  })

  it('is a push event, not a poll — never fires on its own', async () => {
    install()
    fakeSdk()
    await play({ kind: 'album', albumId: 'alb1' })

    const onEvent = vi.fn()
    window.addEventListener(MYBLOG_PLAYBACK_CHANGED, onEvent)
    const events = await waitForEvents()

    expect(events).toHaveLength(0)
    expect(onEvent).not.toHaveBeenCalled()
    window.removeEventListener(MYBLOG_PLAYBACK_CHANGED, onEvent)
  })
})
