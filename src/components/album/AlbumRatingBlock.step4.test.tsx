// FEAT-album-review-authoring Step 4 — the 평론 후보 mark (C6 / OQ14).
//
// Two changes, and the reason each needs a test rather than a reading:
//
//  1. OWNER-ONLY. The mark shipped visible to every signed-in account. Marking
//     an album "평론 쓸 것" is meaningless for someone 하드 룰 1 forbids from
//     writing a 평론, and C1 says do not render what they cannot act on. The
//     sibling file already mounts this component as a MEMBER, so the member half
//     is asserted there by absence; here the owner half is asserted by presence,
//     because a gate that hides it from everyone would also pass that file.
//
//  2. It rides the 평가 write (OQ14 — "put it in the entry"). The dangerous half
//     is the one that must NOT happen: `myState` arrives from an authed read that
//     can lag, so an untouched checkbox must leave `review_candidate` OUT of the
//     PUT entirely. Sending `false` there would silently unmark an album whose
//     mark had not loaded yet.
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
const owner = vi.hoisted(() => ({ isOwnerUser: vi.fn() }))

vi.mock('@lib/auth', () => ({ isLoggedIn: () => true, goLogin: vi.fn() }))
vi.mock('@lib/owner', () => owner)
vi.mock('@lib/member', () => ({ isPlaceholderIdentity: () => false }))
vi.mock('@lib/postLoginIntent', () => ({ writePostLoginIntent: vi.fn() }))
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
const MARK_BUTTON = /평론 쓸 것/
const MARK_CHECKBOX = '나중에 평론으로 쓴다'

function aggregate(reviews: unknown[] = []) {
	return { average: null, count: reviews.length, best_new: false, reviews }
}

/** Mount with NO existing 평가 and a stored mark, as `isOwner`. */
async function mount(isOwner: boolean, { marked = true } = {}) {
	owner.isOwnerUser.mockResolvedValue(isOwner)
	api.fetchAlbumReviews.mockResolvedValue(aggregate())
	api.fetchMyAlbumStates.mockResolvedValue([{ album_id: ALBUM, rating: null, comment: null, review_candidate: marked }])
	api.fetchMyHandle.mockResolvedValue('park')
	render(<AlbumRatingBlock albumId={ALBUM} />)
	await screen.findByRole('button', { name: '평가 남기기' })
}

beforeEach(() => {
	vi.clearAllMocks()
	api.putMyAlbumState.mockResolvedValue({ album_id: ALBUM, rating: 4, comment: null, review_candidate: true })
})

describe('the 평론 후보 mark is owner-only', () => {
	it('shows the standalone toggle to the owner', async () => {
		await mount(true)
		expect(await screen.findByRole('button', { name: MARK_BUTTON })).toBeTruthy()
	})

	it('never shows it to a member', async () => {
		await mount(false)
		// Wait for the owner probe to settle before concluding "absent" — an
		// assertion that runs first would pass against a component that shows it.
		await waitFor(() => expect(owner.isOwnerUser).toHaveBeenCalled())
		expect(screen.queryByRole('button', { name: MARK_BUTTON })).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: '평가 남기기' }))
		expect(screen.queryByLabelText(MARK_CHECKBOX)).toBeNull()
		expect(screen.queryByText(MARK_CHECKBOX)).toBeNull()
	})

	it('moves the mark INTO the editor while editing, so there is only ever one control', async () => {
		await mount(true)
		await screen.findByRole('button', { name: MARK_BUTTON })
		fireEvent.click(screen.getByRole('button', { name: '평가 남기기' }))
		expect(await screen.findByText(MARK_CHECKBOX)).toBeTruthy()
		expect(screen.queryByRole('button', { name: MARK_BUTTON })).toBeNull()
	})

	it('seeds the checkbox from the stored mark', async () => {
		await mount(true, { marked: true })
		await screen.findByRole('button', { name: MARK_BUTTON })
		fireEvent.click(screen.getByRole('button', { name: '평가 남기기' }))
		const box = (await screen.findByText(MARK_CHECKBOX)).closest('label')?.querySelector('input')
		expect(box?.checked).toBe(true)
	})
})

describe('saving a 평가 and the mark together', () => {
	async function openEditor() {
		await mount(true, { marked: true })
		await screen.findByRole('button', { name: MARK_BUTTON })
		fireEvent.click(screen.getByRole('button', { name: '평가 남기기' }))
		await screen.findByText(MARK_CHECKBOX)
	}

	it('omits review_candidate entirely when the author did not touch it', async () => {
		await openEditor()
		fireEvent.click(screen.getByRole('button', { name: '저장' }))
		await waitFor(() => expect(api.putMyAlbumState).toHaveBeenCalled())
		const [, changes] = api.putMyAlbumState.mock.calls[0]
		// Not `false`, not `true` — ABSENT. The PUT is partial, and a key that is
		// present is a key that overwrites.
		expect('review_candidate' in changes).toBe(false)
	})

	it('carries the mark when the author unticks it', async () => {
		await openEditor()
		const box = screen.getByText(MARK_CHECKBOX).closest('label')?.querySelector('input') as HTMLInputElement
		fireEvent.click(box)
		fireEvent.click(screen.getByRole('button', { name: '저장' }))
		await waitFor(() => expect(api.putMyAlbumState).toHaveBeenCalled())
		const [, changes] = api.putMyAlbumState.mock.calls[0]
		expect(changes.review_candidate).toBe(false)
	})

	it('carries the mark when the author ticks it on an unmarked album', async () => {
		await mount(true, { marked: false })
		await screen.findByRole('button', { name: MARK_BUTTON })
		fireEvent.click(screen.getByRole('button', { name: '평가 남기기' }))
		const box = (await screen.findByText(MARK_CHECKBOX)).closest('label')?.querySelector('input') as HTMLInputElement
		expect(box.checked).toBe(false)
		fireEvent.click(box)
		fireEvent.click(screen.getByRole('button', { name: '저장' }))
		await waitFor(() => expect(api.putMyAlbumState).toHaveBeenCalled())
		const [, changes] = api.putMyAlbumState.mock.calls[0]
		expect(changes.review_candidate).toBe(true)
	})

	it('forgets a touch when the editor is reopened', async () => {
		await openEditor()
		const box = screen.getByText(MARK_CHECKBOX).closest('label')?.querySelector('input') as HTMLInputElement
		fireEvent.click(box)
		fireEvent.click(screen.getByRole('button', { name: '취소' }))
		fireEvent.click(await screen.findByRole('button', { name: '평가 남기기' }))
		fireEvent.click(await screen.findByRole('button', { name: '저장' }))
		await waitFor(() => expect(api.putMyAlbumState).toHaveBeenCalled())
		const [, changes] = api.putMyAlbumState.mock.calls[0]
		expect('review_candidate' in changes).toBe(false)
	})
})
