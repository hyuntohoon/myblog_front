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
// each re-sync) `readLivePlayback().progressMs` seeds `{ anchorMs, wallMs }`
// and `estimatedMs = anchorMs + (performance.now() - wallMs)` drives `focus`
// via `focusIndexForMs()`. The ↻ re-sync re-seeds the anchor. Plain-only
// (non-trackable) rows never run the estimate. No backend / polling / SDK
// coupling — the position source is still the existing one-shot REST read
// (D28 honored).
//
// FEAT-lyrics-sync-precision Step 1 removes the fixed lead by removing what it
// was hiding. `SYNC_LEAD_MS = 300` was never a latency correction: it
// cancelled the 250ms interval grain (+125ms mean, always late) and the
// `.lyv-line` 0.35s opacity ramp (+175ms perceived midpoint). Both are gone —
// the interval is replaced by ONE timer armed for the exact next `start_ms`
// (`nextBoundaryMs`), and the focus transition gained a 120ms attack against
// its unchanged 350ms release. What is left is `PERCEPTUAL_LEAD_MS = 80`,
// labelled as taste. Because the anchor lives in a ref, every anchor WRITE
// bumps `anchorSeq` to re-arm the scheduler — the old interval got that for
// free from its next tick.
//
// FEAT-lyrics-end-resync extends the clock estimate two ways:
// (1) Latency-anchored seeding — the anchor's wall instant is the moment the
//     playback position was actually READ (`readAtMs` from readLivePlayback),
//     not whenever the lyrics finished loading. Previously the entry-tap
//     position was paired with a post-`getLyrics()` performance.now(), so the
//     focus lagged by the whole read + lyrics-load latency. (This block also
//     described a `SYNC_LEAD_MS` bias "covering what can't be measured" —
//     that claim was disproved and the constant removed by
//     FEAT-lyrics-sync-precision, below; nothing now models Spotify-side
//     staleness or tick granularity, because neither is a term any more.)
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
// snaps back to the live line after idle (un-dimmed browse window). A floating
// circular countdown shows the snap-back timer and returns immediately on tap
// (keeper decision 2026-07-20: behavior D kept, A's pill removed — its ring
// survives as the browse countdown). Explicit line taps still re-anchor.
//
// FEAT-lyrics-viewer-controls Step 2 replaces the interim bottom rail with a
// header ⚙ settings popover for the backdrop style and regroups the header
// controls into a quieter actions cluster.
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
import type { PlayerCommand } from '@lib/spotifyPlayback'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, WheelEvent } from 'react'
import type { LyricsResponse, LyricsSegment, LyricsTranslationInfo } from './lyrics.api'
import type { QueueResult } from './queue.api'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { estimateMs } from '@lib/clockEstimate'
import { MYBLOG_PLAYBACK_CHANGED, sendPlayerCommand } from '@lib/spotifyPlayback'
import { useDismissable } from '@lib/useDismissable'
import { useScrollLock } from '@lib/useScrollLock'
import { ArtistNames } from '../NowPlaying'
import { getLyrics, requestTranslation } from './lyrics.api'
import { readLivePlayback } from './playback.api'
import { readQueue } from './queue.api'

/** Vertical drag distance (px) that advances the focus by one segment. */
const DRAG_STEP = 56
/** Accumulated wheel delta (px) that advances the focus by one segment. */
const WHEEL_STEP = 80
/**
 * FEAT-lyrics-sync-precision Step 1 — the ONLY constant left on the estimate,
 * and it is TASTE, not latency. A line flipping a touch before its first
 * syllable reads as "in sync" because you need a beat to find it with your
 * eyes; flipping exactly on the syllable reads as late.
 *
 * It replaces `SYNC_LEAD_MS = 300`, which was never a latency correction: it
 * cancelled the 250ms polling grain (+125ms mean) and the `.lyv-line` 0.35s
 * opacity ramp (+175ms perceived midpoint) — 125 + 175 ≈ 300. Both are now
 * removed at their source (boundary-scheduled focus below; fast-attack
 * transition in `.lyv-line.is-focus`), so deleting the constant outright would
 * have made the viewer read LATER than it did. What remains is the ~60ms
 * midpoint of the new 120ms attack plus a small deliberate lead.
 *
 * Tune here if the feel drifts — it is one number and it means one thing.
 */
const PERCEPTUAL_LEAD_MS = 80
/**
 * How far past `durationMs` the estimate must run before the end-of-track auto
 * re-sync fires (FEAT-lyrics-end-resync). Gives Spotify a beat to actually
 * advance to the next item so the one-shot read lands on it, and absorbs
 * estimate drift near the boundary.
 */
const END_GRACE_MS = 1500
/** Idle snap-back delay for the un-dimmed browse window (and its countdown ring). */
const BROWSE_IDLE_MS = 3000
/**
 * Minimum spacing between event-driven re-anchor reads (FEAT-lyrics-sync-
 * precision Step 2). A floor, NOT a cadence — nothing schedules a read, this
 * only stops a burst of events (tab flicking, a rapid ⏭⏭⏭) from turning into a
 * request storm. D28 still holds: no timer polls playback state.
 */
const EVENT_RESYNC_FLOOR_MS = 1500

/**
 * What triggered a re-anchor (FEAT-lyrics-sync-precision Step 2). Recorded with
 * the residual so the accuracy series can be read per trigger — a `visibility`
 * residual means something happened off-tab, a `command` residual is our own
 * transport round-trip, a `manual` one is the owner noticing drift.
 */
type ResyncSource = 'manual' | 'command' | 'visibility' | 'end'

type Phase =
	| { k: 'loading' } |
	{ k: 'error' } |
	{ k: 'ready', data: LyricsResponse }

/**
 * The segment a playback moment maps to: the last segment whose `start_ms` is
 * at or before `ms` (synced rows only — plain rows carry no timestamps and are
 * never position-initialized).
 */
export function focusIndexForMs(segs: LyricsSegment[], ms: number): number {
  let idx = 0
  for (let i = 0; i < segs.length; i++) {
    const start = segs[i].start_ms
    if (start != null && start <= ms)
      idx = i
  }
  return idx
}

/**
 * The next timed segment start strictly after `ms`, or null when `ms` is past
 * the last one (FEAT-lyrics-sync-precision Step 1). This is what the focus
 * scheduler wakes on, so untimed segments (`start_ms == null`, mixed rows) are
 * skipped — they are never estimate-selectable focus targets either.
 */
export function nextBoundaryMs(segs: LyricsSegment[], ms: number): number | null {
  for (let i = 0; i < segs.length; i++) {
    const start = segs[i].start_ms
    if (start != null && start > ms)
      return start
  }
  return null
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

export function LyricsViewer({ spotifyTrackId, initialProgressMs = null, initialProgressAtMs = null, initialDurationMs = null, initialAlbumCoverUrl = null, initialTrack = null, initialArtist = null, initialArtists = [], canRefresh = false, onClose }: {
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
  /** Spotify artist ids/names from the live read; resolvable ids link to artist hubs. Re-sync refreshes them. */
  initialArtists?: Array<{ id: string, name: string }>
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
  const [meta, setMeta] = useState<{ track: string | null, artist: string | null, artists: Array<{ id: string, name: string }> }>({ track: initialTrack, artist: initialArtist, artists: initialArtists })
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
  const settingsReady = phase.k === 'ready' && phase.data.availability === 'ok' && n > 0
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsPopoverRef = useRef<HTMLDivElement>(null)
  const settingsTriggerRef = useRef<HTMLButtonElement>(null)
  const closeSettings = useCallback(() => setSettingsOpen(false), [])
  const isSettingsOpen = settingsOpen && settingsReady
  // Nested dismissable: ESC closes settings first, then the viewer on the next
  // press. Focus stays on the trigger while picking for live comparison.
  useDismissable(isSettingsOpen, closeSettings, settingsPopoverRef, { trapFocus: false, autoFocus: false })
  // Outside-pointerdown close (useDismissable doesn't cover outside-click).
  useEffect(() => {
    if (!isSettingsOpen)
      return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (settingsPopoverRef.current?.contains(t) || settingsTriggerRef.current?.contains(t))
        return
      setSettingsOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [isSettingsOpen])
  useEffect(() => {
    if (!settingsReady)
      setSettingsOpen(false)
  }, [settingsReady])

  // ── Queue screen (FEAT-lyrics-viewer-playback Step 2) ────────────────────
  // A VIEW swap, not an overlay: the queue replaces the panel body while the
  // head and the transport bar stay put. The viewer's vertical drag already
  // means "browse lyrics lines", so a sheet sliding over the lines would put
  // two scroll surfaces under one gesture (owner pick 2026-08-01). Swapping
  // the body keeps exactly one scrollable thing on screen at a time.
  //
  // The lyrics clock keeps running underneath — `focus` is derived state, not
  // something the unmounted list owns — so returning lands on the right line
  // with no re-read.
  const [view, setView] = useState<'lyrics' | 'queue'>('lyrics')
  const [queue, setQueue] = useState<{ k: 'loading' } | { k: 'ready', data: QueueResult }>({ k: 'loading' })
  // Bumped by 다시 시도 — the read is keyed on it so a retry is a re-run of the
  // same effect rather than a second, separately-cancelled fetch path.
  const [queueSeq, setQueueSeq] = useState(0)
  const queueRef = useRef<HTMLDivElement>(null)
  const backToLyrics = useCallback(() => setView('lyrics'), [])
  // Nested dismissable, same idiom as the settings popover: this pushes onto
  // the shared stack ABOVE the viewer's own entry, so ESC on the queue returns
  // to the lyrics and only the next ESC closes the viewer.
  useDismissable(view === 'queue', backToLyrics, queueRef, { trapFocus: false, autoFocus: false })
  // One read when the screen opens; one more if the track changes while it is
  // open (a ⏭ from the bar below re-queues everything). No interval — D28.
  useEffect(() => {
    if (view !== 'queue')
      return
    let live = true
    setQueue({ k: 'loading' })
    void readQueue().then((data) => {
      if (live)
        setQueue({ k: 'ready', data })
    })
    return () => {
      live = false
    }
  }, [view, trackId, queueSeq])

  // Clock-estimate anchor (shared idiom in @lib/clockEstimate since
  // member-player Step 3): position `ms` captured at wall instant `wallMs`.
  // Seeded on open (from initialProgressMs) and on each re-sync. `null` until a
  // position is available — follow with a null anchor simply doesn't advance.
  const anchor = useRef<ClockAnchor | null>(null)
  // FEAT-lyrics-sync-precision Step 1: the anchor is a ref, so writing it does
  // not re-render — the old 250ms interval simply picked the new value up on
  // its next tick. The boundary scheduler has no next tick, so every anchor
  // WRITE must re-arm it. This counter is that signal (a scheduler dep).
  // Clears are deliberately NOT counted: an anchor is only ever cleared
  // alongside a phase change, which re-runs the scheduler through `segs`.
  const [anchorSeq, setAnchorSeq] = useState(0)
  const setAnchor = (next: ClockAnchor) => {
    anchor.current = next
    setAnchorSeq(k => k + 1)
  }

  // FEAT-lyrics-sync-precision Step 2 — is playback actually running? Until
  // now the viewer had no pause concept at all (unlike NowPlaying, which
  // passes `!paused` to `useClockEstimate`), so a 30s pause left the estimate
  // 30s ahead until something else happened to fire. Seeded true: the live
  // entry only exists while a track is playing.
  const [playing, setPlaying] = useState(true)

  /**
   * The accuracy series (FEAT-lyrics-sync-precision Step 2). Every event-driven
   * re-anchor on the SAME track yields "where we thought we were" minus "where
   * we actually were" — the system grading itself, for free, in real use.
   *
   * Nothing consumes it yet; the RFC deliberately dropped live staleness
   * correction so that acting on this later needs data, not a rewrite. A large
   * value after a pause is not an error, it is the pause being measured.
   */
  const logResidual = (source: ResyncSource, progressMs: number | null, readAtMs: number) => {
    const a = anchor.current
    if (!a || progressMs == null)
      return
    const predicted = estimateMs(a, readAtMs) + PERCEPTUAL_LEAD_MS
    // eslint-disable-next-line no-console -- the measurement channel; prod Lambda-side logging does not apply to the browser
    console.debug('[lyrics-sync] residual', { source, residualMs: Math.round(predicted - progressMs), predictedMs: Math.round(predicted), actualMs: progressMs, playing })
  }

  // Follow/suspend (FEAT-lyrics-viewer-controls Step 1): trackable rows follow
  // the estimate by default. Browse input pauses that loop only while a live
  // anchor exists; plain/no-seed rows retain today's unrestricted manual nav.
  const [suspended, setSuspended] = useState(false)
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
      setFocus(focusIndexForMs(segs, estimateMs(a) + PERCEPTUAL_LEAD_MS))
    setSuspended(false)
  }

  const armSuspend = () => {
    // With no trackable clock seed there is no live position to return to, so
    // navigation remains free and no suspend UI/timer is created.
    if (!trackable || anchor.current == null)
      return
    clearSuspendTimer()
    setSuspended(true)
    // Every browse input extends the timer, so the ring restarts with it.
    setRingRestart(k => k + 1)
    suspendTimer.current = window.setTimeout(returnToFollow, BROWSE_IDLE_MS)
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
    const next: ClockAnchor = { ms: progressMs, wallMs: readAtMs ?? performance.now() }
    setAnchor(next)
    clearSuspendTimer()
    setSuspended(false)
    // Re-arm end detection only when the fresh position sits meaningfully
    // before the end. A same-track read still pinned inside the grace window
    // (a player stuck reporting `playing` at ≈duration) keeps the auto
    // re-sync spent — one automatic read, never a hammer; manual ↻ remains.
    if (durationMs == null || progressMs < durationMs - END_GRACE_MS)
      endSynced.current = false
    if (n > 0)
      setFocus(focusIndexForMs(segs, estimateMs(next) + PERCEPTUAL_LEAD_MS))
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
          setAnchor(seed)
          endSynced.current = false
          setFocus(focusIndexForMs(data.segments, seed.ms + PERCEPTUAL_LEAD_MS + (performance.now() - seed.wallMs)))
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
  // FEAT-lyrics-viewer-playback Step 1 — a read requested while one is in
  // flight is REMEMBERED, not dropped. `refreshing` state alone made a second
  // caller a no-op, which was harmless while the only callers were a human tap
  // and a rare end-of-track fire. The transport bar changes that: ⏭⏭ in quick
  // succession issues two identity reads, and losing the second leaves the
  // viewer showing an earlier track's lyrics with nothing left to correct it.
  // A ref, not state, because the guard must be exact within one tick.
  const refreshingRef = useRef(false)
  const refreshQueued = useRef(false)
  const refresh = async (source: ResyncSource = 'manual'): Promise<void> => {
    if (refreshingRef.current) {
      refreshQueued.current = true
      return
    }
    refreshingRef.current = true
    setRefreshing(true)
    try {
      const r = await readLivePlayback()
      if (r.state === 'playing' || r.state === 'paused') {
        setNotice(null)
        // Re-render the blur backdrop against the current track's cover (Step 2).
        setCoverUrl(r.albumCoverUrl)
        setMeta({ track: r.track, artist: r.artist, artists: r.artists })
        setDurationMs(r.durationMs)
        setPlaying(r.state === 'playing')
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
          // A paused read re-anchors too: the anchor then holds the REAL held
          // position, so the frozen line is exact rather than guessed, and a
          // later resume resumes from truth.
          logResidual(source, r.progressMs, r.readAtMs)
          applyAnchor(r.progressMs, r.readAtMs)
        }
      }
      else if (r.state === 'idle') {
        setNotice('지금 재생 중인 곡이 없어요')
        setPlaying(false)
      }
      else {
        setNotice('재생 상태를 확인하지 못했어요')
      }
    }
    finally {
      refreshingRef.current = false
      setRefreshing(false)
      // Exactly one catch-up read, whatever piled up behind this one — the
      // queue is a boolean, so a burst collapses to a single trailing read
      // rather than replaying every dropped call (D28: still no polling).
      if (refreshQueued.current) {
        refreshQueued.current = false
        void refresh(source)
      }
    }
  }

  // Latest-ref so the estimate loop can fire the end-of-track auto re-sync
  // without carrying refresh's per-render identity in its effect deps.
  const refreshRef = useRef(refresh)
  useEffect(() => {
    refreshRef.current = refresh
  })

  // FEAT-lyrics-viewer-playback Step 1 — transport commands from the bottom
  // bar. Same client-side Spotify Connect transport NowPlaying uses; nothing
  // new server-side (rule #9 holds — the only server hit is the token mint).
  //
  // `no-capability` is sticky: a 403 (no Premium / missing scope) or 404 (no
  // active device) will not resolve by retrying, so the cluster degrades to
  // disabled with one line of reason instead of offering dead buttons.
  const [transportDead, setTransportDead] = useState(false)
  const commandBusy = useRef(false)

  const runCommand = async (cmd: PlayerCommand) => {
    if (commandBusy.current || transportDead)
      return
    commandBusy.current = true
    // Optimistic `playing` write. The event-driven resync (Step 2 of
    // FEAT-lyrics-sync-precision) is rate-limited to one read per
    // EVENT_RESYNC_FLOOR_MS, so a ⏭ immediately followed by a ⏸ would have its
    // pause read swallowed — leaving the icon claiming playback and the focus
    // scheduler still advancing lines over silence. The command we issued is
    // the most direct evidence we will ever have; the resync stays the
    // correction of record, not the write path.
    const wasPlaying = playing
    const a = anchor.current
    if (cmd.kind === 'pause' && a) {
      // Freeze the clock at the current estimate so the held line is exact and
      // a later resume starts from truth (NowPlaying's idiom, member-player
      // Step 3). Without this the anchor keeps ageing through the pause.
      const at = estimateMs(a)
      setAnchor({ ms: durationMs != null ? Math.min(at, durationMs) : at, wallMs: performance.now() })
    }
    else if (cmd.kind === 'play' && a) {
      // Resume: restart the wall clock from the frozen position.
      setAnchor({ ms: a.ms, wallMs: performance.now() })
    }
    if (cmd.kind === 'play' || cmd.kind === 'pause')
      setPlaying(cmd.kind === 'play')
    try {
      const r = await sendPlayerCommand(cmd)
      if (r.ok) {
        setNotice(null)
        // A skip changes WHICH track is playing, so the viewer needs an
        // identity read to swap the lyrics. Nothing else will do it:
        // `sendPlayerCommand` does not dispatch MYBLOG_PLAYBACK_CHANGED (only
        // `sendConnectPlay` does), so the listener above never sees a skip.
        // Verified in a browser 2026-08-01 — without this call the viewer sits
        // on the previous track's lyrics indefinitely.
        if (cmd.kind === 'next' || cmd.kind === 'previous')
          void refreshRef.current('command')
        return
      }
      // Failed: put the optimistic state back before reporting.
      if (cmd.kind === 'play' || cmd.kind === 'pause') {
        setPlaying(wasPlaying)
        if (a)
          setAnchor(a)
      }
      if (r.reason === 'no-capability') {
        setTransportDead(true)
        setNotice('이 계정/기기에서는 재생을 조작할 수 없어요')
      }
      else if (r.reason === 'token') {
        setNotice('Spotify 연결이 끊겼어요. 다시 연결해 주세요')
      }
      else {
        setNotice('조작에 실패했어요. 잠시 후 다시 시도해 주세요')
      }
    }
    finally {
      commandBusy.current = false
    }
  }

  // FEAT-lyrics-sync-precision Step 2 — event-driven re-anchoring. A correct
  // anchor stays correct: playback runs at 1.0x and browser-vs-device clock
  // drift is ~10ms over a four-minute track. Only EVENTS invalidate it, so
  // these are the two the browser hands us for free. No timer polls playback
  // state (D28 upheld).
  useEffect(() => {
    if (!canRefresh)
      return
    // A floor, not a cadence: tab-flicking or a burst of transport commands
    // must not turn one-shot reads into a request storm.
    let lastAtMs = 0
    const resync = (source: ResyncSource) => {
      const now = performance.now()
      if (now - lastAtMs < EVENT_RESYNC_FLOOR_MS)
        return
      lastAtMs = now
      void refreshRef.current(source)
    }
    // CORRECTED 2026-08-01 (FEAT-lyrics-viewer-playback Step 1, verified in a
    // browser): this comment used to claim "every successful transport command
    // dispatches this". It does not. `sendPlayerCommand` never dispatches —
    // only `sendConnectPlay` does (@lib/spotifyPlayback), i.e. starting an
    // album/track from a card. So this listener fires for "playback started
    // elsewhere on the page", NOT for ⏯⏭⏮.
    //
    // That is why the transport bar below writes `playing` itself and asks for
    // its own identity read after a skip, rather than leaning on this path.
    const onCommand = () => resync('command')
    // Leaving the tab to operate Spotify elsewhere is precisely the case where
    // "playback kept running" stops being true, and it was assumed until now.
    const onVisible = () => {
      if (!document.hidden)
        resync('visibility')
    }
    window.addEventListener(MYBLOG_PLAYBACK_CHANGED, onCommand)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener(MYBLOG_PLAYBACK_CHANGED, onCommand)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [canRefresh])

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
    // Untimed lines leave the anchor (and so the scheduler) untouched — the
    // visual focus moves best-effort and the next scheduled boundary reclaims
    // it, exactly as the old interval did within one tick.
    if (start != null)
      setAnchor({ ms: start, wallMs: performance.now() })
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
  //
  // `notice` joins them (FEAT-lyrics-viewer-playback Step 1): `.lyv-note` is a
  // flow sibling of `.lyv-body`, so showing or hiding it changes `.lyv-scroll`'s
  // clientHeight — and the cache holds `boxH`, not just line offsets. That was
  // already true before the transport bar; the bar's failure line makes it
  // reachable often enough to matter, since every degraded command writes one.
  useEffect(() => {
    measureRef.current = null
  }, [showKo, lyvStyle, notice])

  useEffect(() => {
    if (n === 0) {
      positionedRef.current = false
      measureRef.current = null
      return
    }
    // Queue screen open (Step 2): the list is unmounted, so `applyCenter` would
    // early-return on its null refs anyway — but it would ALSO leave
    // `positionedRef` true, and the return would then glide the remounted list
    // up from its identity transform instead of landing. The clock keeps
    // running underneath, so `focus` may well have moved on by then; forcing
    // the next centre to be instant is what makes "return lands on the right
    // line" true rather than merely eventual. The offset cache stays valid —
    // same content, and the head/transport around it never changed size.
    if (view === 'queue') {
      positionedRef.current = false
      return
    }
    // First position after (re)load lands instantly; reduced-motion users get
    // no animation either way (CSS transition: none under the media query).
    applyCenter(focus, !positionedRef.current)
    positionedRef.current = true
  }, [focus, n, showKo, lyvStyle, notice, view])

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

  // Clock-estimate follow (FEAT-lyrics-viewer-controls Step 1, rebuilt by
  // FEAT-lyrics-sync-precision Step 1). Suspend tears the scheduler down
  // entirely; the anchor keeps aging in wall-clock so return snaps directly to
  // the current line rather than catching up steps.
  //
  // The 250ms interval is gone. One timer is armed for the EXACT instant the
  // next timed segment starts, so the crossing error drops from 0-250ms (mean
  // +125, always late) to roughly one frame. Every fire recomputes the focus
  // from the anchor rather than stepping a counter, so a timer that fires late
  // — background-tab throttling clamps timeouts to ~1s — lands on the right
  // line anyway. That makes lateness the only possible failure, never drift,
  // and it never accumulates across a long instrumental gap.
  useEffect(() => {
    // `!playing` (Step 2) freezes rather than tears down: the scheduler simply
    // never arms, so the focus holds at the last computed line. The anchor is
    // NOT aged past a pause either — a paused read re-anchors it to the real
    // held position — so resuming picks up from truth, not from a clock that
    // kept running while the music did not.
    if (!trackable || suspended || !playing || n === 0)
      return
    let timer: number | null = null
    const clear = () => {
      if (timer != null) {
        window.clearTimeout(timer)
        timer = null
      }
    }
    const arm = () => {
      clear()
      // No position seed yet (e.g. a static/debug entry has no playback
      // binding) — nothing to estimate from. Seeding one bumps `anchorSeq`,
      // which re-runs this effect.
      const a = anchor.current
      if (!a)
        return
      const estimatedMs = estimateMs(a) + PERCEPTUAL_LEAD_MS
      const endAtMs = canRefresh && durationMs != null ? durationMs + END_GRACE_MS : null
      // End-of-track auto re-sync (FEAT-lyrics-end-resync): once the estimate
      // runs past the track length + grace, fire ONE automatic refresh — next
      // track playing swaps the lyrics in place, idle keeps the view with the
      // notice. Live entries only (`canRefresh`); armed once per anchor seed.
      // Held back while hidden so a backgrounded tab never fires the request;
      // the visibility listener below re-arms and it goes out on return.
      if (endAtMs != null && !endSynced.current && estimatedMs >= endAtMs && !document.hidden) {
        endSynced.current = true
        void refreshRef.current('end')
        return // the refresh re-anchors, which re-arms through `anchorSeq`
      }
      setFocus((f) => {
        const nf = focusIndexForMs(segs, estimatedMs)
        return nf !== f ? nf : f
      })
      // Wake at whichever comes first: the next line, or the end-of-track
      // threshold. Both are track positions, and playback runs at 1.0x, so the
      // gap to either is also the wall-clock delay.
      const boundary = nextBoundaryMs(segs, estimatedMs)
      const pendingEnd = endAtMs != null && !endSynced.current && endAtMs > estimatedMs ? endAtMs : null
      const target = boundary != null && pendingEnd != null ?
        Math.min(boundary, pendingEnd) :
        boundary ?? pendingEnd
      if (target == null)
        return // past the last line with no end re-sync pending — nothing left to do
      timer = window.setTimeout(arm, Math.max(0, target - estimatedMs))
    }
    arm()
    // A throttled or skipped timer leaves the focus stale while hidden; re-arm
    // on return so it corrects immediately instead of at the next boundary.
    const onVisible = () => {
      if (!document.hidden)
        arm()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clear()
    }
  }, [trackable, suspended, playing, n, segs, canRefresh, durationMs, anchorSeq])

  // Vertical swipe/drag = manual navigation (touch-action: none on the scroll
  // area hands touch pans to us). Dragging up (finger/pointer moves up) reads
  // forward, matching natural scroll direction. A real drag suppresses the
  // click that fires on pointerup so it can't double as tap-to-focus.
  const drag = useRef<{ y0: number, applied: number, moved: boolean } | null>(null)
  const suppressTap = useRef(false)
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0)
      return
    drag.current = { y0: e.clientY, applied: 0, moved: false }
    suppressTap.current = false
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
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
	data-lyv-browse={suspended ? '' : undefined}
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
        <div className="lyv-head">
          {/*
            Back sits at the head's leading edge, not beside ✕ — it is the
            queue screen's "up", and putting it on the right would read as a
            second close. ☰ below toggles too, for the thumb.
          */}
          {view === 'queue' && (
            <button type="button" className="lyv-btn lyv-head-back" onClick={backToLyrics} aria-label="가사로 돌아가기">←</button>
          )}
          <div className="lyv-head-id">
            <span className="lyv-eyebrow mono">
              {view === 'queue' ?
                '대기열' :
                (
                  <>
                    Lyrics
                    {phase.k === 'ready' && phase.data.availability === 'ok' && phase.data.source_kind ?
                      ` · ${phase.data.source_kind}` :
                      ''}
                  </>
                )}
            </span>
            {meta.track && (
              <span className="lyv-title-block">
                <span className="lyv-title">{meta.track}</span>
                {(meta.artist || meta.artists.length > 0) && <span className="lyv-artist"><ArtistNames artists={meta.artists} text={meta.artist} /></span>}
              </span>
            )}
          </div>
          <div className="lyv-head-actions">
            {/*
              번역 / ↻ / ⚙ all act on the lyrics surface, which the queue screen
              has replaced. Hiding them (rather than disabling) keeps the head
              honest about what the current screen can do; ✕ stays because
              closing the viewer is always available.
            */}
            {view === 'lyrics' && phase.k === 'ready' && phase.data.availability === 'ok' && n > 0 && (
              translation?.status === 'done' ?
                (
                  <div className="lyv-tr-cluster">
                    {translation.origin === 'manual' && <span className="lyv-tr-origin mono">manual</span>}
                    <button
	type="button"
	className={showKo ? 'lyv-tr-btn is-on mono' : 'lyv-tr-btn mono'}
	aria-pressed={showKo}
	onClick={() => setShowKo(v => !v)}
                    >
                      번역
                    </button>
                  </div>
                ) :
                koreanDominant ?
                  null :
                  translation?.status === 'requested' ?
                    (
                      <div className="lyv-tr-cluster">
                        <span className="lyv-tr-state mono" role="status">요청됨</span>
                      </div>
                    ) :
                    (
                      <div className="lyv-tr-cluster">
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
                      </div>
                    )
            )}
            {view === 'lyrics' && settingsReady && !trackable && <span className="lyv-manual-note mono">동기화 없음 — 수동</span>}
            {view === 'lyrics' && canRefresh && (
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
            {view === 'lyrics' && settingsReady && (
              <button
	ref={settingsTriggerRef}
	type="button"
	className="lyv-btn"
	onClick={() => setSettingsOpen(open => !open)}
	aria-label="가사 화면 설정"
	aria-expanded={isSettingsOpen}
	aria-haspopup="dialog"
              >
                ⚙
              </button>
            )}
            <button type="button" className="lyv-btn" onClick={onClose} aria-label="닫기">✕</button>
          </div>
          {isSettingsOpen && (
            <div
	ref={settingsPopoverRef}
	className="lyv-settings-popover"
	role="dialog"
	aria-label="가사 화면 설정"
	onKeyDown={e => e.stopPropagation()}
            >
              <section className="lyv-settings-section">
                <span className="lyv-settings-eyebrow mono">스타일</span>
                <div className="lyv-settings-styles" role="group" aria-label="가사 화면 스타일">
                  <button
	type="button"
	className={lyvStyle === 'blur' ? 'lyv-settings-style is-on' : 'lyv-settings-style'}
	onClick={() => pickStyle('blur')}
	aria-pressed={lyvStyle === 'blur'}
                  >
                    <span className="lyv-settings-preview is-blur" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                    <span className="lyv-settings-style-label">블러</span>
                  </button>
                  <button
	type="button"
	className={lyvStyle === 'flat' ? 'lyv-settings-style is-on' : 'lyv-settings-style'}
	onClick={() => pickStyle('flat')}
	aria-pressed={lyvStyle === 'flat'}
                  >
                    <span className="lyv-settings-preview is-flat" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                    <span className="lyv-settings-style-label">플랫</span>
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>

        {notice && <div className="lyv-note mono" role="status">{notice}</div>}

        {view === 'lyrics' && phase.k === 'loading' && <div className="lyv-status mono">불러오는 중…</div>}

        {view === 'lyrics' && phase.k === 'error' && (
          <div className="lyv-status">
            <p>가사를 불러오지 못했어요</p>
            <button type="button" className="lyv-retry mono" onClick={() => setLoadSeq(s => s + 1)}>다시 시도</button>
          </div>
        )}

        {view === 'lyrics' && phase.k === 'ready' && n === 0 && <div className="lyv-status">{emptyText}</div>}

        {view === 'queue' && (
          <QueueScreen
	rootRef={queueRef}
	state={queue}
	onRetry={() => setQueueSeq(s => s + 1)}
          />
        )}

        {view === 'lyrics' && phase.k === 'ready' && n > 0 && (
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
              {/*
                The browse snap-back ring lives INSIDE .lyv-body (moved there by
                FEAT-lyrics-viewer-playback Step 1). It used to be absolute
                against .lyv-panel at bottom: 28px + safe-area — exactly where
                the transport bar now sits. .lyv-body is already a positioned
                stacking context and it is what the bar shrinks, so anchoring
                the ring to it keeps the ring clear of the bar with no
                conditional offset and no safe-area arithmetic.
                `suspended` implies a live anchor, which implies this branch
                rendered, so the ring can never need a host that isn't here.
              */}
              {suspended && (
                <button type="button" className="lyv-return" onClick={returnToFollow} aria-label="현재 줄로 돌아가기">
                  <svg className="lyv-return-ring" viewBox="0 0 20 20" aria-hidden="true">
                    <circle className="lyv-return-ring-track" cx="10" cy="10" r="8" />
                    {/* duration from BROWSE_IDLE_MS so tuning the idle constant can't drift from the ring */}
                    <circle key={ringRestart} className="lyv-return-ring-progress" cx="10" cy="10" r="8" style={{ animationDuration: `${BROWSE_IDLE_MS}ms` }} />
                  </svg>
                  <span aria-hidden="true">↩</span>
                </button>
              )}
            </div>
            {/* Position stays available to assistive tech without visual chrome. */}
            <span className="lyv-sr-only" aria-live="polite">
              {`${focus + 1} / ${n}${suspended ? ' · 따라가기 일시정지' : ''}`}
            </span>
          </>
        )}

        {/*
          FEAT-lyrics-viewer-playback Step 1 — transport bar, live entries only.
          Deliberately OUTSIDE the `ready && n > 0` fragment above: loading, a
          load error and "가사 없음 (연주곡)" are exactly the states the owner
          needs ⏭ in, to get off a track the viewer has nothing to show for.
          A flex sibling of .lyv-body rather than an overlay, so .lyv-scroll's
          clientHeight shrinks with it and applyCenter's boxH * 0.42 keeps the
          focused line centred without touching the centring math.
        */}
        {canRefresh && (
          <div className="lyv-transport">
            <div className="lyv-transport-main">
              <button
	type="button"
	className="lyv-tbtn"
	disabled={transportDead}
	onClick={() => {
                  void runCommand({ kind: 'previous' })
                }}
	aria-label="이전 곡"
              >
                ⏮
              </button>
              <button
	type="button"
	className="lyv-tbtn is-play"
	disabled={transportDead}
	onClick={() => {
                  void runCommand({ kind: playing ? 'pause' : 'play' })
                }}
	aria-label={playing ? '일시정지' : '재생'}
              >
                {playing ? '⏸' : '▶'}
              </button>
              <button
	type="button"
	className="lyv-tbtn"
	disabled={transportDead}
	onClick={() => {
                  void runCommand({ kind: 'next' })
                }}
	aria-label="다음 곡"
              >
                ⏭
              </button>
            </div>
            {/*
              Step 2 turned this on. It is a TOGGLE, not a one-way door: the bar
              stays put across the swap, so pressing ☰ again is the shortest way
              back for a thumb already there (← in the head is the same action
              for a pointer/keyboard). `aria-pressed` is what tells assistive
              tech the two screens are one control's two states.
              Not gated on `transportDead`: a queue READ and a transport COMMAND
              fail independently, and a member who cannot control playback can
              still legitimately see what is queued.
            */}
            <button
	type="button"
	className={view === 'queue' ? 'lyv-tbtn lyv-transport-queue is-on' : 'lyv-tbtn lyv-transport-queue'}
	aria-pressed={view === 'queue'}
	onClick={() => setView(v => (v === 'queue' ? 'lyrics' : 'queue'))}
	aria-label="대기열"
            >
              <span aria-hidden="true">☰</span>
              <span className="lyv-tbtn-label">대기열</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The queue screen body (FEAT-lyrics-viewer-playback Step 2) — view only.
 *
 * Rows are deliberately inert `<li>`s, not buttons: Step 3 is what decides
 * whether a row can be jumped to (it needs the playback `context`, and OQ2 is
 * still open for user-added entries). Shipping them tappable-looking now would
 * promise something this step cannot keep.
 *
 * Every failure resolves to a sentence INSIDE the panel. Nothing here closes
 * the viewer or disturbs the lyrics clock running behind it, so a queue that
 * cannot be read costs the member the queue and nothing else.
 */
function QueueScreen({ rootRef, state, onRetry }: {
	rootRef: { current: HTMLDivElement | null }
	state: { k: 'loading' } | { k: 'ready', data: QueueResult }
	onRetry: () => void
}) {
	if (state.k === 'loading') {
		return (
			<div ref={rootRef} className="lyv-queue">
				<div className="lyv-status mono">불러오는 중…</div>
			</div>
		)
	}
	const r = state.data
	if (!r.ok) {
		// 다시 시도 appears ONLY for the failure a retry can actually clear. A
		// missing scope and a dead connection both survive any number of
		// retries, so offering the button there would just be a lie with a
		// hover state.
		const message = r.reason === 'no-capability' ?
			'이 계정에서는 대기열을 볼 수 없어요' :
			r.reason === 'token' ?
				'Spotify 연결이 끊겼어요. 다시 연결해 주세요' :
				'대기열을 불러오지 못했어요'
		return (
			<div ref={rootRef} className="lyv-queue">
				<div className="lyv-status">
					<p>{message}</p>
					{r.reason === 'transient' && (
						<button type="button" className="lyv-retry mono" onClick={onRetry}>다시 시도</button>
					)}
				</div>
			</div>
		)
	}
	if (!r.current && r.items.length === 0) {
		return (
			<div ref={rootRef} className="lyv-queue">
				<div className="lyv-status">대기열이 비어 있어요</div>
			</div>
		)
	}
	return (
		<div ref={rootRef} className="lyv-queue">
			<ul className="lyv-queue-list">
				{r.current && (
					<li className="lyv-queue-row is-now">
						<span className="lyv-queue-badge mono">재생 중</span>
						<span className="lyv-queue-text">
							<span className="lyv-queue-title">{r.current.name}</span>
							{r.current.artist && <span className="lyv-queue-artist">{r.current.artist}</span>}
						</span>
					</li>
				)}
				{r.items.map((it, i) => (
					// Spotify may legitimately repeat a track in one queue (a
					// looped album, a manually re-queued song), so the id alone
					// is not a key.
					<li key={`${it.id}:${i}`} className="lyv-queue-row">
						<span className="lyv-queue-badge mono">{i + 1}</span>
						<span className="lyv-queue-text">
							<span className="lyv-queue-title">{it.name}</span>
							{it.artist && <span className="lyv-queue-artist">{it.artist}</span>}
						</span>
					</li>
				))}
			</ul>
		</div>
	)
}

export default LyricsViewer
