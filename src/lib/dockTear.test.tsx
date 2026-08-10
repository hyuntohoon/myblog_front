import type { RefObject } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { useCallback, useRef, useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import {  useDockTear } from './dockTear'
import type { DockState } from './dockTear'

const FLOATING: DockState = { docked: false, dragging: false, expect: false, freePos: null }

function Harness({ initialDock = FLOATING, geometryKey }: { initialDock?: DockState, geometryKey?: string }) {
	const panelRef = useRef<HTMLDivElement>(null)
	const hostRef = useRef<HTMLDivElement>(null)
	const [dock, setDock] = useState(initialDock)
	const patch = useCallback((value: Partial<DockState>) => setDock(current => ({ ...current, ...value })), [])
	const { handlers, togglePlacement } = useDockTear({
		panelRef,
		hostRef: hostRef as RefObject<HTMLElement | null>,
		dock,
		patch,
		dockRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
		floatSize: () => ({ width: 100, height: 100 }),
		restRect: () => ({ left: 150, top: 0, width: 100, height: 100 }),
		clampPos: (left, top) => ({ left, top }),
		inSlot: (x, y) => x >= 0 && x <= 100 && y >= 0 && y <= 100,
		reducedMotion: true,
		geometryKey,
	})
	return (
		<>
			<div ref={hostRef} />
			<div ref={panelRef} data-testid="panel" {...handlers} />
			<output data-testid="placement">{dock.docked ? 'docked' : 'floating'}</output>
			<output data-testid="expect">{String(dock.expect)}</output>
			<output data-testid="free-pos">{dock.freePos ? `${dock.freePos.left},${dock.freePos.top}` : 'none'}</output>
			<button type="button" onClick={togglePlacement}>toggle</button>
		</>
	)
}

describe('useDockTear re-arm gate', () => {
	beforeEach(() => sessionStorage.clear())

	it('does not dock a floating panel nudged inside the slot', () => {
		render(<Harness />)
		const panel = screen.getByTestId('panel')
		fireEvent.pointerDown(panel, { button: 0, pointerId: 1, clientX: 40, clientY: 40 })
		fireEvent.pointerMove(panel, { pointerId: 1, clientX: 45, clientY: 45 })
		expect(screen.getByTestId('expect')).toHaveTextContent('false')
		fireEvent.pointerUp(panel, { pointerId: 1, clientX: 45, clientY: 45 })
		expect(screen.getByTestId('placement')).toHaveTextContent('floating')
	})

	it('docks only after the pointer leaves and re-enters the slot', () => {
		render(<Harness />)
		const panel = screen.getByTestId('panel')
		fireEvent.pointerDown(panel, { button: 0, pointerId: 2, clientX: 40, clientY: 40 })
		fireEvent.pointerMove(panel, { pointerId: 2, clientX: 140, clientY: 40 })
		expect(screen.getByTestId('expect')).toHaveTextContent('false')
		fireEvent.pointerMove(panel, { pointerId: 2, clientX: 50, clientY: 50 })
		expect(screen.getByTestId('expect')).toHaveTextContent('true')
		fireEvent.pointerUp(panel, { pointerId: 2, clientX: 50, clientY: 50 })
		expect(screen.getByTestId('placement')).toHaveTextContent('docked')
	})

	it('stores a released float position and restores it on explicit detach', () => {
		const { unmount } = render(<Harness geometryKey="dock-geometry" />)
		const panel = screen.getByTestId('panel')
		Object.defineProperties(panel, {
			offsetLeft: { configurable: true, get: () => Number.parseFloat(panel.style.left) || 0 },
			offsetTop: { configurable: true, get: () => Number.parseFloat(panel.style.top) || 0 },
			offsetWidth: { configurable: true, get: () => 100 },
			offsetHeight: { configurable: true, get: () => 100 },
		})
		fireEvent.pointerDown(panel, { button: 0, pointerId: 3, clientX: 40, clientY: 40 })
		fireEvent.pointerMove(panel, { pointerId: 3, clientX: 180, clientY: 160 })
		fireEvent.pointerUp(panel, { pointerId: 3, clientX: 180, clientY: 160 })
		expect(JSON.parse(sessionStorage.getItem('dock-geometry')!)).toEqual({ left: 290, top: 120 })

		unmount()
		render(<Harness geometryKey="dock-geometry" initialDock={{ ...FLOATING, docked: true }} />)
		fireEvent.click(screen.getByRole('button', { name: 'toggle' }))
		expect(screen.getByTestId('free-pos')).toHaveTextContent('290,120')
	})
})
