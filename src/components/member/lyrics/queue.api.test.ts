// FEAT-lyrics-viewer-playback Step 2 — pins `readQueue`'s outcome mapping.
//
// The screen's contract is that NO response shape may close the viewer or blank
// the lyrics behind it, so every branch has to land on a typed result rather
// than throw. The two that are easy to get wrong are pinned first: 204 (no
// active device) is an EMPTY queue, not a failure, and 403/404 is the one
// outcome the screen must phrase as "can't read this" rather than "retry".
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as playbackLib from '@lib/spotifyPlayback'
import { readQueue } from './queue.api'

vi.mock('@lib/spotifyPlayback', () => ({ getStreamingToken: vi.fn() }))

const lib = vi.mocked(playbackLib)

function entry(over: Record<string, unknown> = {}) {
  return { id: 'trk1', uri: 'spotify:track:trk1', name: 'Some Track', artists: [{ name: 'Someone' }], ...over }
}

/** Stub one `GET /v1/me/player/queue` response. */
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

describe('readQueue outcome mapping', () => {
  it('maps currently_playing + queue into rows', async () => {
    respond(200, {
      currently_playing: entry(),
      queue: [entry({ id: 'trk2', name: 'Next' }), entry({ id: 'trk3', name: 'After' })],
    })
    const r = await readQueue()
    expect(r.ok).toBe(true)
    if (!r.ok)
      throw new Error('expected ok')
    expect(r.current).toEqual({ id: 'trk1', uri: 'spotify:track:trk1', name: 'Some Track', artist: 'Someone' })
    expect(r.items.map(i => i.id)).toEqual(['trk2', 'trk3'])
  })

  it('joins multiple artists into one subtitle', async () => {
    respond(200, { currently_playing: null, queue: [entry({ artists: [{ name: 'A' }, { name: 'B' }] })] })
    const r = await readQueue()
    if (!r.ok)
      throw new Error('expected ok')
    expect(r.items[0].artist).toBe('A, B')
  })

  it('keeps an artist-less entry (episode) with a null subtitle rather than dropping it', async () => {
    // Dropping it would make our list silently disagree with the Spotify app.
    respond(200, { currently_playing: null, queue: [entry({ artists: null })] })
    const r = await readQueue()
    if (!r.ok)
      throw new Error('expected ok')
    expect(r.items).toHaveLength(1)
    expect(r.items[0].artist).toBeNull()
  })

  it('keeps an entry with no uri and renders it with uri: null', async () => {
    // The list must still agree with Spotify; the missing uri only makes this
    // one row inert instead of making the whole entry disappear.
    respond(200, { currently_playing: null, queue: [entry({ uri: null })] })
    const r = await readQueue()
    if (!r.ok)
      throw new Error('expected ok')
    expect(r.items).toHaveLength(1)
    expect(r.items[0].uri).toBeNull()
  })

  it('drops an entry with no id or no name — it has nothing to render', async () => {
    respond(200, { currently_playing: null, queue: [entry({ id: null }), entry({ name: null }), entry({ id: 'ok' })] })
    const r = await readQueue()
    if (!r.ok)
      throw new Error('expected ok')
    expect(r.items.map(i => i.id)).toEqual(['ok'])
  })

  it('a null currently_playing is not a failure', async () => {
    respond(200, { currently_playing: null, queue: [] })
    const r = await readQueue()
    expect(r).toEqual({ ok: true, current: null, items: [] })
  })

  it('204 (no active device) is an EMPTY queue, not a failure', async () => {
    // The screen has a real sentence for "queue is empty"; routing this to a
    // failure would show a retry button for something retrying cannot fix.
    respond(204)
    expect(await readQueue()).toEqual({ ok: true, current: null, items: [] })
  })

  it('403 → no-capability (a legacy grant missing the scope)', async () => {
    respond(403, {})
    expect(await readQueue()).toEqual({ ok: false, reason: 'no-capability' })
  })

  it('404 → no-capability', async () => {
    respond(404, {})
    expect(await readQueue()).toEqual({ ok: false, reason: 'no-capability' })
  })

  it('500 → transient', async () => {
    respond(500, {})
    expect(await readQueue()).toEqual({ ok: false, reason: 'transient' })
  })

  it('a failed token mint → token, never confused with an empty queue', async () => {
    lib.getStreamingToken.mockResolvedValue({ ok: false, status: 'dormant' } as never)
    expect(await readQueue()).toEqual({ ok: false, reason: 'token' })
  })

  it('a network throw → transient, never propagated to the viewer', async () => {
    lib.getStreamingToken.mockResolvedValue({ ok: true, token: 't' } as never)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(readQueue()).resolves.toEqual({ ok: false, reason: 'transient' })
  })

  it('unparseable JSON → transient rather than a throw', async () => {
    lib.getStreamingToken.mockResolvedValue({ ok: true, token: 't' } as never)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => {
        throw new Error('bad json')
      },
    }))
    await expect(readQueue()).resolves.toEqual({ ok: false, reason: 'transient' })
  })

  it('passes an AbortSignal so the read cannot hang the screen open', async () => {
    respond(200, { currently_playing: null, queue: [] })
    await readQueue()
    const init = vi.mocked(globalThis.fetch).mock.calls[0][1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})
