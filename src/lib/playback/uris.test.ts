import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetUriCache, cachedUri, PREFETCH_CONCURRENCY, prefetchUris, resolveTail, resolveUri } from './uris'

vi.mock('@lib/auth', () => ({ getAuthHeader: vi.fn(() => ({ Authorization: 'Bearer test' })) }))

const fetchMock = vi.fn()

function response(ok: boolean, uri?: string | null, status = ok ? 200 : 404) {
  return { ok, status, json: vi.fn(async () => ({ uri })) }
}

beforeEach(() => {
  __resetUriCache()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('uri cache', () => {
  it('serves a cache hit without another fetch', async () => {
    fetchMock.mockResolvedValue(response(true, 'provider:track:a'))

    await expect(resolveUri('a')).resolves.toBe('provider:track:a')
    await expect(resolveUri('a')).resolves.toBe('provider:track:a')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(cachedUri('a')).toBe('provider:track:a')
  })

  it('dedupes two callers onto one in-flight request', async () => {
    let release: (value: ReturnType<typeof response>) => void = () => {}
    fetchMock.mockImplementation(() => new Promise((resolve) => {
      release = resolve
    }))

    const first = resolveUri('a')
    const second = resolveUri('a')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    release(response(true, 'provider:track:a'))
    await expect(Promise.all([first, second])).resolves.toEqual(['provider:track:a', 'provider:track:a'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('remembers a DURABLE miss (404)', async () => {
    fetchMock.mockResolvedValue(response(false, undefined, 404))

    await expect(resolveUri('missing')).resolves.toBeNull()
    await expect(resolveUri('missing')).resolves.toBeNull()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(cachedUri('missing')).toBeNull()
  })

  it('remembers a durable miss reported as 200 with no uri', async () => {
    fetchMock.mockResolvedValue(response(true, null))

    await expect(resolveUri('unmapped')).resolves.toBeNull()
    await expect(resolveUri('unmapped')).resolves.toBeNull()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(cachedUri('unmapped')).toBeNull()
  })

  // ARCH-playback-authority-convergence Step 1 — the regression this whole split
  // exists for. Before it, ONE 500 made the track unplayable for the tab's life.
  it('does NOT cache a transient 500, and resolves on the retry', async () => {
    fetchMock.mockResolvedValueOnce(response(false, undefined, 500))

    await expect(resolveUri('flaky')).resolves.toBeNull()
    expect(cachedUri('flaky')).toBeUndefined()

    fetchMock.mockResolvedValueOnce(response(true, 'provider:track:flaky'))
    await expect(resolveUri('flaky')).resolves.toBe('provider:track:flaky')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does NOT cache a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))

    await expect(resolveUri('offline')).resolves.toBeNull()
    expect(cachedUri('offline')).toBeUndefined()

    fetchMock.mockResolvedValueOnce(response(true, 'provider:track:offline'))
    await expect(resolveUri('offline')).resolves.toBe('provider:track:offline')
  })
})

describe('resolveTail', () => {
  const row = (itemId: string, trackId = itemId) => ({ itemId, trackId })

  it('preserves order and keeps each resolved row bound to its itemId', async () => {
    fetchMock.mockImplementation(async (input: string) => {
      const id = new URL(input).searchParams.get('id')
      return id === 'missing' ? response(false, undefined, 404) : response(true, `provider:track:${id}`)
    })

    const tail = await resolveTail([row('i-a', 'a'), row('i-missing', 'missing'), row('i-c', 'c')])

    expect(tail.resolved).toEqual([
      { itemId: 'i-a', trackId: 'a', uri: 'provider:track:a' },
      { itemId: 'i-c', trackId: 'c', uri: 'provider:track:c' },
    ])
    expect(tail.failed).toEqual([{ itemId: 'i-missing', trackId: 'missing' }])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  // The identity bug in one assertion: the FIRST requested row is unresolvable, so
  // the row that actually starts playing is the second one — and the caller has to
  // be able to see that.
  it('reports the first PLAYABLE row when the requested head cannot resolve', async () => {
    fetchMock.mockImplementation(async (input: string) => {
      const id = new URL(input).searchParams.get('id')
      return id === 'a' ? response(false, undefined, 404) : response(true, `provider:track:${id}`)
    })

    const tail = await resolveTail([row('i-a', 'a'), row('i-b', 'b'), row('i-c', 'c')])

    expect(tail.resolved[0].itemId).toBe('i-b')
    expect(tail.resolved.map(r => r.uri)).toEqual(['provider:track:b', 'provider:track:c'])
  })

  it('resolves to an empty tail when nothing is playable', async () => {
    fetchMock.mockResolvedValue(response(false, undefined, 404))

    const tail = await resolveTail([row('i-a', 'a')])

    expect(tail.resolved).toEqual([])
    expect(tail.failed).toHaveLength(1)
  })
  // ARCH-playback-queue-atomic-replace: the 2026-10-07 ▶ fired 16 resolves at once
  // and 8 came back 503. Rows now carry the URI; reading it is the whole fix.
  describe('rows that carry their Spotify URI (the payload)', () => {
    const paid = (itemId: string, trackId: string) => ({ itemId, trackId, spotifyUri: `spotify:track:sp${trackId}` })

    it('sends no resolve at all, cold, and plays the payload URIs in order', async () => {
      fetchMock.mockResolvedValue(response(true, 'spotify:track:WRONG'))

      const tail = await resolveTail([paid('i-a', 'a'), paid('i-b', 'b')])

      expect(fetchMock).not.toHaveBeenCalled()
      expect(tail.resolved).toEqual([
        { itemId: 'i-a', trackId: 'a', uri: 'spotify:track:spa' },
        { itemId: 'i-b', trackId: 'b', uri: 'spotify:track:spb' },
      ])
      expect(tail.failed).toEqual([])
    })

    it('seeds the cache, so cache-only readers match the row and the idle prefetch skips it', async () => {
      await resolveTail([paid('i-a', 'a')])

      expect(cachedUri('a')).toBe('spotify:track:spa')
      await prefetchUris(['a'])
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('still resolves a row that arrived without one', async () => {
      fetchMock.mockResolvedValue(response(true, 'spotify:track:spc'))

      const tail = await resolveTail([paid('i-a', 'a'), row('i-c', 'c')])

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('id')).toBe('c')
      expect(tail.resolved.map(r => r.uri)).toEqual(['spotify:track:spa', 'spotify:track:spc'])
    })

    // A YouTube mapping is revocable and never arrives on the payload; a Spotify
    // URI must never answer a YouTube question.
    it('ignores the Spotify URI when resolving for YouTube', async () => {
      fetchMock.mockResolvedValue(response(true, 'youtube:video:abcdefghijk'))

      const tail = await resolveTail([paid('i-a', 'a')], 'youtube')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(tail.resolved.map(r => r.uri)).toEqual(['youtube:video:abcdefghijk'])
    })
  })
})

// OPS-project-stabilization Step 2A, real-device gate 2026-10-06: home entry makes two
// prefetch calls at once, and per-call concurrency let them fan out together against
// an account-wide Lambda concurrency of 10. The limit is the tab's, not the call's.
describe('prefetch concurrency', () => {
  it('keeps every concurrent prefetch call inside one tab-wide limit, and still resolves them all', async () => {
    let active = 0
    let peak = 0
    const pending: Array<() => void> = []
    fetchMock.mockImplementation((url: string) => {
      active++
      peak = Math.max(peak, active)
      const id = new URL(url, 'https://x').searchParams.get('id')
      return new Promise((resolve) => {
        pending.push(() => {
          active--
          resolve(response(true, `spotify:track:${id}`))
        })
      })
    })

    const a = prefetchUris(['a1', 'a2', 'a3', 'a4', 'a5', 'a6'])
    const b = prefetchUris(['b1', 'b2', 'b3', 'b4', 'b5', 'b6'])
    for (let i = 0; i < 12; i++) {
      await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0))
      expect(active).toBeLessThanOrEqual(PREFETCH_CONCURRENCY)
      pending.shift()!()
    }
    await Promise.all([a, b])

    expect(peak).toBe(PREFETCH_CONCURRENCY)
    expect(fetchMock).toHaveBeenCalledTimes(12)
    for (const id of ['a1', 'a6', 'b1', 'b6'])
      expect(cachedUri(id)).toBe(`spotify:track:${id}`)
  })

  // `resolveUri` never throws (a failure comes back as `transient`), so this is the
  // path a failed resolve really takes: it must still hand its slot on.
  it('a failed resolve hands its slot on', async () => {
    fetchMock.mockRejectedValue(new Error('network'))
    await prefetchUris(['x1', 'x2', 'x3', 'x4', 'x5'])
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(response(true, 'spotify:track:y'))
    await prefetchUris(['y'])
    expect(cachedUri('y')).toBe('spotify:track:y')
  })
})
