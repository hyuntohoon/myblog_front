import type { components } from '@lib/api.gen'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	ForYouReleaseAlbumCardAdapter,
	LegacyForYouReleaseCard,
} from '../home/ForYouReleasesCard'
import {
	LegacyTodayAlbumCard,
	TodayAlbumCardAdapter,
} from '../home/TodayAlbumBuckit'
import {
	LegacyReviewCandidateCard,
	ReviewCandidateAlbumCardAdapter,
	ReviewCandidates,
} from '../member/ReviewCandidates'

const mocks = vi.hoisted(() => ({ openAlbum: vi.fn(), fetchCandidates: vi.fn() }))

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
	mocks.fetchCandidates.mockResolvedValue([CANDIDATE])
})

describe('albumCard Stage 5 adapters', () => {
	it('migrates For You while keeping unmatched Spotify-only releases non-openable', () => {
		const { rerender } = render(<ForYouReleaseAlbumCardAdapter it={FOR_YOU} />)
		fireEvent.click(screen.getByRole('button', { name: 'Lotus — Little Simz 앨범 보기' }))
		expect(mocks.openAlbum).toHaveBeenCalledWith({
			albumId: 'album-1',
			title: 'Lotus',
			artist: 'Little Simz',
			cover: undefined,
			year: 2026,
		})

		rerender(<ForYouReleaseAlbumCardAdapter it={{ ...FOR_YOU, album_id: null }} />)
		expect(screen.queryByRole('button', { name: 'Lotus — Little Simz 앨범 보기' })).toBeNull()
		expect(screen.getByText('Lotus')).toBeInTheDocument()
		expect(screen.getByText('08.01 발매 · EP')).toBeInTheDocument()
	})

	it('preserves the For You display signature', () => {
		const legacy = render(<LegacyForYouReleaseCard it={FOR_YOU} />)
		const canonical = render(<ForYouReleaseAlbumCardAdapter it={FOR_YOU} />)

		const signature = (container: HTMLElement) => ({
			fallback: container.querySelector('.cover-ph')?.textContent,
			title: within(container).getByText('Lotus').textContent,
			artist: within(container).getByRole('link', { name: 'Little Simz' }).getAttribute('href'),
			date: within(container).getByText('08.01 발매 · EP').textContent,
		})
		expect(signature(canonical.container)).toEqual(signature(legacy.container))
		const card = canonical.container.querySelector('[data-album-card-layout="grid"]')
		expect(card).toBeInTheDocument()
		expect(card?.querySelector('.album-card__cover')).toHaveAttribute('data-cover-state', 'fallback')
		expect(card?.querySelector('.album-card__secondary')).toHaveTextContent('08.01 발매 · EP')
	})

	it('migrates Today Album with the anniversary badge and open capability', () => {
		render(<TodayAlbumCardAdapter it={TODAY} />)
		fireEvent.click(screen.getByRole('button', { name: 'Vespertine — Björk 앨범 보기' }))
		expect(mocks.openAlbum).toHaveBeenCalledWith({
			albumId: 'album-2',
			title: 'Vespertine',
			artist: 'Björk',
			cover: null,
			year: 2001,
		})
		expect(screen.getByText('25년 전')).toBeInTheDocument()
	})

	it('preserves the Today Album display signature', () => {
		const legacy = render(<LegacyTodayAlbumCard it={TODAY} />)
		const canonical = render(<TodayAlbumCardAdapter it={TODAY} />)

		const signature = (container: HTMLElement) => ({
			fallback: container.querySelector('.cover-ph')?.textContent,
			title: within(container).getByText('Vespertine').textContent,
			artist: within(container).getByRole('link', { name: 'Björk' }).getAttribute('href'),
			badge: within(container).getByText('25년 전').textContent,
		})
		expect(signature(canonical.container)).toEqual(signature(legacy.container))
		const card = canonical.container.querySelector('[data-album-card-layout="grid"]')
		const cover = card?.querySelector('.album-card__cover')
		expect(cover).toHaveAttribute('data-cover-state', 'fallback')
		expect(cover?.querySelector('.album-card__badge')).toHaveTextContent('25년 전')
	})

	it('migrates Review Candidates with rating and editor entry in card slots', () => {
		render(<ReviewCandidateAlbumCardAdapter c={CANDIDATE} />)
		fireEvent.click(screen.getByRole('button', { name: 'Promises — Floating Points 앨범 보기' }))
		expect(mocks.openAlbum).toHaveBeenCalledWith({
			albumId: 'album/3',
			title: 'Promises',
			cover: null,
		})
		expect(screen.getByRole('img', { name: '별점 4.5 / 5' })).toBeInTheDocument()
		expect(screen.getByRole('link', { name: '평론 쓰기 →' })).toHaveAttribute('href', '/write?album=album%2F3')
	})

	it('preserves the Review Candidate display signature', () => {
		const legacy = render(<LegacyReviewCandidateCard c={CANDIDATE} />)
		const canonical = render(<ReviewCandidateAlbumCardAdapter c={CANDIDATE} />)

		const signature = (container: HTMLElement) => ({
			fallback: container.querySelector('.cover-ph')?.textContent,
			title: within(container).getByText('Promises').textContent,
			artist: within(container).getByRole('link', { name: 'Floating Points' }).getAttribute('href'),
			rating: within(container).getByRole('img', { name: '별점 4.5 / 5' }).getAttribute('aria-label'),
			comment: within(container).getByText('오래 남는 여운').textContent,
			writeHref: within(container).getByRole('link', { name: /평론 쓰기/ }).getAttribute('href'),
		})
		expect(signature(canonical.container)).toEqual(signature(legacy.container))
		const card = canonical.container.querySelector('[data-album-card-layout="row"]')
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
