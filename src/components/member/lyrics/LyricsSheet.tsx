// FEAT-lyrics-sheet — the STATIC lyrics viewer, for reading lyrics as review
// material (not the immersive live-sync LyricsViewer).
//
// The two are deliberately different surfaces (owner 2026-07-07): the live
// viewer is a dark, one-line-focus, auto-advancing listening screen; this sheet
// is a bright paper document you read in full, copy from, and set the Korean
// translation beside — because it exists to WRITE a review, not to follow a
// playing track. It has no playback binding, no auto-advance, no focus
// centering; it renders every project-normalized segment at once.
//
// Two typography modes on the same data (persisted per browser):
//   · doc   — 대역 문서: each line in serif, its translation as a dimmed
//             footnote-toned line directly under it. Best for quoting.
//   · liner — 라이너 노트: verses (segments split on gap rows) as centered
//             italic stanzas, the translation as a per-stanza prose block.
//
// Placement is free-drag by the header (PR 1). The memo-window dock / tear
// interaction is a follow-up (PR 2) — this component stays placement-agnostic.
//
// Data + translation reuse the existing authenticated reads (GET
// /api/lyrics/{id} + translation-request) — no backend change.
import type { CSSProperties, PointerEvent, ReactNode, RefObject } from 'react'
import type { LyricsResponse, LyricsSegment, LyricsTranslationInfo } from './lyrics.api'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useDismissable } from '@lib/useDismissable'
import { getLyrics, requestTranslation } from './lyrics.api'

/** Header pointer handlers — the sheet's grab handle (move / tear). */
export interface HeadHandlers {
	onPointerDown?: (e: PointerEvent<HTMLElement>) => void
	onPointerMove?: (e: PointerEvent<HTMLElement>) => void
	onPointerUp?: (e: PointerEvent<HTMLElement>) => void
	onPointerCancel?: (e: PointerEvent<HTMLElement>) => void
}

/** Header identity handed in by the entry (the reads carry no title/artist). */
export interface LyricsSheetMeta {
	track?: string | null
	artist?: string | null
	album?: string | null
	cover?: string | null
}

type Mode = 'doc' | 'liner'
const MODE_KEY = 'lys:mode'

function readMode(): Mode {
	try {
		return localStorage.getItem(MODE_KEY) === 'liner' ? 'liner' : 'doc'
	}
	catch {
		return 'doc'
	}
}

type Phase =
	| { k: 'loading' } |
	{ k: 'error' } |
	{ k: 'ready', data: LyricsResponse }

/**
 * Korean-dominant source detection (mirror of LyricsViewer OQ3): ≥50% Hangul
 * share of the letter-like characters → already Korean, so offer no request.
 */
function isKoreanDominant(segs: LyricsSegment[]): boolean {
	let hangul = 0
	let letters = 0
	const isHangul = /[\uAC00-\uD7A3\u3131-\u318E]/
	const isLetter = /[a-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u3040-\u30FF\u4E00-\u9FFF]/i
	for (const s of segs) {
		for (const ch of s.text) {
			if (isHangul.test(ch)) {
				hangul++
				letters++
			}
			else if (isLetter.test(ch)) {
				letters++
			}
		}
	}
	return letters > 0 && hangul / letters >= 0.5
}

/** Split segments into stanzas on gap (empty-text) rows, for the liner layout. */
function toStanzas(segs: LyricsSegment[]): LyricsSegment[][] {
	const out: LyricsSegment[][] = []
	let cur: LyricsSegment[] = []
	for (const s of segs) {
		if (s.text === '') {
			if (cur.length) {
				out.push(cur)
				cur = []
			}
		}
		else {
			cur.push(s)
		}
	}
	if (cur.length)
		out.push(cur)
	return out
}

/** A stanza's translation as a prose block ('' when the stanza has none). */
function stanzaKo(st: LyricsSegment[]): string {
	return st
		.map(s => (s.text_ko && s.text_ko !== s.text ? s.text_ko : ''))
		.filter(Boolean)
		.join('\n')
}

/**
 * The placement-agnostic sheet interior (FEAT-lyrics-sheet PR 2 architecture:
 * "LyricsSheet가 배치를 모른다"). It owns the lyric data, 조판 mode, translation
 * and copy — everything that reads the same wherever the paper sits. WHERE the
 * paper goes (free float in a scrim, or docked as the memo window's right
 * column) is the wrapper's job, supplied via `panelRef` / `panelClassName` /
 * `panelStyle` / `headHandlers`. The float wrapper is `LyricsSheet` below; the
 * dock/tear wrapper is `DockableLyricsSheet` (used by the memo window host).
 */
export function LyricsSheetContent({ spotifyTrackId, meta, onClose, panelRef, panelClassName, panelStyle, headHandlers, placementControl }: {
	spotifyTrackId: string
	meta?: LyricsSheetMeta
	onClose: () => void
	/** Panel element ref — the wrapper owns useDismissable + measurement. */
	panelRef: RefObject<HTMLDivElement | null>
	/** Placement/state modifiers (is-docked / is-float / is-grabbed …). */
	panelClassName?: string
	/** Positioning the wrapper computes (transform for float, fixed rect for dock). */
	panelStyle?: CSSProperties
	/** Header pointer handlers — the grab-to-move / grab-to-tear handle. */
	headHandlers?: HeadHandlers
	/** Optional header control (the 분리/도킹 keyboard-equivalent button). */
	placementControl?: ReactNode
}) {
	const [phase, setPhase] = useState<Phase>({ k: 'loading' })
	const [mode, setMode] = useState<Mode>(readMode)
	const [showKo, setShowKo] = useState(false)
	const [trOverride, setTrOverride] = useState<LyricsTranslationInfo | null>(null)
	const [requesting, setRequesting] = useState(false)
	const [copied, setCopied] = useState(false)
	const [notice, setNotice] = useState<string | null>(null)
	const [loadSeq, setLoadSeq] = useState(0)

	// Load (and reload on retry). Guard a stale response landing after unmount.
	useEffect(() => {
		let stale = false
		setPhase({ k: 'loading' })
		setTrOverride(null)
		getLyrics(spotifyTrackId)
			.then((data) => {
				if (stale)
					return
				setPhase({ k: 'ready', data })
				// A finished translation shows by default (matches LyricsViewer).
				setShowKo(data.availability === 'ok' && data.translation?.status === 'done')
			})
			.catch(() => {
				if (!stale)
					setPhase({ k: 'error' })
			})
		return () => {
			stale = true
		}
	}, [spotifyTrackId, loadSeq])

	const pickMode = (m: Mode) => {
		setMode(m)
		try {
			localStorage.setItem(MODE_KEY, m)
		}
		catch { /* private mode — the choice just doesn't persist */ }
	}

	const segs = phase.k === 'ready' && phase.data.availability === 'ok' ?
		(phase.data.segments ?? []) :
		[]
	const n = segs.length
	const translation = trOverride ?? (phase.k === 'ready' ? phase.data.translation : null) ?? null
	const koreanDominant = useMemo(() => isKoreanDominant(segs.filter(s => s.text !== '')), [segs])
	const stanzas = useMemo(() => toStanzas(segs), [segs])

	const requestTr = async () => {
		if (requesting)
			return
		setRequesting(true)
		try {
			setTrOverride(await requestTranslation(spotifyTrackId))
			setNotice(null)
		}
		catch {
			setNotice('번역 요청에 실패했어요')
		}
		finally {
			setRequesting(false)
		}
	}

	// Copy the whole lyric as plain text (review material). Follows the 번역
	// toggle: original only, or original + translation interleaved per line.
	const copyAll = async () => {
		const text = segs
			.map((s) => {
				if (s.text === '')
					return ''
				const ko = showKo && s.text_ko && s.text_ko !== s.text ? `\n${s.text_ko}` : ''
				return s.text + ko
			})
			.join('\n')
		try {
			await navigator.clipboard.writeText(text)
			setCopied(true)
			setNotice(null)
			window.setTimeout(() => setCopied(false), 1600)
		}
		catch {
			setNotice('복사에 실패했어요')
		}
	}

	const emptyText = phase.k === 'ready' && phase.data.availability === 'no_lyrics' ?
		'가사 없음 (연주곡)' :
		'아직 연결된 가사가 없어요'
	const sourceKind = phase.k === 'ready' && phase.data.availability === 'ok' ? phase.data.source_kind : null

	return (
		<div
			ref={panelRef}
			className={panelClassName ? `lys-sheet ${panelClassName}` : 'lys-sheet'}
			role="dialog"
			aria-modal="true"
			aria-label="가사"
			onClick={e => e.stopPropagation()}
			style={panelStyle}
		>
			{/* perforation seam — the boundary with the memo paper when docked;
			    CSS fades it out on float (see .lys-sheet.is-float .lys-perf). */}
			<div className="lys-perf" aria-hidden="true" />
			<header className="lys-head" onPointerDown={headHandlers?.onPointerDown} onPointerMove={headHandlers?.onPointerMove} onPointerUp={headHandlers?.onPointerUp} onPointerCancel={headHandlers?.onPointerCancel}>
				<div className="lys-id">
					<span className="lys-eyebrow mono">
						가사
						{sourceKind ? ` · ${sourceKind}` : ''}
					</span>
					<span className="lys-title serif">{meta?.track || '가사'}</span>
					{(meta?.artist || meta?.album) && (
						<span className="lys-sub">{[meta?.artist, meta?.album].filter(Boolean).join(' — ')}</span>
					)}
				</div>
				<div className="lys-actions">
					<span className="lys-seg" role="group" aria-label="조판 모드">
						<button type="button" className={mode === 'doc' ? 'on' : ''} aria-pressed={mode === 'doc'} onClick={() => pickMode('doc')}>문서</button>
						<button type="button" className={mode === 'liner' ? 'on' : ''} aria-pressed={mode === 'liner'} onClick={() => pickMode('liner')}>라이너</button>
					</span>
					{phase.k === 'ready' && phase.data.availability === 'ok' && n > 0 && (
						translation?.status === 'done' ?
							(
								<button type="button" className={showKo ? 'lys-btn is-on mono' : 'lys-btn mono'} aria-pressed={showKo} onClick={() => setShowKo(v => !v)}>번역</button>
							) :
							koreanDominant ?
								null :
								translation?.status === 'requested' ?
									<span className="lys-tr-state mono" role="status">요청됨</span> :
									(
										<button type="button" className="lys-btn mono" disabled={requesting} onClick={() => void requestTr()}>
											{translation?.status === 'failed' ? '실패 · 재요청' : translation?.status === 'stale' ? '번역 갱신' : '번역 요청'}
										</button>
									)
					)}
					{n > 0 && (
						<button type="button" className="lys-btn mono" onClick={() => void copyAll()}>{copied ? '복사됨' : '전문 복사'}</button>
					)}
					{placementControl}
					<button type="button" className="lys-x" onClick={onClose} aria-label="닫기">✕</button>
				</div>
			</header>

			{notice && <div className="lys-note mono" role="status">{notice}</div>}

			<div className="lys-body">
				{phase.k === 'loading' && <div className="lys-status mono">불러오는 중…</div>}

				{phase.k === 'error' && (
					<div className="lys-status">
						<p>가사를 불러오지 못했어요</p>
						<button type="button" className="lys-retry mono" onClick={() => setLoadSeq(s => s + 1)}>다시 시도</button>
					</div>
				)}

				{phase.k === 'ready' && n === 0 && <div className="lys-status">{emptyText}</div>}

				{phase.k === 'ready' && n > 0 && mode === 'doc' && (
					<div className="lys-doc">
						{segs.map(s => (
							s.text === '' ?
								<div key={s.i} className="lys-gap" aria-hidden="true">· · ·</div> :
								(
									<p key={s.i} className="lys-line">
										<span className="lys-orig serif">{s.text}</span>
										{showKo && s.text_ko && s.text_ko !== s.text && <span className="lys-ko">{s.text_ko}</span>}
									</p>
								)
						))}
					</div>
				)}

				{phase.k === 'ready' && n > 0 && mode === 'liner' && (
					<div className="lys-liner">
						{meta?.cover && (
							<div className="lys-liner-art" role="img" aria-label="앨범 커버" style={{ backgroundImage: `url(${meta.cover})` }} />
						)}
						{stanzas.map((st, idx) => {
							const ko = stanzaKo(st)
							return (
								<div className="lys-stanza" key={st[0]?.i ?? idx}>
									{idx > 0 && <div className="lys-stanza-rule" aria-hidden="true" />}
									<p className="lys-stanza-o serif">{st.map(s => s.text).join('\n')}</p>
									{showKo && ko && <p className="lys-stanza-k">{ko}</p>}
								</div>
							)
						})}
						<div className="lys-liner-src mono">
							source · lrclib
							{translation?.origin ? ` — translation · ${translation.origin}` : ''}
						</div>
					</div>
				)}
			</div>
		</div>
	)
}

/**
 * Float standalone wrapper (the non-dock entries: album detail tracklist, liked
 * board, `?lyrics=`). A centered scrim + free drag-to-reposition by the header —
 * the PR 1 behaviour, now expressed on top of the shared LyricsSheetContent.
 */
export function LyricsSheet({ spotifyTrackId, meta, onClose }: {
	spotifyTrackId: string
	meta?: LyricsSheetMeta
	onClose: () => void
}) {
	const panelRef = useRef<HTMLDivElement>(null)
	useDismissable(true, onClose, panelRef)

	// Free drag-to-reposition by the header. Offset rides on top of the scrim's
	// flex-centering; loosely clamped so the header can never leave the viewport.
	const [offset, setOffset] = useState<{ x: number, y: number }>({ x: 0, y: 0 })
	const drag = useRef<{ px: number, py: number, ox: number, oy: number } | null>(null)
	const headHandlers: HeadHandlers = {
		onPointerDown: (e) => {
			if (e.button !== 0)
				return
			if ((e.target as HTMLElement).closest('button'))
				return
			drag.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y }
			try {
				e.currentTarget.setPointerCapture(e.pointerId)
			}
			catch { /* pointer already released — drag still tracks via bubbling */ }
		},
		onPointerMove: (e) => {
			const d = drag.current
			if (!d)
				return
			const cx = window.innerWidth * 0.42
			const cy = window.innerHeight * 0.42
			setOffset({
				x: Math.max(-cx, Math.min(cx, d.ox + (e.clientX - d.px))),
				y: Math.max(-cy, Math.min(cy, d.oy + (e.clientY - d.py))),
			})
		},
		onPointerUp: () => {
			drag.current = null
		},
	}
	headHandlers.onPointerCancel = headHandlers.onPointerUp

	return (
		<div
			className="scrim"
			style={{ justifyContent: 'center', alignItems: 'center', padding: 24 }}
			onClick={onClose}
			role="presentation"
		>
			<LyricsSheetContent
				spotifyTrackId={spotifyTrackId}
				meta={meta}
				onClose={onClose}
				panelRef={panelRef}
				headHandlers={headHandlers}
				panelStyle={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
			/>
		</div>
	)
}

export default LyricsSheet
