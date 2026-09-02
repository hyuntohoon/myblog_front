// FEAT-album-review-authoring Step 4 — 평론 is an owner-only dashboard tab
// (충돌 #2 + C1's permission rule).
//
// For a member the tab was named 평론 and showed their 평가 — the exact collision
// the terminology decision exists to remove — and it carried live authoring
// affordances (ReviewCandidates' 평론 쓰기 →, draft cards linking /write?id=)
// that 하드 룰 1 reserves for editors.
//
// The deep-link case is the one worth writing down: `?tab=reviews` is a shareable
// address and the initial tab is read from the URL BEFORE the handle is compared
// to OWNER_HANDLE. A member arriving on that URL must land somewhere real, not on
// a blank dashboard, so the assertion is that they get the public 평가 list.
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
	fetchMemberProfile: vi.fn(),
	fetchMemberNowPlaying: vi.fn(),
	fetchMyReratings: vi.fn(),
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
	cancelRerating: vi.fn(),
}))

const { OWNER_HANDLE } = await import('@lib/member')
const { default: MemberProfile } = await import('./MemberProfile')

const MEMBER_HANDLE = 'park'

function profileFor(handle: string) {
	return { handle, display_name: 'Park', avatar_url: null, review_count: 0, reviews: [], reratings: [] }
}

async function mountSelf(handle: string, search = '') {
	window.history.replaceState({}, '', `/members/${search}`)
	api.getMe.mockResolvedValue({ handle })
	api.fetchMemberProfile.mockResolvedValue(profileFor(handle))
	render(<MemberProfile handle={handle} />)
	return screen.findByRole('navigation', { name: '내 대시보드' })
}

function tabNames(nav: HTMLElement) {
	return Array.from(nav.querySelectorAll('button')).map(b => b.textContent?.trim())
}

/** The nav tab currently carrying the accent underline. */
function activeTabName(): string | undefined {
	const buttons = Array.from(document.querySelectorAll('nav[aria-label="내 대시보드"] button'))
	const active = buttons.find(b => (b as HTMLElement).style.borderBottom.includes('var(--color-accent)'))
	return active?.textContent?.trim()
}

beforeEach(() => {
	vi.clearAllMocks()
	api.fetchMemberNowPlaying.mockResolvedValue(null)
	api.fetchMyReratings.mockResolvedValue([])
})

describe('the 평론 dashboard tab', () => {
	it('is offered to the owner', async () => {
		const nav = await mountSelf(OWNER_HANDLE)
		expect(tabNames(nav)).toContain('평론')
	})

	it('is not offered to a member, who keeps every other tab', async () => {
		const nav = await mountSelf(MEMBER_HANDLE)
		const names = tabNames(nav)
		expect(names).not.toContain('평론')
		// Absence has to be surgical: a gate that dropped the whole nav, or all
		// the dashboard tabs, would also satisfy the line above.
		expect(names).toEqual(expect.arrayContaining(['평가', '개요', 'My Buckit', '분석 버킷', '연동']))
	})

	it('refuses to activate ?tab=reviews for a member, landing them on the 평가 list', async () => {
		await mountSelf(MEMBER_HANDLE, '?tab=reviews')
		// Not a blank dashboard: the public 평가 list is what renders when no
		// dashboard tab is active, and 평가 is the tab shown as current.
		await waitFor(() => expect(screen.getByText('아직 남긴 평가가 없어요.')).toBeTruthy())
		expect(activeTabName()).toBe('평가')
	})

	it('still activates ?tab=reviews for the owner', async () => {
		await mountSelf(OWNER_HANDLE, '?tab=reviews')
		await waitFor(() => expect(activeTabName()).toBe('평론'))
	})
})
