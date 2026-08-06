// ARCH-album-card-contract-and-composition Stage 3 — pins the shared album
// renderer before a live surface adopts it. The cover matrix records the
// semantics of the four legacy paths this primitive replaces over Stages 4-9.
import type { DragPayload } from '@lib/entityDrag'
import type { AlbumCardCapabilities, AlbumCardData } from './AlbumCard'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PB_BOARD_DND_END_EVENT, PB_BOARD_DND_START_EVENT, PB_DND_END_EVENT, PB_DND_START_EVENT } from '@lib/pocketBuckit/events'
import { Cover as HomeCover } from '../home/ui'
import { LkCover } from '../member/LikedBoard'
import { AlbumArt } from '../member/ui'
import SubjectHero from '../writer/SubjectHero'
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

describe('albumCard — layouts and slots', () => {
	it.each(['grid', 'row'] as const)('renders the literal %s layout with canonical metadata', (layout) => {
		const { container } = render(
			<AlbumCard data={DATA} layout={layout} badge={<span>★ 평론</span>} secondaryLine={<span>선정 이유</span>} />,
		)

		const card = container.querySelector('.album-card')
		expect(card).toHaveAttribute('data-album-card-layout', layout)
		expect(card).toHaveClass(`album-card--${layout}`)
		expect(screen.getByText('Kind of Blue')).toBeInTheDocument()
		expect(screen.getByText('Miles Davis')).toBeInTheDocument()
		expect(screen.getByText('1959')).toBeInTheDocument()
		expect(screen.getByText('★ 평론')).toBeInTheDocument()
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

describe('albumCard — legacy cover parity matrix', () => {
	const subject = (cover: string | null) => ({
		id: 'album-1',
		title: 'Kind of Blue',
		cover_url: cover,
		release_date: '1959-08-17',
		artists: [{ id: 'artist-1', name: 'Miles Davis' }],
		tracks: [],
		kind: 'album' as const,
	})

	function legacyCover(name: 'home Cover' | 'member AlbumArt' | 'LikedBoard LkCover' | 'writer SubjectHero', cover: string | null) {
		if (name === 'home Cover')
			return <HomeCover label="Kind of Blue" src={cover} square />
		if (name === 'member AlbumArt')
			return <AlbumArt label="Kind of Blue" url={cover} />
		if (name === 'LikedBoard LkCover')
			return <LkCover label="Kind of Blue" cover={cover} square />
		return <SubjectHero subject={subject(cover)} score={0} onScoreChange={vi.fn()} subjectBestNew={false} onSubjectBestNewChange={vi.fn()} onOpenSearch={vi.fn()} />
	}

	function coverSignature(container: HTMLElement, subjectHero = false) {
		const node = subjectHero ? container.querySelector('.wr-hero-cover')! : container.firstElementChild!
		const image = node.matches('img') ? node : node.querySelector('img')
		const fallback = node.querySelector('.cover-ph, .wr-hero-cover-fallback')
		return {
			tag: node.tagName.toLowerCase(),
			className: node.getAttribute('class'),
			style: node.getAttribute('style'),
			image: image ?
				{
					src: image.getAttribute('src'),
					alt: image.getAttribute('alt'),
					loading: image.getAttribute('loading'),
					decoding: image.getAttribute('decoding'),
					style: image.getAttribute('style'),
				} :
				null,
			fallback: fallback ?
				{
					className: fallback.getAttribute('class'),
					text: fallback.textContent,
					style: fallback.getAttribute('style'),
				} :
				null,
		}
	}

	it('freezes the actual legacy DOM/style signatures instead of claiming they were identical', () => {
		const names = ['home Cover', 'member AlbumArt', 'LikedBoard LkCover', 'writer SubjectHero'] as const
		const image = names.map((legacy) => {
			const view = render(legacyCover(legacy, '/kind-of-blue.jpg'))
			return coverSignature(view.container, legacy === 'writer SubjectHero')
		})
		const fallback = names.map((legacy) => {
			const view = render(legacyCover(legacy, null))
			return coverSignature(view.container, legacy === 'writer SubjectHero')
		})

		expect(image).toEqual([
			{ tag: 'div', className: 'cover', style: 'width: 100%; aspect-ratio: 1 / 1; border-radius: 3px;', image: { src: '/kind-of-blue.jpg', alt: 'Kind of Blue', loading: 'lazy', decoding: null, style: null }, fallback: null },
			{ tag: 'img', className: null, style: 'width: 100%; aspect-ratio: 1 / 1; object-fit: cover; border-radius: 3px; display: block; border: 1px solid var(--color-border);', image: { src: '/kind-of-blue.jpg', alt: 'Kind of Blue', loading: 'lazy', decoding: 'async', style: 'width: 100%; aspect-ratio: 1 / 1; object-fit: cover; border-radius: 3px; display: block; border: 1px solid var(--color-border);' }, fallback: null },
			{ tag: 'img', className: null, style: 'width: 100%; aspect-ratio: 1 / 1; object-fit: cover; border-radius: 4px; display: block; border: 1px solid var(--color-border);', image: { src: '/kind-of-blue.jpg', alt: 'Kind of Blue', loading: 'lazy', decoding: 'async', style: 'width: 100%; aspect-ratio: 1 / 1; object-fit: cover; border-radius: 4px; display: block; border: 1px solid var(--color-border);' }, fallback: null },
			{ tag: 'div', className: 'wr-hero-cover', style: null, image: { src: '/kind-of-blue.jpg', alt: 'Kind of Blue', loading: null, decoding: null, style: null }, fallback: null },
		])
		expect(fallback).toEqual([
			{ tag: 'div', className: 'cover', style: 'width: 100%; aspect-ratio: 1 / 1; border-radius: 3px;', image: null, fallback: { className: 'cover-ph', text: 'KI', style: null } },
			{ tag: 'div', className: 'cover', style: 'width: 100%; aspect-ratio: 1 / 1; border-radius: 3px;', image: null, fallback: { className: 'cover-ph', text: 'KI', style: null } },
			{ tag: 'div', className: 'cover', style: 'width: 100%; aspect-ratio: 1 / 1; border-radius: 4px;', image: null, fallback: { className: 'cover-ph', text: 'KI', style: null } },
			{ tag: 'div', className: 'wr-hero-cover', style: null, image: null, fallback: { className: 'wr-hero-cover-fallback serif', text: 'K', style: null } },
		])
	})

	it.each(['home Cover', 'member AlbumArt', 'LikedBoard LkCover', 'writer SubjectHero'] as const)('matches the %s image identity and source', (legacy) => {
		const old = render(legacyCover(legacy, '/kind-of-blue.jpg'))
		const oldImage = within(old.container).getByRole('img', { name: 'Kind of Blue' })
		const canonical = render(<AlbumCard data={{ ...DATA, cover: '/kind-of-blue.jpg' }} layout="grid" />)
		const newImage = within(canonical.container).getByRole('img', { name: 'Kind of Blue' })

		expect(newImage).toHaveAttribute('src', oldImage.getAttribute('src'))
		expect(newImage).toHaveAttribute('alt', oldImage.getAttribute('alt'))
		// Canonical normalization: lazy+async matches AlbumArt/LkCover and adds
		// non-visual loading hints to HomeCover/SubjectHero.
		expect(newImage).toHaveAttribute('loading', 'lazy')
		expect(newImage).toHaveAttribute('decoding', 'async')
	})

	it('freezes the four actual no-image outputs and the chosen canonical normalization', () => {
		const actual = (['home Cover', 'member AlbumArt', 'LikedBoard LkCover', 'writer SubjectHero'] as const).map((legacy) => {
			const view = render(legacyCover(legacy, null))
			return view.container.querySelector('.cover-ph, .wr-hero-cover-fallback')?.textContent
		})
		const canonical = render(<AlbumCard data={DATA} layout="grid" />)

		expect(actual).toEqual(['KI', 'KI', 'KI', 'K'])
		// The shared primitive takes the already-shared two-letter Cover output;
		// SubjectHero's single glyph stays live until its Stage 8 migration.
		expect(canonical.container.querySelector('[data-cover-state="fallback"]')).toHaveTextContent('KI')
	})

	it.each(['home Cover', 'member AlbumArt', 'LikedBoard LkCover', 'writer SubjectHero'] as const)('keeps a broken URL in the image branch like %s', (legacy) => {
		const old = render(legacyCover(legacy, '/missing.jpg'))
		const oldImage = within(old.container).getByRole('img', { name: 'Kind of Blue' })
		const canonical = render(<AlbumCard data={{ ...DATA, cover: '/missing.jpg' }} layout="grid" />)
		const newImage = within(canonical.container).getByRole('img', { name: 'Kind of Blue' })

		fireEvent.error(oldImage)
		fireEvent.error(newImage)
		expect(oldImage).toBeInTheDocument()
		expect(newImage).toBeInTheDocument()
		expect(canonical.container.querySelector('[data-cover-state="fallback"]')).toBeNull()
	})
})
