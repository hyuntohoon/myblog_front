import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { useCallback, useEffect, useRef } from 'react'

export interface Rect {
	left: number
	top: number
	width: number
	height: number
}

export interface SizeConstraints {
	minWidth: number
	minHeight: number
	maxWidth: number
	maxHeight: number
}

export interface ViewportSize { width: number, height: number }

export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const SURFACE_RESIZE_EDGES: ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
export const SURFACE_MARGIN = 8

function clamp(value: number, min: number, max: number): number {
	if (max < min)
		return max
	return Math.max(min, Math.min(max, value))
}

function resizeAxis({
	start,
	size,
	delta,
	near,
	far,
	minSize,
	maxSize,
	viewportSize,
}: {
	start: number
	size: number
	delta: number
	near: boolean
	far: boolean
	minSize: number
	maxSize: number
	viewportSize: number
}): { start: number, size: number } {
	const boxMin = SURFACE_MARGIN
	const boxMax = Math.max(boxMin, viewportSize - SURFACE_MARGIN)
	const available = Math.max(0, boxMax - boxMin)

	if (near) {
		const anchor = clamp(start + size, boxMin, boxMax)
		const constrained = clamp(size - delta, minSize, maxSize)
		const nextSize = Math.max(0, Math.min(constrained, anchor - boxMin, available))
		return { start: anchor - nextSize, size: nextSize }
	}

	if (far) {
		const anchor = clamp(start, boxMin, boxMax)
		const constrained = clamp(size + delta, minSize, maxSize)
		const nextSize = Math.max(0, Math.min(constrained, boxMax - anchor, available))
		return { start: anchor, size: nextSize }
	}

	const nextSize = Math.max(0, Math.min(clamp(size, minSize, maxSize), available))
	return {
		start: clamp(start, boxMin, boxMax - nextSize),
		size: nextSize,
	}
}

export function resizeSurfaceRect(
	start: Rect,
	edge: ResizeEdge,
	delta: { dx: number, dy: number },
	constraints: SizeConstraints,
	viewport: ViewportSize,
): Rect {
	const horizontal = resizeAxis({
		start: start.left,
		size: start.width,
		delta: delta.dx,
		near: edge.includes('w'),
		far: edge.includes('e'),
		minSize: constraints.minWidth,
		maxSize: constraints.maxWidth,
		viewportSize: viewport.width,
	})
	const vertical = resizeAxis({
		start: start.top,
		size: start.height,
		delta: delta.dy,
		near: edge.includes('n'),
		far: edge.includes('s'),
		minSize: constraints.minHeight,
		maxSize: constraints.maxHeight,
		viewportSize: viewport.height,
	})
	return { left: horizontal.start, top: vertical.start, width: horizontal.size, height: vertical.size }
}

export function clampSurfacePosition(
	position: { left: number, top: number },
	size: { width: number, height: number },
	viewport: ViewportSize,
): { left: number, top: number } {
	return {
		left: clamp(position.left, SURFACE_MARGIN, Math.max(SURFACE_MARGIN, viewport.width - size.width - SURFACE_MARGIN)),
		top: clamp(position.top, SURFACE_MARGIN, Math.max(SURFACE_MARGIN, viewport.height - size.height - SURFACE_MARGIN)),
	}
}

function storedPatch(value: unknown): Partial<Rect> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		return null
	const result: Partial<Rect> = {}
	for (const key of ['left', 'top', 'width', 'height'] as const) {
		const field = (value as Record<string, unknown>)[key]
		if (typeof field === 'number' && Number.isFinite(field))
			result[key] = field
	}
	return Object.keys(result).length ? result : null
}

export function readStoredRect(key: string): Partial<Rect> | null {
	try {
		if (typeof window === 'undefined')
			return null
		const raw = window.sessionStorage.getItem(key)
		return raw == null ? null : storedPatch(JSON.parse(raw))
	}
	catch {
		return null
	}
}

export function writeStoredRect(key: string, patch: Partial<Rect>): void {
	try {
		if (typeof window === 'undefined')
			return
		const current = readStoredRect(key) ?? {}
		const next = storedPatch({ ...current, ...patch })
		if (next)
			window.sessionStorage.setItem(key, JSON.stringify(next))
	}
	catch {
		/* Storage-disabled sessions keep geometry in memory only. */
	}
}

interface ResizeDrag {
	edge: ResizeEdge
	pointerId: number
	startX: number
	startY: number
	startRect: Rect
	currentRect: Rect
}

export interface ResizeHandleProps {
	onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
	onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
	onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
	onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void
}

export function useResizableSurface({
	panelRef,
	enabled,
	constraints,
	getRect,
	onLiveResize,
	onCommit,
}: {
	panelRef: RefObject<HTMLElement | null>
	enabled: boolean
	constraints: () => SizeConstraints
	getRect: () => Rect
	onLiveResize?: (rect: Rect) => void
	onCommit: (rect: Rect) => void
}): (edge: ResizeEdge) => ResizeHandleProps {
	const dragRef = useRef<ResizeDrag | null>(null)

	useEffect(() => {
		if (enabled)
			return
		dragRef.current = null
		panelRef.current?.classList.remove('is-resizing')
	}, [enabled, panelRef])

	return useCallback((edge: ResizeEdge): ResizeHandleProps => {
		const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
			if (!enabled || event.button !== 0 || dragRef.current)
				return
			event.preventDefault()
			try {
				event.currentTarget.setPointerCapture(event.pointerId)
			}
			catch { /* pointer released early — bubbling still tracks the resize */ }
			const startRect = getRect()
			dragRef.current = {
				edge,
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				startRect,
				currentRect: startRect,
			}
			panelRef.current?.classList.add('is-resizing')
		}

		const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
			const drag = dragRef.current
			if (!enabled || !drag || drag.edge !== edge || drag.pointerId !== event.pointerId)
				return
			const rect = resizeSurfaceRect(
				drag.startRect,
				edge,
				{ dx: event.clientX - drag.startX, dy: event.clientY - drag.startY },
				constraints(),
				{ width: window.innerWidth, height: window.innerHeight },
			)
			drag.currentRect = rect
			const panel = panelRef.current
			if (panel) {
				panel.style.left = `${rect.left}px`
				panel.style.top = `${rect.top}px`
				panel.style.width = `${rect.width}px`
				panel.style.height = `${rect.height}px`
			}
			onLiveResize?.(rect)
		}

		const endResize = (event: ReactPointerEvent<HTMLElement>) => {
			const drag = dragRef.current
			if (!enabled || !drag || drag.edge !== edge || drag.pointerId !== event.pointerId)
				return
			dragRef.current = null
			panelRef.current?.classList.remove('is-resizing')
			onCommit(drag.currentRect)
		}

		return {
			onPointerDown,
			onPointerMove,
			onPointerUp: endResize,
			onPointerCancel: endResize,
		}
	}, [constraints, enabled, getRect, onCommit, onLiveResize, panelRef])
}

interface MoveDrag {
	pointerId: number
	startX: number
	startY: number
	startRect: Rect
	currentRect: Rect
}

export function useMovableSurface({
	panelRef,
	enabled,
	getRect,
	onCommit,
}: {
	panelRef: RefObject<HTMLElement | null>
	enabled: boolean
	getRect: () => Rect
	onCommit: (rect: Rect) => void
}): ResizeHandleProps {
	const dragRef = useRef<MoveDrag | null>(null)

	useEffect(() => {
		if (enabled)
			return
		dragRef.current = null
		panelRef.current?.classList.remove('is-moving')
	}, [enabled, panelRef])

	const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
		if (!enabled || event.button !== 0 || dragRef.current || (event.target as HTMLElement).closest('button'))
			return
		event.preventDefault()
		try {
			event.currentTarget.setPointerCapture(event.pointerId)
		}
		catch { /* pointer released early — bubbling still tracks the move */ }
		const startRect = getRect()
		dragRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			startRect,
			currentRect: startRect,
		}
		panelRef.current?.classList.add('is-moving')
	}

	const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
		const drag = dragRef.current
		if (!enabled || !drag || drag.pointerId !== event.pointerId)
			return
		const position = clampSurfacePosition(
			{ left: drag.startRect.left + event.clientX - drag.startX, top: drag.startRect.top + event.clientY - drag.startY },
			drag.startRect,
			{ width: window.innerWidth, height: window.innerHeight },
		)
		const rect = { ...drag.startRect, ...position }
		drag.currentRect = rect
		const panel = panelRef.current
		if (panel) {
			panel.style.left = `${rect.left}px`
			panel.style.top = `${rect.top}px`
		}
	}

	const endMove = (event: ReactPointerEvent<HTMLElement>) => {
		const drag = dragRef.current
		if (!enabled || !drag || drag.pointerId !== event.pointerId)
			return
		dragRef.current = null
		panelRef.current?.classList.remove('is-moving')
		onCommit(drag.currentRect)
	}

	return {
		onPointerDown,
		onPointerMove,
		onPointerUp: endMove,
		onPointerCancel: endMove,
	}
}
