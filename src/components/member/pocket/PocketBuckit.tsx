// FEAT-pocket-buckit Step 1 — the site-wide island. Mounted once in layout.astro
// (client:only). Signed-in members only (the bucket read needs a Cognito JWT and
// is per-user since multi-user P2 — each member sees their OWN buckets here);
// anonymous visitors get nothing. Streaming ▶ inside the tray stays owner-only.
import type { OpenLiveLyricsDetail } from '@lib/entityEvents'
import type { LyricsSheetMeta } from '../lyrics/LyricsSheet'
import type { PbOpenStateDetail } from '@lib/pocketBuckit/events'
import { useEffect, useRef, useState } from 'react'
import { isLoggedIn } from '@lib/auth'
import { ENT_OPEN_LIVE_LYRICS } from '@lib/entityEvents'
import { PB_CLOSED_EVENT, PB_OPEN_STATE_EVENT, PB_TOGGLE_EVENT } from '@lib/pocketBuckit/events'
import { LyricsSheet } from '../lyrics/LyricsSheet'
import { LyricsViewer } from '../lyrics/LyricsViewer'
import { GlobalPlaybackBar } from '../playback/GlobalPlaybackBar'
import { PlaybackPanel } from '../playback/PlaybackPanel'
import { openPlaybackLyrics } from '../playback/playbackEntryActions'
import { PocketBuckitProvider, usePocket } from './PocketBuckitProvider'
import { PocketDesignSettings } from './PocketDesignSettings'
import { PocketTray } from './PocketTray'
import './pocket.css'
// LyricsViewer's own .lyv-* CSS — self-supplied here (not via member.css,
// which is dashboard-only) since this is now the app-wide mount. See
// lyricsViewer.css's own header comment for why.
import '@styles/lyricsViewer.css'

function PocketBuckitInner() {
  const { open, setOpen } = usePocket()
  const [settings, setSettings] = useState(false)
  const [playbackPanelOpen, setPlaybackPanelOpen] = useState(false)
  // ARCH-global-playback-experience Step 2 — the live lyrics host, relocated
  // here from SelfDashboard (dashboard-scoped) so 가사 opens from any route.
  // PocketTray dispatches ENT_OPEN_LIVE_LYRICS (openPlaybackLyrics); this is
  // now its only listener. LyricsViewer's own component/data hooks/sync logic
  // are untouched — only the mount trigger moved.
  const [liveLyrics, setLiveLyrics] = useState<OpenLiveLyricsDetail | null>(null)
  // ARCH-playback-authority-convergence Step 4 (G5) — the 전체 가사 handoff.
  // The live viewer is a listening screen; reading the lyric in full is the
  // static sheet's job, and until now there was no way to get from one to the
  // other. The sheet mounts HERE rather than in the viewer because it is a
  // sibling surface, not a child: the two are mutually exclusive, and this is
  // the site-wide host, so the handoff works on every route the viewer opens on
  // — which is all of them (`SelfDashboard` wires its own dashboard-internal
  // pair the same way). `LyricsSheet` self-supplies its CSS since Step 4, which
  // is what makes mounting it outside the dashboard legal at all.
  const [fullLyrics, setFullLyrics] = useState<{ trackId: string, meta: LyricsSheetMeta } | null>(null)
  useEffect(() => {
    const onOpen = (e: Event) => setLiveLyrics((e as CustomEvent<OpenLiveLyricsDetail>).detail)
    window.addEventListener(ENT_OPEN_LIVE_LYRICS, onOpen)
    return () => window.removeEventListener(ENT_OPEN_LIVE_LYRICS, onOpen)
  }, [])
  // Cross-island toggle bridge: the member My Buckit board (a separate React
  // root) dispatches `pb:toggle` from its toolbar button; flip the in-memory tray
  // `open` here, where usePocket() is inside the provider. setOpen is pure state —
  // no fetch — so the toggle never hits the network. Mirrors the pb:add-track
  // window-event convention (the two islands share no context).
  useEffect(() => {
    const onToggle = () => setOpen(v => !v)
    window.addEventListener(PB_TOGGLE_EVENT, onToggle)
    return () => window.removeEventListener(PB_TOGGLE_EVENT, onToggle)
  }, [setOpen])
  // Broadcast `open` back to the member board on EVERY transition. The board
  // can't read this island's `open`, so it mirrors `detail.open` for the 🪣 Pocket
  // toggle's aria-expanded. Driving this from useEffect([open]) — not the tray's
  // 닫기 click — means EVERY close path is observed: the 닫기 button AND the board
  // toggle flipping open→false. On a close transition we also re-emit pb:closed so
  // the board clears its transient NEW drag markers regardless of which control
  // closed the tray (the 닫기 button's own pb:closed becomes idempotent). The
  // first run (mount) is `open === false` with no prior true, so it emits the
  // open-state (false) but the close-marker clear is a harmless no-op.
  const prevOpen = useRef(open)
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent<PbOpenStateDetail>(PB_OPEN_STATE_EVENT, { detail: { open } }),
    )
    if (prevOpen.current && !open)
      window.dispatchEvent(new CustomEvent(PB_CLOSED_EVENT))
    prevOpen.current = open
  }, [open])
  return (
    <div className="pb-scope">
      <GlobalPlaybackBar playbackPanelOpen={playbackPanelOpen} onOpenPlaybackPanel={() => setPlaybackPanelOpen(true)} />
      <PocketTray onOpenPlaybackPanel={() => setPlaybackPanelOpen(true)} />
      {playbackPanelOpen && (
        <PlaybackPanel
	onClose={() => setPlaybackPanelOpen(false)}
	onOpenLyrics={openPlaybackLyrics}
        />
      )}
      <button
	type="button"
	aria-label="Pocket 디자인 설정"
	title="Pocket 디자인 설정"
	onClick={() => setSettings(true)}
	style={{
          position: 'fixed',
          right: 22,
          bottom: `calc(var(--global-player-h, 0px) + ${open ? 152 : 60}px)`,
          zIndex: 72,
          width: 34,
          height: 34,
          borderRadius: 34,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--color-bg)',
          color: 'var(--color-subtle)',
          border: '1px solid var(--color-border)',
          boxShadow: '0 4px 14px rgba(26,26,26,.16)',
          cursor: 'pointer',
          transition: 'bottom .2s',
        }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="3.2" />
          <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1" />
        </svg>
      </button>
      {settings && <PocketDesignSettings onClose={() => setSettings(false)} />}
      {liveLyrics && (
        <LyricsViewer
	key={liveLyrics.trackId}
	spotifyTrackId={liveLyrics.trackId}
	initialProgressMs={liveLyrics.progressMs}
	initialProgressAtMs={liveLyrics.progressAtMs}
	initialDurationMs={liveLyrics.durationMs}
	initialAlbumCoverUrl={liveLyrics.albumCoverUrl}
	initialTrack={liveLyrics.track}
	initialArtist={liveLyrics.artist}
	initialArtists={liveLyrics.artists}
	canRefresh
	onOpenFullLyrics={(trackId, meta) => {
          setLiveLyrics(null)
          setFullLyrics({ trackId, meta: { track: meta.track, artist: meta.artist, cover: meta.cover } })
        }}
	onClose={() => setLiveLyrics(null)}
        />
      )}
      {fullLyrics && (
        <LyricsSheet
	key={fullLyrics.trackId}
	spotifyTrackId={fullLyrics.trackId}
	meta={fullLyrics.meta}
	onClose={() => setFullLyrics(null)}
        />
      )}
    </div>
  )
}

export default function PocketBuckit() {
  // client:only island → window is always defined here; gate on the owner session.
  if (typeof window !== 'undefined' && !isLoggedIn())
    return null
  return (
    <PocketBuckitProvider>
      <PocketBuckitInner />
    </PocketBuckitProvider>
  )
}
