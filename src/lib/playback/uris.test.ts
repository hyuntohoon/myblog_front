import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetUriCache, cachedUri, resolveTail, resolveUri } from './uris'

vi.mock('@lib/auth', () => ({ getAuthHeader: vi.fn(() => ({ Authorization: 'Bearer test' })) }))

const fetchMock = vi.fn()

function response(ok: boolean, uri?: string | null) {
  return { ok, json: vi.fn(async () => ({ uri })) }
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

  it('remembers an unresolvable miss', async () => {
    fetchMock.mockResolvedValue(response(false))

    await expect(resolveUri('missing')).resolves.toBeNull()
    await expect(resolveUri('missing')).resolves.toBeNull()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(cachedUri('missing')).toBeNull()
  })
})

describe('resolveTail', () => {
  it('preserves order while dropping unresolvable rows', async () => {
    fetchMock.mockImplementation(async (input: string) => {
      const id = new URL(input).searchParams.get('id')
      return id === 'missing' ? response(false) : response(true, `provider:track:${id}`)
    })

    await expect(resolveTail(['a', 'missing', 'c'])).resolves.toEqual([
      'provider:track:a',
      'provider:track:c',
    ])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
