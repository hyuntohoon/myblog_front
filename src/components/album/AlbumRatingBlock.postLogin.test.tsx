// FIX-auth-identity-lifecycle Step 2 — the 평가 half of the post-login handoff.
//
// Separate from AlbumRatingBlock.test.tsx because that suite pins `isLoggedIn`
// to true at module scope, and the defect being fixed here lives entirely on the
// logged-out branch: the CTA used to hand off to Cognito with nothing parked, so
// coming back to the same page left the visitor looking at a closed overlay.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ loggedIn: false, goLogin: vi.fn() }))
const intent = vi.hoisted(() => ({ writePostLoginIntent: vi.fn() }))
const api = vi.hoisted(() => ({
	fetchAlbumReviews: vi.fn(),
	fetchMyAlbumStates: vi.fn(),
	fetchMyHandle: vi.fn(),
}))

vi.mock('@lib/auth', () => ({ isLoggedIn: () => auth.loggedIn, goLogin: auth.goLogin }))
vi.mock('@lib/postLoginIntent', () => ({ writePostLoginIntent: intent.writePostLoginIntent }))
vi.mock('@lib/owner', () => ({ isOwnerUser: () => Promise.resolve(false) }))
vi.mock('@lib/member', () => ({ isPlaceholderIdentity: () => false }))
vi.mock('@lib/entityEvents', () => ({ notifyAlbumStateChanged: vi.fn() }))
vi.mock('../member/ui', () => ({ Stars: () => <span data-testid="stars" /> }))
vi.mock('./HalfStarInput', () => ({ default: ({ value }: { value: number }) => <span data-testid="star-input" data-value={value} /> }))
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
	putMyAlbumState: vi.fn(),
	deleteMyReview: vi.fn(),
	putAlbumBestNew: vi.fn(),
}))

const { default: AlbumRatingBlock } = await import('./AlbumRatingBlock')

const ALBUM = 'album-1'
const MY_REVIEW = {
	id: 'rating-1',
	album_id: ALBUM,
	rating: 4.5,
	comment: 'mine',
	created_at: '2026-08-01T00:00:00Z',
	author: { handle: 'park', display_name: 'Park' },
}

beforeEach(() => {
	auth.loggedIn = false
	auth.goLogin.mockReset()
	intent.writePostLoginIntent.mockReset()
	api.fetchAlbumReviews.mockResolvedValue({ average: null, count: 0, best_new: false, reviews: [] })
	api.fetchMyAlbumStates.mockResolvedValue([])
	api.fetchMyHandle.mockResolvedValue(null)
})

describe('logged-out CTA', () => {
	it('parks a rate-album intent with the album display identity before handing off', async () => {
		render(<AlbumRatingBlock albumId={ALBUM} display={{ title: 'Kid A', artist: 'Radiohead', cover: 'c.jpg', year: 2000 }} />)

		fireEvent.click(await screen.findByRole('button', { name: '로그인하고 평가 남기기' }))

		expect(intent.writePostLoginIntent).toHaveBeenCalledWith({
			kind: 'rate-album',
			albumId: ALBUM,
			title: 'Kid A',
			artist: 'Radiohead',
			cover: 'c.jpg',
			year: 2000,
		})
		expect(auth.goLogin).toHaveBeenCalledWith(true)
	})

	it('parks something usable even with no display identity to hand it', async () => {
		render(<AlbumRatingBlock albumId={ALBUM} />)

		fireEvent.click(await screen.findByRole('button', { name: '로그인하고 평가 남기기' }))

		expect(intent.writePostLoginIntent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'rate-album', albumId: ALBUM, artist: null, cover: null, year: null }))
	})
})

describe('openRating resume', () => {
	it('opens the editor seeded with the 평가 the member already has, not the default', async () => {
		auth.loggedIn = true
		api.fetchAlbumReviews.mockResolvedValue({ average: 4.5, count: 1, best_new: false, reviews: [MY_REVIEW] })
		api.fetchMyHandle.mockResolvedValue('park')
		api.fetchMyAlbumStates.mockResolvedValue([{ album_id: ALBUM, rating: 4.5, comment: 'mine', review_candidate: false }])

		render(<AlbumRatingBlock albumId={ALBUM} openRating />)

		// The gate that matters: opening on mount would seed 4 and blank the
		// comment, quietly overwriting the member's own 평가 on save.
		await waitFor(() => expect(screen.getByTestId('star-input')).toHaveAttribute('data-value', '4.5'))
		expect(screen.getByRole('textbox')).toHaveValue('mine')
	})

	it('opens an empty editor for an album the member has not rated', async () => {
		auth.loggedIn = true

		render(<AlbumRatingBlock albumId={ALBUM} openRating />)

		await waitFor(() => expect(screen.getByTestId('star-input')).toHaveAttribute('data-value', '4'))
		expect(screen.getByRole('textbox')).toHaveValue('')
	})

	it('leaves the editor closed without the flag', async () => {
		auth.loggedIn = true

		render(<AlbumRatingBlock albumId={ALBUM} />)

		expect(await screen.findByRole('button', { name: '평가 남기기' })).toBeInTheDocument()
		expect(screen.queryByTestId('star-input')).toBeNull()
	})

	it('does not reopen an editor the member closed when auth re-settles under it', async () => {
		// The deps array alone does not cover this: `authed` is read at render, so
		// a sign-in completing in ANOTHER tab while this overlay sits open flips
		// it and re-fires the effect. Only the once-per-album ref keeps 취소 from
		// being undone by a background event the member never saw.
		auth.loggedIn = true
		const view = render(<AlbumRatingBlock albumId={ALBUM} openRating display={{ title: 'Kid A' }} />)
		await screen.findByTestId('star-input')

		fireEvent.click(screen.getByRole('button', { name: '취소' }))
		await waitFor(() => expect(screen.queryByTestId('star-input')).toBeNull())

		auth.loggedIn = false
		view.rerender(<AlbumRatingBlock albumId={ALBUM} openRating display={{ title: 'Kid A (rerender)' }} />)
		auth.loggedIn = true
		view.rerender(<AlbumRatingBlock albumId={ALBUM} openRating display={{ title: 'Kid A' }} />)

		await waitFor(() => expect(screen.getByRole('button', { name: '평가 남기기' })).toBeInTheDocument())
		expect(screen.queryByTestId('star-input')).toBeNull()
	})

	it('does not reopen an editor the member closed', async () => {
		auth.loggedIn = true

		render(<AlbumRatingBlock albumId={ALBUM} openRating />)
		await screen.findByTestId('star-input')

		fireEvent.click(screen.getByRole('button', { name: '취소' }))

		await waitFor(() => expect(screen.queryByTestId('star-input')).toBeNull())
		expect(screen.getByRole('button', { name: '평가 남기기' })).toBeInTheDocument()
	})
})
