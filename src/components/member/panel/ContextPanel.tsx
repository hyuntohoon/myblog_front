import type { PointerEvent, ReactNode, RefObject } from 'react'
import type { DockRect, DockState } from '@lib/dockTear'
import type { HeadHandlers, LyricsSheetMeta } from '../lyrics/LyricsSheet'
import { useCallback, useRef, useState } from 'react'
import { useDockTear } from '@lib/dockTear'
import { useDismissable } from '@lib/useDismissable'
import { useScrollLock } from '@lib/useScrollLock'
import ResearchNote from '../ResearchNote'
import { LyricsSheetBody, LyricsSheetToolbar, useLyricsSheetState } from '../lyrics/LyricsSheet'

export type ContextPanelTab = 'lyrics' | 'research'

export interface ContextPanelTrack {
	trackId: string
	meta?: LyricsSheetMeta
}

export interface ContextPanelProps {
	albumId: string
	track: ContextPanelTrack | null
	tab: ContextPanelTab
	onTabChange: (tab: ContextPanelTab) => void
	onClose: () => void
	hostRef: RefObject<HTMLElement | null>
	dock: DockState
	patch: (patch: Partial<DockState>) => void
	mobile: boolean
}

const DOCK_W = 320
const MARGIN = 8
const FLOAT_W = 720
const SIDE_MIN_W = 380
// These are the exact .lys-dock-hint inset values in layout.css. The target is
// deliberately no larger than the preview a person can see.
const DOCK_HINT_X = 12
const DOCK_HINT_Y = 16

function LyricsPane({ track }: { track: ContextPanelTrack }) {
	const state = useLyricsSheetState(track.trackId)
	return (
		<div className="ctx-lyrics">
			<div className="ctx-track-id">
				<span className="lys-eyebrow mono">
					가사
					{state.sourceKind ? ` · ${state.sourceKind}` : ''}
				</span>
				<span className="lys-title serif">{track.meta?.track || '가사'}</span>
				{(track.meta?.artist || track.meta?.album) && (
					<span className="lys-sub">{[track.meta?.artist, track.meta?.album].filter(Boolean).join(' — ')}</span>
				)}
			</div>
			<div className="lys-actions ctx-lyrics-actions">
				<LyricsSheetToolbar state={state} />
			</div>
			<LyricsSheetBody state={state} meta={track.meta} />
		</div>
	)
}

/** Both panes stay in the tree; CSS alone switches which one is visible. */
function ContextPanelPanes({ albumId, track, tab }: Pick<ContextPanelProps, 'albumId' | 'track' | 'tab'>) {
	return (
		<div className="ctx-body">
			<div
				id="ctx-pane-lyrics"
				className={`ctx-pane ctx-pane-lyrics${tab === 'lyrics' ? ' is-active' : ''}`}
				role="tabpanel"
				aria-labelledby="ctx-tab-lyrics"
				aria-hidden={tab !== 'lyrics'}
			>
				{track ? <LyricsPane key={track.trackId} track={track} /> : <div className="lys-status mono">트랙을 선택하면 가사가 여기 표시됩니다</div>}
			</div>
			<div
				id="ctx-pane-research"
				className={`ctx-pane ctx-pane-research${tab === 'research' ? ' is-active' : ''}`}
				role="tabpanel"
				aria-labelledby="ctx-tab-research"
				aria-hidden={tab !== 'research'}
			>
				<ResearchNote albumId={albumId} variant="doc" />
			</div>
		</div>
	)
}

function ContextPanelHeader({ tab, onTabChange, onClose, handlers, placementControl }: {
	tab: ContextPanelTab
	onTabChange: (tab: ContextPanelTab) => void
	onClose: () => void
	handlers: HeadHandlers
	placementControl?: ReactNode
}) {
	return (
		<header className="lys-head ctx-head" {...handlers}>
			<div className="ctx-tabs" role="tablist" aria-label="컨텍스트 패널">
				<button
					id="ctx-tab-lyrics"
					type="button"
					className={`ctx-tab${tab === 'lyrics' ? ' is-active' : ''}`}
					role="tab"
					aria-selected={tab === 'lyrics'}
					aria-controls="ctx-pane-lyrics"
					onClick={() => onTabChange('lyrics')}
				>
					가사
				</button>
				<button
					id="ctx-tab-research"
					type="button"
					className={`ctx-tab${tab === 'research' ? ' is-active' : ''}`}
					role="tab"
					aria-selected={tab === 'research'}
					aria-controls="ctx-pane-research"
					onClick={() => onTabChange('research')}
				>
					리서치 노트
				</button>
			</div>
			<div className="lys-actions ctx-head-actions">
				{placementControl}
				<button type="button" className="lys-x" onClick={onClose} aria-label="닫기">✕</button>
			</div>
		</header>
	)
}

function DesktopContextPanel(props: Omit<ContextPanelProps, 'mobile'>) {
	const { albumId, track, tab, onTabChange, onClose, hostRef, dock, patch } = props
	const panelRef = useRef<HTMLDivElement>(null)
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

	const inSlot = useCallback((x: number, y: number) => {
		const modal = hostRef.current?.getBoundingClientRect()
		if (!modal)
			return false
		return x >= modal.right - dockW() + DOCK_HINT_X && x <= modal.right - DOCK_HINT_X &&
			y >= modal.top + DOCK_HINT_Y && y <= modal.bottom - DOCK_HINT_Y
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
	const placementControl = (
		<button type="button" className="lys-place" onClick={togglePlacement} title={dock.docked ? '분리해서 자유 배치' : '메모창에 도킹'}>
			{dock.docked ? '⇱ 분리' : '⇲ 도킹'}
		</button>
	)

	return (
		<div
			ref={panelRef}
			className={`lys-sheet ctx-panel is-mounted ${dock.docked ? 'is-docked' : 'is-float'}`}
			role="dialog"
			aria-modal="true"
			aria-label="앨범 컨텍스트"
			onClick={event => event.stopPropagation()}
		>
			<div className="lys-perf" aria-hidden="true" />
			<ContextPanelHeader tab={tab} onTabChange={onTabChange} onClose={onClose} handlers={handlers} placementControl={placementControl} />
			<ContextPanelPanes albumId={albumId} track={track} tab={tab} />
		</div>
	)
}

function MobileContextPanel(props: Omit<ContextPanelProps, 'mobile' | 'hostRef' | 'dock' | 'patch'>) {
	const { albumId, track, tab, onTabChange, onClose } = props
	const panelRef = useRef<HTMLDivElement>(null)
	useDismissable(true, onClose, panelRef)
	useScrollLock()
	const [offset, setOffset] = useState({ x: 0, y: 0 })
	const drag = useRef<{ px: number, py: number, ox: number, oy: number } | null>(null)
	const handlers: HeadHandlers = {
		onPointerDown: (event: PointerEvent<HTMLElement>) => {
			if (event.button !== 0 || (event.target as HTMLElement).closest('button'))
				return
			drag.current = { px: event.clientX, py: event.clientY, ox: offset.x, oy: offset.y }
			try {
				event.currentTarget.setPointerCapture(event.pointerId)
			}
			catch { /* pointer already released */ }
		},
		onPointerMove: (event) => {
			const current = drag.current
			if (!current)
				return
			const cx = window.innerWidth * 0.42
			const cy = window.innerHeight * 0.42
			setOffset({
				x: Math.max(-cx, Math.min(cx, current.ox + event.clientX - current.px)),
				y: Math.max(-cy, Math.min(cy, current.oy + event.clientY - current.py)),
			})
		},
		onPointerUp: () => {
			drag.current = null
		},
	}
	handlers.onPointerCancel = handlers.onPointerUp

	return (
		<div
			className="scrim"
			style={{ justifyContent: 'center', alignItems: 'center', padding: 24 }}
			onClick={(event) => {
				event.stopPropagation()
				onClose()
			}}
			role="presentation"
		>
			<div
				ref={panelRef}
				className="lys-sheet ctx-panel ctx-panel-mobile"
				role="dialog"
				aria-modal="true"
				aria-label="앨범 컨텍스트"
				onClick={event => event.stopPropagation()}
				style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
			>
				<div className="lys-perf" aria-hidden="true" />
				<ContextPanelHeader tab={tab} onTabChange={onTabChange} onClose={onClose} handlers={handlers} />
				<ContextPanelPanes albumId={albumId} track={track} tab={tab} />
			</div>
		</div>
	)
}

export function ContextPanel({ mobile, ...props }: ContextPanelProps) {
	return mobile ? <MobileContextPanel {...props} /> : <DesktopContextPanel {...props} />
}

export default ContextPanel
