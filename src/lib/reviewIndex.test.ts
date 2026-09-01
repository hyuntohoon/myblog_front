// FIX-user-flow-state-consistency leg 3 — the review index's failure behaviour.
//
// The defect this pins: `loadReviews()` resolved `[]` on any failure and left
// the settled promise parked in its `inflight` memo. `cache` was never filled,
// so the memo was never replaced either — one transient failure pinned the
// 평론 facet of both search surfaces empty, silently, for the rest of the page's
// life. The success path is the control: it must still fetch exactly once.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReviewHit } from './reviewIndex'
import { loadReviews, resetReviewIndex } from './reviewIndex'

const INDEX: ReviewHit[] = [{
  slug: 'kind-of-blue',
  album: 'Kind of Blue',
  artist: 'Miles Davis',
  genres: ['jazz'],
  year: 1959,
  rating: 10,
  bestNew: false,
  cover: null,
  excerpt: '',
  body: '',
  albumId: null,
}]

function okOnce() {
  return { ok: true, status: 200, json: async () => INDEX } as unknown as Response
}

beforeEach(() => {
  resetReviewIndex()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('loadReviews', () => {
  it('fetches the index once and serves later calls from cache', async () => {
    const f = vi.fn(async () => okOnce())
    vi.stubGlobal('fetch', f)

    await expect(loadReviews()).resolves.toEqual(INDEX)
    await expect(loadReviews()).resolves.toEqual(INDEX)

    expect(f).toHaveBeenCalledTimes(1)
  })

  it('rejects a non-2xx index instead of passing it off as an empty one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 } as unknown as Response)))

    await expect(loadReviews()).rejects.toThrow('HTTP 503')
  })

  it('reconnects after a non-2xx: the next call goes back to the network', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 } as unknown as Response)
      .mockResolvedValueOnce(okOnce())
    vi.stubGlobal('fetch', f)

    await expect(loadReviews()).rejects.toThrow('HTTP 503')
    await expect(loadReviews()).resolves.toEqual(INDEX)

    expect(f).toHaveBeenCalledTimes(2)
  })

  it('reconnects after a transport failure', async () => {
    const f = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(okOnce())
    vi.stubGlobal('fetch', f)

    await expect(loadReviews()).rejects.toThrow('Failed to fetch')
    await expect(loadReviews()).resolves.toEqual(INDEX)

    expect(f).toHaveBeenCalledTimes(2)
  })
})
