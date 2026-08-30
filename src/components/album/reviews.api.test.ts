import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetch = vi.fn()
vi.mock('@lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }))

const { deleteMyReview, putMyAlbumState, RatingRateLimitError } = await import('./reviews.api')

const ALBUM = '11111111-2222-3333-4444-555555555555'
const STATE = { album_id: ALBUM, rating: 4.5, comment: 'great', review_candidate: false }

describe('putMyAlbumState', () => {
	beforeEach(() => apiFetch.mockReset())

	it('returns the confirmed state from a 200 response', async () => {
		apiFetch.mockResolvedValue({ status: 200, ok: true, json: async () => STATE })
		await expect(putMyAlbumState(ALBUM, { rating: 4.5 })).resolves.toEqual(STATE)
	})

	it('reserves null for a successful 204 with no state left', async () => {
		apiFetch.mockResolvedValue({ status: 204, ok: true })
		await expect(putMyAlbumState(ALBUM, { review_candidate: false })).resolves.toBeNull()
	})

	it('throws on a non-ok response', async () => {
		apiFetch.mockResolvedValue({ status: 500, ok: false })
		await expect(putMyAlbumState(ALBUM, { rating: 4.5 })).rejects.toThrow('Album state update failed')
	})

	it('throws on apiFetch transport-null', async () => {
		apiFetch.mockResolvedValue(null)
		await expect(putMyAlbumState(ALBUM, { rating: 4.5 })).rejects.toThrow('Album state update failed')
	})

	it('preserves the distinct 429 error', async () => {
		apiFetch.mockResolvedValue({ status: 429, ok: false })
		await expect(putMyAlbumState(ALBUM, { rating: 4.5 })).rejects.toBeInstanceOf(RatingRateLimitError)
	})
})

describe('deleteMyReview', () => {
	beforeEach(() => apiFetch.mockReset())

	it('returns true only for a confirmed 204', async () => {
		apiFetch.mockResolvedValue({ status: 204, ok: true })
		await expect(deleteMyReview(ALBUM)).resolves.toBe(true)
	})

	it.each([
		['500 response', { status: 500, ok: false }],
		['non-204 success', { status: 200, ok: true }],
		['apiFetch transport-null', null],
	])('throws on %s', async (_label, response) => {
		apiFetch.mockResolvedValue(response)
		await expect(deleteMyReview(ALBUM)).rejects.toThrow('Album rating delete failed')
	})
})
