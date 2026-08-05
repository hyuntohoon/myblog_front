// Regression test for the `interactive` gate added alongside
// ARCH-entity-interaction-domain-audit item 9 review (releaseShared.tsx's
// dbId-or-spotify-id fallback into OpenAlbumDetail.albumId). AlbumRatingBlock
// PUTs against `albumId`, so it must not render when that id is a
// display-only fallback, not a real catalog id.
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AlbumDetailView } from './AlbumDetailView'

vi.mock('@lib/albumDetail', () => ({
	getCachedAlbumDetail: () => null,
	fetchAlbumDetail: () => Promise.resolve(null),
}))

vi.mock('./AlbumRatingBlock', () => ({
	default: () => <div data-testid="rating-block" />,
}))

describe('albumDetailView interactive gate', () => {
	it('renders AlbumRatingBlock by default (real catalog id)', async () => {
		render(<AlbumDetailView albumId="real-db-uuid" title="Kind of Blue" />)
		expect(await screen.findByTestId('rating-block')).toBeInTheDocument()
	})

	it('hides AlbumRatingBlock when interactive=false (display-only fallback id)', async () => {
		render(<AlbumDetailView albumId="3ByGjXPFtG2b2vJXo1XSKz" title="Kind of Blue" interactive={false} />)
		await screen.findByText('Kind of Blue')
		expect(screen.queryByTestId('rating-block')).not.toBeInTheDocument()
	})
})
