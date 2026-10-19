// Front audit S1/S2 — the Canon grid is a list of published reviews. Each card
// stays a document card (RFC ARCH-album-card-contract §12): the cover peeks the
// album overlay, the rest links to the review, and no canonical AlbumCard is
// rendered. Prod /canon is empty (0 평론), so this is the populated grid's only
// automated coverage.
import type { ReviewCard } from '@lib/reviews'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CanonPage from './CanonPage'

const mocks = vi.hoisted(() => ({ openAlbum: vi.fn() }))

vi.mock('@lib/entityLinks', async () => ({
	...await vi.importActual<typeof import('@lib/entityLinks')>('@lib/entityLinks'),
	openAlbum: mocks.openAlbum,
}))

function review(over: Partial<ReviewCard>): ReviewCard {
	return {
		slug: 'kind-of-blue',
		album: 'Kind of Blue',
		artist: 'Miles Davis',
		genres: ['Jazz'],
		category: 'album',
		tags: [],
		date: '2026-10-01',
		year: 1959,
		rating: 4.5,
		bestNew: false,
		cover: 'https://example.test/kob.jpg',
		excerpt: '모달 재즈의 교과서.',
		albumIds: ['album-1'],
		artistIds: [],
		...over,
	}
}

afterEach(() => mocks.openAlbum.mockReset())

describe('canonPage cards', () => {
	it('renders review document cards, not canonical album cards', () => {
		const { container } = render(<CanonPage albums={[review({})]} />)
		expect(container.querySelectorAll('.canon-card')).toHaveLength(1)
		expect(container.querySelector('.album-card')).toBeNull()
		expect(container.querySelector('.canon-cover .cover img')).toHaveAttribute('src', 'https://example.test/kob.jpg')
	})

	it('peeks the album from the cover and links the rest to the review', () => {
		render(<CanonPage albums={[review({})]} />)
		fireEvent.click(screen.getByRole('button', { name: 'Kind of Blue 앨범 정보 보기' }))
		expect(mocks.openAlbum).toHaveBeenCalledWith({ albumId: 'album-1', title: 'Kind of Blue', artist: 'Miles Davis', cover: 'https://example.test/kob.jpg', year: 1959 })
		expect(screen.getByRole('heading', { name: 'Kind of Blue' }).closest('a')).toHaveAttribute('href', expect.stringContaining('kind-of-blue'))
	})

	it('shows the placeholder in a plain cover when the review has no album id', () => {
		const { container } = render(<CanonPage albums={[review({ albumIds: [], cover: null })]} />)
		expect(screen.queryByRole('button', { name: /앨범 정보 보기/ })).toBeNull()
		expect(container.querySelector('div.canon-cover .cover-ph')).toHaveTextContent('KI')
	})
})
