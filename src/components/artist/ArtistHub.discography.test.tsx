// Front UI/UX audit 2026-10-16 S1 — the /artist discography composes the
// canonical AlbumCard through CatalogAlbumCardAdapter, so the same album has
// the same open + ＋ on /artist as on /search (finding #7, #406 class).
import type { AlbumListItem, ArtistHeroResult } from '../../scripts/write/artistApi'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ArtistHub, { artistDiscographyCardData, discographyGroup } from './ArtistHub'

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
			const el = document.querySelector('.art-disco-block')
			expect(el?.querySelector('.art-disco-grid')).not.toBeNull()
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

// Front UI/UX audit #7 (rest): 앨범 / 싱글·EP groups, masthead counts by type,
// no dangling "·" in the footnote, and no empty CRITIC'S LENS.
describe('artist hub audit #7', () => {
	function groupTitles() {
		return [...document.querySelectorAll('.art-disco-group-title')].map(el => el.textContent)
	}
	function groupTitlesOf(title: string) {
		const label = [...document.querySelectorAll('.art-disco-group-title')]
			.find(el => el.firstChild?.textContent === title)
		const section = label?.closest('section') as HTMLElement
		return [...section.querySelectorAll('.album-card__title')].map(el => el.textContent)
	}

	it('fetches the whole discography in one page', async () => {
		renderHub()
		await screen.findByRole('button', { name: 'Break 앨범 보기' })
		expect(api.fetchArtistAlbums).toHaveBeenCalledWith('artist-1', 100)
	})

	it('groups albums before singles, with compilations and untyped rows as albums', async () => {
		api.fetchArtistAlbums.mockResolvedValue([
			album({ id: 's1', title: 'Single A', album_type: 'single' }),
			album({ id: 'a1', title: 'LP', album_type: 'album' }),
			album({ id: 'c1', title: 'Comp', album_type: 'compilation' }),
			album({ id: 'n1', title: 'Untyped', album_type: null }),
			album({ id: 's2', title: 'Single B', album_type: 'single' }),
		])
		renderHub()
		await screen.findByRole('button', { name: 'LP 앨범 보기' })
		expect(groupTitles()).toEqual(['앨범3', '싱글·EP2'])
		expect(groupTitlesOf('앨범')).toEqual(['LP', 'Comp', 'Untyped'])
		expect(groupTitlesOf('싱글·EP')).toEqual(['Single A', 'Single B'])
		expect(screen.getByRole('region', { name: /싱글·EP/ })).toBeTruthy()
	})

	it('omits a group with no releases', async () => {
		api.fetchArtistAlbums.mockResolvedValue([album({ id: 's1', title: 'Only', album_type: 'single' })])
		renderHub()
		await screen.findByRole('button', { name: 'Only 앨범 보기' })
		expect(groupTitles()).toEqual(['싱글·EP1'])
	})

	it('sorts inside each group', async () => {
		api.fetchArtistAlbums.mockResolvedValue([
			album({ id: 's1', title: 'Old', album_type: 'single', release_date: '2012-01-01' }),
			album({ id: 's2', title: 'New', album_type: 'single', release_date: '2020-01-01' }),
			album({ id: 'a1', title: 'LP', album_type: 'album', release_date: '2015-01-01' }),
		])
		renderHub()
		await screen.findByRole('button', { name: 'LP 앨범 보기' })
		fireEvent.click(screen.getByRole('button', { name: '최신순' }))
		expect(groupTitlesOf('앨범')).toEqual(['LP'])
		expect(groupTitlesOf('싱글·EP')).toEqual(['New', 'Old'])
	})

	it('counts the masthead by type over every fetched album', async () => {
		renderHub()
		await screen.findByRole('button', { name: 'Break 앨범 보기' })
		const counts = document.querySelector('.art-id-counts') as HTMLElement
		expect(counts.textContent).toBe('1 앨범·1 싱글·EP·20 트랙')
	})

	it('keeps the hero album count when the album list is empty', async () => {
		api.fetchArtistAlbums.mockResolvedValue([])
		renderHub()
		await screen.findByText('등록된 앨범이 없습니다.')
		expect(document.querySelector('.art-id-counts')?.textContent).toBe('2 앨범·20 트랙')
	})

	it('puts no leading dot before the followers when there is no Spotify link', async () => {
		api.fetchArtistHero.mockResolvedValue({ ...HERO, hero: { ...HERO.ok && HERO.hero, followers: 1500, popularity: 40 } } as ArtistHeroResult)
		renderHub()
		await screen.findByText('팔로워 1.5K')
		const foot = document.querySelector('.art-id-foot') as HTMLElement
		expect(foot.firstElementChild?.textContent).toBe('팔로워 1.5K')
		expect(foot.textContent).toBe('팔로워 1.5K·인기도 40')
	})

	it('renders no footnote at all when it has nothing to show', async () => {
		renderHub()
		await screen.findByRole('button', { name: 'Break 앨범 보기' })
		expect(document.querySelector('.art-id-foot')).toBeNull()
	})

	it('renders no CRITIC\u2019S LENS section without a 평론', async () => {
		renderHub()
		await screen.findByRole('button', { name: 'Break 앨범 보기' })
		expect(screen.queryByText('THE CRITIC’S LENS')).toBeNull()
		expect(screen.queryByText('아직 이 아티스트의 평론이 없습니다.')).toBeNull()
	})

	it('still renders the lens when the artist has a 평론', async () => {
		render(
			<ArtistHub
				artistId="artist-1"
				name="빈지노"
				reviews={[{ slug: 'nowitzki', album: 'NOWITZKI', cover: null, rating: 4, year: 2023, genre: null, pull: null, bestNew: false }] as never}
				reviewedAlbumIds={['alb-2']}
			/>,
		)
		// the lens renders from props before the album fetch resolves — wait
		// for the catalog, not the lens, before reading the groups
		await screen.findByRole('button', { name: 'Break 앨범 보기' })
		expect(screen.getByText('THE CRITIC’S LENS')).toBeTruthy()
		expect(screen.getByText('NOWITZKI')).toBeTruthy()
		// the reviewed album leaves the catalog, and its group with it
		expect(groupTitles()).toEqual(['싱글·EP1'])
	})

	it('maps album types to groups', () => {
		expect(discographyGroup(album({ album_type: 'single' }))).toBe('single')
		expect(discographyGroup(album({ album_type: 'album' }))).toBe('album')
		expect(discographyGroup(album({ album_type: 'compilation' }))).toBe('album')
		expect(discographyGroup(album({ album_type: null }))).toBe('album')
	})
})
