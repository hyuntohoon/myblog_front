import type { RefObject } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { useCallback, useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'
import {  useDockTear } from './dockTear'
import type { DockState } from './dockTear'

const FLOATING: DockState = { docked: false, dragging: false, expect: false, freePos: null }

function Harness() {
	const panelRef = useRef<HTMLDivElement>(null)
	const hostRef = useRef<HTMLDivElement>(null)
	const [dock, setDock] = useState(FLOATING)
	const patch = useCallback((value: Partial<DockState>) => setDock(current => ({ ...current, ...value })), [])
	const { handlers } = useDockTear({
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
	})
	return (
		<>
			<div ref={hostRef} />
			<div ref={panelRef} data-testid="panel" {...handlers} />
			<output data-testid="placement">{dock.docked ? 'docked' : 'floating'}</output>
			<output data-testid="expect">{String(dock.expect)}</output>
		</>
	)
}

describe('useDockTear re-arm gate', () => {
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
})
