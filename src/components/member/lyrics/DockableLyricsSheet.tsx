// FEAT-lyrics-sheet PR 2 — the drag tear/dock wrapper around LyricsSheetContent.
//
// Docking is a 봉합, not a panel (owner 2026-07-07): while docked the sheet is
// the memo window's right column — the SAME paper, no border/shadow, only the
// perforation seam. Grab the header and pull: the seam resists (0.35× follow)
// until a 70px threshold, then '뚝' — it tears into a free-floating sheet that
// tilts with the drag and, dragged back over the dock slot, snaps home.
//
// Placement lives here (the memo host owns the DockState so it can size the
// reserved slot); LyricsSheetContent stays placement-agnostic. The sheet is
// position:fixed and JS-positioned in viewport coords; a ResizeObserver keeps
// the docked sheet glued to the memo as it (or the window) resizes.
//
// Desktop only — the memo host renders the plain float LyricsSheet on mobile,
// where header-drag would fight scrolling (see MemoWindow).
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { HeadHandlers, LyricsSheetMeta } from './LyricsSheet'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useDismissable } from '@lib/useDismissable'
import { LyricsSheetContent } from './LyricsSheet'

const DOCK_W = 320 // reserved dock-slot width == docked sheet width
const TEAR_PX = 70 // resistance threshold before the sheet tears off
const RESIST = 0.35 // follow ratio while still attached
const TILT_MAX = 2 // ± degrees of velocity tilt while gliding
const MARGIN = 8 // viewport clamp margin for a floating sheet

/** Placement state — owned by the memo host so it can size the reserved slot. */
export interface DockState {
	docked: boolean
	dragging: boolean
	expect: boolean // pointer is over the dock slot (float drag → drop preview)
	freePos: { left: number, top: number } | null
}

export const INITIAL_DOCK: DockState = { docked: true, dragging: false, expect: false, freePos: null }

interface Rect { left: number, top: number, width: number, height: number }

export function DockableLyricsSheet({ spotifyTrackId, meta, onClose, hostRef, dock, patch }: {
	spotifyTrackId: string
	meta?: LyricsSheetMeta
	onClose: () => void
	/** The memo modal element — measured to place the docked column. */
	hostRef: RefObject<HTMLElement | null>
	dock: DockState
	patch: (p: Partial<DockState>) => void
}) {
	const panelRef = useRef<HTMLDivElement>(null)
	useDismissable(true, onClose, panelRef)
	const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

	const { docked, freePos } = dock

	/* ── geometry (viewport coords — the panel is position:fixed) ───────────── */
	const dockRect = useCallback((): Rect | null => {
		const m = hostRef.current?.getBoundingClientRect()
		if (!m)
			return null
		return { left: m.right - DOCK_W, top: m.top, width: DOCK_W, height: m.height }
	}, [hostRef])
	const floatSize = () => ({
		width: Math.min(560, window.innerWidth - 80),
		height: Math.min(window.innerHeight - 100, 760),
	})
	const centerRect = (): Rect => {
		const s = floatSize()
		return { left: (window.innerWidth - s.width) / 2, top: Math.max(24, (window.innerHeight - s.height) / 2), ...s }
	}
	const clampPos = (left: number, top: number, w: number, h: number) => ({
		left: Math.max(MARGIN, Math.min(window.innerWidth - w - MARGIN, left)),
		top: Math.max(MARGIN, Math.min(window.innerHeight - h - MARGIN, top)),
	})
	const inSlot = (x: number, y: number) => {
		const m = hostRef.current?.getBoundingClientRect()
		if (!m)
			return false
		return x >= m.right - DOCK_W - 28 && y >= m.top - 28 && y <= m.bottom + 28
	}

	const apply = (r: Partial<Rect>) => {
		const el = panelRef.current
		if (!el)
			return
		if (r.left != null)
			el.style.left = `${r.left}px`
		if (r.top != null)
			el.style.top = `${r.top}px`
		if (r.width != null)
			el.style.width = `${r.width}px`
		if (r.height != null)
			el.style.height = `${r.height}px`
	}

	/* ── resting placement (not during a drag) ─────────────────────────────── */
	const dragRef = useRef<{ p0x: number, p0y: number, sx: number, sy: number, torn: boolean, lastX: number, lastT: number, tilt: number } | null>(null)
	const placeResting = useCallback((instant: boolean) => {
		const el = panelRef.current
		if (!el || dragRef.current)
			return
		if (instant)
			el.style.transition = 'none'
		if (docked) {
			const r = dockRect()
			if (r)
				apply(r)
		}
		else {
			const s = floatSize()
			const pos = freePos ? clampPos(freePos.left, freePos.top, s.width, s.height) : centerRect()
			apply({ ...s, ...pos })
		}
		if (instant) {
			void el.offsetHeight // flush so the resumed transition doesn't animate this jump
			el.style.transition = ''
		}
	}, [docked, freePos, dockRect])

	// Initial place is instant; later state changes glide.
	const mounted = useRef(false)
	useLayoutEffect(() => {
		placeResting(!mounted.current)
		mounted.current = true
	}, [placeResting])

	// Keep the docked sheet glued to the memo through any resize (window, or the
	// slot's own expand/collapse as it docks/tears).
	useEffect(() => {
		const onResize = () => placeResting(true)
		window.addEventListener('resize', onResize)
		const host = hostRef.current
		let ro: ResizeObserver | null = null
		if (host && 'ResizeObserver' in window) {
			ro = new ResizeObserver(() => {
				if (dock.docked && !dragRef.current)
					placeResting(false)
			})
			ro.observe(host)
		}
		return () => {
			window.removeEventListener('resize', onResize)
			ro?.disconnect()
		}
	}, [placeResting, hostRef, dock.docked])

	/* ── drag state machine: grab → tear → glide → dock ────────────────────── */
	const setClass = (add: string[], remove: string[]) => {
		const el = panelRef.current
		if (!el)
			return
		el.classList.add(...add)
		el.classList.remove(...remove)
	}

	const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
		if (e.button !== 0 || dragRef.current)
			return
		if ((e.target as HTMLElement).closest('button'))
			return
		e.preventDefault()
		try {
			e.currentTarget.setPointerCapture(e.pointerId)
		}
		catch { /* pointer released early — bubbling still tracks the drag */ }
		const el = panelRef.current!
		dragRef.current = {
			p0x: e.clientX,
			p0y: e.clientY,
			sx: el.offsetLeft,
			sy: el.offsetTop,
			torn: !docked,
			lastX: e.clientX,
			lastT: performance.now(),
			tilt: 0,
		}
		setClass(['is-grabbed', 'is-lifted', ...(docked ? ['is-straining'] : [])], [])
		patch({ dragging: true })
	}

	const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
		const d = dragRef.current
		if (!d)
			return
		const dx = e.clientX - d.p0x
		const dy = e.clientY - d.p0y

		if (!d.torn) {
			// act 2 — tear resistance
			if (Math.hypot(dx, dy) < TEAR_PX) {
				apply({ left: d.sx + dx * RESIST, top: d.sy + dy * RESIST })
				return
			}
			// '뚝' — it tears off into a floating sheet
			d.torn = true
			setClass([], ['is-straining'])
			patch({ docked: false })
			const s = floatSize()
			d.sx = e.clientX - s.width * 0.4
			d.sy = e.clientY - 24
			d.p0x = e.clientX
			d.p0y = e.clientY
			apply({ left: d.sx, top: d.sy, ...s })
			return
		}

		// act 3 — glide with velocity tilt
		if (!reduced) {
			const now = performance.now()
			const vx = (e.clientX - d.lastX) / Math.max(1, now - d.lastT)
			d.lastX = e.clientX
			d.lastT = now
			const t = Math.max(-TILT_MAX, Math.min(TILT_MAX, vx * 3))
			d.tilt = d.tilt * 0.7 + t * 0.3
			if (panelRef.current)
				panelRef.current.style.transform = `rotate(${d.tilt.toFixed(2)}deg)`
		}
		const el = panelRef.current!
		const pos = clampPos(d.sx + dx, d.sy + dy, el.offsetWidth, el.offsetHeight)
		apply(pos)

		// act 4 preview — highlight the slot when the pointer is over it
		patch({ expect: inSlot(e.clientX, e.clientY) })
	}

	const endDrag = (e: ReactPointerEvent<HTMLElement>) => {
		const d = dragRef.current
		if (!d)
			return
		const wasTorn = d.torn
		const overSlot = wasTorn && inSlot(e.clientX, e.clientY)
		dragRef.current = null
		setClass([], ['is-grabbed', 'is-lifted', 'is-straining'])
		if (panelRef.current)
			panelRef.current.style.transform = ''

		if (!wasTorn) {
			// never tore — settle back into the dock
			patch({ dragging: false, expect: false })
			placeResting(false)
			return
		}
		if (overSlot) {
			// act 4 — magnet snap home
			patch({ docked: true, dragging: false, expect: false, freePos: null })
		}
		else {
			// free placement — the paper stays where it was dropped
			const el = panelRef.current!
			const pos = clampPos(el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight)
			patch({ dragging: false, expect: false, freePos: pos })
		}
	}

	const headHandlers: HeadHandlers = { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag }

	/* ── keyboard-equivalent placement toggle ──────────────────────────────── */
	const togglePlacement = () => {
		if (dragRef.current)
			return
		if (docked)
			patch({ docked: false, freePos: null })
		else
			patch({ docked: true, freePos: null })
	}
	const placementControl = (
		<button type="button" className="lys-place" onClick={togglePlacement} title={docked ? '분리해서 자유 배치' : '메모창에 도킹'}>
			{docked ? '⇱ 분리' : '⇲ 도킹'}
		</button>
	)

	return (
		<LyricsSheetContent
			spotifyTrackId={spotifyTrackId}
			meta={meta}
			onClose={onClose}
			panelRef={panelRef}
			panelClassName={`is-mounted ${docked ? 'is-docked' : 'is-float'}`}
			headHandlers={headHandlers}
			placementControl={placementControl}
		/>
	)
}

export default DockableLyricsSheet
