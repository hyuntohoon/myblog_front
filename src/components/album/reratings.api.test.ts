// FEAT-album-rerating — the client's status mapping.
//
// The 409 branch is the one worth pinning: it is not a failure, it is the single
// refusal a member can act on ("아직 평가하지 않은 앨범입니다"), and BOTH surfaces
// that can start a 재평가 — the 수정 panel and the 다시 들어볼 앨범 drop target —
// print a different message for it. Collapsing it into a generic error would tell
// someone to retry an action that can never succeed.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetch = vi.fn()
vi.mock('@lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }))

const { cancelRerating, fetchMyReratings, startRerating } = await import('./reratings.api')

const ALBUM = '11111111-2222-3333-4444-555555555555'

describe('startRerating', () => {
  beforeEach(() => apiFetch.mockReset())

  it('204 is ok', async () => {
    apiFetch.mockResolvedValue({ status: 204, ok: true })
    expect(await startRerating(ALBUM)).toBe('ok')
  })

  it('409 is a conflict, distinct from an error', async () => {
    apiFetch.mockResolvedValue({ status: 409, ok: false })
    expect(await startRerating(ALBUM)).toBe('conflict')
  })

  it('anything else is an error', async () => {
    apiFetch.mockResolvedValue({ status: 500, ok: false })
    expect(await startRerating(ALBUM)).toBe('error')
  })

  it('a null response (logged out / transport failure) is an error, never a conflict', async () => {
    apiFetch.mockResolvedValue(null)
    expect(await startRerating(ALBUM)).toBe('error')
  })

  it('uses PUT — matching the planned-ratings mark, not a POST', async () => {
    apiFetch.mockResolvedValue({ status: 204, ok: true })
    await startRerating(ALBUM)
    expect(apiFetch.mock.calls[0][1]).toEqual({ method: 'PUT' })
    expect(String(apiFetch.mock.calls[0][0])).toContain(`/api/me/reratings/${ALBUM}`)
  })
})

describe('cancelRerating', () => {
  beforeEach(() => apiFetch.mockReset())

  it('is true only on 204', async () => {
    apiFetch.mockResolvedValue({ status: 204, ok: true })
    expect(await cancelRerating(ALBUM)).toBe(true)
    apiFetch.mockResolvedValue({ status: 500, ok: false })
    expect(await cancelRerating(ALBUM)).toBe(false)
  })
})

describe('fetchMyReratings', () => {
  beforeEach(() => apiFetch.mockReset())

  it('yields [] when logged out rather than throwing', async () => {
    apiFetch.mockResolvedValue(null)
    expect(await fetchMyReratings()).toEqual([])
  })

  it('tolerates a body with no reratings key', async () => {
    apiFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
    expect(await fetchMyReratings()).toEqual([])
  })

  it('returns the rows, withdrawn score included', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ reratings: [{ album_id: ALBUM, album_title: 'Indigo', previous_rating: 3.5, created_at: '2026-08-17T00:00:00Z' }] }),
    })
    const rows = await fetchMyReratings()
    expect(rows).toHaveLength(1)
    expect(rows[0].previous_rating).toBe(3.5)
  })
})
