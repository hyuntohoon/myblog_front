// FEAT-youtube-playback-provider Step A4 — the provider dimension of the memo.
//
// Kept in its own file rather than folded into uris.test.ts on purpose: that
// suite is the SPOTIFY regression proof, and it must keep passing byte-for-byte
// unchanged. A file that grew new YouTube cases would make "the incumbent suite
// is untouched" impossible to see at a glance.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetUriCache, cachedUri, invalidateUri, resolveUri, resolveUriDetailed } from './uris'

vi.mock('@lib/auth', () => ({ getAuthHeader: vi.fn(() => ({ Authorization: 'Bearer test' })) }))

const fetchMock = vi.fn()

function ok(uri: string | null) {
  return { ok: true, status: 200, json: vi.fn(async () => ({ uri })) }
}
function status(code: number) {
  return { ok: false, status: code, json: vi.fn(async () => ({})) }
}

beforeEach(() => {
  __resetUriCache()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('the request shape', () => {
  it('omits `provider` entirely for spotify', async () => {
    // The parameter is additive and defaults server-side. Keeping the shipped
    // call byte-identical is what makes this change unable to affect the
    // incumbent — a `provider=spotify` would be a new request shape for every
    // existing caller.
    fetchMock.mockResolvedValue(ok('spotify:track:a'))
    await resolveUri('a')
    expect(fetchMock.mock.calls[0][0]).not.toContain('provider=')
  })

  it('sends `provider=youtube` when asked', async () => {
    fetchMock.mockResolvedValue(ok('youtube:video:v'))
    await resolveUri('a', 'youtube')
    expect(fetchMock.mock.calls[0][0]).toContain('provider=youtube')
  })
})

describe('the cache is provider-keyed', () => {
  it('a spotify hit does not answer a youtube question', async () => {
    // THE defect a single-provider key would produce, and the one the module's
    // original "ids are immutable" comment implicitly ruled out on a premise
    // that no longer holds.
    fetchMock.mockResolvedValueOnce(ok('spotify:track:a'))
    await expect(resolveUri('a')).resolves.toBe('spotify:track:a')

    fetchMock.mockResolvedValueOnce(ok('youtube:video:v'))
    await expect(resolveUri('a', 'youtube')).resolves.toBe('youtube:video:v')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(cachedUri('a', 'spotify')).toBe('spotify:track:a')
    expect(cachedUri('a', 'youtube')).toBe('youtube:video:v')
  })

  it('a youtube MISS does not become a spotify miss', async () => {
    fetchMock.mockResolvedValueOnce(status(404))
    await expect(resolveUri('a', 'youtube')).resolves.toBeNull()

    fetchMock.mockResolvedValueOnce(ok('spotify:track:a'))
    await expect(resolveUri('a')).resolves.toBe('spotify:track:a')
  })
})

describe('410 Gone is reported and never remembered', () => {
  it('is its own outcome, distinct from unmapped', async () => {
    fetchMock.mockResolvedValue(status(410))
    await expect(resolveUriDetailed('a', 'youtube')).resolves.toEqual({ kind: 'gone' })
  })

  it('404 stays `unmapped` — the control', async () => {
    // Without this, mapping BOTH to 'gone' would pass the test above, and the
    // UI would offer "pick another video" for a track that was never mapped.
    fetchMock.mockResolvedValue(status(404))
    await expect(resolveUriDetailed('a', 'youtube')).resolves.toEqual({ kind: 'unmapped' })
  })

  it('is re-asked on the next call, unlike a 404', async () => {
    // The load-bearing half. A 'gone' row is revocable — the A5 refresh job or a
    // member re-pick can clear it at any moment — so remembering it would make a
    // FIXED mapping look permanently broken for the rest of the tab.
    fetchMock.mockResolvedValue(status(410))
    await resolveUriDetailed('a', 'youtube')
    await resolveUriDetailed('a', 'youtube')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fetchMock.mockReset()
    fetchMock.mockResolvedValue(status(404))
    await resolveUriDetailed('b', 'youtube')
    await resolveUriDetailed('b', 'youtube')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('youtube entries expire, spotify entries do not', () => {
  it('a youtube hit is re-resolved after the TTL', async () => {
    // A tab left open overnight must not serve a mapping the A5 retention sweep
    // has since DELETED. The TTL sits well under the 30-day window.
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(ok('youtube:video:v'))

    await resolveUri('a', 'youtube')
    vi.advanceTimersByTime(29 * 60 * 1000)
    await resolveUri('a', 'youtube')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(2 * 60 * 1000)
    await resolveUri('a', 'youtube')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a spotify hit is NOT aged — the control', async () => {
    // Its premise is still true: `tracks.spotify_id` is NOT NULL and UNIQUE.
    // Ageing it would add requests for nothing, and a test that only showed
    // youtube expiring could not tell "TTL applied to youtube" from "TTL applied
    // to everything".
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(ok('spotify:track:a'))

    await resolveUri('a')
    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    await resolveUri('a')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a youtube durable MISS expires too', async () => {
    // A 404 means "never mapped" — which stops being true the moment a member
    // maps it. Under an unbounded miss the freshly mapped track would stay
    // unplayable for the rest of the tab.
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(status(404))

    await resolveUri('a', 'youtube')
    vi.advanceTimersByTime(31 * 60 * 1000)
    await resolveUri('a', 'youtube')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('invalidateUri', () => {
  it('forgets one entry so a re-pick takes effect immediately', async () => {
    // The case the TTL cannot cover: after A3's confirm, the old value is wrong
    // the instant the write lands, and waiting up to the TTL would make the fix
    // look like it did not take.
    fetchMock.mockResolvedValueOnce(ok('youtube:video:old'))
    await expect(resolveUri('a', 'youtube')).resolves.toBe('youtube:video:old')

    invalidateUri('a')

    fetchMock.mockResolvedValueOnce(ok('youtube:video:new'))
    await expect(resolveUri('a', 'youtube')).resolves.toBe('youtube:video:new')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('leaves the other provider alone', async () => {
    fetchMock.mockResolvedValueOnce(ok('spotify:track:a'))
    await resolveUri('a')
    fetchMock.mockResolvedValueOnce(ok('youtube:video:v'))
    await resolveUri('a', 'youtube')

    invalidateUri('a', 'youtube')

    expect(cachedUri('a', 'spotify')).toBe('spotify:track:a')
    expect(cachedUri('a', 'youtube')).toBeUndefined()
  })
})
