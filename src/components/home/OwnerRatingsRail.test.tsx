// FEAT-public-surfaces-before-first-review Step 2 — the owner's 최근 평가 rail.
// Locks: build-seeded SSR render, trim to ORR_LIMIT, runtime refresh lands a
// new 평가 without a redeploy, a failed refresh keeps the seed, a confirmed-
// empty feed hides the rail, and no data at all renders nothing.
import type { components } from '@lib/api.gen'
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openAlbum } from '@lib/entityLinks'
import OwnerRatingsRail, { ORR_LIMIT, OWNER_MEMBER_HREF, ownerRatingItems } from './OwnerRatingsRail'

vi.mock('@lib/albumDetail', () => ({ prefetchAlbumDetail: vi.fn() }))
vi.mock('@lib/entityLinks', async () => ({
	...await vi.importActual<typeof import('@lib/entityLinks')>('@lib/entityLinks'),
	openAlbum: vi.fn(),
}))
vi.mock('@components/member/pocket/AddToBucketMenu', () => ({
	AddToBucketMenu: ({ render }: { render: (props: { open: () => void, busy: boolean }) => ReactNode }) =>
		render({ open: () => {}, busy: false }),
}))

beforeEach(() => {
	vi.mocked(openAlbum).mockReset()
	vi.stubGlobal('ResizeObserver', class {
		observe() {}
		unobserve() {}
		disconnect() {}
	})
})

type MemberRating = components['schemas']['Backend_MemberRatingResponse']

function rating(i: number, over: Partial<MemberRating> = {}): MemberRating {
	return {
		id: `r${i}`,
		album_id: `a${i}`,
		album_title: `Album ${i}`,
		album_cover_url: null,
		artist_name: `Artist ${i}`,
		artist_id: `ar${i}`,
		rating: 4,
		comment: null,
		created_at: '2026-08-17T08:43:55Z',
		updated_at: '2026-08-17T08:43:55Z',
		...over,
	} as MemberRating
}

const profile = (reviews: MemberRating[]) => ({ handle: 'user-0468fd3c', display_name: 'x', created_at: '', review_count: reviews.length, reviews })
const okJson = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })

describe('ownerRatingItems', () => {
	it('trims a 37-item feed to the newest ORR_LIMIT, in feed order', () => {
		const feed = Array.from({ length: 37 }, (_, i) => rating(i))
		const items = ownerRatingItems(profile(feed) as never)!
		expect(items).toHaveLength(ORR_LIMIT)
		expect(items.map(r => r.id)).toEqual(feed.slice(0, ORR_LIMIT).map(r => r.id))
	})

	it('returns null for a malformed body', () => {
		expect(ownerRatingItems(null)).toBeNull()
		expect(ownerRatingItems({} as never)).toBeNull()
	})
})

describe('ownerRatingsRail', () => {
	it('renders the seeded rail synchronously, labelled 평가 and linking to the owner page', () => {
		vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
		render(<OwnerRatingsRail initial={[rating(1, { comment: '청춘의 출사표' })]} />)
		expect(screen.getByRole('heading', { name: '최근 평가' })).toBeInTheDocument()
		expect(screen.getByText('Album 1')).toBeInTheDocument()
		expect(screen.getByText('청춘의 출사표')).toBeInTheDocument()
		expect(screen.getByRole('img', { name: '별점 4.0 / 5' })).toBeInTheDocument()
		expect(screen.getByRole('link', { name: '전체 평가 →' })).toHaveAttribute('href', OWNER_MEMBER_HREF)
		expect(document.body.textContent).not.toMatch(/리뷰|평론/)
	})

	it('swaps in a newer 평가 from the runtime fetch (no redeploy)', async () => {
		vi.stubGlobal('fetch', vi.fn(() => okJson(profile([rating(9), rating(1)]))))
		render(<OwnerRatingsRail initial={[rating(1)]} />)
		expect(await screen.findByText('Album 9')).toBeInTheDocument()
	})

	it('keeps the seeded rail when the runtime fetch fails', async () => {
		const fetchMock = vi.fn(() => Promise.reject(new Error('down')))
		vi.stubGlobal('fetch', fetchMock)
		render(<OwnerRatingsRail initial={[rating(1)]} />)
		await waitFor(() => expect(fetchMock).toHaveBeenCalled())
		expect(screen.getByText('Album 1')).toBeInTheDocument()
	})

	it('keeps the seeded rail on a non-ok response', async () => {
		const fetchMock = vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }))
		vi.stubGlobal('fetch', fetchMock)
		render(<OwnerRatingsRail initial={[rating(1)]} />)
		await waitFor(() => expect(fetchMock).toHaveBeenCalled())
		expect(screen.getByText('Album 1')).toBeInTheDocument()
	})

	it('hides when the owner feed is confirmed empty', async () => {
		vi.stubGlobal('fetch', vi.fn(() => okJson(profile([]))))
		const { container } = render(<OwnerRatingsRail initial={[rating(1)]} />)
		await waitFor(() => expect(container).toBeEmptyDOMElement())
	})

	it('unseeded + failed fetch renders nothing', async () => {
		const fetchMock = vi.fn(() => Promise.reject(new Error('down')))
		vi.stubGlobal('fetch', fetchMock)
		const { container } = render(<OwnerRatingsRail />)
		await waitFor(() => expect(fetchMock).toHaveBeenCalled())
		expect(container).toBeEmptyDOMElement()
	})

	it('opens the album overlay from the card', () => {
		vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
		render(<OwnerRatingsRail initial={[rating(1)]} />)
		fireEvent.click(screen.getByRole('button', { name: 'Album 1 — Artist 1 앨범 보기' }))
		expect(openAlbum).toHaveBeenCalledWith({ albumId: 'a1', title: 'Album 1', artist: 'Artist 1', cover: null, year: null })
	})
})
