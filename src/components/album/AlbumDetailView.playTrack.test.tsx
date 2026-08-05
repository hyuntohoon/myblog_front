// ARCH-entity-interaction-v2 Step 5 — the `play` grant on AlbumDetailView's
// Tracklist. Mirrors AlbumDetailView.addTrack.test.tsx exactly, one prop over:
// present a track list, assert the ▶ button dispatches the DB track id, and
// that omitting onPlayTrack renders no button.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AlbumDetailView } from './AlbumDetailView'

const FIXTURE = {
	album: { id: 'album-1', title: 'Kind of Blue', release_date: '1959-08-17', cover_url: null, album_type: 'album', label: null },
	artists: [],
	tracks: [
		{ id: 'track-db-1', title: 'So What', track_no: 1, duration_sec: 545, spotify_id: 'sp-1', feat_artist_names: [] },
		{ id: 'track-db-2', title: 'Freddie Freeloader', track_no: 2, duration_sec: 588, spotify_id: null, feat_artist_names: [] },
	],
}

vi.mock('@lib/albumDetail', () => ({
	getCachedAlbumDetail: () => FIXTURE,
	fetchAlbumDetail: () => Promise.resolve(FIXTURE),
}))

vi.mock('./AlbumRatingBlock', () => ({
	default: () => <div data-testid="rating-block" />,
}))

describe('albumDetailView Tracklist play grant', () => {
	it('renders a ▶ button per track and calls onPlayTrack with the DB id + title', async () => {
		const onPlayTrack = vi.fn()
		render(<AlbumDetailView albumId="album-1" title="Kind of Blue" onPlayTrack={onPlayTrack} />)
		const buttons = await screen.findAllByRole('button', { name: /재생/ })
		expect(buttons).toHaveLength(2)
		fireEvent.click(buttons[0])
		expect(onPlayTrack).toHaveBeenCalledWith('track-db-1', 'So What')
		fireEvent.click(buttons[1])
		expect(onPlayTrack).toHaveBeenCalledWith('track-db-2', 'Freddie Freeloader')
	})

	it('renders no ▶ button when onPlayTrack is omitted', async () => {
		render(<AlbumDetailView albumId="album-1" title="Kind of Blue" />)
		await screen.findByText('So What')
		expect(screen.queryByRole('button', { name: /재생/ })).not.toBeInTheDocument()
	})
})
