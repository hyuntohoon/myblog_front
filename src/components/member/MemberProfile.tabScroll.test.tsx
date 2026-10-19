// Audit #17 (2026-10-16 front UI/UX audit) — on a 390px phone the dashboard tab
// row overflows and nothing said so. The nav now fades whichever edge still has
// tabs past it. jsdom has no layout, so the widths are pinned on the element and
// a scroll event drives the same update a real swipe does.
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
	fetchMemberProfile: vi.fn(),
	fetchMemberNowPlaying: vi.fn(),
	fetchMyReratings: vi.fn(),
	getMe: vi.fn(),
}))

vi.mock('@lib/auth', () => ({ isLoggedIn: () => true, goLogin: vi.fn() }))
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
	cancelRerating: vi.fn(),
}))

const { default: MemberProfile } = await import('./MemberProfile')

const HANDLE = 'park'

async function mountNav() {
	window.history.replaceState({}, '', '/members/')
	api.getMe.mockResolvedValue({ handle: HANDLE })
	api.fetchMemberProfile.mockResolvedValue({ handle: HANDLE, display_name: 'Park', avatar_url: null, review_count: 0, reviews: [], reratings: [] })
	render(<MemberProfile handle={HANDLE} />)
	return screen.findByRole('navigation', { name: '내 대시보드' })
}

/** Lay the nav out as a 390px viewport over a 600px row, scrolled to `left`. */
function scrollTo(nav: HTMLElement, left: number) {
	Object.defineProperty(nav, 'clientWidth', { configurable: true, value: 390 })
	Object.defineProperty(nav, 'scrollWidth', { configurable: true, value: 600 })
	Object.defineProperty(nav, 'scrollLeft', { configurable: true, value: left })
	fireEvent.scroll(nav)
}

beforeEach(() => {
	vi.clearAllMocks()
	api.fetchMemberNowPlaying.mockResolvedValue(null)
	api.fetchMyReratings.mockResolvedValue([])
})

describe('dashboard tab row overflow fade', () => {
	it('shows no fade when the row fits', async () => {
		const nav = await mountNav()
		expect(nav).not.toHaveAttribute('data-fade-l')
		expect(nav).not.toHaveAttribute('data-fade-r')
	})

	it('fades only the right edge at the start of an overflowing row', async () => {
		const nav = await mountNav()
		scrollTo(nav, 0)
		expect(nav).toHaveAttribute('data-fade-r')
		expect(nav).not.toHaveAttribute('data-fade-l')
		expect(nav.style.getPropertyValue('--fade-r')).toBe('28px')
		expect(nav.style.getPropertyValue('--fade-l')).toBe('0px')
	})

	it('fades both edges mid-row and only the left edge at the end', async () => {
		const nav = await mountNav()
		scrollTo(nav, 100)
		expect(nav).toHaveAttribute('data-fade-l')
		expect(nav).toHaveAttribute('data-fade-r')
		scrollTo(nav, 210)
		expect(nav).toHaveAttribute('data-fade-l')
		expect(nav).not.toHaveAttribute('data-fade-r')
	})
})
