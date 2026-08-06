// ARCH-album-card-contract-and-composition Stage 2 — pins the unused shim's
// zero-output behavior and the drag/tap capability pairing before Stage 3.
import type { DragPayload } from '@lib/entityDrag'
import type { AlbumCardCapabilities, AlbumCardData } from './AlbumCard'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AlbumCard } from './AlbumCard'

const DATA: AlbumCardData = {
	catalogAlbumId: 'album-1',
	spotifyAlbumId: null,
	title: 'Kind of Blue',
	artist: 'Miles Davis',
	artistId: 'artist-1',
	cover: null,
	year: 1959,
}

const DRAG: DragPayload = {
	ref: { entity: 'album', albumId: 'album-1' },
	origin: { kind: 'external', copies: true },
}

describe('albumCard — Stage 2 contract shim', () => {
	it('renders nothing observable before Stage 3 wires the presentation', () => {
		const { container } = render(
			<AlbumCard
				data={DATA}
				layout="grid"
				capabilities={{ open: vi.fn(), add: vi.fn(), drag: DRAG }}
			/>,
		)

		expect(container.innerHTML).toMatchInlineSnapshot('""')
		expect(container).toBeEmptyDOMElement()
	})

	it('requires a tap fallback whenever drag is granted', () => {
		const valid: AlbumCardCapabilities = { add: vi.fn(), drag: DRAG }

		// @ts-expect-error Rule #14: drag cannot be the only path to the operation.
		const invalid: AlbumCardCapabilities = { drag: DRAG }

		expect(valid.drag).toBe(DRAG)
		expect(invalid.drag).toBe(DRAG)
	})
})
