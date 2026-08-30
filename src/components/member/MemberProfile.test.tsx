import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
	fetchMemberProfile: vi.fn(),
	fetchMemberNowPlaying: vi.fn(),
	fetchMyReratings: vi.fn(),
	cancelRerating: vi.fn(),
	getMe: vi.fn(),
}))

vi.mock('@lib/auth', () => ({ isLoggedIn: () => true }))
vi.mock('./me.api', () => ({ getMe: api.getMe }))
vi.mock('../album/reviews.api', () => ({
	RATING_COMMENT_MAX: 60,
	RatingRateLimitError: class RatingRateLimitError extends Error {},
	fetchMemberProfile: api.fetchMemberProfile,
	fetchMemberNowPlaying: api.fetchMemberNowPlaying,
	putMyAlbumState: vi.fn(),
}))
vi.mock('../album/reratings.api', () => ({
	fetchMyReratings: api.fetchMyReratings,
	startRerating: vi.fn(),
	cancelRerating: api.cancelRerating,
}))

const { ENT_ALBUM_STATE_CHANGED } = await import('@lib/entityEvents')
const { default: MemberProfile } = await import('./MemberProfile')

const HANDLE = 'park'
const RATING = {
	id: 'rating-1',
	album_id: 'album-1',
	album_title: 'Kind of Blue',
	album_cover_url: null,
	artist_id: null,
	artist_name: 'Miles Davis',
	rating: 4.5,
	comment: null,
	created_at: '2026-08-01T00:00:00Z',
}
const PROFILE_WITH_RATING = {
	handle: HANDLE,
	display_name: 'Park',
	avatar_url: null,
	review_count: 1,
	reviews: [RATING],
	reratings: [],
}
const PROFILE_WITHOUT_RATING = {
	...PROFILE_WITH_RATING,
	review_count: 0,
	reviews: [],
}
const PROFILE_RERATING = {
	...PROFILE_WITHOUT_RATING,
	reratings: [{
		album_id: 'album-1',
		album_title: 'Kind of Blue',
		album_cover_url: null,
		artist_id: null,
		artist_name: 'Miles Davis',
		created_at: '2026-08-20T00:00:00Z',
	}],
}

beforeEach(() => {
	vi.clearAllMocks()
	api.fetchMemberNowPlaying.mockResolvedValue(null)
	api.fetchMyReratings.mockResolvedValue([])
	api.cancelRerating.mockResolvedValue(false)
	api.getMe.mockResolvedValue({ handle: HANDLE })
})

describe('memberProfile album-state synchronization', () => {
	it('refetches the self profile when an external event clears a rating', async () => {
		api.fetchMemberProfile
			.mockResolvedValueOnce(PROFILE_WITH_RATING)
			.mockResolvedValueOnce(PROFILE_WITHOUT_RATING)
		render(<MemberProfile handle={HANDLE} />)

		await waitFor(() => expect(screen.getByText((_text, node) =>
			node?.classList.contains('mono') === true && node.textContent?.includes('1개 평가') === true,
		)).toBeInTheDocument())
		await screen.findByRole('navigation', { name: '내 대시보드' })

		window.dispatchEvent(new CustomEvent(ENT_ALBUM_STATE_CHANGED, {
			detail: { albumId: 'album-1', rating: null },
		}))

		await waitFor(() => expect(api.fetchMemberProfile).toHaveBeenCalledTimes(2))
		await waitFor(() => expect(screen.getByText((_text, node) =>
			node?.classList.contains('mono') === true && node.textContent?.includes('0개 평가') === true,
		)).toBeInTheDocument())
	})

	it('drops an older profile refetch that resolves after a newer event', async () => {
		let resolveOlder!: (value: typeof PROFILE_WITH_RATING) => void
		let resolveNewer!: (value: typeof PROFILE_WITHOUT_RATING) => void
		api.fetchMemberProfile
			.mockResolvedValueOnce(PROFILE_WITH_RATING)
			.mockImplementationOnce(() => new Promise((resolve) => { resolveOlder = resolve }))
			.mockImplementationOnce(() => new Promise((resolve) => { resolveNewer = resolve }))
		render(<MemberProfile handle={HANDLE} />)

		await screen.findByRole('navigation', { name: '내 대시보드' })
		window.dispatchEvent(new CustomEvent(ENT_ALBUM_STATE_CHANGED, {
			detail: { albumId: 'album-1', rating: 4 },
		}))
		window.dispatchEvent(new CustomEvent(ENT_ALBUM_STATE_CHANGED, {
			detail: { albumId: 'album-1', rating: null },
		}))
		await waitFor(() => expect(api.fetchMemberProfile).toHaveBeenCalledTimes(3))

		resolveNewer(PROFILE_WITHOUT_RATING)
		await waitFor(() => expect(screen.getByText((_text, node) =>
			node?.classList.contains('mono') === true && node.textContent?.includes('0개 평가') === true,
		)).toBeInTheDocument())
		resolveOlder(PROFILE_WITH_RATING)
		await Promise.resolve()

		expect(screen.getByText((_text, node) =>
			node?.classList.contains('mono') === true && node.textContent?.includes('0개 평가') === true,
		)).toBeInTheDocument()
	})

	it('forwards a confirmed cancel immediately and offers retry when the profile read fails', async () => {
		let resolveRetry!: (value: typeof PROFILE_WITH_RATING) => void
		api.fetchMemberProfile
			.mockResolvedValueOnce(PROFILE_RERATING)
			.mockResolvedValueOnce(null)
			.mockImplementationOnce(() => new Promise((resolve) => { resolveRetry = resolve }))
		api.fetchMyReratings.mockResolvedValue([{
			album_id: 'album-1',
			album_title: 'Kind of Blue',
			previous_rating: 4.5,
			created_at: '2026-08-20T00:00:00Z',
		}])
		api.cancelRerating.mockResolvedValue(true)
		const events: Array<{ albumId: string, rating: number | null }> = []
		const capture = (event: Event) => events.push((event as CustomEvent).detail)
		window.addEventListener(ENT_ALBUM_STATE_CHANGED, capture)

		try {
			render(<MemberProfile handle={HANDLE} />)
			await screen.findByRole('navigation', { name: '내 대시보드' })
			await screen.findByText('이전 4.5')

			fireEvent.click(screen.getByRole('button', { name: '재평가 취소' }))

			expect(await screen.findByRole('alert')).toHaveTextContent('재평가 취소는 완료됐지만 평가 목록을 확인하지 못했습니다.')
			expect(screen.getByRole('button', { name: '다시 확인' })).toBeInTheDocument()
			expect(screen.queryByText('Kind of Blue')).not.toBeInTheDocument()
			expect(events).toEqual([{ albumId: 'album-1', rating: 4.5 }])
			// One initial read plus one confirmation read: the locally forwarded
			// event is suppressed in this root instead of triggering a third fetch.
			expect(api.fetchMemberProfile).toHaveBeenCalledTimes(2)

			const retry = screen.getByRole('button', { name: '다시 확인' })
			fireEvent.click(retry)
			fireEvent.click(retry)
			expect(retry).toBeDisabled()
			expect(retry).toHaveTextContent('확인 중…')
			expect(api.fetchMemberProfile).toHaveBeenCalledTimes(3)

			resolveRetry(PROFILE_WITH_RATING)
			await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
			expect(events).toEqual([{ albumId: 'album-1', rating: 4.5 }])
		}
		finally {
			window.removeEventListener(ENT_ALBUM_STATE_CHANGED, capture)
		}
	})

	it('forwards the restored rating from the confirmation response when the private score is unavailable', async () => {
		api.fetchMemberProfile
			.mockResolvedValueOnce(PROFILE_RERATING)
			.mockResolvedValueOnce(PROFILE_WITH_RATING)
		api.cancelRerating.mockResolvedValue(true)
		const events: Array<{ albumId: string, rating: number | null }> = []
		const capture = (event: Event) => events.push((event as CustomEvent).detail)
		window.addEventListener(ENT_ALBUM_STATE_CHANGED, capture)

		try {
			render(<MemberProfile handle={HANDLE} />)
			await screen.findByRole('navigation', { name: '내 대시보드' })
			fireEvent.click(screen.getByRole('button', { name: '재평가 취소' }))

			await waitFor(() => expect(events).toEqual([{ albumId: 'album-1', rating: 4.5 }]))
			expect(screen.queryByRole('alert')).not.toBeInTheDocument()
			// The forwarded local event is consumed by this root rather than
			// starting a redundant third profile request.
			expect(api.fetchMemberProfile).toHaveBeenCalledTimes(2)
		}
		finally {
			window.removeEventListener(ENT_ALBUM_STATE_CHANGED, capture)
		}
	})

	it('serializes cancellations so one album cannot hide another album confirmation failure', async () => {
		const secondRating = {
			...RATING,
			id: 'rating-2',
			album_id: 'album-2',
			album_title: 'Blue Train',
			rating: 3.5,
		}
		const profileAfterFirst = {
			...PROFILE_WITH_RATING,
			reratings: [{
				album_id: 'album-2',
				album_title: 'Blue Train',
				album_cover_url: null,
				artist_id: null,
				artist_name: 'John Coltrane',
				created_at: '2026-08-21T00:00:00Z',
			}],
		}
		const profileWithTwoReratings = {
			...PROFILE_WITHOUT_RATING,
			reratings: [
				...PROFILE_RERATING.reratings,
				{
					album_id: 'album-2',
					album_title: 'Blue Train',
					album_cover_url: null,
					artist_id: null,
					artist_name: 'John Coltrane',
					created_at: '2026-08-21T00:00:00Z',
				},
			],
		}
		const profileAfterBoth = {
			...PROFILE_WITH_RATING,
			review_count: 2,
			reviews: [RATING, secondRating],
		}
		let resolveFirst!: (value: typeof profileAfterFirst) => void
		let resolveSecond!: (value: typeof profileAfterBoth) => void
		api.fetchMemberProfile
			.mockResolvedValueOnce(profileWithTwoReratings)
			.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
			.mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve }))
		api.cancelRerating.mockResolvedValue(true)
		const events: Array<{ albumId: string, rating: number | null }> = []
		const capture = (event: Event) => events.push((event as CustomEvent).detail)
		window.addEventListener(ENT_ALBUM_STATE_CHANGED, capture)

		try {
			render(<MemberProfile handle={HANDLE} />)
			await screen.findByRole('navigation', { name: '내 대시보드' })
			const firstCancel = await screen.findAllByRole('button', { name: '재평가 취소' })
			fireEvent.click(firstCancel[0])
			await waitFor(() => expect(api.fetchMemberProfile).toHaveBeenCalledTimes(2))
			const secondCancel = screen.getByRole('button', { name: '재평가 취소' })
			expect(secondCancel).toBeDisabled()
			fireEvent.click(secondCancel)
			expect(api.fetchMemberProfile).toHaveBeenCalledTimes(2)

			resolveFirst(profileAfterFirst)
			await waitFor(() => expect(secondCancel).toBeEnabled())
			expect(events).toEqual([{ albumId: 'album-1', rating: 4.5 }])

			fireEvent.click(secondCancel)
			await waitFor(() => expect(api.fetchMemberProfile).toHaveBeenCalledTimes(3))
			resolveSecond(profileAfterBoth)
			await waitFor(() => expect(events).toEqual([
				{ albumId: 'album-1', rating: 4.5 },
				{ albumId: 'album-2', rating: 3.5 },
			]))

			expect(screen.getByText('Kind of Blue')).toBeInTheDocument()
			expect(screen.getByText('Blue Train')).toBeInTheDocument()
			expect(screen.queryByRole('alert')).not.toBeInTheDocument()
		}
		finally {
			window.removeEventListener(ENT_ALBUM_STATE_CHANGED, capture)
		}
	})
})
