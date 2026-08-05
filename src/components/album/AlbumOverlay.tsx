// App-wide read-only album overlay (ARCH-entity-interaction-unify Step 1).
//
// Mounted once in layout.astro (sibling to PocketBuckit), UN-gated so it works
// on public pages too — unlike PocketBuckit, which returns null when logged out.
// Opens on the `ent:open-album` window event (lib/entityEvents): any surface
// (public review, home tiles, search) dispatches it via openAlbum(). Member
// surfaces keep their own writable AlbumDetail modal (SelfDashboard's onOpen) — this
// overlay is read-only: no lyrics affordance (onOpenLyrics omitted = privacy),
// no memo/edit. Closes on ESC/scrim/✕ and on SPA navigation.
import type { OpenAlbumDetail } from '@lib/entityEvents'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isLoggedIn } from '@lib/auth'
import { ENT_OPEN_ALBUM } from '@lib/entityEvents'
import { playbackSession } from '@lib/playback/session'
import { rememberSpotifyTransportProbe } from '@lib/spotifyCapability'
import { useDismissable } from '@lib/useDismissable'
import { useScrollLock } from '@lib/useScrollLock'
import { AlbumDetailView } from './AlbumDetailView'

export default function AlbumOverlay() {
  const [target, setTarget] = useState<OpenAlbumDetail | null>(null)

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenAlbumDetail>).detail
      if (detail?.albumId)
        setTarget(detail)
    }
    const onNav = () => setTarget(null)
    window.addEventListener(ENT_OPEN_ALBUM, onOpen)
    // Close across ClientRouter view transitions (the overlay is not per-page state).
    document.addEventListener('astro:before-swap', onNav)
    return () => {
      window.removeEventListener(ENT_OPEN_ALBUM, onOpen)
      document.removeEventListener('astro:before-swap', onNav)
    }
  }, [])

  if (!target)
    return null
  return <OverlayCard target={target} onClose={() => setTarget(null)} />
}

function OverlayCard({ target, onClose }: { target: OpenAlbumDetail, onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null)
  const noticeTimer = useRef<number | null>(null)
  const [playing, setPlaying] = useState(false)
  // The toast carries an optional Undo, because ▶ now REPLACES the playback queue
  // (Step 6b) and that is destructive. Shipped idiom, not a new one: label + a
  // 되돌리기 button, no confirm dialog (this RFC's OQ3).
  const [notice, setNotice] = useState<{ label: string, undo: (() => void) | null } | null>(null)
  useDismissable(true, onClose, cardRef)
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
  // No local busy guard, matching that same precedent — a double click races
  // two `rewriteQueue` calls in theory, but the shipped vanilla version has
  // carried that exact risk with no reported issue.
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
	className="lf-modal-card"
	onClick={e => e.stopPropagation()}
	role="dialog"
	aria-modal="true"
	aria-label="앨범 상세"
	style={{ position: 'relative', width: '100%', maxWidth: 600, maxHeight: '86vh', overflowY: 'auto', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 12, boxShadow: '0 34px 80px rgba(0,0,0,.42)', padding: '30px 30px 26px' }}
      >
        <button type="button" className="iconbtn" onClick={onClose} aria-label="닫기" style={{ position: 'absolute', top: 16, right: 16, width: 30, height: 30, borderColor: 'var(--color-border-soft)', zIndex: 2 }}>✕</button>
        <AlbumDetailView
	albumId={target.albumId}
	title={target.title}
	artist={target.artist}
	cover={target.cover}
	year={target.year}
	interactive={!target.unresolved}
	onPlayTrack={isLoggedIn() && !target.unresolved ? playTrack : undefined}
	topSlot={isLoggedIn() && !target.unresolved ?
          (
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--color-border-soft)', display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => { void playAlbum() }} disabled={playing} className="sans" style={{ padding: '8px 13px', borderRadius: 5, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text)', cursor: playing ? 'default' : 'pointer', opacity: playing ? 0.55 : 1, fontSize: 12.5 }}>
                {playing ? '재생 요청 중…' : '이 앨범 재생 ▶'}
              </button>
            </div>
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
