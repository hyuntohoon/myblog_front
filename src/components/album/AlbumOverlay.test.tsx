// FIX-auth-identity-lifecycle Step 2 — the overlay's half of the post-login
// rating resume: it has to pick up an open dispatched by a SIBLING island whose
// mount effect may have run before this one's listener existed, and it must pass
// `openRating` down only for a real catalog id.
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { consumeLatchedOpenAlbum, openAlbum, openAlbumLatched } from '@lib/entityEvents'
import AlbumOverlay from './AlbumOverlay'

vi.mock('@lib/auth', () => ({ isLoggedIn: () => false }))
vi.mock('@lib/playback/session', () => ({ playbackSession: { replaceQueueAndPlay: vi.fn() } }))
vi.mock('@lib/spotifyCapability', () => ({ rememberSpotifyTransportProbe: vi.fn() }))
vi.mock('@lib/useDismissable', () => ({ useDismissable: vi.fn() }))
vi.mock('@lib/useScrollLock', () => ({ useScrollLock: vi.fn() }))
vi.mock('./AlbumDetailView', () => ({
	AlbumDetailView: ({ albumId, openRating, interactive }: { albumId: string, openRating?: boolean, interactive?: boolean }) => (
		<div data-testid="detail" data-album={albumId} data-open-rating={String(!!openRating)} data-interactive={String(interactive !== false)} />
	),
	Header: () => null,
}))

beforeEach(() => {
	consumeLatchedOpenAlbum()
})

it('opens on the event, the ordinary path', async () => {
	render(<AlbumOverlay />)
	act(() => openAlbum({ albumId: 'album-1', title: 'Kid A' }))

	const detail = await screen.findByTestId('detail')
	expect(detail).toHaveAttribute('data-album', 'album-1')
	expect(detail).toHaveAttribute('data-open-rating', 'false')
})

describe('post-login resume', () => {
	it('picks up an open latched before it mounted', async () => {
		// The sibling island won the hydration race: its dispatch has already come
		// and gone by the time this overlay attaches a listener.
		openAlbumLatched({ albumId: 'album-1', title: 'Kid A', openRating: true })

		render(<AlbumOverlay />)

		const detail = await screen.findByTestId('detail')
		expect(detail).toHaveAttribute('data-album', 'album-1')
		expect(detail).toHaveAttribute('data-open-rating', 'true')
	})

	it('consumes the latch, so a later mount does not replay the open', async () => {
		openAlbumLatched({ albumId: 'album-1', openRating: true })
		render(<AlbumOverlay />)
		await screen.findByTestId('detail')

		expect(consumeLatchedOpenAlbum()).toBeNull()
	})

	it('clears the latch when it received the event instead', async () => {
		render(<AlbumOverlay />)
		act(() => openAlbumLatched({ albumId: 'album-1', openRating: true }))

		await screen.findByTestId('detail')
		expect(consumeLatchedOpenAlbum()).toBeNull()
	})

	it('never forwards openRating for a display-only fallback id', async () => {
		// `unresolved` means the id is a Spotify id, not a catalog one — there is
		// no write panel to open and a PUT against it would target the wrong
		// namespace.
		openAlbumLatched({ albumId: 'spotify-id', openRating: true, unresolved: true })

		render(<AlbumOverlay />)

		const detail = await screen.findByTestId('detail')
		expect(detail).toHaveAttribute('data-interactive', 'false')
		expect(detail).toHaveAttribute('data-open-rating', 'false')
	})
})

it('ignores an open with no album id', async () => {
	render(<AlbumOverlay />)
	act(() => openAlbum({ albumId: '' }))

	await waitFor(() => expect(screen.queryByTestId('detail')).toBeNull())
})
