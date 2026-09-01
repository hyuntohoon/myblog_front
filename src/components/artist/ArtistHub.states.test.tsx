// FIX-user-flow-state-consistency leg 4 — /artist/[id] must not report a failed
// load as a missing artist.
//
// `getHero` has always distinguished 404 from a 5xx and from a transport error
// (status 0), and ArtistHub collapsed all three into 아티스트를 찾을 수 없습니다.
// Same shape as the /search defect leg 3 fixed: the distinction was computed and
// then dropped. Found by opening the page in a browser, where the hub rendered
// "not found" for an artist that plainly exists.
import type { ArtistHeroResult } from '../../scripts/write/artistApi'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ArtistHub from './ArtistHub'

const api = vi.hoisted(() => ({
	fetchArtistHero: vi.fn(),
	fetchArtistAlbums: vi.fn(),
	fetchArtistTopTracks: vi.fn(),
}))

vi.mock('../../scripts/write/artistApi', () => api)
vi.mock('@lib/auth', () => ({ isLoggedIn: () => false, goLogin: vi.fn() }))
vi.mock('@lib/trackedArtists', () => ({
	listTrackedArtists: vi.fn().mockResolvedValue([]),
	trackArtist: vi.fn(),
	untrackArtist: vi.fn(),
}))

const HERO = {
	ok: true,
	hero: {
		id: 'artist-1',
		name: '100 gecs',
		photo_url: null,
		genres: [],
		catalog_genres: [],
		album_count: 3,
		track_count: 20,
		followers: null,
		popularity: null,
		spotify_url: null,
	},
} as unknown as ArtistHeroResult

function renderHub() {
	return render(<ArtistHub artistId="artist-1" name="100 gecs" reviews={[]} reviewedAlbumIds={[]} />)
}

beforeEach(() => {
	api.fetchArtistHero.mockReset()
	api.fetchArtistAlbums.mockReset().mockResolvedValue([])
	api.fetchArtistTopTracks.mockReset().mockResolvedValue([])
})

afterEach(() => {
	vi.clearAllMocks()
})

describe('artist hub load failure', () => {
	it('says the artist is missing only on a real 404', async () => {
		api.fetchArtistHero.mockResolvedValue({ ok: false, status: 404 })
		renderHub()

		await screen.findByText('아티스트를 찾을 수 없습니다.')
		expect(screen.queryByText('아티스트 정보를 불러오지 못했습니다.')).toBeNull()
	})

	it('says the load failed on a server error', async () => {
		api.fetchArtistHero.mockResolvedValue({ ok: false, status: 503 })
		renderHub()

		await screen.findByText('아티스트 정보를 불러오지 못했습니다.')
		expect(screen.queryByText('아티스트를 찾을 수 없습니다.')).toBeNull()
	})

	it('says the load failed on a transport error', async () => {
		api.fetchArtistHero.mockResolvedValue({ ok: false, status: 0 })
		renderHub()

		await screen.findByText('아티스트 정보를 불러오지 못했습니다.')
		expect(screen.queryByText('아티스트를 찾을 수 없습니다.')).toBeNull()
	})

	it('retries the load and recovers the hub', async () => {
		api.fetchArtistHero
			.mockResolvedValueOnce({ ok: false, status: 0 })
			.mockResolvedValue(HERO)
		renderHub()

		fireEvent.click(await screen.findByRole('button', { name: '다시 시도' }))

		await waitFor(() => {
			expect(screen.getByRole('heading', { name: '100 gecs', level: 1 })).toBeTruthy()
		})
		expect(api.fetchArtistHero).toHaveBeenCalledTimes(2)
	})
})
