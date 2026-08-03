// FEAT-lyrics-sheet PR 2 — the drag tear/dock wrapper around LyricsSheetContent.
//
// Docking is a 봉합, not a panel (owner 2026-07-07): while docked the sheet is
// the memo window's right column — the SAME paper, no border/shadow, only the
// perforation seam. The shared grab → tear → glide → dock physics lives in
// `@lib/dockTear`; this wrapper supplies only the memo-specific geometry.
//
// Desktop only — the memo host renders the plain float LyricsSheet on mobile,
// where header-drag would fight scrolling (see MemoWindow).
import type { RefObject } from 'react'
import type { DockRect, DockState } from '@lib/dockTear'
import type { HeadHandlers, LyricsSheetMeta } from './LyricsSheet'
import { useCallback, useRef } from 'react'
import { useDockTear } from '@lib/dockTear'
import { useDismissable } from '@lib/useDismissable'
import { LyricsSheetContent } from './LyricsSheet'

export type { DockState } from '@lib/dockTear'
export { INITIAL_DOCK } from '@lib/dockTear'

// Fallback only. The real width is `--lys-dock-w` on the memo shell, which
// varies with the 보통/크게/최대 size setting — read at call time so the CSS
// remains the single source and the two cannot disagree.
const DOCK_W = 320
const MARGIN = 8
const FLOAT_W = 720
const SIDE_MIN_W = 380

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
	// Focus is trapped only while DOCKED. Torn off, the sheet is a second window
	// beside the memo rather than a layer over it, and trapping Tab inside it
	// makes the memo — the thing you tore the sheet off to write in — unreachable.
	useDismissable(true, onClose, panelRef, { trapFocus: dock.docked, autoFocus: dock.docked })
	const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

	const dockW = useCallback(() => {
		const host = hostRef.current
		if (!host)
			return DOCK_W
		const value = Number.parseFloat(getComputedStyle(host).getPropertyValue('--lys-dock-w'))
		return Number.isFinite(value) && value > 0 ? value : DOCK_W
	}, [hostRef])

	const dockRect = useCallback((): DockRect | null => {
		const modal = hostRef.current?.getBoundingClientRect()
		if (!modal)
			return null
		const width = dockW()
		return { left: modal.right - width, top: modal.top, width, height: modal.height }
	}, [dockW, hostRef])

	const floatSize = useCallback(() => ({
		width: Math.min(FLOAT_W, window.innerWidth - 80),
		height: Math.min(window.innerHeight - 64, 900),
	}), [])

	/** A torn sheet rests beside the memo when a useful side gap exists. */
	const restRect = useCallback((): DockRect => {
		const size = floatSize()
		const modal = hostRef.current?.getBoundingClientRect()
		const centred = {
			left: (window.innerWidth - size.width) / 2,
			top: Math.max(24, (window.innerHeight - size.height) / 2),
			...size,
		}
		if (!modal)
			return centred
		const top = Math.max(MARGIN, Math.min(modal.top, window.innerHeight - size.height - MARGIN))
		// Fit the sheet to the available gap: at 최대 a fixed 720px sheet would
		// otherwise fall back over the memo, defeating the tear-off interaction.
		const right = window.innerWidth - modal.right - MARGIN * 2
		const left = modal.left - MARGIN * 2
		const gap = Math.max(right, left)
		if (gap >= SIDE_MIN_W) {
			const width = Math.min(size.width, gap)
			return right >= left ?
				{ left: modal.right + MARGIN, top, width, height: size.height } :
				{ left: modal.left - width - MARGIN, top, width, height: size.height }
		}
		return centred
	}, [floatSize, hostRef])

	const clampPos = useCallback((left: number, top: number, width: number, height: number) => ({
		left: Math.max(MARGIN, Math.min(window.innerWidth - width - MARGIN, left)),
		top: Math.max(MARGIN, Math.min(window.innerHeight - height - MARGIN, top)),
	}), [])

	/** Bound both slot edges so the dock target is not an infinite right half-plane. */
	const inSlot = useCallback((x: number, y: number) => {
		const modal = hostRef.current?.getBoundingClientRect()
		if (!modal)
			return false
		return x >= modal.right - dockW() - 28 && x <= modal.right + 28 &&
			y >= modal.top - 28 && y <= modal.bottom + 28
	}, [dockW, hostRef])

	const { handlers, togglePlacement } = useDockTear({
		panelRef,
		hostRef,
		dock,
		patch,
		dockRect,
		floatSize,
		restRect,
		clampPos,
		inSlot,
		reducedMotion: reduced,
	})
	const headHandlers: HeadHandlers = handlers
	const placementControl = (
		<button type="button" className="lys-place" onClick={togglePlacement} title={dock.docked ? '분리해서 자유 배치' : '메모창에 도킹'}>
			{dock.docked ? '⇱ 분리' : '⇲ 도킹'}
		</button>
	)

	return (
		<LyricsSheetContent
			spotifyTrackId={spotifyTrackId}
			meta={meta}
			onClose={onClose}
			panelRef={panelRef}
			panelClassName={`is-mounted ${dock.docked ? 'is-docked' : 'is-float'}`}
			headHandlers={headHandlers}
			placementControl={placementControl}
		/>
	)
}

export default DockableLyricsSheet
