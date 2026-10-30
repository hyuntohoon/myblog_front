// Audit #8 — the album header must name the artist even when the opener only
// held a title (member 평가 rows did): the catalog read supplies it.
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AlbumDetailView } from './AlbumDetailView'

const DETAIL = {
	album: { id: 'album-1', title: 'Gemini Rights' },
	artists: [{ id: 'a1', name: 'Steve Lacy', genres: [] }, { id: 'a2', name: 'Fousheé', genres: [] }],
	tracks: [],
}

vi.mock('@lib/albumDetail', () => ({
	getCachedAlbumDetail: () => null,
	fetchAlbumDetail: () => Promise.resolve(DETAIL),
}))

vi.mock('./AlbumRatingBlock', () => ({
	default: ({ display }: { display?: { artist?: string } }) => <div data-testid="rating-artist">{display?.artist}</div>,
}))

function header() {
	return screen.getByRole('banner')
}

describe('albumDetailView header artist', () => {
	it('falls back to the catalog artists when the opener passed none', async () => {
		render(<AlbumDetailView albumId="album-1" title="Gemini Rights" hideArtists />)
		expect(await within(header()).findByText('Steve Lacy, Fousheé')).toBeInTheDocument()
		expect(screen.getByTestId('rating-artist')).toHaveTextContent('Steve Lacy, Fousheé')
	})

	it('keeps the artist the opener passed', async () => {
		render(<AlbumDetailView albumId="album-1" title="Gemini Rights" artist="Steve Lacy" hideArtists />)
		await screen.findByText('발매 정보 없음')
		expect(header()).toHaveTextContent('Steve Lacy')
		expect(header()).not.toHaveTextContent('Fousheé')
	})
})
