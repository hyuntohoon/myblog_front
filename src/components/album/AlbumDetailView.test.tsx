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
	default: ({ openRating, display }: { openRating?: boolean, display?: { title?: string, artist?: string, cover?: string | null, year?: number | null } }) => (
		<div
			data-testid="rating-block"
			data-open-rating={String(!!openRating)}
			data-display={JSON.stringify(display ?? null)}
		/>
	),
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

// FIX-auth-identity-lifecycle Step 2 — the view is the only thing standing
// between a resumed `rate-album` intent and the editor it has to reopen.
describe('albumDetailView rating resume', () => {
	it('does not ask for the editor unless the resume did', async () => {
		render(<AlbumDetailView albumId="real-db-uuid" title="Kind of Blue" />)
		expect(await screen.findByTestId('rating-block')).toHaveAttribute('data-open-rating', 'false')
	})

	it('forwards openRating so the resumed overlay lands on the editor', async () => {
		render(<AlbumDetailView albumId="real-db-uuid" title="Kind of Blue" openRating />)
		expect(await screen.findByTestId('rating-block')).toHaveAttribute('data-open-rating', 'true')
	})

	it('forwards the display identity a parked rate-album intent needs', async () => {
		// Without it the CTA can only park a bare album id, and the overlay it
		// reopens flashes an empty header for the length of the detail fetch.
		render(<AlbumDetailView albumId="real-db-uuid" title="Kind of Blue" artist="Miles Davis" cover="c.jpg" year={1959} />)
		const block = await screen.findByTestId('rating-block')
		expect(JSON.parse(block.getAttribute('data-display') ?? 'null')).toEqual({
			title: 'Kind of Blue',
			artist: 'Miles Davis',
			cover: 'c.jpg',
			year: 1959,
		})
	})
})
