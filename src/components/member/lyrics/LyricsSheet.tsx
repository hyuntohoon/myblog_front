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
import type { CSSProperties, PointerEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react'
import type { AnnoStyle, LineMark } from './annotations'
import type { LyricsAnnotation, LyricsResponse, LyricsSegment, LyricsTranslationInfo } from './lyrics.api'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useDismissable } from '@lib/useDismissable'
import { useScrollLock } from '@lib/useScrollLock'
import {
  buildLineMarks,
  drawerItems,
  drawerMark,
  lineClasses,
  readAnnoStyle,
  spanLength,
  writeAnnoStyle,
} from './annotations'
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

/** Screen-reader label for a marked line — announces the range, per the design record. */
function markLabel(mark: LineMark): string {
	const a = mark.anno
	const n = spanLength(a)
	const range = n <= 1 ?
		`${(a.start_i ?? 0) + 1}행` :
		`${(a.start_i ?? 0) + 1}행부터 ${(a.end_i ?? 0) + 1}행까지 ${n}행`
	const repeat = a.status === 'repeated' && a.occurrences > 1 ? `, 곡에서 ${a.occurrences}번 반복` : ''
	const disputed = a.disputed ? ', 이견 있음' : ''
	const paired = mark.sharedBy > 1 ? `, 이 줄을 주장하는 해설 ${mark.sharedBy}개` : ''
	return `해설, ${range}${repeat}${disputed}${paired}`
}

/**
 * The `N행` / 반복 tail that sits at the end of a range.
 *
 * Every label is built as ONE interpolated string. Splitting `{n}` and `행` across
 * JSX lines makes the compiler join them with a space — "12 행", "곡에서 2 번 나옵니다" —
 * which is what the formatter does if the text is left inline.
 */
function MarkTail({ mark }: { mark: LineMark }) {
	const n = spanLength(mark.anno)
	const repeats = mark.anno.status === 'repeated' && mark.anno.occurrences > 1
	return (
		<>
			{n > 1 && <span className="lys-tail mono">{`${n}행`}</span>}
			{repeats && <span className="lys-echo mono">{`×${mark.anno.occurrences}`}</span>}
			{mark.sharedBy > 1 && <span className="lys-dual mono">{`해설 ${mark.sharedBy}`}</span>}
		</>
	)
}

/**
 * One opened annotation. The Korean body is the body a reader sees; the original is
 * secondary and collapsed. A withheld translation says so rather than showing nothing.
 */
function AnnoNote({ anno, paired }: { anno: LyricsAnnotation, paired: boolean }) {
	const withheld = anno.translation_status !== 'done'
	return (
		<div className="lys-note">
			<div className="lys-note-head mono">
				<span>해설</span>
				<span className={anno.votes_total < 0 ? 'v neg' : 'v'}>
					{`${anno.votes_total > 0 ? '+' : ''}${anno.votes_total}표`}
				</span>
			</div>
			{anno.status === 'repeated' && anno.occurrences > 1 && (
				<p className="lys-note-flag mono">
					{`이 구간은 곡에서 ${anno.occurrences}번 나옵니다 — 번호는 첫 등장에만 붙습니다`}
				</p>
			)}
			{anno.disputed && (
				<p className="lys-note-flag is-warn mono">
					{`득표 ${anno.votes_total} — 커뮤니티에서 반박된 해석입니다`}
				</p>
			)}
			{paired && <p className="lys-note-flag mono">겹친 줄 — 이 줄을 주장하는 해설이 둘입니다</p>}
			{withheld ?
				(
					<p className="lys-note-body">
						{anno.translation_status === 'stale' ?
							'원문이 바뀌어 한국어 해설을 다시 만들어야 합니다.' :
							'한국어 해설이 아직 준비되지 않았습니다.'}
					</p>
				) :
				<p className="lys-note-body">{anno.body_ko}</p>}
			<details>
				<summary className="mono">원문 보기</summary>
				<p className="lys-note-src">{anno.fragment}</p>
				{anno.genius_url && (
					<a className="lys-note-link mono" href={anno.genius_url} target="_blank" rel="noreferrer noopener">Genius에서 보기</a>
				)}
			</details>
		</div>
	)
}

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
 * Lyrics data + reading state shared by the standalone sheet and the memo
 * context panel. Keeping this state above the presentational pieces means a tab
 * switch can hide lyrics without discarding scroll-adjacent UI state such as an
 * opened annotation or translation preference.
 */
export function useLyricsSheetState(spotifyTrackId: string) {
	const [phase, setPhase] = useState<Phase>({ k: 'loading' })
	const [mode, setMode] = useState<Mode>(readMode)
	const [annoStyle, setAnnoStyle] = useState<AnnoStyle>(readAnnoStyle)
	const [openIds, setOpenIds] = useState<number[]>([])
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
				if (stale)
					return
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

	// Annotations ride the same payload. They are present even when availability is
	// not "ok" — a track can carry commentary and no synced lyrics at all.
	const annotations = (phase.k === 'ready' ? phase.data.annotations : null) ?? []
	const lineMarks = useMemo(() => buildLineMarks(annotations), [annotations])
	const drawer = useMemo(() => drawerItems(annotations), [annotations])

	const pickAnnoStyle = (v: AnnoStyle) => {
		setAnnoStyle(v)
		writeAnnoStyle(v)
	}

	/** Opening a shared line opens every claim on it — see the containment fallback. */
	const toggleAnno = (mark: LineMark) => {
		const ids = mark.claims.map(a => a.id)
		const same = ids.length === openIds.length && ids.every(i => openIds.includes(i))
		setOpenIds(same ? [] : ids)
	}

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

	return {
		phase,
		mode,
		annoStyle,
		openIds,
		showKo,
		requesting,
		copied,
		notice,
		segs,
		n,
		translation,
		koreanDominant,
		stanzas,
		annotations,
		lineMarks,
		drawer,
		emptyText,
		sourceKind,
		pickMode,
		pickAnnoStyle,
		toggleAnno,
		requestTr,
		copyAll,
		setShowKo,
		setOpenIds,
		retry: () => setLoadSeq(s => s + 1),
	}
}

export type LyricsSheetState = ReturnType<typeof useLyricsSheetState>

/** Toolbar controls only; host chrome owns placement and close controls. */
export function LyricsSheetToolbar({ state }: { state: LyricsSheetState }) {
	const {
		mode,
		annotations,
		annoStyle,
		phase,
		n,
		translation,
		showKo,
		koreanDominant,
		requesting,
		copied,
		pickMode,
		pickAnnoStyle,
		setShowKo,
		requestTr,
		copyAll,
	} = state

	return (
		<>
			<span className="lys-seg" role="group" aria-label="조판 모드">
				<button type="button" className={mode === 'doc' ? 'on' : ''} aria-pressed={mode === 'doc'} onClick={() => pickMode('doc')}>문서</button>
				<button type="button" className={mode === 'liner' ? 'on' : ''} aria-pressed={mode === 'liner'} onClick={() => pickMode('liner')}>라이너</button>
			</span>
			{/* Highlight treatment is the ONE annotation axis exposed. Marker density
			    runs 9.5%–64.7% per track, so no fixed treatment is right across it;
			    long spans and overlap have single answers and stay fixed rules.
			    Shown only when this track actually has annotations. */}
			{mode === 'doc' && annotations.length > 0 && (
				<span className="lys-seg" role="group" aria-label="주석 강조">
					<button type="button" className={annoStyle === 'm0' ? 'on' : ''} aria-pressed={annoStyle === 'm0'} onClick={() => pickAnnoStyle('m0')} title="칠하기">칠</button>
					<button type="button" className={annoStyle === 'm1' ? 'on' : ''} aria-pressed={annoStyle === 'm1'} onClick={() => pickAnnoStyle('m1')} title="밑줄 — 밀집한 곡에 적합">밑줄</button>
					<button type="button" className={annoStyle === 'm2' ? 'on' : ''} aria-pressed={annoStyle === 'm2'} onClick={() => pickAnnoStyle('m2')} title="여백만 — 가사를 가장 방해하지 않음">여백</button>
					<button type="button" className={annoStyle === 'm3' ? 'on' : ''} aria-pressed={annoStyle === 'm3'} onClick={() => pickAnnoStyle('m3')} title="열었을 때만 — 강조를 희소하게">열림</button>
				</span>
			)}
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
		</>
	)
}

/** The notice + scroll body, kept byte-for-byte compatible in the old sheet. */
export function LyricsSheetBody({ state, meta }: { state: LyricsSheetState, meta?: LyricsSheetMeta }) {
	const {
		phase,
		mode,
		annoStyle,
		openIds,
		showKo,
		notice,
		segs,
		n,
		translation,
		stanzas,
		lineMarks,
		drawer,
		emptyText,
		toggleAnno,
		setOpenIds,
		retry,
	} = state
	return (
		<>
			{notice && <div className="lys-note mono" role="status">{notice}</div>}
			<div className="lys-body">
				{phase.k === 'loading' && <div className="lys-status mono">불러오는 중…</div>}

				{phase.k === 'error' && (
					<div className="lys-status">
						<p>가사를 불러오지 못했어요</p>
						<button type="button" className="lys-retry mono" onClick={retry}>다시 시도</button>
					</div>
				)}

				{phase.k === 'ready' && n === 0 && <div className="lys-status">{emptyText}</div>}

				{phase.k === 'ready' && n > 0 && mode === 'doc' && (
					<div className={`lys-doc lys-anno-${annoStyle}`}>
						{segs.map((s) => {
							if (s.text === '')
								return <div key={s.i} className="lys-gap" aria-hidden="true">· · ·</div>

							const mark = lineMarks.get(s.i)
							const cls = ['lys-line', ...lineClasses(mark, openIds)].join(' ')
							const open = mark && mark.claims.some(a => openIds.includes(a.id))
							return (
								<div key={s.i}>
									<p
										className={cls}
										{...(mark && {
											role: 'button',
											tabIndex: 0,
											'aria-expanded': !!open,
											'aria-label': markLabel(mark),
											onClick: () => toggleAnno(mark),
											onKeyDown: (e: ReactKeyboardEvent) => {
												if (e.key === 'Enter' || e.key === ' ') {
													e.preventDefault()
													toggleAnno(mark)
												}
											},
										})}
									>
										{mark && <span className="lys-brk" aria-hidden="true" />}
										<span className="lys-orig serif">{s.text}</span>
										{mark && mark.pos !== 'middle' && mark.pos !== 'start' && <MarkTail mark={mark} />}
										{showKo && s.text_ko && s.text_ko !== s.text && <span className="lys-ko">{s.text_ko}</span>}
									</p>
									{/* The note opens inline under its own range: this column is 320–560px,
									    so there is no margin for it to sit beside. */}
									{open && mark.claims.filter(a => openIds.includes(a.id)).map(a => (
										<AnnoNote key={a.id} anno={a} paired={mark.sharedBy > 1} />
									))}
								</div>
							)
						})}
					</div>
				)}

				{phase.k === 'ready' && mode === 'doc' && drawer.length > 0 && (
					<div className="lys-anno-drawer">
						<h3 className="mono">가사에 못 붙은 주석</h3>
						<p className="lys-anno-why">
							Genius 원문에는 있지만 우리 가사에는 없는 구절입니다. 가사가 다시 매칭되면
							저절로 본문에 붙습니다.
						</p>
						<ol>
							{drawer.map((a, idx) => (
								<li key={a.id}>
									<button
										type="button"
										aria-expanded={openIds.includes(a.id)}
										onClick={() => setOpenIds(openIds.includes(a.id) ? [] : [a.id])}
									>
										<span className="mk mono">{drawerMark(idx)}</span>
										<span className="tx">{a.fragment}</span>
									</button>
									{openIds.includes(a.id) && <AnnoNote anno={a} paired={false} />}
								</li>
							))}
						</ol>
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
		</>
	)
}

/** Placement-agnostic standalone sheet interior retained for existing callers. */
export function LyricsSheetContent({ spotifyTrackId, meta, onClose, panelRef, panelClassName, panelStyle, headHandlers, placementControl }: {
	spotifyTrackId: string
	meta?: LyricsSheetMeta
	onClose: () => void
	panelRef: RefObject<HTMLDivElement | null>
	panelClassName?: string
	panelStyle?: CSSProperties
	headHandlers?: HeadHandlers
	placementControl?: ReactNode
}) {
	const state = useLyricsSheetState(spotifyTrackId)
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
			<div className="lys-perf" aria-hidden="true" />
			<header className="lys-head" onPointerDown={headHandlers?.onPointerDown} onPointerMove={headHandlers?.onPointerMove} onPointerUp={headHandlers?.onPointerUp} onPointerCancel={headHandlers?.onPointerCancel}>
				<div className="lys-id">
					<span className="lys-eyebrow mono">
						가사
						{state.sourceKind ? ` · ${state.sourceKind}` : ''}
					</span>
					<span className="lys-title serif">{meta?.track || '가사'}</span>
					{(meta?.artist || meta?.album) && (
						<span className="lys-sub">{[meta?.artist, meta?.album].filter(Boolean).join(' — ')}</span>
					)}
				</div>
				<div className="lys-actions">
					<LyricsSheetToolbar state={state} />
					{placementControl}
					<button type="button" className="lys-x" onClick={onClose} aria-label="닫기">✕</button>
				</div>
			</header>
			<LyricsSheetBody state={state} meta={meta} />
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
	// Freeze the page behind the scrim (else the profile scrolls under the sheet).
	useScrollLock()

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
