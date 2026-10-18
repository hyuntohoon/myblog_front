// App-wide read-only album overlay (ARCH-entity-interaction-unify Step 1).
//
// Mounted once in layout.astro (sibling to PocketBuckit), UN-gated so it works
// on public pages too — unlike PocketBuckit, which returns null when logged out.
// Opens on the `ent:open-album` window event (lib/entityEvents): any surface
// (public review, home tiles, search) dispatches it via openAlbum(). Member
// surfaces keep their own writable AlbumDetail modal (SelfDashboard's onOpen) — this
// overlay is read-only: no lyrics affordance (onOpenLyrics omitted = privacy),
// no memo/edit. Closes on ESC/scrim/✕, on Back, and on SPA navigation.
//
// Back closes it (front UI/UX audit 2026-10-16, owner decision D2): opening
// pushes a history entry with NO URL change — not an album URL, which D2 kept
// closed (2026-07-08, 2026-08-04). The rule is that the entry IS the overlay:
// the overlay shows exactly when the current entry carries `albumOverlay`, so
// Back, Forward and ✕ can never disagree about whether it is open.
//   - ✕/ESC/scrim consume the entry (history.back()); leaving it in place would
//     make the next Back a dead press that only removes an invisible entry.
//   - Opening another album while one is showing replaces the entry: one Back
//     always closes, it does not walk back through albums.
//   - A pop between this overlay's entry and the one beneath it is a same-page
//     state change, so it must not reach ClientRouter — the router treats any
//     traverse with a non-null state as a navigation and would re-fetch and
//     swap the page underneath the reader. The router's popstate listener is
//     registered before any island exists, and listeners on `window` run in
//     registration order whatever their capture flag (measured in Chrome;
//     jsdom runs capture first and hid this), so this component cannot get in
//     front of it. layout.astro's inline head script can: it is the first
//     popstate listener and asks, via POPSTATE_CLAIM, whether this overlay
//     wants the pop; claiming it stops the router.
import type { OpenAlbumDetail } from '@lib/entityEvents'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isLoggedIn } from '@lib/auth'
import { consumeLatchedOpenAlbum, ENT_OPEN_ALBUM, POPSTATE_CLAIM } from '@lib/entityEvents'
import { playbackSession } from '@lib/playback/session'
import { rememberSpotifyTransportProbe } from '@lib/spotifyCapability'
import { useDismissable } from '@lib/useDismissable'
import { useScrollLock } from '@lib/useScrollLock'
import { AlbumDetailView } from './AlbumDetailView'

const ENTRY_KEY = 'albumOverlay'

/** What this overlay keeps in `history.state[ENTRY_KEY]`. */
interface OverlayEntry {
  /**
   * The document that pushed it. A pop is ours to absorb only inside the same
   * document; an entry from an earlier page (Back from the page a link inside
   * the overlay led to) has to go through the router first.
   */
  doc: string
  href: string
  detail: OpenAlbumDetail
}

function newDocToken(): string {
  return Math.random().toString(36).slice(2)
}

function readEntry(state: unknown): OverlayEntry | null {
  const entry = (state as Record<string, unknown> | null)?.[ENTRY_KEY] as OverlayEntry | undefined
  return entry?.detail?.albumId ? entry : null
}

function writeEntry(entry: OverlayEntry, mode: 'push' | 'replace') {
  // Spread the router's own fields ({ index, scrollX, scrollY }) so it keeps
  // counting this as the same page; `''` leaves the URL as it is.
  const state = { ...(window.history.state as object | null), [ENTRY_KEY]: entry }
  if (mode === 'push')
    window.history.pushState(state, '')
  else
    window.history.replaceState(state, '')
}

export default function AlbumOverlay() {
  const [target, setTarget] = useState<OpenAlbumDetail | null>(null)
  const doc = useRef(newDocToken())
  // The entry this overlay pushed and is showing; null whenever it is closed.
  const own = useRef<OverlayEntry | null>(null)

  const currentEntry = () => {
    const entry = readEntry(window.history.state)
    return entry?.doc === doc.current ? entry : null
  }

  // ✕ / ESC / scrim. Back arrives through the popstate listener instead.
  const close = () => {
    setTarget(null)
    if (own.current && currentEntry())
      window.history.back() // the pop it produces clears `own`
    else
      own.current = null
  }

  useEffect(() => {
    const show = (detail: OpenAlbumDetail) => {
      // openRating is a one-shot (the post-login resume); a Forward or a reload
      // that brings the overlay back must not reopen the rating editor too.
      const { openRating: _oneShot, ...kept } = detail
      const entry: OverlayEntry = { doc: doc.current, href: window.location.href, detail: kept }
      writeEntry(entry, currentEntry() ? 'replace' : 'push')
      own.current = entry
      setTarget(detail)
    }
    // Arriving on an entry this overlay wrote in another document — a reload,
    // or Back to the page a link inside the overlay left — re-adopts it.
    const adopt = () => {
      const entry = readEntry(window.history.state)
      if (!entry)
        return
      const adopted: OverlayEntry = { ...entry, doc: doc.current, href: window.location.href }
      writeEntry(adopted, 'replace')
      own.current = adopted
      setTarget(entry.detail)
    }
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenAlbumDetail>).detail
      // The latch is for an open dispatched before this listener existed; an
      // event we actually received has served its purpose, so clear it here too
      // rather than leave a stale one for a later remount to replay.
      consumeLatchedOpenAlbum()
      if (detail?.albumId)
        show(detail)
    }
    const onPop = (e: Event) => {
      const arriving = readEntry((e as CustomEvent<unknown>).detail)
      if (arriving?.doc === doc.current && arriving.href === window.location.href) {
        // Forward onto an entry this overlay pushed in this document.
        e.preventDefault()
        own.current = arriving
        setTarget(arriving.detail)
        return
      }
      const leaving = own.current
      if (!leaving)
        return
      own.current = null
      setTarget(null)
      // Back onto the page beneath: nothing but the overlay changed. A pop that
      // lands on another URL (a long-press jump) is a real navigation — let the
      // router run it.
      if (window.location.href === leaving.href)
        e.preventDefault()
    }
    const onNav = () => {
      own.current = null
      setTarget(null)
    }
    const onSwapped = () => {
      doc.current = newDocToken()
      adopt()
    }
    window.addEventListener(ENT_OPEN_ALBUM, onOpen)
    window.addEventListener(POPSTATE_CLAIM, onPop)
    adopt()
    // A sibling island (the post-login resume) may have fired its open from its
    // own mount effect, before this one ran — see openAlbumLatched.
    const latched = consumeLatchedOpenAlbum()
    if (latched?.albumId)
      show(latched)
    // Close across ClientRouter view transitions (the overlay is not per-page state).
    document.addEventListener('astro:before-swap', onNav)
    document.addEventListener('astro:after-swap', onSwapped)
    return () => {
      window.removeEventListener(ENT_OPEN_ALBUM, onOpen)
      window.removeEventListener(POPSTATE_CLAIM, onPop)
      document.removeEventListener('astro:before-swap', onNav)
      document.removeEventListener('astro:after-swap', onSwapped)
    }
  }, [])

  if (!target)
    return null
  return <OverlayCard target={target} onClose={close} />
}

function OverlayCard({ target, onClose }: { target: OpenAlbumDetail, onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null)
  const noticeTimer = useRef<number | null>(null)
  const [playing, setPlaying] = useState(false)
  // The toast carries an optional Undo, because ▶ now REPLACES the playback queue
  // (Step 6b) and that is destructive. Shipped idiom, not a new one: label + a
  // 되돌리기 button, no confirm dialog (this RFC's OQ3).
  const [notice, setNotice] = useState<{ label: string, undo: (() => void) | null } | null>(null)
  useDismissable(true, onClose, cardRef, { inertBackground: true })
  useScrollLock()

  const showNotice = (label: string, undo: (() => void) | null = null) => {
    setNotice({ label, undo })
    if (noticeTimer.current != null)
      window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4200)
  }

  useEffect(() => {
    setPlaying(false)
    setNotice(null)
    return () => {
      if (noticeTimer.current != null)
        window.clearTimeout(noticeTimer.current)
    }
  }, [target.albumId])

  const playAlbum = async () => {
    // The action is hidden for visitors, and this guard guarantees an auth
    // transition cannot mint a token after the button was painted.
    if (!isLoggedIn() || playing)
      return
    setPlaying(true)
    // FEAT-playback-bucket-player Step 6b: ▶ REPLACES the playback queue and plays
    // it, instead of calling the ladder behind the session's back. Same ladder
    // underneath (the session owns the only play path) — what changed is that the
    // queue now knows about this, which is the whole finding this step came from.
    const outcome = await playbackSession.replaceQueueAndPlay({
      kind: 'album',
      albumId: target.albumId,
      title: target.title,
    })
    setPlaying(false)
    const undo = outcome.undo
    const runUndo = undo ? () => void undo().then(r => showNotice(r.message)) : null
    if (outcome.ok) {
      rememberSpotifyTransportProbe('available')
      showNotice(outcome.message, runUndo)
      return
    }
    if (outcome.play?.ok === false) {
      if (outcome.play.reason === 'no-capability')
        rememberSpotifyTransportProbe('no-capability')
      if (outcome.play.reason === 'token' && outcome.play.status === 'disconnected') {
        showNotice('Spotify를 연동하면 이 앨범을 재생할 수 있어요.', runUndo)
        return
      }
    }
    showNotice(outcome.message, runUndo)
  }

  // ARCH-entity-interaction-v2 Step 5 — the track-level twin of `playAlbum`,
  // same primitive (`replaceQueueAndPlay`, `kind: 'track'`) the vanilla review
  // page's per-track ▶ already uses in production (`albumDetail.client.ts`).
  // No local busy guard, matching that same precedent — a double click sends two
  // replaces, and the session's `replaceChain` (BUG-23) runs them one after the
  // other, so the second press is the one that lands.
  const playTrack = async (trackId: string, title: string) => {
    if (!isLoggedIn())
      return
    const outcome = await playbackSession.replaceQueueAndPlay({ kind: 'track', trackId, title })
    const undo = outcome.undo
    const runUndo = undo ? () => void undo().then(r => showNotice(r.message)) : null
    if (outcome.ok) {
      rememberSpotifyTransportProbe('available')
      showNotice(outcome.message, runUndo)
      return
    }
    if (outcome.play?.ok === false) {
      if (outcome.play.reason === 'no-capability')
        rememberSpotifyTransportProbe('no-capability')
      if (outcome.play.reason === 'token' && outcome.play.status === 'disconnected') {
        showNotice('Spotify를 연동하면 이 곡을 재생할 수 있어요.', runUndo)
        return
      }
    }
    showNotice(outcome.message, runUndo)
  }

  return (
    <>
      <div
	className="scrim"
	style={{ justifyContent: 'center', alignItems: 'center', padding: 24 }}
	onClick={onClose}
	role="presentation"
      >
      <div
	ref={cardRef}
	className="lf-modal-card album-modal"
	onClick={e => e.stopPropagation()}
	role="dialog"
	aria-modal="true"
	aria-label="앨범 상세"
      >
        <button type="button" className="iconbtn album-modal__close" onClick={onClose} aria-label="닫기">✕</button>
        <AlbumDetailView
	albumId={target.albumId}
	title={target.title}
	artist={target.artist}
	cover={target.cover}
	year={target.year}
	interactive={!target.unresolved}
	openRating={target.openRating && !target.unresolved}
	onPlayTrack={isLoggedIn() && !target.unresolved ? playTrack : undefined}
	headerActions={isLoggedIn() && !target.unresolved ?
          (
            <button type="button" onClick={() => { void playAlbum() }} disabled={playing} className="sans album-modal__button album-modal__button--primary">
              {playing ? '재생 요청 중…' : '이 앨범 재생 ▶'}
            </button>
          ) :
undefined}
        />
      </div>
      </div>
      {notice && createPortal(
        <div className="rise" role="status" style={{ position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)', zIndex: 200, padding: '11px 16px', borderRadius: 7, background: 'var(--color-text)', color: 'var(--color-bg)', boxShadow: '0 16px 40px rgba(0,0,0,.3)', maxWidth: 'min(90vw, 560px)' }}>
          <span className="sans" style={{ fontSize: 13 }}>{notice.label}</span>
          {notice.undo && (
            <button
	type="button"
	className="sans"
	onClick={() => {
                notice.undo?.()
                setNotice(null)
              }}
	style={{ marginLeft: 12, background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', fontSize: 13, textDecoration: 'underline', cursor: 'pointer' }}
            >
              되돌리기
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
