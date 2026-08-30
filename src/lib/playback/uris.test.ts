import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetUriCache, cachedUri, resolveTail, resolveUri } from './uris'

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
})
