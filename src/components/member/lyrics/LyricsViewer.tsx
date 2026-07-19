// FEAT-lyrics-viewer Steps 2–3 + FEAT-lyrics-auto-progression Step 1 —
// full-screen lyrics viewer overlay.
//
// Renders the project-normalized segments from GET /api/lyrics/{id}
// (ARCH-lyrics-normalization-model contract) as an editorial reading surface:
// exactly one focused segment emphasized (serif, full contrast), neighbors
// de-emphasized, the rest recessed.
//
// Navigation: vertical swipe/drag, direct tap-to-focus (+ arrow keys / wheel
// as control equivalents). The dedicated prev/next rail was dropped; manual
// browsing stays available via swipe/keys/tap.
//
// The viewer does no LRC parsing and never falls back to raw text: rows the
// normalization model hasn't made consumable arrive as availability !== 'ok'
// and render an availability-aware empty state.
//
// Step 3 seeded a ONE-SHOT initial focus from the playback position handed in
// by the dynamic entry (`initialProgressMs`); a manual refresh control
// (`canRefresh`, dynamic entry only) re-reads the live playback moment — track
// change swaps segments, position-only change re-initializes focus, stopped
// playback shows "재생 중 아님" rather than substituting a recent track.
//
// FEAT-lyrics-auto-progression Step 1 REPEALS the prior manual-only non-goal:
// the one-shot seed is now a continuous **clock estimate**. On open (and on
// each re-sync) `readLivePlayback().progressMs` seeds `{ anchorMs, wallMs }`;
// a ~250ms interval (while following, paused while `document.hidden`) computes
// `estimatedMs = anchorMs + (performance.now() - wallMs)` and advances `focus`
// via `focusIndexForMs()` only when the index changes (minimal re-renders).
// The ↻ re-sync re-seeds the continuous anchor. Plain-only (non-trackable)
// rows never run the estimate. No backend / polling / SDK coupling — the
// position source is still the existing one-shot REST read (D28 honored).
//
// FEAT-lyrics-end-resync extends the clock estimate two ways:
// (1) Latency-anchored seeding — the anchor's wall instant is the moment the
//     playback position was actually READ (`readAtMs` from readLivePlayback),
//     not whenever the lyrics finished loading. Previously the entry-tap
//     position was paired with a post-`getLyrics()` performance.now(), so the
//     focus lagged by the whole read + lyrics-load latency. A small
//     `SYNC_LEAD_MS` bias covers what can't be measured (Spotify-side progress
//     staleness, tick granularity, perception).
// (2) End-of-track auto re-sync — the live entry now hands in `durationMs`;
//     when the estimate passes duration + END_GRACE_MS the viewer fires ONE
//     automatic `refresh()` (same one-shot read — event-driven, not polling, so
//     D28 still holds). Next track playing → existing swap path shows its
//     lyrics; idle → the existing "지금 재생 중인 곡이 없어요" notice, view kept.
//     One shot per anchor seed (`endSynced` ref): a re-sync re-arms it only
//     when the fresh position sits meaningfully before the end; idle/failed
//     results and a player stuck reporting `playing` at ≈duration leave it
//     disarmed, so neither a stopped nor a wedged player is ever hammered.
//
// FEAT-lyrics-viewer-controls Step 1 replaces [자동|수동] with follow/suspend:
// browsing temporarily pauses the clock estimate without re-anchoring it, then
// returns to the live line through either a countdown pill (A) or an un-dimmed
// browse window with idle snap-back (D). Explicit line taps still re-anchor.
//
// FEAT-lyrics-translation Step 4: a 번역 toggle interleaves each segment's
// `text_ko` dimmed under its original line (the focus/nav unit stays the
// original segment), and a 번역 요청 button drives the request lifecycle
// (none/failed/stale → request → 요청됨). Korean-dominant tracks get no
// request button — nothing to translate.
//
// FEAT-lyrics-auto-progression Step 2 is visual-only (album-blur backdrop +
// always-dark + large sans-serif typography); it lives in the `.lyv-*` CSS.
import type { ClockAnchor } from '@lib/clockEstimate'
import type { KeyboardEvent, PointerEvent, WheelEvent } from 'react'
import type { LyricsResponse, LyricsSegment, LyricsTranslationInfo } from './lyrics.api'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { estimateMs } from '@lib/clockEstimate'
import { useDismissable } from '@lib/useDismissable'
import { useScrollLock } from '@lib/useScrollLock'
import { getLyrics, requestTranslation } from './lyrics.api'
import { readLivePlayback } from './playback.api'

/** Vertical drag distance (px) that advances the focus by one segment. */
const DRAG_STEP = 56
/** Accumulated wheel delta (px) that advances the focus by one segment. */
const WHEEL_STEP = 80
/**
 * Clock-estimate loop cadence (FEAT-lyrics-auto-progression Step 1, OQ1).
 * Lines are typically 3-8s apart, so 250ms is far finer than needed and keeps
 * the estimate / focus comparison cheap. RAF was rejected (overkill at this
 * grain, harder to pause/resume).
 */
const ESTIMATE_INTERVAL_MS = 250
/**
 * Fixed lead added to the clock estimate (FEAT-lyrics-end-resync). Covers the
 * unmeasurable tail after latency-anchoring: Spotify's own progress staleness
 * and the ≤250ms tick grain — a line landing a touch early reads as "in sync",
 * landing late reads as lagging. Tune here if the feel drifts.
 */
const SYNC_LEAD_MS = 300
/**
 * How far past `durationMs` the estimate must run before the end-of-track auto
 * re-sync fires (FEAT-lyrics-end-resync). Gives Spotify a beat to actually
 * advance to the next item so the one-shot read lands on it, and absorbs
 * estimate drift near the boundary.
 */
const END_GRACE_MS = 1500
/** Idle return delay for Behavior A's visible countdown pill. */
const PILL_IDLE_MS = 4000
/** Idle return delay for Behavior D's un-dimmed browse window. */
const BROWSE_IDLE_MS = 3000

type Phase =
	| { k: 'loading' } |
	{ k: 'error' } |
	{ k: 'ready', data: LyricsResponse }

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

/**
 * One lyric line, memoized so a focus step re-renders only the ≤4 lines whose
 * emphasis tier changed instead of the whole list — the full-list commit was
 * the main-thread spike at the start of every auto-advance step on WebKit.
 * `register`/`onTap` are stable callbacks (refs inside), so shallow compare
 * only sees `cls`/`textKo` flips.
 */
const LyricsLine = memo(({ i, text, textKo, cls, register, onTap }: {
  i: number
  text: string
  textKo: string | null
  cls: string
  register: (i: number, el: HTMLButtonElement | null) => void
  onTap: (i: number) => void
}) => (
  <button
	type="button"
	ref={(el) => {
      register(i, el)
    }}
	className={cls}
	onClick={() => onTap(i)}
  >
    {text === '' ?
      <span className="lyv-gap" aria-label="간주">· · ·</span> :
      textKo ?
        (
          <>
            {text}
            <span className="lyv-line-ko">{textKo}</span>
          </>
        ) :
        text}
  </button>
))

/** localStorage key for the viewer style choice ('blur' | 'flat'). */
const STYLE_KEY = 'lyv:style'
type LyvStyle = 'blur' | 'flat'

function readStoredStyle(): LyvStyle {
  try {
    return localStorage.getItem(STYLE_KEY) === 'flat' ? 'flat' : 'blur'
  }
  catch {
    return 'blur'
  }
}

/** localStorage key for the follow-return behavior ('pill' | 'browse'). */
const BEHAVIOR_KEY = 'lyv:behavior'
type LyvBehavior = 'pill' | 'browse'

function readStoredBehavior(): LyvBehavior {
  try {
    return localStorage.getItem(BEHAVIOR_KEY) === 'browse' ? 'browse' : 'pill'
  }
  catch {
    return 'pill'
  }
}

export function LyricsViewer({ spotifyTrackId, initialProgressMs = null, initialProgressAtMs = null, initialDurationMs = null, initialAlbumCoverUrl = null, initialTrack = null, initialArtist = null, canRefresh = false, onClose }: {
  spotifyTrackId: string
  /** One-shot playback position from the dynamic entry; seeds the initial focus and continuous clock anchor. */
  initialProgressMs?: number | null
  /** Wall instant (performance.now() timeline) `initialProgressMs` was read at — anchors the estimate at read time, not load time. */
  initialProgressAtMs?: number | null
  /** Track length from the dynamic entry's live read; enables end-of-track auto re-sync. */
  initialDurationMs?: number | null
  /** Album cover URL from the dynamic entry; backs the Spotify-style blur backdrop (Step 2). Re-sync refreshes it. */
  initialAlbumCoverUrl?: string | null
  /** Track title / artist from the dynamic entry's live read (display only — the debug/static entries have none and hide the block). Re-sync refreshes them. */
  initialTrack?: string | null
  initialArtist?: string | null
  /** Show the manual-refresh control (dynamic entry only — the debug entry has no playback binding). */
  canRefresh?: boolean
  onClose: () => void
}) {
  // Track id is internal state (seeded from the prop) so a manual refresh can
  // swap tracks in place; the caller's key still remounts on a fresh open.
  const [trackId, setTrackId] = useState(spotifyTrackId)
  const [phase, setPhase] = useState<Phase>({ k: 'loading' })
  const [focus, setFocus] = useState(0)
  // Album cover for the blur backdrop (FEAT-lyrics-auto-progression Step 2).
  // Visual-only state: seeded from the entry prop, refreshed alongside each
  // re-sync's readLivePlayback(). The dynamic entry passes it; the static/debug
  // entries have no cover and fall back to the neutral dark background.
  const [coverUrl, setCoverUrl] = useState<string | null>(initialAlbumCoverUrl)
  // Track title/artist for the header (live entry only; refreshed per re-sync).
  const [meta, setMeta] = useState<{ track: string | null, artist: string | null }>({ track: initialTrack, artist: initialArtist })
  // Viewer style variant: 'blur' = the Spotify-like centered album-blur look,
  // 'flat' = the Apple-Music-like left-aligned flat wash (owner request
  // 2026-07-06, reference screenshot). Persisted per browser.
  const [lyvStyle, setLyvStyle] = useState<LyvStyle>(readStoredStyle)
  const pickStyle = (s: LyvStyle) => {
    setLyvStyle(s)
    try {
      localStorage.setItem(STYLE_KEY, s)
    }
    catch { /* private mode — the choice just doesn't persist */ }
  }
  const panelRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const segRefs = useRef<(HTMLButtonElement | null)[]>([])
  // False until the current track's list has been positioned once — the first
  // centering after (re)load is instant, everything after animates.
  const positionedRef = useRef(false)
  useDismissable(true, onClose, panelRef)
  // Freeze the page behind the viewer (it can open over the album-detail modal).
  useScrollLock()

  const segs = phase.k === 'ready' && phase.data.availability === 'ok' ?
    (phase.data.segments ?? []) :
    []
  const n = segs.length
  // Whether the row carries timestamps auto-advance can consume. Computed from
  // the loaded phase; plain-only rows (trackable === false) are manual-only.
  const trackable = phase.k === 'ready' && phase.data.availability === 'ok' && phase.data.trackable

  // Clock-estimate anchor (shared idiom in @lib/clockEstimate since
  // member-player Step 3): position `ms` captured at wall instant `wallMs`.
  // Seeded on open (from initialProgressMs) and on each re-sync. `null` until a
  // position is available — follow with a null anchor simply doesn't advance.
  const anchor = useRef<ClockAnchor | null>(null)

  // Follow/suspend (FEAT-lyrics-viewer-controls Step 1): trackable rows follow
  // the estimate by default. Browse input pauses that loop only while a live
  // anchor exists; plain/no-seed rows retain today's unrestricted manual nav.
  const [suspended, setSuspended] = useState(false)
  const [behavior, setBehavior] = useState<LyvBehavior>(readStoredBehavior)
  const [ringRestart, setRingRestart] = useState(0)
  const suspendTimer = useRef<number | null>(null)

  const clearSuspendTimer = () => {
    if (suspendTimer.current == null)
      return
    window.clearTimeout(suspendTimer.current)
    suspendTimer.current = null
  }

  // Return to the CURRENT estimated line without changing the anchor. Browse
  // navigation deliberately never re-anchors: otherwise its temporary focus
  // would erase the playback position this return needs to recover.
  const returnToFollow = () => {
    clearSuspendTimer()
    const a = anchor.current
    if (a && n > 0)
      setFocus(focusIndexForMs(segs, estimateMs(a) + SYNC_LEAD_MS))
    setSuspended(false)
  }

  const armSuspend = () => {
    // With no trackable clock seed there is no live position to return to, so
    // navigation remains free and no suspend UI/timer is created.
    if (!trackable || anchor.current == null)
      return
    clearSuspendTimer()
    setSuspended(true)
    if (behavior === 'pill')
      setRingRestart(k => k + 1)
    const idleMs = behavior === 'pill' ? PILL_IDLE_MS : BROWSE_IDLE_MS
    suspendTimer.current = window.setTimeout(returnToFollow, idleMs)
  }

  const pickBehavior = (next: LyvBehavior) => {
    // The interim switch is itself an explicit request to resume following;
    // snap back before adopting the next behavior's timer/UI.
    if (suspended)
      returnToFollow()
    setBehavior(next)
    try {
      localStorage.setItem(BEHAVIOR_KEY, next)
    }
    catch { /* private mode — the choice just doesn't persist */ }
  }

  // Track length for end-of-track detection (FEAT-lyrics-end-resync). Seeded
  // by the dynamic entry, refreshed from every successful live read; null for
  // static/debug entries — no duration, no end detection.
  const [durationMs, setDurationMs] = useState<number | null>(initialDurationMs)

  // One-shot-per-seed guard for the end-of-track auto re-sync: armed (false)
  // whenever a fresh position seeds the anchor, disarmed (true) the moment the
  // auto re-sync fires. An idle/failed re-sync never re-arms it, so a stopped
  // player gets exactly one automatic read.
  const endSynced = useRef(false)

  // Re-seed the anchor from a fresh playback position and (re)compute the
  // focus from it. Centralizes the "position → anchor + focus" step used by
  // same-track re-sync. `readAtMs` is the wall instant the
  // position was read (defaults to now for callers without one).
  const applyAnchor = (progressMs: number | null, readAtMs?: number) => {
    if (progressMs == null)
      return
    anchor.current = { ms: progressMs, wallMs: readAtMs ?? performance.now() }
    clearSuspendTimer()
    setSuspended(false)
    // Re-arm end detection only when the fresh position sits meaningfully
    // before the end. A same-track read still pinned inside the grace window
    // (a player stuck reporting `playing` at ≈duration) keeps the auto
    // re-sync spent — one automatic read, never a hammer; manual ↻ remains.
    if (durationMs == null || progressMs < durationMs - END_GRACE_MS)
      endSynced.current = false
    if (n > 0)
      setFocus(focusIndexForMs(segs, estimateMs(anchor.current) + SYNC_LEAD_MS))
  }

  // One-shot initial-focus seed (position + the wall instant it was read at):
  // consumed exactly once by the next load (open with position, or a refresh
  // that swapped tracks), then cleared.
  const pendingSeed = useRef<ClockAnchor | null>(
    initialProgressMs != null ? { ms: initialProgressMs, wallMs: initialProgressAtMs ?? performance.now() } : null,
  )

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
    clearSuspendTimer()
    setSuspended(false)
    setPhase({ k: 'loading' })
    setFocus(0)
    anchor.current = null
    segRefs.current = []
    setTrOverride(null)
    getLyrics(trackId)
      .then((data) => {
        if (stale)
          return
        setPhase({ k: 'ready', data })
        // A finished translation shows by default (owner decision 2026-07-06);
        // the 번역 toggle can still hide it. Re-derived per loaded track.
        setShowKo(data.availability === 'ok' && data.translation?.status === 'done')
        const seed = pendingSeed.current
        pendingSeed.current = null
        // Seed BOTH the initial focus and the continuous clock anchor from the
        // one-shot position, anchored at the instant it was READ — the lyrics
        // load that just finished no longer eats into sync. Without timestamps
        // (plain) there is nothing to anchor — follow simply won't advance.
        if (seed != null && data.availability === 'ok' && data.trackable && data.segments?.length) {
          anchor.current = seed
          endSynced.current = false
          setFocus(focusIndexForMs(data.segments, seed.ms + SYNC_LEAD_MS + (performance.now() - seed.wallMs)))
        }
      })
      .catch(() => {
        if (!stale)
          setPhase({ k: 'error' })
      })
    return () => {
      stale = true
    }
  }, [trackId, loadSeq])

  // The suspend timer is the only delayed work added by Step 1; never leave it
  // alive after the full-screen viewer unmounts.
  useEffect(() => () => clearSuspendTimer(), [])

  // Manual refresh / re-sync (dynamic entry only): ONE live playback read per
  // tap. Track changed → swap segments (the load effect seeds focus + anchor
  // from the fresh position); same track → re-seed the continuous anchor +
  // recompute focus from the fresh position (drift correction); stopped → say
  // so — never substitute a recent track (RFC).
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
        // Re-render the blur backdrop against the current track's cover (Step 2).
        setCoverUrl(r.albumCoverUrl)
        setMeta({ track: r.track, artist: r.artist })
        setDurationMs(r.durationMs)
        if (r.trackId !== trackId) {
          // Track changed → swap segments; the load effect seeds both focus
          // and the continuous anchor from the fresh position.
          pendingSeed.current = r.progressMs != null ? { ms: r.progressMs, wallMs: r.readAtMs } : null
          setTrackId(r.trackId)
        }
        else {
          // Same track → re-seed the CONTINUOUS anchor from the fresh position
          // (previously a one-shot focus only). A successful re-sync also exits
          // suspend so the freshly corrected position resumes following.
          applyAnchor(r.progressMs, r.readAtMs)
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

  // Latest-ref so the estimate loop can fire the end-of-track auto re-sync
  // without carrying refresh's per-render identity in its effect deps.
  const refreshRef = useRef(refresh)
  useEffect(() => {
    refreshRef.current = refresh
  })

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

  // Explicit line taps are the ONLY manual navigation that re-anchors: tapping
  // chooses a new playback-relative starting line and resumes follow from it.
  // Browse steps below move visual focus only, preserving the live anchor that
  // idle/pill return needs. Untimed lines leave the anchor unchanged (best effort).
  const moveFocusTo = (next: number) => {
    const start = segs[next]?.start_ms
    if (start != null)
      anchor.current = { ms: start, wallMs: performance.now() }
    clearSuspendTimer()
    setSuspended(false)
    setFocus(next)
  }

  const step = (delta: number) => {
    setFocus(f => Math.max(0, Math.min(n - 1, f + delta)))
  }

  // Keep the focused segment at ~42% viewport height by translating the whole
  // list (compositor-only) instead of scrolling the container. `.lyv-scroll`
  // is overflow:hidden, so `scrollTo({behavior:'smooth'})` was a NON-composited
  // scroll — WebKit repainted the large-type list every animation frame (the
  // reported iPhone/Mac stutter). A `transform` transition never repaints, its
  // duration/easing are ours (CSS `.lyv-list`), and a new focus mid-animation
  // retargets smoothly instead of restarting a native scroll. The focus
  // emphasis stays layout-neutral, so offsets are final at render time.
  // Cached line-center offsets: reading offsetTop/clientHeight forces a full
  // layout of the large-type list, so measure once per (track, 번역 toggle,
  // resize) instead of on every focus step — a per-step forced layout was part
  // of the WebKit step hitch. Offsets are transform-independent, so moving the
  // list never invalidates them.
  const measureRef = useRef<{ centers: number[], boxH: number } | null>(null)

  const applyCenter = (i: number, instant: boolean) => {
    const box = scrollRef.current
    const list = listRef.current
    if (!box || !list)
      return
    let m = measureRef.current
    if (!m) {
      m = {
        centers: segRefs.current.slice(0, n).map(el => (el ? el.offsetTop + el.offsetHeight / 2 : 0)),
        boxH: box.clientHeight,
      }
      measureRef.current = m
    }
    const center = m.centers[i]
    if (center == null)
      return
    const y = m.boxH * 0.42 - center
    if (instant) {
      list.style.transition = 'none'
      list.style.transform = `translate3d(0, ${y}px, 0)`
      void list.offsetHeight // flush so restoring the transition can't animate this jump
      list.style.transition = ''
    }
    else {
      list.style.transform = `translate3d(0, ${y}px, 0)`
    }
  }

  // 번역 toggle interleaves/removes ko lines and the style variant changes
  // alignment/type size → line heights change → offsets must be re-measured
  // (ordered before the centering effect below, which re-applies the
  // now-fresh center on the same commit).
  useEffect(() => {
    measureRef.current = null
  }, [showKo, lyvStyle])

  useEffect(() => {
    if (n === 0) {
      positionedRef.current = false
      measureRef.current = null
      return
    }
    // First position after (re)load lands instantly; reduced-motion users get
    // no animation either way (CSS transition: none under the media query).
    applyCenter(focus, !positionedRef.current)
    positionedRef.current = true
  }, [focus, n, showKo, lyvStyle])

  // Re-center instantly on viewport changes (rotation, keyboard, resize) —
  // sizes changed, so drop the offset cache before re-measuring.
  useEffect(() => {
    if (n === 0)
      return
    const onResize = () => {
      measureRef.current = null
      applyCenter(focus, true)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [focus, n])

  // Clock-estimate follow (FEAT-lyrics-viewer-controls Step 1). Advance focus
  // to the estimated playback segment only when its index changes. Suspend
  // tears down the interval entirely; the anchor keeps aging in wall-clock so
  // return snaps directly to the current line rather than catching up steps.
  // Hidden tabs remain paused and catch up the same way when visible again.
  useEffect(() => {
    if (!trackable || suspended || n === 0)
      return
    // No position seed yet (e.g. a static/debug entry has no playback binding)
    // — nothing to estimate from. The loop will start mattering once a re-sync
    // seeds the anchor.
    const tick = () => {
      if (document.hidden)
        return
      const a = anchor.current
      if (!a)
        return
      const estimatedMs = estimateMs(a) + SYNC_LEAD_MS
      // End-of-track auto re-sync (FEAT-lyrics-end-resync): once the estimate
      // runs past the track length + grace, fire ONE automatic refresh — next
      // track playing swaps the lyrics in place, idle keeps the view with the
      // notice. Live entries only (`canRefresh`); armed once per anchor seed.
      if (canRefresh && durationMs != null && !endSynced.current && estimatedMs >= durationMs + END_GRACE_MS) {
        endSynced.current = true
        void refreshRef.current()
      }
      setFocus((f) => {
        const nf = focusIndexForMs(segs, estimatedMs)
        return nf !== f ? nf : f
      })
    }
    tick()
    const id = window.setInterval(tick, ESTIMATE_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [trackable, suspended, n, segs, canRefresh, durationMs])

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
    // Idle = no input at all, so EVERY moved event extends the window (like
    // wheel) — extending only on applied line steps would let the return fire
    // under a finger resting mid-drag.
    if (d.moved)
      armSuspend()
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
    // Wheel streams are synthetic browse input already; every event extends
    // suspend even when accumulated delta has not crossed a line yet.
    armSuspend()
    wheelAcc.current += e.deltaY
    if (Math.abs(wheelAcc.current) >= WHEEL_STEP) {
      step(Math.sign(wheelAcc.current))
      wheelAcc.current = 0
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      armSuspend()
      step(1)
    }
    else if (e.key === 'ArrowUp') {
      e.preventDefault()
      armSuspend()
      step(-1)
    }
  }

  // Stable handlers for the memoized lines (latest-ref pattern, same as
  // refreshRef): identity never changes, so a focus step's shallow compare
  // re-renders only the lines whose `cls` flipped.
  const moveFocusToRef = useRef(moveFocusTo)
  useEffect(() => {
    moveFocusToRef.current = moveFocusTo
  })
  const onLineTap = useCallback((i: number) => {
    if (suppressTap.current)
      return
    moveFocusToRef.current(i)
  }, [])
  const registerLine = useCallback((i: number, el: HTMLButtonElement | null) => {
    segRefs.current[i] = el
  }, [])

  const emptyText = phase.k === 'ready' && phase.data.availability === 'no_lyrics' ?
    '가사 없음 (연주곡)' :
    '아직 연결된 가사가 없어요'

  return (
    <div className="scrim lyv-scrim" role="dialog" aria-modal="true" aria-label="가사 뷰어">
      <div
	ref={panelRef}
	className="lyv-panel"
	data-lyv-style={lyvStyle}
	data-lyv-browse={suspended && behavior === 'browse' ? '' : undefined}
	onKeyDown={onKeyDown}
      >
        {/*
          Album-blur backdrop (FEAT-lyrics-auto-progression Step 2). The real
          cover as a CSS background-image + filter: blur() — CORS-free (no pixel
          reads), re-renders on track swap (coverUrl state). Neutral dark when
          no cover (static/debug entry). The viewer is always dark regardless of
          site theme, like Spotify. `aria-hidden` + `key` keep it out of the a11y
          tree and let the bg transition restart on swap.
        */}
        <div
	className={coverUrl ? 'lyv-bg' : 'lyv-bg is-empty'}
	aria-hidden="true"
	style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}
        />
        <div className="lyv-bg-overlay" aria-hidden="true" />
        {suspended && behavior === 'pill' && (
          <button type="button" className="lyv-return" onClick={returnToFollow}>
            <svg className="lyv-return-ring" viewBox="0 0 20 20" aria-hidden="true">
              <circle className="lyv-return-ring-track" cx="10" cy="10" r="8" />
              {/* duration from PILL_IDLE_MS so tuning the idle constant can't drift from the ring */}
              <circle key={ringRestart} className="lyv-return-ring-progress" cx="10" cy="10" r="8" style={{ animationDuration: `${PILL_IDLE_MS}ms` }} />
            </svg>
            ↩ 현재 줄로
          </button>
        )}
        <div className="lyv-head">
          <div className="lyv-head-id">
            <span className="lyv-eyebrow mono">
              Lyrics
              {phase.k === 'ready' && phase.data.availability === 'ok' && phase.data.source_kind ?
                ` · ${phase.data.source_kind}` :
                ''}
            </span>
            {meta.track && (
              <span className="lyv-title-block">
                <span className="lyv-title">{meta.track}</span>
                {meta.artist && <span className="lyv-artist">{meta.artist}</span>}
              </span>
            )}
          </div>
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
                <div className="lyv-list" ref={listRef}>
                  {segs.map((s, i) => {
                    const d = Math.abs(i - focus)
                    // 3-level emphasis (FEAT-lyrics-auto-progression Step 2):
                    // focus = current line; near = ±1 neighbor; far = the rest.
                    // The flat variant additionally reads direction (sung vs
                    // upcoming), so past/ahead ride along; the blur variant
                    // has no styles for them. Only lines around the crossing
                    // change class per step, so the memo still holds.
                    const tier = i === focus ? 'is-focus' : d === 1 ? 'is-near' : 'is-far'
                    const rel = i < focus ? ' is-past' : i > focus ? ' is-ahead' : ''
                    const cls = `lyv-line ${tier}${rel}`
                    return (
                      <LyricsLine
	key={s.i}
	i={i}
	text={s.text}
	textKo={showKo && s.text_ko && s.text_ko !== s.text ? s.text_ko : null}
	cls={cls}
	register={registerLine}
	onTap={onLineTap}
                      />
                    )
                  })}
                </div>
              </div>
            </div>
            <div className="lyv-rail">
              {/*
                Interim switch until the Step 2 ⚙ popover absorbs the rail.
                Plain rows hide it because they have no follow state to return to.
              */}
              {trackable && (
                <div className="lyv-mode" role="group" aria-label="복귀 방식">
                  <button
	type="button"
	className={behavior === 'pill' ? 'lyv-mode-btn is-on' : 'lyv-mode-btn'}
	onClick={() => pickBehavior('pill')}
	aria-pressed={behavior === 'pill'}
	aria-label="복귀 방식: 필"
                  >
                    필
                  </button>
                  <button
	type="button"
	className={behavior === 'browse' ? 'lyv-mode-btn is-on' : 'lyv-mode-btn'}
	onClick={() => pickBehavior('browse')}
	aria-pressed={behavior === 'browse'}
	aria-label="복귀 방식: 브라우즈"
                  >
                    브라우즈
                  </button>
                </div>
              )}
              {/* viewer style variant (owner request 2026-07-06): 블러 = the
                  centered album-blur look, 플랫 = the Apple-Music-like
                  left-aligned flat wash. Persisted per browser. */}
              <div className="lyv-mode" role="group" aria-label="가사 화면 스타일">
                <button
	type="button"
	className={lyvStyle === 'blur' ? 'lyv-mode-btn is-on' : 'lyv-mode-btn'}
	onClick={() => pickStyle('blur')}
	aria-pressed={lyvStyle === 'blur'}
                >
                  블러
                </button>
                <button
	type="button"
	className={lyvStyle === 'flat' ? 'lyv-mode-btn is-on' : 'lyv-mode-btn'}
	onClick={() => pickStyle('flat')}
	aria-pressed={lyvStyle === 'flat'}
                >
                  플랫
                </button>
              </div>
              {/*
                Position counter (Step 2): visually dropped to match Spotify's
                minimal chrome, kept as a screen-reader-only aria-live region so
                the focus position is still announced.
              */}
              <span className="lyv-sr-only" aria-live="polite">
                {`${focus + 1} / ${n}${suspended ? ' · 따라가기 일시정지' : ''}`}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default LyricsViewer
