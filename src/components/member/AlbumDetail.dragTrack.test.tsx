// ARCH-entity-interaction-v2 Step 5 — the modal `drag` grant + the scrim
// drag-passthrough fix that unblocks it. Pins the NEW glue in both hosts:
// StandardModal (via AlbumDetailView's `enableDrag`) and MemoWindow (its own
// hand-rolled TrackRow) — the payload shape a dragstart carries, and that the
// scrim drops `pointer-events` for the PB_DND_START_EVENT/PB_DND_END_EVENT
// window (so a drag reaches PocketTray underneath) and restores it after.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PB_BOARD_DND_START_EVENT, PB_DND_END_EVENT, PB_DND_START_EVENT } from '@lib/pocketBuckit/events'
import { AlbumDetail } from './AlbumDetail'

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

vi.mock('../album/AlbumRatingBlock', () => ({
	default: () => <div data-testid="rating-block" />,
}))

// MemoWindow's `useIsMobileHost` calls `window.matchMedia` unconditionally —
// jsdom does not implement it, and no prior test has rendered MemoWindow (every
// other AlbumDetail test uses a non-writable album, reaching StandardModal
// instead), so this gap was never hit until this test needed the memo path.
window.matchMedia = window.matchMedia || ((query: string) => ({
	matches: false,
	media: query,
	onchange: null,
	addListener: () => {},
	removeListener: () => {},
	addEventListener: () => {},
	removeEventListener: () => {},
	dispatchEvent: () => false,
}) as MediaQueryList)

const EXPECTED_PAYLOAD = {
	ref: { entity: 'track', trackId: 'track-db-1', albumId: 'album-1' },
	origin: { kind: 'external', copies: true },
}

describe('albumDetail modal — drag grant + scrim passthrough', () => {
	it('standardModal: dispatches the track payload on dragstart and drops/restores scrim pointer-events', async () => {
		const startSpy = vi.fn()
		window.addEventListener(PB_DND_START_EVENT, startSpy)

		render(<AlbumDetail album={{ album: 'Kind of Blue', albumId: 'album-1' }} reviews={[]} onClose={() => {}} />)
		const row = (await screen.findByText('So What')).closest('[draggable]')!
		const scrim = document.querySelector('.scrim') as HTMLElement

		expect(scrim.style.pointerEvents).not.toBe('none')
		fireEvent.dragStart(row, { dataTransfer: {} })
		expect((startSpy.mock.calls[0][0] as CustomEvent).detail).toEqual(EXPECTED_PAYLOAD)
		expect(scrim.style.pointerEvents).toBe('none')

		fireEvent.dragEnd(row)
		expect(scrim.style.pointerEvents).not.toBe('none')

		window.removeEventListener(PB_DND_START_EVENT, startSpy)
	})

	it('memoWindow: dispatches the track payload on dragstart and drops/restores scrim pointer-events', async () => {
		const startSpy = vi.fn()
		const boardStartSpy = vi.fn()
		const endSpy = vi.fn()
		window.addEventListener(PB_DND_START_EVENT, startSpy)
		window.addEventListener(PB_BOARD_DND_START_EVENT, boardStartSpy)
		window.addEventListener(PB_DND_END_EVENT, endSpy)

		render(
			<AlbumDetail
				album={{ album: 'Kind of Blue', albumId: 'album-1', writable: true, bucketId: 'bucket-1', itemId: 'item-1' }}
				reviews={[]}
				onClose={() => {}}
			/>,
		)
		const row = (await screen.findByText('So What')).closest('[draggable]')!
		const scrim = document.querySelector('.scrim') as HTMLElement

		expect(scrim.style.pointerEvents).not.toBe('none')
		fireEvent.dragStart(row, { dataTransfer: {} })
		expect((startSpy.mock.calls[0][0] as CustomEvent).detail).toEqual(EXPECTED_PAYLOAD)
		expect((boardStartSpy.mock.calls[0][0] as CustomEvent).detail).toEqual(EXPECTED_PAYLOAD)
		expect(scrim.style.pointerEvents).toBe('none')

		fireEvent.dragEnd(row)
		expect(endSpy).toHaveBeenCalled()
		expect(scrim.style.pointerEvents).not.toBe('none')

		window.removeEventListener(PB_DND_START_EVENT, startSpy)
		window.removeEventListener(PB_BOARD_DND_START_EVENT, boardStartSpy)
		window.removeEventListener(PB_DND_END_EVENT, endSpy)
	})
})
