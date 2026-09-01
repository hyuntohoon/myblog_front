// ARCH-album-card-contract-and-composition — /search album-grid migration onto the
// canonical card. The interaction test the RFC's test strategy requires per migrated
// surface: capability wiring (open / add / drag) for a catalog hit, and the
// display-only boundary for a Spotify-only hit whose foreign id must never become a
// catalog write.
import type { AlbumHit, UseMusicSearch } from '@lib/useMusicSearch'
import type { BoardBucket } from '@lib/buckets'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as buckets from '@lib/buckets'
import * as entityEvents from '@lib/entityEvents'
import { bucketStore } from '@lib/pocketBuckit/bucketStore'
import SearchPage from './SearchPage'

vi.mock('@lib/auth', () => ({ isLoggedIn: () => true, goLogin: vi.fn() }))
vi.mock('@lib/owner', () => ({ isOwnerUser: () => false }))

vi.mock('@lib/reviewIndex', () => ({
	loadReviews: vi.fn().mockResolvedValue([]),
	filterReviews: vi.fn().mockReturnValue([]),
}))

vi.mock('@lib/entityEvents', async importOriginal => ({
	...await importOriginal<typeof import('@lib/entityEvents')>(),
	openAlbum: vi.fn(),
}))

vi.mock('@lib/buckets', async importOriginal => ({
	...await importOriginal<typeof import('@lib/buckets')>(),
	addBucketItem: vi.fn(),
	listBuckets: vi.fn(),
}))

const ALBUMS: AlbumHit[] = [
	{
		kind: 'album',
		id: 'album-cat-1',
		title: 'Kind of Blue',
		artistId: 'artist-1',
		artist: 'Miles Davis',
		cover: 'https://example.test/kob.jpg',
		year: '1959',
		spotifyId: null,
		source: 'db',
	},
	{
		kind: 'album',
		id: null,
		title: 'Unregistered Sessions',
		artistId: null,
		artist: 'Someone Else',
		cover: null,
		year: '2024',
		spotifyId: 'spotify-only-1',
		source: 'spotify',
	},
]

const TARGET: BoardBucket = {
	id: 'bucket-1',
	name: 'Pocket Buckit',
	color: null,
	isDone: false,
	kind: 'review',
	type: 'general',
	isPublic: false,
	researchMode: 'off',
	albums: [],
	children: [],
}

const searchState: UseMusicSearch = {
	query: 'blue',
	setQuery: vi.fn(),
	albums: ALBUMS,
	artists: [],
	tracks: [],
	loading: false,
	loadingMore: null,
	status: '',
	searchFailed: false,
	moreFailed: null,
	syncRequested: false,
	source: 'db',
	setSource: vi.fn(),
	spotifyCooldown: false,
	hasMore: { album: 0, artist: 0, track: 0 },
	runDbSearch: vi.fn().mockResolvedValue(undefined),
	runSpotifySync: vi.fn().mockResolvedValue(undefined),
	loadMore: vi.fn().mockResolvedValue(undefined),
	reset: vi.fn(),
}

vi.mock('@lib/useMusicSearch', async importOriginal => ({
	...await importOriginal<typeof import('@lib/useMusicSearch')>(),
	useMusicSearch: () => searchState,
}))

function cardFor(title: string): HTMLElement {
	const heading = screen.getByRole('heading', { name: title })
	const card = heading.closest('article.album-card')
	if (!card)
		throw new Error(`no canonical album card rendered for ${title}`)
	return card as HTMLElement
}

beforeEach(() => {
	bucketStore.clear()
	sessionStorage.clear()
	window.history.replaceState(null, '', '/search?q=blue')
	vi.mocked(buckets.listBuckets).mockReset().mockResolvedValue([TARGET])
	vi.mocked(buckets.addBucketItem).mockReset().mockResolvedValue({ item: null, conflict: false })
	vi.mocked(entityEvents.openAlbum).mockReset()
})

describe('/search album grid on the canonical album card', () => {
	it('renders catalog hits as the shared primitive, not a search-local card', () => {
		render(<SearchPage />)
		// The bespoke `gs-albcard` album tile is gone; only the review renderer may
		// still use that class, and this fixture has no reviews.
		expect(document.querySelectorAll('.gs-albcard')).toHaveLength(0)
		expect(document.querySelectorAll('article.album-card')).toHaveLength(2)
	})

	it('grants open, add, and copy-drag to a catalog-backed hit', () => {
		render(<SearchPage />)
		const card = cardFor('Kind of Blue')

		expect(card).toHaveAttribute('draggable', 'true')
		within(card).getByRole('button', { name: 'Kind of Blue 버킷에 담기' })

		within(card).getByRole('button', { name: /앨범 보기/ }).click()
		expect(entityEvents.openAlbum).toHaveBeenCalledWith(expect.objectContaining({
			albumId: 'album-cat-1',
			title: 'Kind of Blue',
			year: 1959,
		}))
	})

	it('keeps the artist link on the canonical byline', () => {
		render(<SearchPage />)
		const link = within(cardFor('Kind of Blue')).getByRole('link', { name: 'Miles Davis' })
		expect(link).toHaveAttribute('href', '/artist/artist-1/')
	})

	it('leaves a Spotify-only hit display-only and never writes its foreign id', () => {
		render(<SearchPage />)
		const card = cardFor('Unregistered Sessions')

		expect(card).not.toHaveAttribute('draggable')
		expect(within(card).queryByRole('button', { name: /담기/ })).toBeNull()
		expect(within(card).queryByRole('button', { name: /앨범 보기/ })).toBeNull()
		within(card).getByText('카탈로그 등록 후 담기 가능')
		expect(card.outerHTML).not.toContain('spotify-only-1')
	})
})
