// Front UI/UX audit 2026-10-16 S1 — the /artist discography composes the
// canonical AlbumCard through CatalogAlbumCardAdapter, so the same album has
// the same open + ＋ on /artist as on /search (finding #7, #406 class).
import type { AlbumListItem, ArtistHeroResult } from '../../scripts/write/artistApi'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ArtistHub, { artistDiscographyCardData } from './ArtistHub'

const api = vi.hoisted(() => ({
	fetchArtistHero: vi.fn(),
	fetchArtistAlbums: vi.fn(),
	fetchArtistTopTracks: vi.fn(),
}))
const mocks = vi.hoisted(() => ({ openAlbum: vi.fn(), loggedIn: false }))

vi.mock('../../scripts/write/artistApi', () => api)
vi.mock('@lib/auth', () => ({ isLoggedIn: () => mocks.loggedIn, goLogin: vi.fn() }))
vi.mock('@lib/owner', () => ({ isOwnerUser: () => false }))
vi.mock('@lib/trackedArtists', () => ({
	listTrackedArtists: vi.fn().mockResolvedValue([]),
	trackArtist: vi.fn(),
	untrackArtist: vi.fn(),
}))
vi.mock('@lib/entityLinks', async () => ({
	...await vi.importActual<typeof import('@lib/entityLinks')>('@lib/entityLinks'),
	openAlbum: mocks.openAlbum,
}))

const HERO = {
	ok: true,
	hero: {
		id: 'artist-1',
		name: '빈지노',
		photo_url: null,
		genres: [],
		catalog_genres: [],
		album_count: 2,
		track_count: 20,
		followers: null,
		popularity: null,
		spotify_url: null,
	},
} as unknown as ArtistHeroResult

function album(over: Partial<AlbumListItem>): AlbumListItem {
	return {
		id: 'alb-1',
		title: 'Break',
		artist_name: '빈지노',
		cover_url: 'https://img.example/break.jpg',
		release_date: '2016-03-01',
		album_type: 'single',
		best_new: false,
		...over,
	} as AlbumListItem
}

function renderHub() {
	return render(<ArtistHub artistId="artist-1" name="빈지노" reviews={[]} reviewedAlbumIds={[]} />)
}

beforeEach(() => {
	mocks.loggedIn = false
	api.fetchArtistHero.mockReset().mockResolvedValue(HERO)
	api.fetchArtistAlbums.mockReset().mockResolvedValue([
		album({}),
		album({ id: 'alb-2', title: '24:26', cover_url: null, release_date: '2012-06-26', album_type: 'album' }),
	])
	api.fetchArtistTopTracks.mockReset().mockResolvedValue([])
})

afterEach(() => {
	vi.clearAllMocks()
})

describe('artist hub discography (front audit S1)', () => {
	it('renders every catalog album as the canonical album card with ＋', async () => {
		renderHub()
		const grid = await waitFor(() => {
			const el = document.querySelector('.art-disco-grid')
			expect(el).not.toBeNull()
			return el as HTMLElement
		})
		const cards = grid.querySelectorAll('article.album-card')
		expect(cards).toHaveLength(2)
		expect(within(grid).getByRole('button', { name: 'Break 버킷에 담기' })).toBeTruthy()
		expect(within(grid).getByRole('button', { name: '24:26 버킷에 담기' })).toBeTruthy()
		expect(grid.querySelector('.art-disco-item, .art-disco-cover')).toBeNull()
	})

	it('shows year and type, not the artist name or a per-card 아직 평론 없음', async () => {
		renderHub()
		const card = await screen.findByRole('button', { name: 'Break 앨범 보기' })
		const article = card.closest('article') as HTMLElement
		expect(article.querySelector('.album-card__year')?.textContent).toBe('2016')
		expect(article.querySelector('.art-disco-type')?.textContent).toBe('single')
		expect(article.querySelector('.album-card__artist, .album-card__artist-text')).toBeNull()
		expect(screen.queryByText('아직 평론 없음')).toBeNull()
	})

	it('opens the album overlay with the same payload as before', async () => {
		renderHub()
		fireEvent.click(await screen.findByRole('button', { name: 'Break 앨범 보기' }))
		expect(mocks.openAlbum).toHaveBeenCalledWith({
			albumId: 'alb-1',
			title: 'Break',
			artist: '빈지노',
			cover: 'https://img.example/break.jpg',
			year: 2016,
		})
	})

	it('falls back to the placeholder when an album has no cover', async () => {
		renderHub()
		const article = (await screen.findByRole('button', { name: '24:26 앨범 보기' })).closest('article') as HTMLElement
		expect(article.querySelector('.album-card__cover')?.getAttribute('data-cover-state')).toBe('fallback')
		expect(article.querySelector('.cover-ph')?.textContent).toBe('24')
	})

	it('drags only when logged in', async () => {
		const { unmount } = renderHub()
		const anon = (await screen.findByRole('button', { name: 'Break 앨범 보기' })).closest('article') as HTMLElement
		expect(anon.getAttribute('draggable')).toBeNull()
		unmount()
		mocks.loggedIn = true
		renderHub()
		const member = (await screen.findByRole('button', { name: 'Break 앨범 보기' })).closest('article') as HTMLElement
		expect(member.getAttribute('draggable')).toBe('true')
	})
})

describe('artistDiscographyCardData', () => {
	it('keeps an id-less Spotify row display-only through the smart constructor', () => {
		const data = artistDiscographyCardData(album({ id: '' as unknown as string, spotify_id: 'sp-1' }))
		expect(data.catalogAlbumId).toBeNull()
		expect(data.spotifyAlbumId).toBe('sp-1')
	})

	it('reads a malformed release date as no year', () => {
		expect(artistDiscographyCardData(album({ release_date: 'unknown' })).year).toBeNull()
	})
})
