// Canonical AlbumCard presentation and capability contract.
import type { DragPayload } from '@lib/entityDrag'
import type { AlbumCardCapabilities, AlbumCardData } from './AlbumCard'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PB_BOARD_DND_END_EVENT, PB_BOARD_DND_START_EVENT, PB_DND_END_EVENT, PB_DND_START_EVENT } from '@lib/pocketBuckit/events'
import { AlbumCard, unresolvedAlbumCardData } from './AlbumCard'

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

describe('albumCard — layouts and slots', () => {
	it.each(['grid', 'row'] as const)('renders the literal %s layout with canonical metadata', (layout) => {
		const { container } = render(
			<AlbumCard data={DATA} layout={layout} badge={<span>★ 평론</span>} eyebrow={<span>앨범</span>} secondaryLine={<span>선정 이유</span>} />,
		)

		const card = container.querySelector('.album-card')
		expect(card).toHaveAttribute('data-album-card-layout', layout)
		expect(card).toHaveClass(`album-card--${layout}`)
		expect(screen.getByText('Kind of Blue')).toBeInTheDocument()
		expect(screen.getByText('Miles Davis')).toBeInTheDocument()
		expect(screen.getByText('1959')).toBeInTheDocument()
		expect(screen.getByText('★ 평론')).toBeInTheDocument()
		expect(screen.getByText('앨범')).toBeInTheDocument()
		expect(screen.getByText('선정 이유')).toBeInTheDocument()
	})

	it('renders a stable skeleton distinct from the loaded no-cover fallback', () => {
		const { container, rerender } = render(
			<AlbumCard data={{ ...DATA, loading: true }} layout="grid" capabilities={{ open: vi.fn(), play: vi.fn(), add: vi.fn() }} />,
		)

		const card = container.querySelector('.album-card')
		expect(card).toHaveAttribute('aria-busy', 'true')
		expect(container.querySelector('[data-cover-state="loading"]')).toBeInTheDocument()
		expect(screen.queryByRole('button')).toBeNull()

		rerender(<AlbumCard data={DATA} layout="grid" />)
		expect(container.querySelector('[data-cover-state="fallback"]')).toHaveTextContent('KI')
		expect(container.querySelector('.album-card__skeleton-cover')).toBeNull()
	})
})

describe('albumCard — declared capabilities', () => {
	it('renders and fires only the callbacks the adapter grants', () => {
		const open = vi.fn()
		const artistOpen = vi.fn()
		const play = vi.fn()
		const add = vi.fn()
		render(<AlbumCard data={DATA} layout="row" capabilities={{ open, artistOpen, play, add }} />)

		fireEvent.click(screen.getByLabelText('Kind of Blue — Miles Davis 앨범 보기'))
		const artist = screen.getByRole('link', { name: 'Miles Davis' })
		expect(artist).toHaveAttribute('href', '/artist/artist-1/')
		fireEvent.click(artist)
		fireEvent.click(screen.getByLabelText('Kind of Blue 재생'))
		fireEvent.click(screen.getByLabelText('Kind of Blue 담기'))
		expect(open).toHaveBeenCalledTimes(1)
		expect(artistOpen).toHaveBeenCalledTimes(1)
		expect(play).toHaveBeenCalledTimes(1)
		expect(add).toHaveBeenCalledTimes(1)
	})

	it('leaves modified artist-link clicks to the browser', () => {
		const artistOpen = vi.fn()
		render(<AlbumCard data={DATA} layout="row" capabilities={{ artistOpen }} />)
		const artist = screen.getByRole('link', { name: 'Miles Davis' })
		artist.addEventListener('click', event => event.preventDefault())

		fireEvent.click(artist, { metaKey: true })
		expect(artistOpen).not.toHaveBeenCalled()
	})

	it('keeps an interactive contextual slot separate from the whole-card open target', () => {
		const open = vi.fn()
		const secondary = vi.fn()
		render(
			<AlbumCard
				data={DATA}
				layout="grid"
				capabilities={{ open }}
				secondaryLine={<button type="button" onClick={secondary}>평론 쓰기</button>}
			/>,
		)

		fireEvent.click(screen.getByRole('button', { name: '평론 쓰기' }))
		expect(secondary).toHaveBeenCalledTimes(1)
		expect(open).not.toHaveBeenCalled()
	})

	it('lets an adapter preserve an established action name and glyph', () => {
		const fire = vi.fn()
		render(
			<AlbumCard
				data={DATA}
				layout="grid"
				capabilities={{
					add: { fire, label: '앨범 동작', content: '⋯', className: 'surface-action' },
				}}
			/>,
		)

		const action = screen.getByRole('button', { name: '앨범 동작' })
		expect(action).toHaveTextContent('⋯')
		expect(action).toHaveClass('surface-action')
		expect(action.closest('.album-card__cover')).toBeInTheDocument()
		fireEvent.click(action)
		expect(fire).toHaveBeenCalledTimes(1)
	})

	it('renders no affordance for omitted capabilities', () => {
		render(<AlbumCard data={DATA} layout="row" />)
		expect(screen.queryByRole('button')).toBeNull()
		expect(screen.getByText('Miles Davis')).toBeInTheDocument()
	})

	it('keeps an artist plain when its canonical id is unavailable', () => {
		render(<AlbumCard data={{ ...DATA, artistId: null }} layout="row" capabilities={{ artistOpen: vi.fn() }} />)
		expect(screen.queryByRole('link', { name: 'Miles Davis' })).toBeNull()
		expect(screen.getByText('Miles Davis')).toHaveClass('album-card__artist-text')
	})

	it('requires a tap fallback whenever drag is granted', () => {
		const valid: AlbumCardCapabilities = { add: vi.fn(), drag: DRAG }

		// @ts-expect-error Rule #14: drag cannot be the only path to the operation.
		const invalid: AlbumCardCapabilities = { drag: DRAG }

		expect(valid.drag).toBe(DRAG)
		expect(invalid.drag).toBe(DRAG)
	})

	it('requires the smart constructor for a Spotify-only album fallback', () => {
		const unresolved = unresolvedAlbumCardData('spotify-album-1', {
			title: 'Fallback Album',
			artist: 'Fallback Artist',
			artistId: null,
			cover: null,
			year: 2026,
		})

		// @ts-expect-error OQ2: callers cannot hand-pair a foreign id with null.
		const invalid: AlbumCardData = { ...DATA, catalogAlbumId: null, spotifyAlbumId: 'spotify-album-1' }

		expect(unresolved.catalogAlbumId).toBeNull()
		expect(unresolved.spotifyAlbumId).toBe('spotify-album-1')
		expect(invalid.spotifyAlbumId).toBe('spotify-album-1')
	})

	it('dispatches both drag bridges and clears both on drag end', () => {
		const start = vi.fn()
		const boardStart = vi.fn()
		const end = vi.fn()
		const boardEnd = vi.fn()
		window.addEventListener(PB_DND_START_EVENT, start)
		window.addEventListener(PB_BOARD_DND_START_EVENT, boardStart)
		window.addEventListener(PB_DND_END_EVENT, end)
		window.addEventListener(PB_BOARD_DND_END_EVENT, boardEnd)
		const { container } = render(<AlbumCard data={DATA} layout="grid" capabilities={{ open: vi.fn(), add: vi.fn(), drag: DRAG }} />)
		const card = container.querySelector('article[draggable="true"]')!
		const openHit = screen.getByRole('button', { name: 'Kind of Blue — Miles Davis 앨범 보기' })
		expect(card).toHaveAttribute('draggable', 'true')
		expect(openHit).toHaveAttribute('draggable', 'true')

		const dataTransfer = { effectAllowed: 'uninitialized' }
		// The full-card open control is the real pointer hit target. Its native
		// drag must bubble into the article bridge instead of collapsing to a click.
		fireEvent.dragStart(openHit, { dataTransfer })
		fireEvent.dragEnd(openHit)
		expect(dataTransfer.effectAllowed).toBe('copy')
		expect(start).toHaveBeenCalledTimes(1)
		expect(boardStart).toHaveBeenCalledTimes(1)
		expect((start.mock.calls[0][0] as CustomEvent<DragPayload>).detail).toEqual(DRAG)
		expect((boardStart.mock.calls[0][0] as CustomEvent<DragPayload>).detail).toEqual(DRAG)
		expect(end).toHaveBeenCalledTimes(1)
		expect(boardEnd).toHaveBeenCalledTimes(1)
		window.removeEventListener(PB_DND_START_EVENT, start)
		window.removeEventListener(PB_BOARD_DND_START_EVENT, boardStart)
		window.removeEventListener(PB_DND_END_EVENT, end)
		window.removeEventListener(PB_BOARD_DND_END_EVENT, boardEnd)
	})

	it.each([
		[{ ref: { entity: 'album', albumId: 'a1' }, origin: { kind: 'internal', itemId: 'i1', fromBucketId: 'b1' } }, 'move'],
		[{ ref: { entity: 'album', albumId: 'a1' }, origin: { kind: 'library', itemId: 'i1', fromBucketId: 'b1' } }, 'copyMove'],
		[{ ref: { entity: 'album', albumId: 'a1' }, origin: { kind: 'external', copies: false } }, 'all'],
	] as Array<[DragPayload, string]>)('maps the drag origin to effectAllowed=%s', (drag, expected) => {
		const { container } = render(<AlbumCard data={DATA} layout="grid" capabilities={{ add: vi.fn(), drag }} />)
		const dataTransfer = { effectAllowed: 'uninitialized' }
		fireEvent.dragStart(container.querySelector('article[draggable="true"]')!, { dataTransfer })
		expect(dataTransfer.effectAllowed).toBe(expected)
	})

	it('is not draggable when drag is omitted', () => {
		const { container } = render(<AlbumCard data={DATA} layout="grid" capabilities={{ add: vi.fn() }} />)
		expect(container.querySelector('[draggable]')).toBeNull()
	})
})

describe('albumCard — canonical cover behavior', () => {
	it('renders the normalized two-letter fallback', () => {
		const { container } = render(<AlbumCard data={DATA} layout="grid" />)
		expect(container.querySelector('[data-cover-state="fallback"]')).toHaveTextContent('KI')
	})

	it('renders image identity with lazy async loading hints', () => {
		render(<AlbumCard data={{ ...DATA, cover: '/kind-of-blue.jpg' }} layout="grid" />)
		const image = screen.getByRole('img', { name: 'Kind of Blue' })
		expect(image).toHaveAttribute('src', '/kind-of-blue.jpg')
		expect(image).toHaveAttribute('loading', 'lazy')
		expect(image).toHaveAttribute('decoding', 'async')
	})

	it('keeps a broken URL in the image branch', () => {
		const { container } = render(<AlbumCard data={{ ...DATA, cover: '/missing.jpg' }} layout="grid" />)
		const image = screen.getByRole('img', { name: 'Kind of Blue' })
		fireEvent.error(image)
		expect(image).toBeInTheDocument()
		expect(container.querySelector('[data-cover-state="fallback"]')).toBeNull()
	})
})
