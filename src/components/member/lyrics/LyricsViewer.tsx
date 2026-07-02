// FEAT-lyrics-viewer Step 2 — full-screen lyrics viewer overlay (MVP).
//
// Renders the project-normalized segments from GET /api/lyrics/{id}
// (ARCH-lyrics-normalization-model contract) as an editorial reading surface:
// exactly one focused segment emphasized (serif, full contrast), neighbors
// de-emphasized, the rest recessed. Navigation is MANUAL ONLY — prev/next
// controls, vertical swipe/drag, direct tap-to-focus (+ arrow keys / wheel as
// control equivalents). No playback-time progression of any kind (RFC
// non-goal); `start_ms` is ignored until Step 3's one-shot initial focus.
//
// The viewer does no LRC parsing and never falls back to raw text: rows the
// normalization model hasn't made consumable arrive as availability !== 'ok'
// and render an availability-aware empty state.
import type { KeyboardEvent, PointerEvent, WheelEvent } from 'react'
import type { LyricsResponse } from './lyrics.api'
import { useEffect, useRef, useState } from 'react'
import { useDismissable } from '@lib/useDismissable'
import { getLyrics } from './lyrics.api'

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

export function LyricsViewer({ spotifyTrackId, onClose }: { spotifyTrackId: string, onClose: () => void }) {
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

  // Load (and reload on retry). Track-id changes remount via the caller's key,
  // but guard against a stale response landing after unmount anyway.
  const [loadSeq, setLoadSeq] = useState(0)
  useEffect(() => {
    let stale = false
    setPhase({ k: 'loading' })
    setFocus(0)
    getLyrics(spotifyTrackId)
      .then((data) => {
        if (!stale)
          setPhase({ k: 'ready', data })
      })
      .catch(() => {
        if (!stale)
          setPhase({ k: 'error' })
      })
    return () => {
      stale = true
    }
  }, [spotifyTrackId, loadSeq])

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
    <div className="lf-scrim lyv-scrim" role="dialog" aria-modal="true" aria-label="가사 뷰어">
      <div ref={panelRef} className="lyv-panel" onKeyDown={onKeyDown}>
        <div className="lyv-head">
          <span className="lyv-eyebrow lf-mono">
            Lyrics
            {phase.k === 'ready' && phase.data.availability === 'ok' && phase.data.source_kind ?
              ` · ${phase.data.source_kind}` :
              ''}
          </span>
          <button type="button" className="lyv-btn" onClick={onClose} aria-label="닫기">✕</button>
        </div>

        {phase.k === 'loading' && <div className="lyv-status lf-mono">불러오는 중…</div>}

        {phase.k === 'error' && (
          <div className="lyv-status">
            <p>가사를 불러오지 못했어요</p>
            <button type="button" className="lyv-retry lf-mono" onClick={() => setLoadSeq(s => s + 1)}>다시 시도</button>
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
                        {s.text === '' ? <span className="lyv-gap" aria-label="간주">· · ·</span> : s.text}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
            <div className="lyv-rail">
              <button type="button" className="lyv-btn" onClick={() => step(-1)} disabled={focus === 0} aria-label="이전 구절">↑</button>
              <span className="lyv-count lf-mono" aria-live="polite">
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
