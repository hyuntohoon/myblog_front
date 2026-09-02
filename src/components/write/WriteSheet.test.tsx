// FEAT-album-review-authoring Step 4 — the unified write entry (C1 / OQ9).
//
// What has to hold, and why each one is a real failure mode rather than a
// restatement of the code:
//
//  · a member must never be offered 평론 (하드 룰 1 + C1's "쓸 수 없는 항목을
//    보여주지 않는다"). The kind step is where that could leak.
//  · 평가 must land in the EXISTING editor, not a copy — so the assertion is on
//    the openAlbum({ openRating: true }) hand-off, which is the seam that would
//    break if someone later inlined a star form here.
//  · a Spotify-only hit has no catalog id, and both destinations are keyed by
//    one. Passing a Spotify id on would be the id-namespace conflation
//    OpenAlbumDetail's `unresolved` flag exists to prevent.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const owner = vi.hoisted(() => ({ isOwnerUser: vi.fn() }))
const ent = vi.hoisted(() => ({ openAlbum: vi.fn() }))
const auth = vi.hoisted(() => ({ isLoggedIn: vi.fn(() => true) }))
const searchState = vi.hoisted(() => ({
	albums: [] as unknown[],
	runDbSearch: vi.fn(() => Promise.resolve()),
	runSpotifySync: vi.fn(() => Promise.resolve()),
}))

vi.mock('@lib/auth', () => auth)
vi.mock('@lib/owner', () => owner)
vi.mock('@lib/entityEvents', () => ({
	ENT_OPEN_WRITE: 'ent:open-write',
	openAlbum: ent.openAlbum,
}))
vi.mock('@lib/useDismissable', () => ({ useDismissable: () => {} }))
vi.mock('@lib/useScrollLock', () => ({ useScrollLock: () => {} }))
vi.mock('@lib/useMusicSearch', () => ({
	useMusicSearch: () => ({
		query: '',
		setQuery: vi.fn(),
		albums: searchState.albums,
		artists: [],
		tracks: [],
		loading: false,
		loadingMore: null,
		status: '',
		searchFailed: false,
		moreFailed: null,
		syncRequested: false,
		source: 'db',
		setSource: vi.fn(),
		spotifyCooldown: false,
		hasMore: {},
		runDbSearch: searchState.runDbSearch,
		runSpotifySync: searchState.runSpotifySync,
		loadMore: vi.fn(),
		reset: vi.fn(),
	}),
}))

const { ENT_OPEN_WRITE } = await import('@lib/entityEvents')
const { default: WriteSheet } = await import('./WriteSheet')

const DB_HIT = {
	kind: 'album' as const,
	id: 'album-db-1',
	title: 'Renaissance',
	artistId: 'a1',
	artist: 'Beyoncé',
	cover: 'https://img/x.jpg',
	year: '2022',
	spotifyId: null,
	source: 'db' as const,
}
const SPOTIFY_ONLY_HIT = { ...DB_HIT, id: null, spotifyId: 'sp-9', source: 'spotify' as const }

function openSheet() {
	fireEvent(window, new CustomEvent(ENT_OPEN_WRITE))
}

async function mountAs(isOwner: boolean) {
	owner.isOwnerUser.mockResolvedValue(isOwner)
	render(<WriteSheet />)
	openSheet()
	await screen.findByRole('dialog', { name: '쓰기' })
}

beforeEach(() => {
	vi.clearAllMocks()
	auth.isLoggedIn.mockReturnValue(true)
	searchState.albums = []
	vi.stubGlobal('fetch', vi.fn())
})

describe('the write sheet', () => {
	it('renders nothing until the entry fires', () => {
		owner.isOwnerUser.mockResolvedValue(true)
		render(<WriteSheet />)
		expect(screen.queryByRole('dialog')).toBeNull()
	})

	it('ignores the entry when logged out', () => {
		auth.isLoggedIn.mockReturnValue(false)
		owner.isOwnerUser.mockResolvedValue(false)
		render(<WriteSheet />)
		openSheet()
		expect(screen.queryByRole('dialog')).toBeNull()
	})

	it('offers the owner both kinds', async () => {
		await mountAs(true)
		expect(await screen.findByRole('button', { name: /평론/ })).toBeTruthy()
		expect(screen.getByRole('button', { name: /평가/ })).toBeTruthy()
	})

	it('never offers a member 평론, and skips the choice entirely', async () => {
		searchState.albums = [DB_HIT]
		await mountAs(false)
		// Straight to the album step — the search box is on screen…
		expect(await screen.findByLabelText('앨범 검색')).toBeTruthy()
		// …and nothing anywhere in the sheet says 평론.
		const dialog = screen.getByRole('dialog', { name: '쓰기' })
		expect(dialog.textContent).not.toContain('평론')
		expect(screen.queryByRole('button', { name: '← 종류 다시 고르기' })).toBeNull()
	})

	it('hands 평가 to the existing rating editor with the album preselected', async () => {
		searchState.albums = [DB_HIT]
		await mountAs(false)
		fireEvent.click(await screen.findByRole('button', { name: /Renaissance/ }))
		await waitFor(() => expect(ent.openAlbum).toHaveBeenCalledTimes(1))
		expect(ent.openAlbum).toHaveBeenCalledWith(expect.objectContaining({
			albumId: 'album-db-1',
			title: 'Renaissance',
			openRating: true,
		}))
		// The sheet gets out of the way first — two stacked modals would both
		// hold the scroll lock and the inert background.
		await waitFor(() => expect(screen.queryByRole('dialog', { name: '쓰기' })).toBeNull())
	})

	it('sends 평론 to the editor with that album, and does NOT open the overlay', async () => {
		const assign = vi.fn()
		vi.stubGlobal('location', { ...window.location, assign })
		searchState.albums = [DB_HIT]
		await mountAs(true)
		fireEvent.click(await screen.findByRole('button', { name: /평론/ }))
		fireEvent.click(await screen.findByRole('button', { name: /Renaissance/ }))
		await waitFor(() => expect(assign).toHaveBeenCalledWith('/write?album=album-db-1'))
		expect(ent.openAlbum).not.toHaveBeenCalled()
	})

	it('refuses a Spotify-only album with no catalog row, instead of passing its id on', async () => {
		vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false } as Response)))
		const assign = vi.fn()
		vi.stubGlobal('location', { ...window.location, assign })
		searchState.albums = [SPOTIFY_ONLY_HIT]
		await mountAs(false)
		fireEvent.click(await screen.findByRole('button', { name: /Renaissance/ }))
		expect(await screen.findByText(/아직 카탈로그에 없는 앨범/)).toBeTruthy()
		expect(ent.openAlbum).not.toHaveBeenCalled()
		expect(assign).not.toHaveBeenCalled()
		// Still open, so the reader can run the Spotify 싱크 the notice names.
		expect(screen.getByRole('dialog', { name: '쓰기' })).toBeTruthy()
	})

	it('resolves a Spotify-only album that DOES have a catalog row', async () => {
		vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
			ok: true,
			json: () => Promise.resolve({ album: { id: 'album-db-2' } }),
		} as unknown as Response)))
		searchState.albums = [SPOTIFY_ONLY_HIT]
		await mountAs(false)
		fireEvent.click(await screen.findByRole('button', { name: /Renaissance/ }))
		await waitFor(() => expect(ent.openAlbum).toHaveBeenCalledWith(
			expect.objectContaining({ albumId: 'album-db-2', openRating: true }),
		))
	})

	it('shows NO kind choice while the owner probe is still in flight', async () => {
		// The owner answer is a network round trip. An immediate stub hides the
		// window it opens, and the window is the whole point: without the
		// `isOwner === true` gate on the kind step, EVERY viewer — member
		// included — is shown [평가][평론] until the probe lands, which is the
		// "쓸 수 없는 항목을 보여주지 않는다" rule failing for as long as the request
		// takes. Held here deliberately rather than resolved.
		let settle: (v: boolean) => void = () => {}
		const held = new Promise<boolean>((resolve) => {
			settle = resolve
		})
		owner.isOwnerUser.mockReturnValue(held)
		render(<WriteSheet />)
		openSheet()
		const dialog = await screen.findByRole('dialog', { name: '쓰기' })
		expect(dialog.textContent).toContain('불러오는 중')
		expect(dialog.textContent).not.toContain('평론')
		expect(screen.queryByLabelText('앨범 검색')).toBeNull()

		settle(false)
		// Once it lands as a member, still no 평론 — just the album step.
		expect(await screen.findByLabelText('앨범 검색')).toBeTruthy()
		expect(screen.getByRole('dialog', { name: '쓰기' }).textContent).not.toContain('평론')
	})

	it('lets the owner go back and change the kind', async () => {
		searchState.albums = [DB_HIT]
		await mountAs(true)
		fireEvent.click(await screen.findByRole('button', { name: /평가/ }))
		expect(await screen.findByLabelText('앨범 검색')).toBeTruthy()
		fireEvent.click(screen.getByRole('button', { name: '← 종류 다시 고르기' }))
		expect(await screen.findByRole('button', { name: /평론/ })).toBeTruthy()
	})
})
