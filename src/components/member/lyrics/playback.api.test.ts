// FEAT-lyrics-sync-precision Step 2 — pins the playing / paused / idle split.
//
// `paused` was carved out of `idle` so the lyrics viewer can freeze at the REAL
// held position instead of guessing from an ageing estimate. That split touches
// three consumers (NowPlaying's applyLive, its lyrics entry, and the viewer's
// refresh), and getting it wrong is silent — a paused player would either read
// as a failure or drag the estimate along. These tests pin the discrimination
// itself; the consumers' handling is pinned by their own branches.
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as playbackLib from '@lib/spotifyPlayback'
import { readLivePlayback } from './playback.api'

vi.mock('@lib/spotifyPlayback', () => ({
  getStreamingToken: vi.fn(),
  MYBLOG_PLAYBACK_CHANGED: 'myblog:playback-changed',
}))

const lib = vi.mocked(playbackLib)

function track(over: Record<string, unknown> = {}) {
  return {
    id: 'trk1',
    type: 'track',
    duration_ms: 210_000,
    name: 'Some Track',
    artists: [{ id: 'art1', name: 'Someone' }],
    album: { id: 'alb1', name: 'Some Album', images: [{ url: 'https://x/cover.jpg', width: 640 }] },
    ...over,
  }
}

/** Stub one `GET /v1/me/player` response. */
function respond(status: number, body?: unknown) {
  lib.getStreamingToken.mockResolvedValue({ ok: true, token: 't' } as never)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }))
}

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('readLivePlayback state discrimination', () => {
  it('shares one in-flight player request across concurrent playback-change consumers, then reads again after settlement', async () => {
    lib.getStreamingToken.mockResolvedValue({ ok: true, token: 't' } as never)
    let resolveFetch!: (value: { status: number, ok: boolean, json: () => Promise<unknown> }) => void
    const fetchMock = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveFetch = resolve
    }))
    vi.stubGlobal('fetch', fetchMock)

    const reads: Array<Promise<unknown>> = []
    const consumers = [
      () => reads.push(readLivePlayback()),
      () => reads.push(readLivePlayback()),
      () => reads.push(readLivePlayback()),
    ]
    for (const consume of consumers)
      window.addEventListener(lib.MYBLOG_PLAYBACK_CHANGED, consume)

    window.dispatchEvent(new CustomEvent(lib.MYBLOG_PLAYBACK_CHANGED))
    expect(reads).toHaveLength(3)
    expect(reads[0]).toBe(reads[1])
    expect(reads[1]).toBe(reads[2])
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())

    resolveFetch({ status: 204, ok: true, json: async () => ({}) })
    await Promise.all(reads)
    fetchMock.mockResolvedValueOnce({ status: 204, ok: true, json: async () => ({}) })
    await readLivePlayback()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    for (const consume of consumers)
      window.removeEventListener(lib.MYBLOG_PLAYBACK_CHANGED, consume)
  })

  it('is_playing true with a track → playing', async () => {
    respond(200, { is_playing: true, progress_ms: 42_000, item: track(), device: { id: 'phone-id', name: 'iPhone' } })
    const r = await readLivePlayback()
    expect(r.state).toBe('playing')
    expect(r).toMatchObject({ trackId: 'trk1', progressMs: 42_000, durationMs: 210_000, deviceName: 'iPhone', deviceId: 'phone-id' })
  })

  it('is_playing false with a track → paused, CARRYING the held position', async () => {
    // The whole point of the split: before it, this position was discarded.
    respond(200, { is_playing: false, progress_ms: 42_000, item: track(), device: { name: 'iPhone' } })
    const r = await readLivePlayback()
    expect(r.state).toBe('paused')
    expect(r).toMatchObject({ trackId: 'trk1', progressMs: 42_000, durationMs: 210_000 })
  })

  it('paused and playing carry the identical payload shape', async () => {
    respond(200, { is_playing: true, progress_ms: 1000, item: track(), device: { name: 'D' } })
    const playing = await readLivePlayback()
    respond(200, { is_playing: false, progress_ms: 1000, item: track(), device: { name: 'D' } })
    const paused = await readLivePlayback()
    expect(Object.keys(playing).sort()).toEqual(Object.keys(paused).sort())
  })

  it('204 (no active device) → idle, not paused', async () => {
    respond(204)
    expect((await readLivePlayback()).state).toBe('idle')
  })

  it('a non-track item stays idle even while playing (ad / podcast)', async () => {
    respond(200, { is_playing: true, progress_ms: 5, item: track({ type: 'episode' }) })
    expect((await readLivePlayback()).state).toBe('idle')
  })

  it('a paused non-track item is idle, not paused', async () => {
    respond(200, { is_playing: false, progress_ms: 5, item: track({ type: 'episode' }) })
    expect((await readLivePlayback()).state).toBe('idle')
  })

  it('an empty body is idle, never paused', async () => {
    respond(200, {})
    expect((await readLivePlayback()).state).toBe('idle')
  })

  it('a failed token mint stays unavailable — never confused with not-playing', async () => {
    lib.getStreamingToken.mockResolvedValue({ ok: false, status: 'dormant' } as never)
    expect((await readLivePlayback()).state).toBe('unavailable')
  })

  it('a non-2xx read stays unavailable', async () => {
    respond(500, {})
    expect((await readLivePlayback()).state).toBe('unavailable')
  })

  it('readAtMs sits inside the request window, so the anchor is not blamed for RTT', async () => {
    const before = performance.now()
    respond(200, { is_playing: true, progress_ms: 1000, item: track() })
    const r = await readLivePlayback()
    const after = performance.now()
    if (r.state !== 'playing')
      throw new Error('expected playing')
    expect(r.readAtMs).toBeGreaterThanOrEqual(before)
    expect(r.readAtMs).toBeLessThanOrEqual(after)
  })
})
