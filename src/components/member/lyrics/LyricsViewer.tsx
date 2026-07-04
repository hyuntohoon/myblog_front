// FEAT-lyrics-viewer Step 2 — full-screen lyrics viewer overlay (MVP).
//
// Renders the project-normalized segments from GET /api/lyrics/{id}
// (ARCH-lyrics-normalization-model contract) as an editorial reading surface:
// exactly one focused segment emphasized (serif, full contrast), neighbors
// de-emphasized, the rest recessed. Navigation is MANUAL ONLY — prev/next
// controls, vertical swipe/drag, direct tap-to-focus (+ arrow keys / wheel as
// control equivalents). No playback-time progression of any kind (RFC
// non-goal).
//
// Step 3 additions: `start_ms` now seeds a ONE-SHOT initial focus from the
// playback position handed in by the dynamic entry (`initialProgressMs`), and a
// manual refresh control (`canRefresh`, dynamic entry only) re-reads the live
// playback moment — track change swaps segments, position-only change
// re-initializes the focus once, stopped playback shows "재생 중 아님" rather
// than substituting a recent track. Focus never advances on its own.
//
// The viewer does no LRC parsing and never falls back to raw text: rows the
// normalization model hasn't made consumable arrive as availability !== 'ok'
// and render an availability-aware empty state.
//
// FEAT-lyrics-translation Step 4: a 번역 toggle interleaves each segment's
// `text_ko` dimmed under its original line (the focus/nav unit stays the
// original segment), and a 번역 요청 button drives the request lifecycle
// (none/failed/stale → request → 요청됨). Korean-dominant tracks get no
// request button — nothing to translate.
import type { KeyboardEvent, PointerEvent, WheelEvent } from 'react'
import type { LyricsResponse, LyricsSegment, LyricsTranslationInfo } from './lyrics.api'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useDismissable } from '@lib/useDismissable'
import { getLyrics, requestTranslation } from './lyrics.api'
import { readLivePlayback } from './playback.api'

/** Vertical drag distance (px) that advances the focus by one segment. */
const DRAG_STEP = 56
/** Accumulated wheel delta (px) that advances the focus by one segment. */
const WHEEL_STEP = 80

type Phase =
	| { k: 'loading' } |
	{ k: 'error' } |
	{ k: 'ready', data: LyricsResponse }

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }
  catch {
    return false
  }
}

/**
 * The segment a playback moment maps to: the last segment whose `start_ms` is
 * at or before `ms` (synced rows only — plain rows carry no timestamps and are
 * never position-initialized).
 */
function focusIndexForMs(segs: LyricsSegment[], ms: number): number {
  let idx = 0
  for (let i = 0; i < segs.length; i++) {
    const start = segs[i].start_ms
    if (start != null && start <= ms)
      idx = i
  }
  return idx
}

/**
 * Korean-dominant source detection (FEAT-lyrics-translation OQ3): Hangul share
 * of the letter-like characters across the non-gap segment text ≥ 50% means
 * the track is already Korean — the viewer offers no translation request.
 * Mirrors the poller's belt-and-suspenders `korean_source` guard.
 */
function isKoreanDominant(segs: LyricsSegment[]): boolean {
  let hangul = 0
  let letters = 0
  // Hangul syllables + compatibility jamo / Latin (+ extended), Greek,
  // Cyrillic, kana, CJK ideographs — the letter scripts the corpus carries.
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

export function LyricsViewer({ spotifyTrackId, initialProgressMs = null, canRefresh = false, onClose }: {
  spotifyTrackId: string
  /** One-shot playback position from the dynamic entry; seeds the initial focus, never advances it. */
  initialProgressMs?: number | null
  /** Show the manual-refresh control (dynamic entry only — the debug entry has no playback binding). */
  canRefresh?: boolean
  onClose: () => void
}) {
  // Track id is internal state (seeded from the prop) so a manual refresh can
  // swap tracks in place; the caller's key still remounts on a fresh open.
  const [trackId, setTrackId] = useState(spotifyTrackId)
  const [phase, setPhase] = useState<Phase>({ k: 'loading' })
  const [focus, setFocus] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const segRefs = useRef<(HTMLButtonElement | null)[]>([])
  useDismissable(true, onClose, panelRef)

  const segs = phase.k === 'ready' && phase.data.availability === 'ok' ?
    (phase.data.segments ?? []) :
    []
  const n = segs.length

  // One-shot initial-focus position: consumed exactly once by the next load
  // (open with position, or a refresh that swapped tracks), then cleared.
  const pendingFocusMs = useRef<number | null>(initialProgressMs)

  // Translation lifecycle (FEAT-lyrics-translation Step 4). The read carries
  // the row state; a successful POST overrides it locally (→ 요청됨) until the
  // next load re-reads the truth. Toggle interleaves text_ko under each line —
  // the focus/nav unit stays the original segment, so nav logic is untouched.
  const [trOverride, setTrOverride] = useState<LyricsTranslationInfo | null>(null)
  const [showKo, setShowKo] = useState(false)
  const [requesting, setRequesting] = useState(false)

  // Load (and reload on retry / refresh track swap). Guard against a stale
  // response landing after unmount or after the track changed again.
  const [loadSeq, setLoadSeq] = useState(0)
  useEffect(() => {
    let stale = false
    setPhase({ k: 'loading' })
    setFocus(0)
    segRefs.current = []
    setTrOverride(null)
    getLyrics(trackId)
      .then((data) => {
        if (stale)
          return
        setPhase({ k: 'ready', data })
        const ms = pendingFocusMs.current
        pendingFocusMs.current = null
        if (ms != null && data.availability === 'ok' && data.trackable && data.segments?.length)
          setFocus(focusIndexForMs(data.segments, ms))
      })
      .catch(() => {
        if (!stale)
          setPhase({ k: 'error' })
      })
    return () => {
      stale = true
    }
  }, [trackId, loadSeq])

  // Manual refresh (dynamic entry only): ONE live playback read per tap.
  // Track changed → swap segments (+ one-shot focus at the new position);
  // same track → re-initialize the focus once at the current position;
  // stopped → say so — never substitute a recent track (RFC).
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const refresh = async () => {
    if (refreshing)
      return
    setRefreshing(true)
    try {
      const r = await readLivePlayback()
      if (r.state === 'playing') {
        setNotice(null)
        if (r.trackId !== trackId) {
          pendingFocusMs.current = r.progressMs
          setTrackId(r.trackId)
        }
        else if (r.progressMs != null && phase.k === 'ready' && phase.data.availability === 'ok' && phase.data.trackable && n > 0) {
          setFocus(focusIndexForMs(segs, r.progressMs))
        }
      }
      else if (r.state === 'idle') {
        setNotice('지금 재생 중인 곡이 없어요')
      }
      else {
        setNotice('재생 상태를 확인하지 못했어요')
      }
    }
    finally {
      setRefreshing(false)
    }
  }

  const translation = trOverride ?? (phase.k === 'ready' ? phase.data.translation : null) ?? null
  const koreanDominant = useMemo(() => isKoreanDominant(segs.filter(s => s.text !== '')), [segs])
  const requestTr = async () => {
    if (requesting)
      return
    setRequesting(true)
    try {
      setTrOverride(await requestTranslation(trackId))
      setNotice(null)
    }
    catch {
      setNotice('번역 요청에 실패했어요')
    }
    finally {
      setRequesting(false)
    }
  }

  const step = (delta: number) => {
    setFocus(f => Math.max(0, Math.min(n - 1, f + delta)))
  }

  // Keep the focused segment at ~42% viewport height. The focus emphasis
  // animates font-size (layout shifts under the smooth scroll), so a short
  // settle pass re-centers once the transition has finished.
  useEffect(() => {
    if (n === 0)
      return
    const center = (behavior: ScrollBehavior) => {
      const box = scrollRef.current
      const el = segRefs.current[focus]
      if (!box || !el)
        return
      const top = el.offsetTop + el.offsetHeight / 2 - box.clientHeight * 0.42
      box.scrollTo({ top, behavior })
    }
    const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth'
    center(behavior)
    const settle = setTimeout(() => center(behavior), 240)
    return () => clearTimeout(settle)
  }, [focus, n])

  // Re-center instantly on viewport changes (rotation, keyboard, resize).
  useEffect(() => {
    if (n === 0)
      return
    const onResize = () => {
      const box = scrollRef.current
      const el = segRefs.current[focus]
      if (!box || !el)
        return
      box.scrollTo({ top: el.offsetTop + el.offsetHeight / 2 - box.clientHeight * 0.42, behavior: 'auto' })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [focus, n])

  // Vertical swipe/drag = manual navigation (touch-action: none on the scroll
  // area hands touch pans to us). Dragging up (finger/pointer moves up) reads
  // forward, matching natural scroll direction. A real drag suppresses the
  // click that fires on pointerup so it can't double as tap-to-focus.
  const drag = useRef<{ y0: number, applied: number, moved: boolean } | null>(null)
  const suppressTap = useRef(false)
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0)
      return
    drag.current = { y0: e.clientY, applied: 0, moved: false }
    suppressTap.current = false
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d)
      return
    const dy = e.clientY - d.y0
    if (Math.abs(dy) > 8 && !d.moved) {
      d.moved = true
      suppressTap.current = true
      // Capture only once a real drag begins. Capturing on pointerdown
      // retargets pointerup/click to this container, so a plain tap's click
      // never reaches the segment button (tap-to-focus goes dead).
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      }
      catch { /* pointer already released — drag still tracks via bubbling */ }
    }
    const want = Math.trunc(-dy / DRAG_STEP)
    if (want !== d.applied) {
      step(want - d.applied)
      d.applied = want
    }
  }
  const onPointerEnd = () => {
    drag.current = null
  }

  // Wheel = control-equivalent stepping on desktop (the list itself is not a
  // free-scroll surface; focus motion is the only scroll).
  const wheelAcc = useRef(0)
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    wheelAcc.current += e.deltaY
    if (Math.abs(wheelAcc.current) >= WHEEL_STEP) {
      step(Math.sign(wheelAcc.current))
      wheelAcc.current = 0
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      step(1)
    }
    else if (e.key === 'ArrowUp') {
      e.preventDefault()
      step(-1)
    }
  }

  const tapFocus = (i: number) => {
    if (suppressTap.current)
      return
    setFocus(i)
  }

  const pad = String(n).length
  const emptyText = phase.k === 'ready' && phase.data.availability === 'no_lyrics' ?
    '가사 없음 (연주곡)' :
    '아직 연결된 가사가 없어요'

  return (
    <div className="scrim lyv-scrim" role="dialog" aria-modal="true" aria-label="가사 뷰어">
      <div ref={panelRef} className="lyv-panel" onKeyDown={onKeyDown}>
        <div className="lyv-head">
          <span className="lyv-eyebrow mono">
            Lyrics
            {phase.k === 'ready' && phase.data.availability === 'ok' && phase.data.source_kind ?
              ` · ${phase.data.source_kind}` :
              ''}
          </span>
          <div className="lyv-head-actions">
            {phase.k === 'ready' && phase.data.availability === 'ok' && n > 0 && (
              translation?.status === 'done' ?
                (
                  <>
                    {translation.origin === 'manual' && <span className="lyv-tr-origin mono">manual</span>}
                    <button
	type="button"
	className={showKo ? 'lyv-tr-btn is-on mono' : 'lyv-tr-btn mono'}
	aria-pressed={showKo}
	onClick={() => setShowKo(v => !v)}
                    >
                      번역
                    </button>
                  </>
                ) :
                koreanDominant ?
                  null :
                  translation?.status === 'requested' ?
                    <span className="lyv-tr-state mono" role="status">요청됨</span> :
                    (
                      <button
	type="button"
	className="lyv-tr-btn mono"
	disabled={requesting}
	onClick={() => {
                          void requestTr()
                        }}
                      >
                        {translation?.status === 'failed' ? '실패 · 재요청' : translation?.status === 'stale' ? '번역 갱신' : '번역 요청'}
                      </button>
                    )
            )}
            {canRefresh && (
              <button
	type="button"
	className={refreshing ? 'lyv-btn is-refreshing' : 'lyv-btn'}
	onClick={() => {
                  void refresh()
                }}
	disabled={refreshing || phase.k === 'loading'}
	aria-label="현재 재생 새로고침"
              >
                ↻
              </button>
            )}
            <button type="button" className="lyv-btn" onClick={onClose} aria-label="닫기">✕</button>
          </div>
        </div>

        {notice && <div className="lyv-note mono" role="status">{notice}</div>}

        {phase.k === 'loading' && <div className="lyv-status mono">불러오는 중…</div>}

        {phase.k === 'error' && (
          <div className="lyv-status">
            <p>가사를 불러오지 못했어요</p>
            <button type="button" className="lyv-retry mono" onClick={() => setLoadSeq(s => s + 1)}>다시 시도</button>
          </div>
        )}

        {phase.k === 'ready' && n === 0 && <div className="lyv-status">{emptyText}</div>}

        {phase.k === 'ready' && n > 0 && (
          <>
            <div className="lyv-body">
              <div
	ref={scrollRef}
	className="lyv-scroll"
	onPointerDown={onPointerDown}
	onPointerMove={onPointerMove}
	onPointerUp={onPointerEnd}
	onPointerCancel={onPointerEnd}
	onWheel={onWheel}
              >
                <div className="lyv-list">
                  {segs.map((s, i) => {
                    const d = Math.abs(i - focus)
                    const cls = i === focus ? 'lyv-line is-focus' : d === 1 ? 'lyv-line is-near' : 'lyv-line'
                    return (
                      <button
	key={s.i}
	ref={(el) => {
                          segRefs.current[i] = el
                        }}
	type="button"
	className={cls}
	onClick={() => tapFocus(i)}
                      >
                        {s.text === '' ?
                          <span className="lyv-gap" aria-label="간주">· · ·</span> :
                          showKo && s.text_ko && s.text_ko !== s.text ?
                            (
                              <>
                                {s.text}
                                <span className="lyv-line-ko">{s.text_ko}</span>
                              </>
                            ) :
                            s.text}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
            <div className="lyv-rail">
              <button type="button" className="lyv-btn" onClick={() => step(-1)} disabled={focus === 0} aria-label="이전 구절">↑</button>
              <span className="lyv-count mono" aria-live="polite">
                <span className="lyv-count-cur">{String(focus + 1).padStart(pad, '0')}</span>
                {' / '}
                {n}
              </span>
              <button type="button" className="lyv-btn" onClick={() => step(1)} disabled={focus === n - 1} aria-label="다음 구절">↓</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default LyricsViewer
