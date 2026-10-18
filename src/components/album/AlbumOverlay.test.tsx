// FIX-auth-identity-lifecycle Step 2 — the overlay's half of the post-login
// rating resume: it has to pick up an open dispatched by a SIBLING island whose
// mount effect may have run before this one's listener existed, and it must pass
// `openRating` down only for a real catalog id.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { consumeLatchedOpenAlbum, openAlbum, openAlbumLatched, POPSTATE_CLAIM } from '@lib/entityEvents'
import AlbumOverlay from './AlbumOverlay'

vi.mock('@lib/auth', () => ({ isLoggedIn: () => false }))
vi.mock('@lib/playback/session', () => ({ playbackSession: { replaceQueueAndPlay: vi.fn() } }))
vi.mock('@lib/spotifyCapability', () => ({ rememberSpotifyTransportProbe: vi.fn() }))
vi.mock('@lib/useDismissable', () => ({ useDismissable: vi.fn() }))
vi.mock('@lib/useScrollLock', () => ({ useScrollLock: vi.fn() }))
vi.mock('./AlbumDetailView', () => ({
	AlbumDetailView: ({ albumId, openRating, interactive }: { albumId: string, openRating?: boolean, interactive?: boolean }) => (
		<div data-testid="detail" data-album={albumId} data-open-rating={String(!!openRating)} data-interactive={String(interactive !== false)}>
			<a href="/artist/a-1/">Radiohead</a>
		</div>
	),
	Header: () => null,
}))

beforeEach(() => {
	consumeLatchedOpenAlbum()
	// jsdom keeps one history per file; start each test on a plain page entry
	// shaped like the one ClientRouter writes, so an earlier test's overlay entry
	// is not adopted as a reload.
	window.history.replaceState({ index: 0, scrollX: 0, scrollY: 0 }, '')
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

// Owner decision D2 (front UI/UX audit 2026-10-16): Back closes the overlay
// through a history entry with no URL change.
describe('clicks inside the overlay', () => {
	// ClientRouter intercepts link clicks with one listener on `document`; a
	// click the card swallows on the way up never reaches it and the browser
	// does a full page load instead of a swap.
	it('lets a link click reach document, where the router listens', async () => {
		render(<AlbumOverlay />)
		act(() => openAlbum({ albumId: 'album-1' }))
		await screen.findByTestId('detail')
		const seen = vi.fn((e: Event) => e.preventDefault())
		document.addEventListener('click', seen)
		try {
			fireEvent.click(screen.getByRole('link', { name: 'Radiohead' }))
		}
		finally {
			document.removeEventListener('click', seen)
		}

		expect(seen).toHaveBeenCalledTimes(1)
		// Reaching the scrim on the way up must not close it: the swap closes it.
		expect(screen.getByTestId('detail')).toBeInTheDocument()
	})

	it('closes on the scrim itself', async () => {
		render(<AlbumOverlay />)
		act(() => openAlbum({ albumId: 'album-1' }))
		await screen.findByTestId('detail')

		fireEvent.click(screen.getByRole('presentation'))

		expect(screen.queryByTestId('detail')).toBeNull()
	})
})

describe('back closes the overlay', () => {
	// layout.astro's inline head script, the first popstate listener on the page.
	const claimBridge = (e: PopStateEvent) => {
		const claim = new CustomEvent(POPSTATE_CLAIM, { cancelable: true, detail: e.state })
		if (!window.dispatchEvent(claim))
			e.stopImmediatePropagation()
	}
	// Stands in for ClientRouter's own popstate listener, which re-fetches and
	// swaps the page on any traverse with a non-null state. It is registered
	// after the bridge and before the overlay mounts, as the router's is. Plain
	// bubble listeners only: jsdom runs capture listeners on `window` first and
	// Chrome does not, so a capture-based fix would pass here and fail live.
	const router = vi.fn()
	beforeEach(() => {
		router.mockClear()
		window.addEventListener('popstate', claimBridge)
		window.addEventListener('popstate', router)
	})
	afterEach(() => {
		window.removeEventListener('popstate', claimBridge)
		window.removeEventListener('popstate', router)
	})

	const back = async () => {
		act(() => window.history.back())
		await waitFor(() => expect(window.history.state?.albumOverlay).toBeUndefined())
	}

	it('pushes one entry without changing the URL', async () => {
		const href = window.location.href
		render(<AlbumOverlay />)
		act(() => openAlbum({ albumId: 'album-1', title: 'Kid A' }))
		await screen.findByTestId('detail')

		expect(window.location.href).toBe(href)
		expect(window.history.state.index).toBe(0)
		expect(window.history.state.albumOverlay.detail.albumId).toBe('album-1')
		// Pushed, not written over the page entry: it is still there beneath.
		await back()
		expect(window.history.state).toEqual({ index: 0, scrollX: 0, scrollY: 0 })
		expect(window.location.href).toBe(href)
	})

	it('closes on Back and keeps the pop away from the router', async () => {
		render(<AlbumOverlay />)
		act(() => openAlbum({ albumId: 'album-1' }))
		await screen.findByTestId('detail')

		await back()

		await waitFor(() => expect(screen.queryByTestId('detail')).toBeNull())
		expect(router).not.toHaveBeenCalled()
	})

	it('✕ consumes the entry it pushed, so the next Back is not a dead press', async () => {
		render(<AlbumOverlay />)
		act(() => openAlbum({ albumId: 'album-1' }))
		await screen.findByTestId('detail')

		fireEvent.click(screen.getByRole('button', { name: '닫기' }))

		expect(screen.queryByTestId('detail')).toBeNull()
		await waitFor(() => expect(window.history.state?.albumOverlay).toBeUndefined())
		expect(window.history.state).toEqual({ index: 0, scrollX: 0, scrollY: 0 })
		expect(router).not.toHaveBeenCalled()
	})

	it('opening another album replaces the entry, so one Back closes', async () => {
		render(<AlbumOverlay />)
		act(() => openAlbum({ albumId: 'album-1' }))
		await screen.findByTestId('detail')
		const length = window.history.length
		act(() => openAlbum({ albumId: 'album-2' }))
		await waitFor(() => expect(screen.getByTestId('detail')).toHaveAttribute('data-album', 'album-2'))

		expect(window.history.length).toBe(length)
		await back()
		await waitFor(() => expect(screen.queryByTestId('detail')).toBeNull())
	})

	it('forward after closing reopens the same album, without the one-shot rating editor', async () => {
		render(<AlbumOverlay />)
		act(() => openAlbum({ albumId: 'album-1', openRating: true }))
		await screen.findByTestId('detail')
		await back()
		await waitFor(() => expect(screen.queryByTestId('detail')).toBeNull())

		act(() => window.history.forward())

		const detail = await screen.findByTestId('detail')
		expect(detail).toHaveAttribute('data-album', 'album-1')
		expect(detail).toHaveAttribute('data-open-rating', 'false')
		expect(router).not.toHaveBeenCalled()
	})

	it('leaves a pop onto another page\'s entry to the router, then re-adopts it after the swap', async () => {
		render(<AlbumOverlay />)
		act(() => openAlbum({ albumId: 'album-1' }))
		await screen.findByTestId('detail')
		// A link inside the overlay navigates: the router swaps, then pushes the next page.
		act(() => {
			document.dispatchEvent(new Event('astro:before-swap'))
			window.history.pushState({ index: 1, scrollX: 0, scrollY: 0 }, '', '/other')
			document.dispatchEvent(new Event('astro:after-swap'))
		})
		expect(screen.queryByTestId('detail')).toBeNull()

		act(() => window.history.back())
		await waitFor(() => expect(router).toHaveBeenCalledTimes(1))
		expect(screen.queryByTestId('detail')).toBeNull()
		act(() => {
			document.dispatchEvent(new Event('astro:before-swap'))
			document.dispatchEvent(new Event('astro:after-swap'))
		})

		expect(await screen.findByTestId('detail')).toHaveAttribute('data-album', 'album-1')
		await back()
		await waitFor(() => expect(screen.queryByTestId('detail')).toBeNull())
		expect(router).toHaveBeenCalledTimes(1)
	})
})
