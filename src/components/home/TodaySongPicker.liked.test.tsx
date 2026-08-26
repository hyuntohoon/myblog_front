// FEAT-todays-pick-liked-tab — locks the 좋아요 tab's contracts:
//  (1) it loads lazily (opening the modal must not fetch ~1000 saved tracks),
//  (2) the client-side filter searches the WHOLE resident set, not just the
//      rows currently painted (LIKED_RENDER_STEP caps rendering, not matching),
//  (3) a saved track with no catalog track_id cannot be posted or queued —
//      daily_picks.track_id is NOT NULL, so posting one would 500/violate,
//  (4) a postable row goes straight to onPick with DB ids already resolved —
//      no music-service round trip, unlike a 검색 tab hit.
import type { components } from '@lib/api.gen'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TodaySongPicker from './TodaySongPicker'

type SavedTrack = components['schemas']['Backend_SavedTrackItem']

const api = vi.hoisted(() => ({
	listSavedTracks: vi.fn(),
	addToPickQueue: vi.fn(),
	getPickQueue: vi.fn(),
}))

vi.mock('@components/member/analysis.api', () => ({ listSavedTracks: api.listSavedTracks }))
vi.mock('@lib/todaysPick', () => ({
	getPickQueue: api.getPickQueue,
	addToPickQueue: api.addToPickQueue,
	promoteFromPickQueue: vi.fn(),
	removeFromPickQueue: vi.fn(),
}))
// The 검색 tab's search core is irrelevant here and would otherwise fetch.
vi.mock('@lib/useMusicSearch', () => ({
	useMusicSearch: () => ({
		query: '',
		setQuery: vi.fn(),
		tracks: [],
		status: '',
		loading: false,
		loadingMore: null,
		hasMore: { track: 0 },
		spotifyCooldown: false,
		runDbSearch: vi.fn(),
		runSpotifySync: vi.fn(),
		loadMore: vi.fn(),
		reset: vi.fn(),
	}),
}))

function saved(i: number, over: Partial<SavedTrack> = {}): SavedTrack {
	return {
		spotify_track_id: `sp${i}`,
		track_id: `trk-${i}`,
		track_name: `Song ${i}`,
		artist_name: `Artist ${i}`,
		album_name: `Album ${i}`,
		album_sid: `spalb${i}`,
		album_id: `alb-${i}`,
		album: { id: `alb-${i}`, title: `Album ${i}`, cover_url: `https://cdn/${i}.jpg`, artist_names: [], genres: [] },
		added_at: '2026-08-01T00:00:00Z',
		duration_ms: 200000,
		...over,
	}
}

function mount(onPick = vi.fn().mockResolvedValue(true)) {
	render(<TodaySongPicker onPick={onPick} onPromoted={vi.fn()} onClose={vi.fn()} />)
	return onPick
}

const openLiked = () => fireEvent.click(screen.getByRole('tab', { name: /좋아요/ }))

beforeEach(() => {
	vi.clearAllMocks()
	api.getPickQueue.mockResolvedValue([])
	api.addToPickQueue.mockResolvedValue({ id: 'q1', title: 'Song 1', artist: 'Artist 1', cover_url: null })
})

describe('todaySongPicker 좋아요 tab', () => {
	it('does not fetch saved tracks until the tab is opened', async () => {
		api.listSavedTracks.mockResolvedValue({ items: [saved(1)], total: 1, lastSyncedAt: null })
		mount()

		await waitFor(() => expect(api.getPickQueue).toHaveBeenCalled())
		expect(api.listSavedTracks).not.toHaveBeenCalled()

		openLiked()
		await screen.findByText('Song 1')
		expect(api.listSavedTracks).toHaveBeenCalledTimes(1)
	})

	it('filters across the whole loaded set, past the render cap', async () => {
		// 70 rows > LIKED_RENDER_STEP (60): row 69 is resident but unpainted, and
		// must still be findable by the filter.
		const items = Array.from({ length: 70 }, (_, i) => saved(i))
		api.listSavedTracks.mockResolvedValue({ items, total: 70, lastSyncedAt: null })
		mount()
		openLiked()

		await screen.findByText('Song 0')
		expect(screen.queryByText('Song 69')).toBeNull()

		fireEvent.change(screen.getByLabelText('좋아요 목록 거르기'), { target: { value: 'song 69' } })

		expect(await screen.findByText('Song 69')).toBeTruthy()
		expect(screen.queryByText('Song 0')).toBeNull()
	})

	it('refuses a saved track with no catalog track id', async () => {
		api.listSavedTracks.mockResolvedValue({
			items: [saved(1, { track_id: null })],
			total: 1,
			lastSyncedAt: null,
		})
		mount()
		openLiked()

		await screen.findByText('Song 1')
		expect(screen.getByText('카탈로그에 없음')).toBeTruthy()
		expect(screen.getByRole('button', { name: '오늘의 곡으로 ↑' })).toHaveProperty('disabled', true)
		expect(screen.getByRole('button', { name: '큐에 담기' })).toHaveProperty('disabled', true)
	})

	it('posts a liked row with its DB ids, no re-resolve', async () => {
		api.listSavedTracks.mockResolvedValue({ items: [saved(1)], total: 1, lastSyncedAt: null })
		const fetchSpy = vi.spyOn(globalThis, 'fetch')
		const onPick = mount()
		openLiked()

		await screen.findByText('Song 1')
		fireEvent.click(screen.getByRole('button', { name: '오늘의 곡으로 ↑' }))

		await waitFor(() => expect(onPick).toHaveBeenCalledWith({
			track_id: 'trk-1',
			album_id: 'alb-1',
			title: 'Song 1',
			artist: 'Artist 1',
			cover_url: 'https://cdn/1.jpg',
			spotify_track_id: 'sp1',
		}))
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it('stages a liked row into the queue', async () => {
		api.listSavedTracks.mockResolvedValue({ items: [saved(1)], total: 1, lastSyncedAt: null })
		mount()
		openLiked()

		await screen.findByText('Song 1')
		fireEvent.click(screen.getByRole('button', { name: '큐에 담기' }))

		await waitFor(() => expect(api.addToPickQueue).toHaveBeenCalledWith(
			expect.objectContaining({ track_id: 'trk-1', album_id: 'alb-1' }),
		))
	})
})
