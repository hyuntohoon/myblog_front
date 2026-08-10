import { beforeEach, describe, expect, it } from 'vitest'
import { readStoredRect, resizeSurfaceRect, writeStoredRect } from './surfaceGeometry'
import type { Rect, ResizeEdge, SizeConstraints } from './surfaceGeometry'

const START: Rect = { left: 200, top: 150, width: 300, height: 240 }
const CONSTRAINTS: SizeConstraints = { minWidth: 180, minHeight: 140, maxWidth: 500, maxHeight: 420 }
const VIEWPORT = { width: 1000, height: 800 }

describe('resizeSurfaceRect', () => {
	it.each<[ResizeEdge, number, number, Rect]>([
		['n', 0, -30, { left: 200, top: 120, width: 300, height: 270 }],
		['s', 0, 30, { left: 200, top: 150, width: 300, height: 270 }],
		['e', 40, 0, { left: 200, top: 150, width: 340, height: 240 }],
		['w', -40, 0, { left: 160, top: 150, width: 340, height: 240 }],
		['ne', 40, -30, { left: 200, top: 120, width: 340, height: 270 }],
		['nw', -40, -30, { left: 160, top: 120, width: 340, height: 270 }],
		['se', 40, 30, { left: 200, top: 150, width: 340, height: 270 }],
		['sw', -40, 30, { left: 160, top: 150, width: 340, height: 270 }],
	])('resizes %s with the opposite edges anchored', (edge, dx, dy, expected) => {
		expect(resizeSurfaceRect(START, edge, { dx, dy }, CONSTRAINTS, VIEWPORT)).toEqual(expected)
	})

	it.each<[ResizeEdge, number, number, Rect]>([
		['n', 0, 30, { left: 200, top: 180, width: 300, height: 210 }],
		['s', 0, -30, { left: 200, top: 150, width: 300, height: 210 }],
		['e', -40, 0, { left: 200, top: 150, width: 260, height: 240 }],
		['w', 40, 0, { left: 240, top: 150, width: 260, height: 240 }],
		['ne', -40, 30, { left: 200, top: 180, width: 260, height: 210 }],
		['nw', 40, 30, { left: 240, top: 180, width: 260, height: 210 }],
		['se', -40, -30, { left: 200, top: 150, width: 260, height: 210 }],
		['sw', 40, -30, { left: 240, top: 150, width: 260, height: 210 }],
	])('shrinks %s with the opposite edges anchored', (edge, dx, dy, expected) => {
		expect(resizeSurfaceRect(START, edge, { dx, dy }, CONSTRAINTS, VIEWPORT)).toEqual(expected)
	})

	it('keeps right and bottom anchored when minimum size clamps north-west resize', () => {
		const rect = resizeSurfaceRect(START, 'nw', { dx: 260, dy: 220 }, CONSTRAINTS, VIEWPORT)
		expect(rect).toEqual({ left: 320, top: 250, width: 180, height: 140 })
		expect(rect.left + rect.width).toBe(START.left + START.width)
		expect(rect.top + rect.height).toBe(START.top + START.height)
	})

	it('clamps maximum size without moving the anchored north-west corner', () => {
		const rect = resizeSurfaceRect(START, 'se', { dx: 400, dy: 400 }, CONSTRAINTS, VIEWPORT)
		expect(rect).toEqual({ left: 200, top: 150, width: 500, height: 420 })
	})

	it('caps edges at the viewport margin instead of overflowing', () => {
		const east = resizeSurfaceRect({ left: 700, top: 150, width: 200, height: 240 }, 'e', { dx: 300, dy: 0 }, { ...CONSTRAINTS, maxWidth: 600 }, VIEWPORT)
		expect(east.left + east.width).toBe(992)

		const northWest = resizeSurfaceRect({ left: 40, top: 30, width: 300, height: 240 }, 'nw', { dx: -200, dy: -200 }, { ...CONSTRAINTS, maxWidth: 600, maxHeight: 600 }, VIEWPORT)
		expect(northWest.left).toBe(8)
		expect(northWest.top).toBe(8)
		expect(northWest.left + northWest.width).toBe(340)
		expect(northWest.top + northWest.height).toBe(270)
	})
})

describe('surface geometry storage', () => {
	beforeEach(() => sessionStorage.clear())

	it('round-trips and merge-patches position and size fields', () => {
		writeStoredRect('surface', { left: 42, top: 64 })
		writeStoredRect('surface', { width: 720, height: 640 })
		expect(readStoredRect('surface')).toEqual({ left: 42, top: 64, width: 720, height: 640 })
	})

	it('degrades corrupt JSON to null without throwing', () => {
		sessionStorage.setItem('surface', '{bad json')
		expect(() => readStoredRect('surface')).not.toThrow()
		expect(readStoredRect('surface')).toBeNull()
		expect(() => writeStoredRect('surface', { width: 500 })).not.toThrow()
		expect(readStoredRect('surface')).toEqual({ width: 500 })
	})
})
