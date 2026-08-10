import type { RefObject } from 'react'
import type { ContextPanelTrack } from './ContextPanel'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useCallback, useRef, useState } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {  INITIAL_DOCK } from '@lib/dockTear'
import type { DockState } from '@lib/dockTear'
import { ContextPanel } from './ContextPanel'

vi.mock('../ResearchNote', () => ({
	default: () => (
<label>
리서치 입력
<input aria-label="리서치 입력" />
</label>
),
}))

vi.mock('../lyrics/lyrics.api', () => ({
	getLyrics: vi.fn(() => Promise.resolve({
		availability: 'ok',
		normalizer_version: 1,
		trackable: true,
		source_kind: 'lrclib',
		segments: [{ i: 0, text: 'A real lyric line', text_ko: null }],
		annotations: [],
		translation: null,
	})),
	requestTranslation: vi.fn(),
}))

beforeAll(() => {
	window.matchMedia = vi.fn().mockImplementation((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	}))
})

function Harness({ initialTrack = { trackId: 'track-1', meta: { track: 'Track one', artist: 'Artist' } }, initialDock = INITIAL_DOCK }: {
	initialTrack?: ContextPanelTrack | null
	initialDock?: DockState
}) {
	const hostRef = useRef<HTMLDivElement>(null)
	const [track, setTrack] = useState<ContextPanelTrack | null>(initialTrack)
	const [tab, setTab] = useState<'lyrics' | 'research'>('lyrics')
	const [dock, setDock] = useState<DockState>(initialDock)
	const patch = useCallback((value: Partial<DockState>) => setDock(current => ({ ...current, ...value })), [])
	const setHost = useCallback((node: HTMLDivElement | null) => {
		hostRef.current = node
		if (!node)
			return
		node.style.setProperty('--lys-dock-w', '420px')
		node.getBoundingClientRect = () => ({
			left: 100,
			top: 80,
			right: 900,
			bottom: 700,
			width: 800,
			height: 620,
			x: 100,
			y: 80,
			toJSON: () => ({}),
		})
	}, [])
	return (
		<>
			<div ref={setHost} />
			<button type="button" onClick={() => setTrack({ trackId: 'track-1', meta: { track: 'Track one' } })}>테스트 트랙 열기</button>
			<ContextPanel
				albumId="album-1"
				track={track}
				tab={tab}
				onTabChange={setTab}
				onClose={() => {}}
				hostRef={hostRef as RefObject<HTMLElement | null>}
				dock={dock}
				patch={patch}
				mobile={false}
			/>
		</>
	)
}

describe('contextPanel', () => {
	beforeEach(() => sessionStorage.clear())

	it('keeps both panes and their local values mounted across tab switches', async () => {
		const { container } = render(<Harness />)
		expect(await screen.findByText('A real lyric line')).toBeInTheDocument()

		fireEvent.click(screen.getByRole('tab', { name: '리서치 노트' }))
		const researchInput = screen.getByLabelText('리서치 입력')
		fireEvent.change(researchInput, { target: { value: '보강할 질문' } })
		expect(container.querySelector('#ctx-pane-lyrics')).toHaveClass('ctx-pane', 'ctx-pane-lyrics')
		expect(container.querySelector('#ctx-pane-lyrics')).not.toHaveClass('is-active')
		expect(screen.getByText('A real lyric line')).toBeInTheDocument()

		fireEvent.click(screen.getByRole('tab', { name: '가사' }))
		expect(screen.getByLabelText('리서치 입력')).toHaveValue('보강할 질문')
		expect(container.querySelector('#ctx-pane-research')).not.toHaveClass('is-active')
	})

	it('shows an empty state until a track is opened, then renders lyrics', async () => {
		render(<Harness initialTrack={null} />)
		expect(screen.getByText('트랙을 선택하면 가사가 여기 표시됩니다')).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: '테스트 트랙 열기' }))
		await waitFor(() => expect(screen.getByText('A real lyric line')).toBeInTheDocument())
		expect(screen.queryByText('트랙을 선택하면 가사가 여기 표시됩니다')).not.toBeInTheDocument()
	})

	it('starts docked and the explicit placement control always toggles', async () => {
		const { container } = render(<Harness />)
		await screen.findByText('A real lyric line')
		const panel = container.querySelector('.ctx-panel')
		expect(panel).toHaveClass('is-docked')

		fireEvent.click(screen.getByRole('button', { name: '⇱ 분리' }))
		expect(panel).toHaveClass('is-float')
		fireEvent.click(screen.getByRole('button', { name: '⇲ 도킹' }))
		expect(panel).toHaveClass('is-docked')
	})

	it('derives the first floating width from the current dock width', () => {
		const { container } = render(<Harness initialTrack={null} />)
		fireEvent.click(screen.getByRole('button', { name: '⇱ 분리' }))
		const panel = container.querySelector('.ctx-panel') as HTMLElement
		expect(panel).toHaveClass('is-float')
		expect(panel.style.width).toBe('420px')
	})

	it('resizes only while floating', () => {
		const floating = { ...INITIAL_DOCK, docked: false }
		const { container, unmount } = render(<Harness initialTrack={null} initialDock={floating} />)
		const panel = container.querySelector('.ctx-panel') as HTMLElement
		const handle = container.querySelector('[data-resize-edge="se"]') as HTMLElement
		expect(handle).toBeInTheDocument()
		const startWidth = Number.parseFloat(panel.style.width)
		const startHeight = Number.parseFloat(panel.style.height)
		fireEvent.pointerDown(handle, { button: 0, pointerId: 9, clientX: 0, clientY: 0 })
		fireEvent.pointerMove(handle, { pointerId: 9, clientX: 100, clientY: -100 })
		expect(Number.parseFloat(panel.style.width)).toBe(startWidth + 100)
		expect(Number.parseFloat(panel.style.height)).toBe(startHeight - 100)
		fireEvent.pointerUp(handle, { pointerId: 9, clientX: 100, clientY: -100 })

		unmount()
		const docked = render(<Harness initialTrack={null} />)
		expect(docked.container.querySelector('[data-resize-edge]')).not.toBeInTheDocument()
	})
})
