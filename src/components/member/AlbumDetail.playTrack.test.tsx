// ARCH-entity-interaction-v2 Step 5 — StandardModal's `onPlayTrack` wiring.
// `playbackSession.replaceQueueAndPlay` itself is untouched, verified machinery
// (already shipped via the vanilla review page's per-track ▶); this test only
// pins the NEW glue — clicking a track's ▶ calls it with the DB track id +
// title, and the toast it returns is shown.
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AlbumDetail } from './AlbumDetail'

const FIXTURE = {
	album: { id: 'album-1', title: 'Kind of Blue', release_date: '1959-08-17', cover_url: null, album_type: 'album', label: null },
	artists: [],
	tracks: [
		{ id: 'track-db-1', title: 'So What', track_no: 1, duration_sec: 545, spotify_id: 'sp-1', feat_artist_names: [] },
		{ id: 'track-db-2', title: 'Freddie Freeloader', track_no: 2, duration_sec: 588, spotify_id: null, feat_artist_names: [] },
	],
}

const replaceQueueAndPlay = vi.fn()

vi.mock('@lib/albumDetail', () => ({
	getCachedAlbumDetail: () => FIXTURE,
	fetchAlbumDetail: () => Promise.resolve(FIXTURE),
}))

vi.mock('./AlbumRatingBlock', () => ({
	default: () => <div data-testid="rating-block" />,
}))

vi.mock('../album/AlbumRatingBlock', () => ({
	default: () => <div data-testid="rating-block" />,
}))

vi.mock('@lib/playback/session', () => ({
	playbackSession: { replaceQueueAndPlay: (...args: unknown[]) => replaceQueueAndPlay(...args) },
}))

vi.mock('@lib/spotifyCapability', () => ({
	rememberSpotifyTransportProbe: () => {},
}))

describe('albumDetail StandardModal play-track wiring', () => {
	beforeEach(() => {
		replaceQueueAndPlay.mockReset()
	})

	it('calls replaceQueueAndPlay with the clicked track and shows the returned toast', async () => {
		replaceQueueAndPlay.mockResolvedValue({ ok: true, message: '재생 대기열을 이 곡으로 바꿨어요', undo: null, play: null })
		render(<AlbumDetail album={{ album: 'Kind of Blue', albumId: 'album-1' }} reviews={[]} onClose={() => {}} />)

		const buttons = await screen.findAllByRole('button', { name: /재생/ })
		fireEvent.click(buttons[0])

		expect(replaceQueueAndPlay).toHaveBeenCalledWith({ kind: 'track', trackId: 'track-db-1', title: 'So What' })
		expect(await screen.findByText('재생 대기열을 이 곡으로 바꿨어요')).toBeInTheDocument()
	})
})
