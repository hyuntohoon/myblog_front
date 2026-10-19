import type { DockState } from '@lib/dockTear'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AlbumDetail } from './AlbumDetail'

const FIXTURE = {
	album: { id: 'album-1', title: 'Kind of Blue', release_date: '1959-08-17', cover_url: null, album_type: 'album', label: null },
	artists: [],
	tracks: [],
}

let mobileMatches = false

vi.mock('@lib/albumDetail', () => ({
	getCachedAlbumDetail: () => FIXTURE,
	fetchAlbumDetail: () => new Promise(() => {}),
}))

vi.mock('@lib/buckets', () => ({
	updateBucketItemMemo: vi.fn(() => Promise.resolve({})),
}))

vi.mock('../album/reviews.api', () => ({
	fetchMyAlbumStates: vi.fn(() => new Promise(() => {})),
	putMyAlbumState: vi.fn(() => Promise.resolve({ rating: null, comment: '' })),
	RATING_COMMENT_MAX: 280,
	RatingRateLimitError: class RatingRateLimitError extends Error {},
}))

vi.mock('./panel/ContextPanel', () => ({
	ContextPanel: ({ dock, patch }: { dock: DockState, patch: (value: Partial<DockState>) => void }) => (
		<button type="button" onClick={() => patch({ docked: !dock.docked, dragging: false, freePos: null })}>
			{dock.docked ? '테스트 분리' : '테스트 도킹'}
		</button>
	),
}))

function setViewport(width: number, height: number) {
	Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
	Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
}

function renderMemo() {
	return render(
		<AlbumDetail
			album={{ album: 'Kind of Blue', artist: 'Miles Davis', albumId: 'album-1', writable: true, bucketId: 'bucket-1', itemId: 'item-1' }}
			reviews={[]}
			onClose={() => {}}
		/>,
	)
}

beforeEach(() => {
	sessionStorage.clear()
	mobileMatches = false
	setViewport(1600, 1000)
	window.matchMedia = vi.fn().mockImplementation((query: string) => ({
		matches: query === '(max-width: 767px)' ? mobileMatches : false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	}))
})

describe('memoWindow surface geometry', () => {
	it('mounts with research docked inside the centred 1320px default footprint', () => {
		const { container } = renderMemo()
		const modal = container.querySelector('.memo-modal-lg') as HTMLElement
		expect(modal).toHaveClass('is-surface-mounted')
		expect(screen.getByRole('button', { name: '테스트 분리' })).toBeInTheDocument()
		// memo content 880 + dock 440 = the 1320 outer width, centred in 1600
		expect(modal.style.left).toBe('140px')
		expect(modal.style.top).toBe('70px')
		expect(modal.style.width).toBe('1320px')
		expect(modal.style.getPropertyValue('--lys-dock-w')).toBe('440px')
		expect(modal.style.height).toBe('860px')
		expect(screen.getByRole('textbox', { name: '메모' })).toHaveFocus()
	})

	it('pulls a stored position back inside the viewport when the dock widens the window', () => {
		sessionStorage.setItem('lf_memo_geo', JSON.stringify({ left: 700, top: 70, width: 880, height: 860 }))
		const { container } = renderMemo()
		const modal = container.querySelector('.memo-modal-lg') as HTMLElement
		expect(modal.style.width).toBe('1320px')
		expect(modal.style.left).toBe('272px')
	})

	it('moves from its header and clamps the modal to the viewport margin', () => {
		const { container } = renderMemo()
		const modal = container.querySelector('.memo-modal-lg') as HTMLElement
		const header = container.querySelector('.memo-lg-bar') as HTMLElement
		fireEvent.pointerDown(header, { button: 0, pointerId: 2, clientX: 300, clientY: 100 })
		fireEvent.pointerMove(header, { pointerId: 2, clientX: -500, clientY: -500 })
		expect(modal.style.left).toBe('8px')
		expect(modal.style.top).toBe('8px')
		fireEvent.pointerUp(header, { pointerId: 2, clientX: -500, clientY: -500 })
	})

	it('resizes within the injected desktop constraints', () => {
		const { container } = renderMemo()
		const modal = container.querySelector('.memo-modal-lg') as HTMLElement
		const handle = container.querySelector('[data-resize-edge="se"]') as HTMLElement
		fireEvent.pointerDown(handle, { button: 0, pointerId: 3, clientX: 0, clientY: 0 })
		fireEvent.pointerMove(handle, { pointerId: 3, clientX: 100, clientY: 50 })
		// content 880 → 980 while the docked column stays frozen at 440
		expect(modal.style.width).toBe('1420px')
		expect(modal.style.height).toBe('910px')
		fireEvent.pointerUp(handle, { pointerId: 3, clientX: 100, clientY: 50 })
		expect(JSON.parse(sessionStorage.getItem('lf_memo_geo')!)).toMatchObject({ width: 980, height: 910 })
	})

	it('shrinks the outer modal by the reserved dock width when the panel detaches', () => {
		const { container } = renderMemo()
		const modal = container.querySelector('.memo-modal-lg') as HTMLElement
		const dockedWidth = Number.parseFloat(modal.style.width)
		expect(dockedWidth).toBe(1320)

		fireEvent.click(screen.getByRole('button', { name: '테스트 분리' }))
		const floatingWidth = Number.parseFloat(modal.style.width)
		expect(floatingWidth).toBe(880)
		expect(dockedWidth - floatingWidth).toBe(440)
	})

	it('keeps the original centred, handle-free modal path on mobile', async () => {
		mobileMatches = true
		setViewport(390, 844)
		const { container } = renderMemo()
		const modal = container.querySelector('.memo-modal-lg') as HTMLElement
		await waitFor(() => expect(modal).not.toHaveClass('is-surface-mounted'))
		expect(modal.style.left).toBe('')
		expect(modal.style.top).toBe('')
		expect(modal.style.width).toBe('')
		expect(modal.style.height).toBe('')
		expect(container.querySelector('[data-resize-edge]')).not.toBeInTheDocument()
		// the phone panel is a modal over the memo, so it waits for an explicit open
		expect(screen.queryByRole('button', { name: '테스트 분리' })).not.toBeInTheDocument()
		expect(screen.getByRole('button', { name: '리서치 노트 열기' })).toBeInTheDocument()
	})
})
