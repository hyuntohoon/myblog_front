import type { components } from '@lib/api.gen'
import type { ReactNode } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	ForYouReleaseAlbumCardAdapter,
} from '../home/ForYouReleasesCard'
import {
	TodayAlbumCardAdapter,
} from '../home/TodayAlbumBuckit'
import {
	ReviewCandidateAlbumCardAdapter,
	ReviewCandidates,
} from '../member/ReviewCandidates'
import { PB_DND_START_EVENT } from '@lib/pocketBuckit/events'

const mocks = vi.hoisted(() => ({ openAlbum: vi.fn(), fetchCandidates: vi.fn(), openMenu: vi.fn() }))

vi.mock('@lib/albumDetail', () => ({ prefetchAlbumDetail: vi.fn() }))
vi.mock('@lib/entityEvents', async () => ({
	...await vi.importActual<typeof import('@lib/entityEvents')>('@lib/entityEvents'),
	openAlbum: mocks.openAlbum,
}))
vi.mock('@lib/entityLinks', async () => ({
	...await vi.importActual<typeof import('@lib/entityLinks')>('@lib/entityLinks'),
	openAlbum: mocks.openAlbum,
}))
vi.mock('../album/reviews.api', () => ({
	fetchMyReviewCandidates: mocks.fetchCandidates,
}))
vi.mock('@components/member/pocket/AddToBucketMenu', () => ({
	AddToBucketMenu: ({ item, render }: { item: unknown, render: (props: { open: () => void, busy: boolean }) => ReactNode }) =>
		render({ open: () => mocks.openMenu(item), busy: false }),
}))

type ReleaseFeedItem = components['schemas']['Backend_ReleaseFeedItem']
type ReviewCandidate = components['schemas']['Backend_ReviewCandidateResponse']

const FOR_YOU = {
	album_id: 'album-1',
	artist_id: 'artist-1',
	artist_name: 'Little Simz',
	cover_url: null,
	release_date: '2026-08-01',
	release_type: 'ep',
	spotify_album_id: 'spotify-1',
	status: 'released',
	title: 'Lotus',
	trust: '확정',
} satisfies ReleaseFeedItem

const TODAY = {
	album_id: 'album-2',
	spotify_album_id: 'spotify-2',
	title: 'Vespertine',
	cover_url: null,
	release_date: '2001-08-27',
	years_ago: 25,
	artists: [{ id: 'artist-2', name: 'Björk', spotify_id: 'spotify-artist-2' }],
}

const CANDIDATE = {
	album_cover_url: null,
	album_id: 'album/3',
	album_title: 'Promises',
	artist_id: 'artist-3',
	artist_name: 'Floating Points',
	comment: '오래 남는 여운',
	rating: 4.5,
	updated_at: '2026-08-06T00:00:00Z',
} satisfies ReviewCandidate

beforeEach(() => {
	mocks.openAlbum.mockReset()
	mocks.openMenu.mockReset()
	mocks.fetchCandidates.mockResolvedValue([CANDIDATE])
})

function expectCopyAdd(container: HTMLElement, title: string, albumId: string) {
	const start = vi.fn()
	window.addEventListener(PB_DND_START_EVENT, start)
	const card = container.querySelector('article[draggable="true"]')!
	const dataTransfer = { effectAllowed: 'uninitialized' }
	fireEvent.dragStart(card, { dataTransfer })
	expect(dataTransfer.effectAllowed).toBe('copy')
	expect((start.mock.calls[0][0] as CustomEvent).detail).toEqual({
		ref: { entity: 'album', albumId, title },
		origin: { kind: 'external', copies: true },
	})
	window.removeEventListener(PB_DND_START_EVENT, start)

	fireEvent.click(screen.getByRole('button', { name: `${title} 버킷에 담기` }))
	expect(mocks.openMenu).toHaveBeenCalledWith({ itemType: 'album', albumId, title })
}

describe('albumCard Stage 5 adapters', () => {
	it('migrates For You while keeping unmatched Spotify-only releases non-openable', () => {
		const { container, rerender } = render(<ForYouReleaseAlbumCardAdapter it={FOR_YOU} />)
		fireEvent.click(screen.getByRole('button', { name: 'Lotus — Little Simz 앨범 보기' }))
		expect(mocks.openAlbum).toHaveBeenCalledWith({
			albumId: 'album-1',
			title: 'Lotus',
			artist: 'Little Simz',
			cover: undefined,
			year: 2026,
		})
		expectCopyAdd(container, 'Lotus', 'album-1')

		rerender(<ForYouReleaseAlbumCardAdapter it={{ ...FOR_YOU, album_id: null }} />)
		expect(screen.queryByRole('button', { name: 'Lotus — Little Simz 앨범 보기' })).toBeNull()
		expect(screen.queryByRole('button', { name: 'Lotus 버킷에 담기' })).toBeNull()
		expect(container.querySelector('[draggable]')).toBeNull()
		expect(screen.getByText('Lotus')).toBeInTheDocument()
		expect(screen.getByText('08.01 발매 · EP')).toBeInTheDocument()
		expect(screen.getByText('카탈로그 등록 후 담기 가능')).toBeInTheDocument()
	})

	it('preserves the For You display signature after legacy removal', () => {
		const { container } = render(<ForYouReleaseAlbumCardAdapter it={FOR_YOU} />)

		expect(container.querySelector('.cover-ph')).toHaveTextContent('LO')
		expect(screen.getByText('Lotus')).toBeInTheDocument()
		expect(screen.getByRole('link', { name: 'Little Simz' })).toHaveAttribute('href', '/artist/artist-1/')
		expect(screen.getByText('08.01 발매 · EP')).toBeInTheDocument()
		const card = container.querySelector('[data-album-card-layout="grid"]')
		expect(card).toBeInTheDocument()
		expect(card?.querySelector('.album-card__cover')).toHaveAttribute('data-cover-state', 'fallback')
		expect(card?.querySelector('.album-card__secondary')).toHaveTextContent('08.01 발매 · EP')
	})

	it('migrates Today Album with the anniversary badge and open capability', () => {
		const { container } = render(<TodayAlbumCardAdapter it={TODAY} />)
		fireEvent.click(screen.getByRole('button', { name: 'Vespertine — Björk 앨범 보기' }))
		expect(mocks.openAlbum).toHaveBeenCalledWith({
			albumId: 'album-2',
			title: 'Vespertine',
			artist: 'Björk',
			cover: null,
			year: 2001,
		})
		expect(screen.getByText('25년 전')).toBeInTheDocument()
		expectCopyAdd(container, 'Vespertine', 'album-2')
	})

	it('preserves the Today Album display signature after legacy removal', () => {
		const { container } = render(<TodayAlbumCardAdapter it={TODAY} />)

		expect(container.querySelector('.cover-ph')).toHaveTextContent('VE')
		expect(screen.getByText('Vespertine')).toBeInTheDocument()
		expect(screen.getByRole('link', { name: 'Björk' })).toHaveAttribute('href', '/artist/artist-2/')
		const card = container.querySelector('[data-album-card-layout="grid"]')
		const cover = card?.querySelector('.album-card__cover')
		expect(cover).toHaveAttribute('data-cover-state', 'fallback')
		expect(cover?.querySelector('.album-card__badge')).toHaveTextContent('25년 전')
	})

	it('migrates Review Candidates with rating and editor entry in card slots', () => {
		const { container } = render(<ReviewCandidateAlbumCardAdapter c={CANDIDATE} />)
		fireEvent.click(screen.getByRole('button', { name: 'Promises — Floating Points 앨범 보기' }))
		expect(mocks.openAlbum).toHaveBeenCalledWith({
			albumId: 'album/3',
			title: 'Promises',
			cover: null,
		})
		expect(screen.getByRole('img', { name: '별점 4.5 / 5' })).toBeInTheDocument()
		expect(screen.getByRole('link', { name: '평론 쓰기 →' })).toHaveAttribute('href', '/write?album=album%2F3')
		expectCopyAdd(container, 'Promises', 'album/3')
	})

	it('preserves the Review Candidate display signature after legacy removal', () => {
		const { container } = render(<ReviewCandidateAlbumCardAdapter c={CANDIDATE} />)

		expect(container.querySelector('.cover-ph')).toHaveTextContent('PR')
		expect(screen.getByText('Promises')).toBeInTheDocument()
		expect(screen.getByRole('link', { name: 'Floating Points' })).toHaveAttribute('href', '/artist/artist-3/')
		expect(screen.getByRole('img', { name: '별점 4.5 / 5' })).toHaveAttribute('aria-label', '별점 4.5 / 5')
		expect(screen.getByText('오래 남는 여운')).toBeInTheDocument()
		expect(screen.getByRole('link', { name: /평론 쓰기/ })).toHaveAttribute('href', '/write?album=album%2F3')
		const card = container.querySelector('[data-album-card-layout="row"]')
		const cover = card?.querySelector('.album-card__cover')
		expect(cover).toHaveAttribute('data-cover-state', 'fallback')
		expect(cover?.querySelector('.album-card__badge')).toContainElement(within(cover as HTMLElement).getByRole('img', { name: '별점 4.5 / 5' }))
		expect(card?.querySelector('.album-card__secondary')).toContainElement(within(card as HTMLElement).getByRole('link', { name: '평론 쓰기 →' }))
	})

	it('ships the Review Candidate surface styles with the live adapter', async () => {
		const { container } = render(<ReviewCandidates />)
		expect(await screen.findByRole('button', { name: 'Promises — Floating Points 앨범 보기' })).toBeInTheDocument()
		expect(container.querySelector('style')).toHaveTextContent('.review-candidate-card .album-card')
		expect(container.querySelector('.review-candidate-card [data-album-card-layout="row"]')).toBeInTheDocument()
	})
})
