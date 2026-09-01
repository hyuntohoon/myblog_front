// ARCH-playback-authority-convergence Step 4 (G3 + G4) — the ONE lyrics data
// lifecycle, shared by the live `LyricsViewer` and the static `LyricsSheet`.
//
// G4. Both screens used to implement the same five things independently:
// `getLyrics` + a loading/error phase, the translation row, the local override a
// successful POST writes, the `번역` default, and a `isKoreanDominant` copy whose
// own comment called itself "mirror of LyricsViewer OQ3". They are one document
// read behind two presentations, and a fix to one never reached the other.
//
// What this hook does NOT take is each screen's UI state — the RFC's boundary.
// `mode`/`annoStyle`/`openIds`/`copied` stay in the sheet; `focus`, the clock
// anchor, browse/suspend, display style and the queue view stay in the viewer.
// `showKo` is here because it is not screen chrome: its value is DERIVED from
// the document ("a finished translation shows by default"), the derivation was
// duplicated verbatim, and G3 below needs the document refresher and that
// derivation to live together — a translation that completes while the screen is
// open has to be able to reveal itself.
//
// G3. Nothing re-read the translation row once a screen was open: `requestTr`
// wrote a local `요청됨` and the real status arrived only if the member happened
// to change tracks. The refresh triggers here are the RFC's permitted ones and
// no others — a visibility return, an explicit re-check, and a BOUNDED burst
// while the row is actually `requested`. There is no interval: the burst is a
// fixed, finite schedule, it is armed only for a pending episode, and it is torn
// down the moment the status moves.
//
// Note the read: the completed translation is not a status flag, it is
// `segments[].text_ko`. So a re-check is the document read (`GET /api/lyrics/{id}`)
// and it adopts the whole document — but only when the status actually changed,
// so a re-check that learns nothing cannot churn `segs` under the viewer's focus
// scheduler.
import type { Dispatch, SetStateAction } from 'react'
import type { LyricsAnnotation, LyricsResponse, LyricsSegment, LyricsTranslationInfo } from './lyrics.api'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getLyrics, requestTranslation } from './lyrics.api'

export type LyricsPhase =
	| { k: 'loading' } |
	{ k: 'error' } |
	{ k: 'ready', data: LyricsResponse }

/** Both screens showed this exact sentence for a failed 번역 요청. */
export const TR_REQUEST_FAILED = '번역 요청에 실패했어요'

/**
 * The catch-up schedule, as gaps between attempts. Three attempts, ~93s of
 * cover, then it stops for good and the explicit / visibility triggers are what
 * remain. Deliberately slow and finite: a translation is a poller job, not a
 * request-response, and the RFC's non-goal is "no new polling loop anywhere".
 */
export const TRANSLATION_RETRY_MS = [8000, 25000, 60000] as const

/**
 * Korean-dominant source detection (FEAT-lyrics-translation OQ3): Hangul share
 * of the letter-like characters across the non-gap segment text ≥ 50% means the
 * track is already Korean, so no screen offers a translation request.
 * Mirrors the poller's belt-and-suspenders `korean_source` guard.
 */
export function isKoreanDominant(segs: LyricsSegment[]): boolean {
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

export interface LyricsDocument {
  phase: LyricsPhase
  /**
   * Bumped by `reload()`. A screen with per-load state of its own (the viewer
   * resets focus, the clock anchor and its segment refs) keys its own reset
   * effect on `[trackId, reloadSeq]` — the load itself is no longer that
   * screen's effect to hang the reset off.
   */
  reloadSeq: number
  segs: LyricsSegment[]
  n: number
  annotations: LyricsAnnotation[]
  sourceKind: string | null
  emptyText: string
  translation: LyricsTranslationInfo | null
  koreanDominant: boolean
  showKo: boolean
  setShowKo: Dispatch<SetStateAction<boolean>>
  requesting: boolean
  /**
   * Each screen owns its own notice, so this reports what happened instead of
   * setting one. `dropped` is a press that was not sent — a double-press while
   * one is in flight, or an answer that came back for a track the screen has
   * since left. It is NOT a success: reporting it as one made the caller clear
   * whatever unrelated notice was on screen (`지금 재생 중인 곡이 없어요`, say).
   */
  requestTr: () => Promise<'ok' | 'failed' | 'dropped'>
  /**
   * An EXPLICIT status re-read is in flight. The bounded burst deliberately does
   * not set this: it fires at +8s, +33s and +93s with no input, and a control
   * that greys itself out three times while someone is reading is the opposite
   * of the "invisible, not a poll" property the burst exists to have.
   */
  checkingTr: boolean
  /** Explicit "is it done yet?" — re-reads the document and re-arms the burst. */
  recheckTr: () => void
  reload: () => void
}

export interface LyricsDocumentOptions {
  /**
   * Per-load hook, called with the freshly loaded document IN THE SAME BATCH as
   * the `ready` phase — never from an effect keyed on the phase afterwards.
   *
   * That distinction is the whole reason this option exists. `LyricsViewer`
   * consumes a one-shot playback position here (it seeds the clock anchor and
   * the initial focus), and an effect would land it one commit late: the lyrics
   * would paint with focus on line 1 and no anchor, so a member who opened 가사
   * mid-song saw line 1 flash, and any input in that window was overwritten by
   * the seed arriving behind it. Caught by an existing browse regression, which
   * stepped the focus before the seed had landed.
   *
   * Called only for a load (mount, track swap, `reload()`), never for the
   * translation re-check — that one adopts a document for an already-seeded
   * screen.
   */
  onLoaded?: (data: LyricsResponse) => void
}

export function useLyricsDocument(spotifyTrackId: string, options: LyricsDocumentOptions = {}): LyricsDocument {
  const [phase, setPhase] = useState<LyricsPhase>({ k: 'loading' })
  const [trOverride, setTrOverride] = useState<LyricsTranslationInfo | null>(null)
  const [showKo, setShowKo] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [checkingTr, setCheckingTr] = useState(false)
  const [reloadSeq, setReloadSeq] = useState(0)
  const [burstSeq, setBurstSeq] = useState(0)

  // Monotonic load epoch. A response is applied only while it is still the
  // current one — the cleanup bump covers both a track swap and unmount, which
  // is what the two hand-rolled `stale` booleans did.
  const epoch = useRef(0)
  const trackIdRef = useRef(spotifyTrackId)
  trackIdRef.current = spotifyTrackId
  // Latest-ref: the caller passes an inline closure, so this must not be an
  // effect dependency — re-running the load on every render would refetch.
  const onLoaded = useRef(options.onLoaded)
  onLoaded.current = options.onLoaded

  useEffect(() => {
    const mine = ++epoch.current
    setPhase({ k: 'loading' })
    setTrOverride(null)
    getLyrics(spotifyTrackId)
      .then((data) => {
        if (epoch.current !== mine)
          return
        setPhase({ k: 'ready', data })
        // A finished translation shows by default (owner decision 2026-07-06);
        // the 번역 toggle can still hide it. Re-derived per loaded track.
        setShowKo(data.availability === 'ok' && data.translation?.status === 'done')
        onLoaded.current?.(data)
      })
      .catch(() => {
        if (epoch.current === mine)
          setPhase({ k: 'error' })
      })
    return () => {
      epoch.current++
    }
  }, [spotifyTrackId, reloadSeq])

  const translation = trOverride ?? (phase.k === 'ready' ? phase.data.translation : null) ?? null
  const translationStatus = translation?.status ?? null

  const segs = phase.k === 'ready' && phase.data.availability === 'ok' ?
    (phase.data.segments ?? []) :
    []
  const n = segs.length
  // Annotations ride the same payload and are present even when availability is
  // not "ok" — a track can carry commentary and no synced lyrics at all.
  const annotations = (phase.k === 'ready' ? phase.data.annotations : null) ?? []
  const koreanDominant = useMemo(() => isKoreanDominant(segs.filter(s => s.text !== '')), [segs])

  const requestTr = useCallback(async (): Promise<'ok' | 'failed' | 'dropped'> => {
    if (requesting)
      return 'dropped'
    // The same epoch guard every other async write in this file uses, and the
    // one place it was missing. Without it: the member presses 번역 요청 on A,
    // the track turns over (naturally, or because the session adopted a skip)
    // while the POST is in flight, and A's answer lands on B — B shows
    // 요청됨 · 확인 for a translation nobody asked for, and `pending` then arms a
    // three-attempt burst and a visibility listener against that wrong state.
    const mine = epoch.current
    setRequesting(true)
    try {
      const info = await requestTranslation(trackIdRef.current)
      if (epoch.current !== mine)
        return 'dropped'
      setTrOverride(info)
      return 'ok'
    }
    catch {
      return epoch.current === mine ? 'failed' : 'dropped'
    }
    finally {
      setRequesting(false)
    }
  }, [requesting])

  // A status re-read. It is the document read, because a completed translation
  // arrives as `text_ko` on every segment, not as a flag. Adopting only on an
  // actual status change keeps a "still pending" answer from replacing `segs`
  // with an equal-but-different array under the viewer's focus scheduler.
  const checking = useRef(false)
  const recheck = useCallback(async (explicit = false) => {
    if (checking.current)
      return
    const mine = epoch.current
    checking.current = true
    if (explicit)
      setCheckingTr(true)
    try {
      const data = await getLyrics(trackIdRef.current)
      if (epoch.current !== mine)
        return
      const next = data.translation?.status ?? null
      if (next === translationStatus)
        return
      setTrOverride(null)
      setPhase({ k: 'ready', data })
      // Reveal a translation that finished while the screen was open. Never
      // hide one: past this point `showKo` is the member's toggle.
      if (data.availability === 'ok' && next === 'done')
        setShowKo(true)
    }
    catch {
      // A failed status check says nothing about the document already on screen.
      // Leaving it alone is the whole point — this is a background refresh.
    }
    finally {
      checking.current = false
      if (explicit)
        setCheckingTr(false)
    }
  }, [translationStatus])

  const recheckRef = useRef(recheck)
  useEffect(() => {
    recheckRef.current = recheck
  })

  const pending = phase.k === 'ready' && translationStatus === 'requested'

  // The bounded burst. Armed ONCE per pending episode (`pending` does not change
  // when a re-check learns the row is still pending, so this effect does not
  // re-arm itself), and re-armed only when the member asks explicitly.
  useEffect(() => {
    if (!pending)
      return
    let elapsed = 0
    const timers = TRANSLATION_RETRY_MS.map((gap) => {
      elapsed += gap
      return window.setTimeout(() => void recheckRef.current(), elapsed)
    })
    return () => timers.forEach(t => window.clearTimeout(t))
  }, [pending, burstSeq])

  // Coming back to the tab is the cheapest honest moment to ask: the member was
  // elsewhere, and the poller had that whole time to finish.
  useEffect(() => {
    if (!pending)
      return
    const onVisible = () => {
      if (!document.hidden)
        void recheckRef.current()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [pending])

  const emptyText = phase.k === 'ready' && phase.data.availability === 'no_lyrics' ?
    '가사 없음 (연주곡)' :
    '아직 연결된 가사가 없어요'
  const sourceKind = phase.k === 'ready' && phase.data.availability === 'ok' ? phase.data.source_kind : null

  return {
    phase,
    reloadSeq,
    segs,
    n,
    annotations,
    sourceKind: sourceKind ?? null,
    emptyText,
    translation,
    koreanDominant,
    showKo,
    setShowKo,
    requesting,
    requestTr,
    checkingTr,
    recheckTr: () => {
      setBurstSeq(s => s + 1)
      void recheckRef.current(true)
    },
    reload: () => setReloadSeq(s => s + 1),
  }
}
