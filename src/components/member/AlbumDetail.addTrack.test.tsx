// ARCH-entity-interaction-v2 Step 5 — StandardModal's `onAddTrack` wiring.
// AddToBucketMenu itself is untouched, verified machinery (already shipped
// via ReviewTrackAdder's identical pending-intent pattern); this test only
// pins the NEW glue — clicking a track's ➕ mounts the menu with the right
// track id/title, and repeat clicks on different tracks remount it (fresh
// `key`), matching the seq-bump ReviewTrackAdder already established.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AlbumDetail } from './AlbumDetail'

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

vi.mock('../album/AlbumRatingBlock', () => ({
	default: () => <div data-testid="rating-block" />,
}))

vi.mock('./pocket/AddToBucketMenu', () => ({
	AddToBucketMenu: ({ item }: { item: { itemType: string, trackId: string, title: string } }) => (
		<div data-testid="add-to-bucket-menu">
			{item.itemType}
			:
			{item.trackId}
			:
			{item.title}
		</div>
	),
}))

describe('albumDetail StandardModal add-track wiring', () => {
	it('mounts AddToBucketMenu with the clicked track only after a click', async () => {
		render(<AlbumDetail album={{ album: 'Kind of Blue', albumId: 'album-1' }} reviews={[]} onClose={() => {}} />)
		expect(screen.queryByTestId('add-to-bucket-menu')).not.toBeInTheDocument()

		const buttons = await screen.findAllByRole('button', { name: /담기/ })
		fireEvent.click(buttons[0])
		expect(await screen.findByTestId('add-to-bucket-menu')).toHaveTextContent('track:track-db-1:So What')

		fireEvent.click(buttons[1])
		expect(await screen.findByTestId('add-to-bucket-menu')).toHaveTextContent('track:track-db-2:Freddie Freeloader')
	})
})
