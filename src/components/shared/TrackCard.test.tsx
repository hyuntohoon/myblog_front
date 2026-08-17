import type { TrackCardData } from './TrackCard'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TrackCard } from './TrackCard'

const DATA: TrackCardData = {
	title: 'So What',
	artist: 'Miles Davis',
	album: 'Kind of Blue',
	cover: null,
}

describe('trackCard — layouts and capabilities', () => {
	it.each(['grid', 'row'] as const)('renders the literal %s layout and metadata', (layout) => {
		const { container } = render(
			<TrackCard data={DATA} layout={layout} badge={<span>최근 재생</span>} eyebrow={<span>트랙</span>} secondaryLine={<span>3:22 · 오늘</span>} />,
		)

		const card = container.querySelector('.track-card')
		expect(card).toHaveAttribute('data-track-card-layout', layout)
		expect(card).toHaveClass(`track-card--${layout}`)
		expect(screen.getByText('So What')).toBeInTheDocument()
		expect(screen.getByText('Miles Davis')).toBeInTheDocument()
		expect(screen.getByText('Kind of Blue')).toBeInTheDocument()
		expect(screen.getByText('최근 재생')).toBeInTheDocument()
		expect(screen.getByText('트랙')).toBeInTheDocument()
		expect(screen.getByText('3:22 · 오늘')).toBeInTheDocument()
	})

	it('keeps the lyrics action separate from whole-card open', () => {
		const open = vi.fn()
		const lyrics = vi.fn()
		render(<TrackCard data={DATA} layout="row" capabilities={{ open, lyrics }} />)

		fireEvent.click(screen.getByLabelText('So What 가사 보기'))
		expect(lyrics).toHaveBeenCalledTimes(1)
		expect(open).not.toHaveBeenCalled()

		fireEvent.click(screen.getByLabelText('So What — Miles Davis 트랙 정보'))
		expect(open).toHaveBeenCalledTimes(1)
	})

	it('places grid actions inside the cover and row actions beside metadata', () => {
		const { container, rerender } = render(<TrackCard data={DATA} layout="grid" capabilities={{ lyrics: vi.fn() }} />)
		let action = screen.getByLabelText('So What 가사 보기')
		expect(action.closest('.track-card__cover')).toBeInTheDocument()

		rerender(<TrackCard data={DATA} layout="row" capabilities={{ lyrics: vi.fn() }} />)
		action = screen.getByLabelText('So What 가사 보기')
		expect(action.closest('.track-card__cover')).toBeNull()
		expect(container.querySelector('.track-card')?.lastElementChild).toContainElement(action)
	})

	it('renders no action affordance when capabilities are omitted', () => {
		render(<TrackCard data={DATA} layout="row" />)
		expect(screen.queryByRole('button')).toBeNull()
	})
})
