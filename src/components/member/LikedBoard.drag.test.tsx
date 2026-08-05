// ARCH-entity-interaction-v2 Step 5 — LikedBoard's TrackRow `drag` grant. The
// dragstart→bridge mechanism itself is already pinned by TrackRow.test.tsx; this
// test only pins the NEW glue — the row's dragstart carries a `kind: 'external',
// copies: true` payload (a liked track is not a bucket membership) built from the
// row's spotify_track_id + DB album id.
import type { SavedTracks } from './analysis.api'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PB_BOARD_DND_START_EVENT, PB_DND_START_EVENT } from '@lib/pocketBuckit/events'
import { LikedBoard } from './LikedBoard'

const FIXTURE: SavedTracks = {
	items: [{
		spotify_track_id: 'sp-track-1',
		track_name: 'Helmet',
		artist_name: 'Steve Lacy',
		artist_id: null,
		album_name: 'Gemini Rights',
		album_id: 'album-db-1',
		album_sid: null,
		album: null,
		duration_ms: 202000,
		added_at: '2026-08-04T00:00:00Z',
	}],
	total: 1,
	lastSyncedAt: null,
}

vi.mock('./analysis.api', async importOriginal => ({
	...(await importOriginal<typeof import('./analysis.api')>()),
	listSavedTracks: () => Promise.resolve(FIXTURE),
}))

describe('likedBoard — drag grant', () => {
	it('dispatches an external, copies:true track payload on row dragstart', async () => {
		const startSpy = vi.fn()
		const boardStartSpy = vi.fn()
		window.addEventListener(PB_DND_START_EVENT, startSpy)
		window.addEventListener(PB_BOARD_DND_START_EVENT, boardStartSpy)

		render(<LikedBoard />)
		const row = (await screen.findByText('Helmet')).closest('[draggable]')!
		fireEvent.dragStart(row, { dataTransfer: {} })

		const expected = {
			ref: { entity: 'track', trackId: 'sp-track-1', albumId: 'album-db-1' },
			origin: { kind: 'external', copies: true },
		}
		expect((startSpy.mock.calls[0][0] as CustomEvent).detail).toEqual(expected)
		expect((boardStartSpy.mock.calls[0][0] as CustomEvent).detail).toEqual(expected)

		window.removeEventListener(PB_DND_START_EVENT, startSpy)
		window.removeEventListener(PB_BOARD_DND_START_EVENT, boardStartSpy)
	})
})
