// ARCH-entity-interaction-v2 Step 5 — AlbumDetailView Tracklist's `drag` grant
// (member modal only — `enableDrag` omitted ⇒ public `AlbumOverlay`'s Tracklist
// stays non-draggable, same shape as `onAddTrack`). Mirrors
// `LikedBoard.drag.test.tsx`'s pattern: pin the dragstart payload shape, not the
// dragstart→bridge mechanism itself (already pinned by TrackRow.test.tsx).
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PB_BOARD_DND_START_EVENT, PB_DND_START_EVENT } from '@lib/pocketBuckit/events'
import { AlbumDetailView } from './AlbumDetailView'

const FIXTURE = {
	album: { id: 'album-1', title: 'Kind of Blue', release_date: '1959-08-17', cover_url: null, album_type: 'album', label: null },
	artists: [],
	tracks: [
		{ id: 'track-db-1', title: 'So What', track_no: 1, duration_sec: 545, spotify_id: 'sp-1', feat_artist_names: [] },
	],
}

vi.mock('@lib/albumDetail', () => ({
	getCachedAlbumDetail: () => FIXTURE,
	fetchAlbumDetail: () => Promise.resolve(FIXTURE),
}))

vi.mock('./AlbumRatingBlock', () => ({
	default: () => <div data-testid="rating-block" />,
}))

describe('albumDetailView Tracklist drag grant', () => {
	it('dispatches an external, copies:true track payload on row dragstart when enableDrag is set', async () => {
		const startSpy = vi.fn()
		const boardStartSpy = vi.fn()
		window.addEventListener(PB_DND_START_EVENT, startSpy)
		window.addEventListener(PB_BOARD_DND_START_EVENT, boardStartSpy)

		render(<AlbumDetailView albumId="album-1" title="Kind of Blue" enableDrag />)
		const row = (await screen.findByText('So What')).closest('[draggable]')!
		fireEvent.dragStart(row, { dataTransfer: {} })

		const expected = {
			ref: { entity: 'track', trackId: 'track-db-1', albumId: 'album-1' },
			origin: { kind: 'external', copies: true },
		}
		expect((startSpy.mock.calls[0][0] as CustomEvent).detail).toEqual(expected)
		expect((boardStartSpy.mock.calls[0][0] as CustomEvent).detail).toEqual(expected)

		window.removeEventListener(PB_DND_START_EVENT, startSpy)
		window.removeEventListener(PB_BOARD_DND_START_EVENT, boardStartSpy)
	})

	it('renders no draggable row when enableDrag is omitted (public AlbumOverlay path)', async () => {
		render(<AlbumDetailView albumId="album-1" title="Kind of Blue" />)
		await screen.findByText('So What')
		expect(document.querySelector('[draggable]')).not.toBeInTheDocument()
	})
})
