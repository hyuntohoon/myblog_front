// ARCH-entity-interaction-v2 Step 5 — the `add` grant on AlbumDetailView's
// Tracklist. Mirrors the existing `onOpenLyrics` gating tests conceptually:
// present a track list, assert the ➕ button dispatches the DB track id, and
// that omitting onAddTrack (the public/AlbumOverlay path) renders no button.
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

describe('albumDetailView Tracklist add grant', () => {
	it('renders a ➕ button per track and calls onAddTrack with the DB id + title', async () => {
		const onAddTrack = vi.fn()
		render(<AlbumDetailView albumId="album-1" title="Kind of Blue" onAddTrack={onAddTrack} />)
		const buttons = await screen.findAllByRole('button', { name: /담기/ })
		expect(buttons).toHaveLength(2)
		fireEvent.click(buttons[0])
		expect(onAddTrack).toHaveBeenCalledWith('track-db-1', 'So What')
		fireEvent.click(buttons[1])
		expect(onAddTrack).toHaveBeenCalledWith('track-db-2', 'Freddie Freeloader')
	})

	it('renders no ➕ button when onAddTrack is omitted (public AlbumOverlay path)', async () => {
		render(<AlbumDetailView albumId="album-1" title="Kind of Blue" />)
		await screen.findByText('So What')
		expect(screen.queryByRole('button', { name: /담기/ })).not.toBeInTheDocument()
	})
})
