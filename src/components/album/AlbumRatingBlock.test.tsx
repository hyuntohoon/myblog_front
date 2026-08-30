import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
	fetchAlbumReviews: vi.fn(),
	fetchMyAlbumStates: vi.fn(),
	fetchMyHandle: vi.fn(),
	putMyAlbumState: vi.fn(),
	deleteMyReview: vi.fn(),
	notifyAlbumStateChanged: vi.fn(),
}))

vi.mock('@lib/auth', () => ({ isLoggedIn: () => true, goLogin: vi.fn() }))
vi.mock('@lib/owner', () => ({ isOwnerUser: () => Promise.resolve(false) }))
vi.mock('@lib/member', () => ({ isPlaceholderIdentity: () => false }))
vi.mock('@lib/entityEvents', () => ({ notifyAlbumStateChanged: api.notifyAlbumStateChanged }))
vi.mock('../member/ui', () => ({ Stars: () => <span data-testid="stars" /> }))
vi.mock('./HalfStarInput', () => ({ default: () => <span data-testid="star-input" /> }))
vi.mock('./reratings.api', () => ({
	fetchMyReratings: () => Promise.resolve([]),
	startRerating: vi.fn(),
	cancelRerating: vi.fn(),
}))
vi.mock('./reviews.api', () => ({
	RATING_COMMENT_MAX: 60,
	RatingRateLimitError: class RatingRateLimitError extends Error {},
	fetchAlbumReviews: api.fetchAlbumReviews,
	fetchMyAlbumStates: api.fetchMyAlbumStates,
	fetchMyHandle: api.fetchMyHandle,
	putMyAlbumState: api.putMyAlbumState,
	deleteMyReview: api.deleteMyReview,
	putAlbumBestNew: vi.fn(),
}))

const { default: AlbumRatingBlock } = await import('./AlbumRatingBlock')

const ALBUM = 'album-1'
const REVIEW = {
	id: 'rating-1',
	album_id: ALBUM,
	rating: 4,
	comment: 'before',
	created_at: '2026-08-01T00:00:00Z',
	author: { handle: 'park', display_name: 'Park' },
}
const STATE = { album_id: ALBUM, rating: 4, comment: 'before', review_candidate: true }

function aggregate(reviews = [REVIEW]) {
	return { average: reviews.length ? 4 : null, count: reviews.length, best_new: false, reviews }
}

async function mountWithExistingRating() {
	api.fetchAlbumReviews.mockResolvedValue(aggregate())
	api.fetchMyAlbumStates.mockResolvedValue([STATE])
	api.fetchMyHandle.mockResolvedValue('park')
	render(<AlbumRatingBlock albumId={ALBUM} />)
	await screen.findByRole('button', { name: '수정' })
}

beforeEach(() => {
	vi.clearAllMocks()
	api.fetchAlbumReviews.mockResolvedValue(aggregate([]))
	api.fetchMyAlbumStates.mockResolvedValue([])
	api.fetchMyHandle.mockResolvedValue('park')
})

describe('albumRatingBlock confirmed mutations', () => {
	it('keeps the editor open, shows an error, and emits no event when delete fails', async () => {
		api.deleteMyReview.mockRejectedValue(new Error('failed'))
		await mountWithExistingRating()

		fireEvent.click(screen.getByRole('button', { name: '삭제' }))

		expect(await screen.findByText('삭제에 실패했습니다. 다시 시도해 주세요.')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: '수정' })).toBeInTheDocument()
		expect(api.notifyAlbumStateChanged).not.toHaveBeenCalled()
	})

	it('emits the stored rating only after save succeeds', async () => {
		api.putMyAlbumState.mockResolvedValue({ ...STATE, rating: 4.5, comment: null })
		render(<AlbumRatingBlock albumId={ALBUM} />)

		fireEvent.click(await screen.findByRole('button', { name: '평가 남기기' }))
		fireEvent.click(screen.getByRole('button', { name: '저장' }))

		await waitFor(() => expect(api.notifyAlbumStateChanged).toHaveBeenCalledWith({
			albumId: ALBUM,
			reviewCandidate: true,
			rating: 4.5,
		}))
	})

	it('emits rating null only after delete succeeds', async () => {
		api.deleteMyReview.mockResolvedValue(true)
		api.fetchAlbumReviews.mockResolvedValueOnce(aggregate()).mockResolvedValueOnce(aggregate([]))
		api.fetchMyAlbumStates.mockResolvedValue([STATE])
		api.fetchMyHandle.mockResolvedValue('park')
		render(<AlbumRatingBlock albumId={ALBUM} />)

		fireEvent.click(await screen.findByRole('button', { name: '삭제' }))

		await waitFor(() => expect(api.notifyAlbumStateChanged).toHaveBeenCalledWith({
			albumId: ALBUM,
			rating: null,
		}))
	})
})
