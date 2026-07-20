// Member dashboard — Now Playing (FEAT-member-dashboard Step 3, D5/D26).
//
// FEAT-member-player Step 3 rebuilt the variant internals into a real player
// bar (D1 repeals D11): every variant renders a hairline-LCD transport —
// elapsed / clock-estimated progress hairline / total — whenever the one-shot
// live read carries a position. **Full tier** (member whose own Spotify grant
// supports it) additionally gets play/pause + click/keyboard seek via
// Spotify-Connect remote (`sendPlayerCommand`, client-side with the member's
// token). Capability is 403-probe based (owner decision 5): controls render
// optimistically once a token mints; the first control call answering 403/404
// degrades the session to the **fallback tier** (controls hidden — not
// disabled — the estimated bar keeps moving). Pause freezes the clock anchor
// client-side (no extra read); seek re-anchors optimistically, then confirms
// with ONE one-shot read (OQ2) — skipped while paused, since a paused player
// reads as `idle` in the one-shot contract. D28 holds: never polled; the
// estimate is wall-clock math off the last explicit read. Step 4 adds the
// Connect-style "Listening on <device>" bottom-edge hint (full/banner) from
// the same one-shot body — see DeviceHintLine.
//
// FEAT-nowplaying-live-sync — the worker-fed cache snapshot
// (GET /api/library/now-playing, hourly cron, up to ~1h stale) is only the
// fallback: on mount the card also fires ONE `readLivePlayback()` and lets the
// live moment win (playing → live card, idle → idle branch even if the snapshot
// claimed playing; unavailable → snapshot as-is, no degradation). A 「동기화」
// button re-fires the same one-shot read. Never polled.
//
// FEAT-lyrics-viewer Step 3 — the dynamic lyrics entry lives here, on the live
// branches only (active-playback-only; the idle/최근 재생 branches never get one —
// no recent-history fallback). The snapshot only gates VISIBILITY; the tap does a
// one-shot live playback read (token mint stays lazy, on the explicit action) and
// opens with the live `item.id` + position — the snapshot stores no track id. A
// tap that discovers playback has stopped hides the entry instead of opening.
//
// RFC-ui-surface-unification playback plumb (file-ownership decision
// 2026-07-19): the live path resolves its Spotify album/artist ids to catalog
// ids via @lib/spotifyCatalog — album links light up post-resolve, artist names
// become links only when resolvable (never a dead click).
import type { ClockAnchor } from '@lib/clockEstimate'
import type { PlayerCommandOutcome } from '@lib/spotifyPlayback'
import { useEffect, useRef, useState } from 'react'
import { estimateMs, useClockEstimate } from '@lib/clockEstimate'
import { openAlbum } from '@lib/entityEvents'
import { artistHref } from '@lib/entityLinks'
import { resolveDbAlbumId, resolveDbArtistId } from '@lib/spotifyCatalog'
import { getStreamingToken, sendPlayerCommand } from '@lib/spotifyPlayback'
import { readLivePlayback } from './lyrics/playback.api'
import type { LivePlayback } from './lyrics/playback.api'
import { getNowPlayingData, listRecentlyListened, listRecentTracks } from './spotify.api'
import type { NowPlaying as NowPlayingData, RecentlyListenedItem, RecentTrackItem } from './spotify.api'
import { Cover, Equalizer } from './ui'

export interface LyricsOpenTarget { trackId: string, progressMs: number | null, progressAtMs: number | null, durationMs: number | null, albumCoverUrl: string | null, track: string | null, artist: string | null, artists: Array<{ id: string, name: string }> }
export type OnOpenLyrics = (t: LyricsOpenTarget) => void

export type NpStyle = 'banner' | 'full' | 'list'

/**
 * Capability tier (D1). `full` is optimistic — granted once a token mints; the
 * first control call answering 403/404 (Premium missing / scope not granted /
 * no active device) drops the session to `fallback` (403-probe model, D5).
 */
type Tier = 'full' | 'fallback'

/** The live playback moment the transport renders from (one-shot sourced). */
interface LiveMoment {
  trackId: string
  /** null when the read carried no progress_ms — bar hidden, card still live. */
  anchor: ClockAnchor | null
  durationMs: number | null
  artists: Array<{ id: string, name: string }>
  albumSpotifyId: string | null
  /** Active Connect device name (Step 4 'playing elsewhere' hint), if known. */
  deviceName: string | null
}

/**
 * sessionStorage flag bridging the 502→404 mint sequence: a revoked grant 502s
 * exactly once (the backend flags the row 'error'), then every later mint is a
 * plain 404 indistinguishable from "never connected". The flag keeps the
 * reconnect line up for the rest of the tab session; a successful mint clears
 * it. Fresh sessions rely on the integrations-tab banner (Step 1) instead.
 */
const RECONNECT_FLAG = 'np-spotify-reconnect'

function readReconnectFlag(): boolean {
  try {
    return sessionStorage.getItem(RECONNECT_FLAG) === '1'
  }
  catch {
    return false
  }
}

function writeReconnectFlag(on: boolean): void {
  try {
    if (on)
      sessionStorage.setItem(RECONNECT_FLAG, '1')
    else sessionStorage.removeItem(RECONNECT_FLAG)
  }
  catch { /* private mode — the hint just doesn't persist */ }
}

/** ms → `m:ss` for the transport time labels. */
function fmtMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Viewport-narrow flag (canonical 640px breakpoint) — drives the mobile size
 * tier (cover / padding / type scale). Media-query listener, never polled.
 */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const on = (e: MediaQueryListEvent) => setNarrow(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

/** Relative freshness label for the snapshot timestamp. */
function fmtSince(iso?: string | null): string {
  if (!iso)
    return ''
  const t = new Date(iso)
  if (Number.isNaN(t.getTime()))
    return ''
  const mins = Math.floor((Date.now() - t.getTime()) / 60_000)
  if (mins < 1)
    return '방금'
  if (mins < 60)
    return `${mins}분 전`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)
    return `${hrs}시간 전`
  return t.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
}

function SyncNote({ iso }: { iso?: string | null }) {
  const s = fmtSince(iso)
  if (!s)
    return null
  // Bare freshness ("3시간 전") — the adjacent ↻ button carries the sync
  // semantic; the old "동기화 …" prefix pushed narrow columns into a wrap.
  return <span className="mono" title={`동기화 ${s}`} style={{ fontSize: 11, color: 'var(--color-faded)', whiteSpace: 'nowrap' }}>{s}</span>
}

/**
 * Sync note + the ↻ button (FEAT-nowplaying-live-sync). The button re-fires
 * the one-shot live read; double-fire is guarded in the hook. Compact icon
 * (not a text button) so the control row fits a phone-width column.
 */
function SyncControl({ iso, onSync, syncing }: { iso?: string | null, onSync?: () => void, syncing?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
      <SyncNote iso={iso} />
      {onSync && (
        <button
	type="button"
	className="iconbtn mono"
	onClick={onSync}
	disabled={syncing}
	aria-label="지금 재생 상태 동기화"
	title="동기화"
	style={{ width: 26, height: 26, fontSize: 14, lineHeight: 1, flex: '0 0 auto' }}
        >
          {syncing ? '…' : '↻'}
        </button>
      )}
    </span>
  )
}

/**
 * Fixed-size album cover (item 9): the real catalog art when a cover URL is
 *  available, else the editorial letter tile. (ui's AlbumArt fills 100% width, so
 *  it can't drive these fixed-size now-playing slots — hence a sized variant.)
 */
function NpCover({ url, label, size, radius = 4 }: { url?: string | null, label: string, size: number, radius?: number }) {
  if (url) {
    return (
      <img
	src={url}
	alt={label}
	loading="lazy"
	decoding="async"
	style={{ width: size, height: size, objectFit: 'cover', borderRadius: radius, display: 'block', flex: '0 0 auto', border: '1px solid var(--color-border)' }}
      />
    )
  }
  return <Cover label={label} size={size} radius={radius} />
}

function AlbumTextLink({ id, title, artist, cover }: { id?: string | null, title?: string | null, artist?: string | null, cover?: string | null }) {
  if (!id || !title)
    return <>{title}</>
  return <button type="button" onClick={() => openAlbum({ albumId: id, title, artist: artist ?? undefined, cover })} style={{ padding: 0, border: 'none', background: 'none', font: 'inherit', color: 'inherit', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3, textDecorationColor: 'var(--color-faded)' }}>{title}</button>
}

function AlbumCoverLink({ id, title, artist, cover, label, size, radius = 4 }: { id?: string | null, title?: string | null, artist?: string | null, cover?: string | null, label: string, size: number, radius?: number }) {
  const art = <NpCover url={cover} label={label} size={size} radius={radius} />
  if (!id)
    return art
  return (
    <button type="button" aria-label="앨범 정보 열기" onClick={() => openAlbum({ albumId: id, title: title ?? undefined, artist: artist ?? undefined, cover })} style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', display: 'block', flex: '0 0 auto' }}>
      {art}
    </button>
  )
}

/**
 * Shared fetch — the worker-fed snapshot, overlaid by a one-shot live read.
 * Snapshot and live read fire in parallel on mount; a decisive live result
 * (`playing`/`idle`) wins regardless of arrival order, `unavailable` silently
 * keeps the snapshot. `sync()` re-fires the live read (동기화 button); the
 * busyRef guard makes it single-flight. Lives in the NowPlaying wrapper (not
 * the variants) so a banner↔full↔list toggle re-renders without re-firing the
 * snapshot GET + live Spotify read.
 */
function useNowPlaying() {
  const [np, setNp] = useState<NowPlayingData | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [syncing, setSyncing] = useState(false)
  const [moment, setMoment] = useState<LiveMoment | null>(null)
  // Client-side pause: freezes the clock anchor without a follow-up read (a
  // paused player reads as `idle` in the one-shot contract, so re-reading
  // would collapse the card).
  const [paused, setPaused] = useState(false)
  const [tier, setTier] = useState<Tier>('fallback')
  const [reconnect, setReconnect] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const busyRef = useRef(false)
  const controlBusyRef = useRef(false)
  const liveWonRef = useRef(false)
  const onRef = useRef(true)
  const noteTimer = useRef<number | null>(null)

  const flashNote = (msg: string) => {
    setNote(msg)
    if (noteTimer.current != null)
      window.clearTimeout(noteTimer.current)
    noteTimer.current = window.setTimeout(() => {
      if (onRef.current)
        setNote(null)
    }, 4000)
  }

  const applyLive = (r: LivePlayback) => {
    if (r.state === 'unavailable')
      return
    liveWonRef.current = true
    if (r.state === 'playing') {
      // The live chain carries Spotify ids only; album_id lights up below once
      // the catalog resolve lands (ui-unify playback plumb).
      setNp({
        is_playing: true,
        track: r.track,
        artist: r.artist,
        album: r.album,
        album_cover_url: r.albumCoverUrl,
        updated_at: new Date().toISOString(),
      })
      setMoment({
        trackId: r.trackId,
        anchor: r.progressMs != null ? { ms: r.progressMs, wallMs: r.readAtMs } : null,
        durationMs: r.durationMs,
        artists: r.artists,
        albumSpotifyId: r.albumSpotifyId,
        deviceName: r.deviceName,
      })
      setPaused(false)
      if (r.albumSpotifyId) {
        void resolveDbAlbumId(r.albumSpotifyId).then((id) => {
          // Same-track guard: a later read may have swapped the card.
          if (id && onRef.current)
            setNp(prev => (prev && prev.is_playing && prev.track === r.track ? { ...prev, album_id: id } : prev))
        })
      }
    }
    else {
      // Live says nothing is playing — force the idle branch even if the stale
      // snapshot claimed otherwise. Keep whatever fields are already there.
      setNp(prev => ({ ...(prev ?? {}), is_playing: false, updated_at: new Date().toISOString() }))
      setMoment(null)
      setPaused(false)
    }
    setState('ready')
  }

  const sync = async () => {
    if (busyRef.current)
      return
    busyRef.current = true
    setSyncing(true)
    try {
      const r = await readLivePlayback()
      if (onRef.current)
        applyLive(r)
    }
    finally {
      busyRef.current = false
      if (onRef.current)
        setSyncing(false)
    }
  }

  const handleControlFailure = (r: Exclude<PlayerCommandOutcome, { ok: true }>) => {
    if (r.reason === 'no-capability') {
      // The 403-probe verdict (D5): this session can't control playback.
      setTier('fallback')
      flashNote('이 계정/기기에선 재생 제어를 사용할 수 없어요')
      return
    }
    if (r.reason === 'token') {
      setTier('fallback')
      if (r.httpStatus === 502) {
        setReconnect(true)
        writeReconnectFlag(true)
      }
      return
    }
    flashNote('제어에 실패했어요. 잠시 후 다시 시도해 주세요')
  }

  const playPause = async () => {
    if (controlBusyRef.current)
      return
    controlBusyRef.current = true
    try {
      const r = await sendPlayerCommand(paused ? { kind: 'play' } : { kind: 'pause' })
      if (!onRef.current)
        return
      if (!r.ok) {
        handleControlFailure(r)
        return
      }
      if (paused) {
        // Resume: restart the clock from the frozen position.
        setMoment(m => (m?.anchor ? { ...m, anchor: { ms: m.anchor.ms, wallMs: performance.now() } } : m))
        setPaused(false)
      }
      else {
        // Pause: freeze the anchor at the current estimate.
        setMoment((m) => {
          if (!m?.anchor)
            return m
          const at = estimateMs(m.anchor)
          return { ...m, anchor: { ms: m.durationMs != null ? Math.min(at, m.durationMs) : at, wallMs: performance.now() } }
        })
        setPaused(true)
      }
    }
    finally {
      controlBusyRef.current = false
    }
  }

  const seek = async (ms: number) => {
    if (controlBusyRef.current)
      return
    controlBusyRef.current = true
    try {
      const target = Math.max(0, Math.round(ms))
      const r = await sendPlayerCommand({ kind: 'seek', positionMs: target })
      if (!onRef.current)
        return
      if (!r.ok) {
        handleControlFailure(r)
        return
      }
      // Optimistic re-anchor at the seek target…
      setMoment(m => (m ? { ...m, anchor: { ms: target, wallMs: performance.now() } } : m))
      // …then the OQ2 confirmation one-shot (accepted 2026-07-19): the PUT
      // returns no body, so one explicit read realigns to the server truth.
      // Skipped while paused — a paused player reads as `idle` and would
      // collapse the card; the optimistic anchor is exact there anyway.
      if (!paused)
        await sync()
    }
    finally {
      controlBusyRef.current = false
    }
  }

  useEffect(() => {
    onRef.current = true
    getNowPlayingData()
      .then((d) => {
        if (!onRef.current)
          return
        if (!liveWonRef.current)
          setNp(d)
        setState(s => (s === 'loading' ? 'ready' : s))
      })
      .catch(() => {
        if (onRef.current && !liveWonRef.current)
          setState(s => (s === 'loading' ? 'error' : s))
      })
    // FEAT-nowplaying-live-sync: one-shot live read on entry (never polled).
    void sync()
    // Tier resolve (optimistic controls): a minting token ⇒ full until a probe
    // says otherwise. Shares the in-flight mint with the live read above, so
    // this adds no extra request. 502 ⇒ the stored grant is broken (revoked /
    // invalid_grant) → inline reconnect line; 404 after a same-session 502
    // keeps it up via the sessionStorage flag.
    void getStreamingToken().then((r) => {
      if (!onRef.current)
        return
      if (r.ok) {
        setTier('full')
        setReconnect(false)
        writeReconnectFlag(false)
        return
      }
      setTier('fallback')
      if (r.httpStatus === 502) {
        setReconnect(true)
        writeReconnectFlag(true)
      }
      else if (r.status === 'disconnected' && readReconnectFlag()) {
        setReconnect(true)
      }
    })
    return () => {
      onRef.current = false
      if (noteTimer.current != null)
        window.clearTimeout(noteTimer.current)
    }
  }, [])
  return { np, state, sync, syncing, moment, paused, tier, reconnect, note, playPause, seek }
}

/**
 * The snapshot when something is actually playing, else null (present-but-idle
 *  snapshots still expose updated_at for the sync note).
 */
function liveSnapshot(np: NowPlayingData | null): NowPlayingData | null {
  return np && np.is_playing === true && np.track ? np : null
}

/**
 * The latest played track (D-C) — shown as "최근 재생" when nothing is currently
 *  playing, so the surface always says *something* about what was last heard.
 *  Only fetched when `enabled` (i.e. the now-playing snapshot is idle), to avoid a
 *  needless request while something is live.
 */
function useLatestPlayed(enabled: boolean): RecentTrackItem | null {
  const [latest, setLatest] = useState<RecentTrackItem | null>(null)
  useEffect(() => {
    if (!enabled)
      return
    let on = true
    listRecentTracks().then(r => on && setLatest(r.items[0] ?? null)).catch(() => { /* leave null */ })
    return () => {
      on = false
    }
  }, [enabled])
  return latest
}

/** The wrapper-owned data bundle every variant renders from. */
interface NpShared {
  np: NowPlayingData | null
  state: 'loading' | 'ready' | 'error'
  sync: () => Promise<void>
  syncing: boolean
  latest: RecentTrackItem | null
  onOpenLyrics?: OnOpenLyrics
  moment: LiveMoment | null
  paused: boolean
  tier: Tier
  reconnect: boolean
  note: string | null
  playPause: () => Promise<void>
  seek: (ms: number) => Promise<void>
}

/* ── transport (member-player Step 3, direction A "hairline LCD") ──────────── */

function PlayPauseBtn({ paused, onClick, size }: { paused: boolean, onClick: () => void, size: number }) {
  return (
    <button
	type="button"
	onClick={onClick}
	aria-label={paused ? '재생' : '일시정지'}
	title={paused ? '재생' : '일시정지'}
	style={{ width: size, height: size, borderRadius: '50%', border: '1px solid var(--color-border)', background: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', flex: '0 0 auto', padding: 0, color: 'var(--color-text)' }}
    >
      {paused ?
        <svg width={Math.round(size * 0.36)} height={Math.round(size * 0.4)} viewBox="0 0 10 12" aria-hidden="true" style={{ marginLeft: 1 }}><path d="M0 0 L10 6 L0 12 Z" fill="currentColor" /></svg> :
(
        <svg width={Math.round(size * 0.33)} height={Math.round(size * 0.4)} viewBox="0 0 10 12" aria-hidden="true">
<rect width="3.4" height="12" fill="currentColor" />
<rect x="6.6" width="3.4" height="12" fill="currentColor" />
        </svg>
      )}
    </button>
  )
}

/**
 * Hairline transport: [⏯] elapsed ── 2px hairline ── total. Renders nothing
 * without a position anchor + duration (the card then reads as before Step 3).
 * Full tier: button + click/keyboard seek + accent knob. Fallback tier:
 * display-only — controls hidden (not disabled, D1), the estimate still ticks.
 */
function Transport({ moment, paused, tier, playPause, seek, note, micro = false, showButton = true }: {
  moment: LiveMoment
  paused: boolean
  tier: Tier
  playPause: () => Promise<void>
  seek: (ms: number) => Promise<void>
  note: string | null
  micro?: boolean
  showButton?: boolean
}) {
  const est = useClockEstimate(moment.anchor, !paused, moment.durationMs)
  const barRef = useRef<HTMLDivElement>(null)
  const dur = moment.durationMs
  const noteLine = note ?
    <div className="mono" style={{ marginTop: 6, fontSize: 10.5, color: 'var(--color-faded)', letterSpacing: '.03em' }}>{note}</div> :
    null
  if (est == null || dur == null || dur <= 0)
    return noteLine
  const frac = Math.min(1, Math.max(0, est / dur))
  const full = tier === 'full'
  const timeStyle = { fontSize: micro ? 9.5 : 10.5, color: 'var(--color-faded)', letterSpacing: '.03em', whiteSpace: 'nowrap' as const }
  const seekAt = (clientX: number) => {
    const el = barRef.current
    if (!el)
      return
    const r = el.getBoundingClientRect()
    if (r.width > 0)
      void seek(((clientX - r.left) / r.width) * dur)
  }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: micro ? 8 : 10 }}>
        {full && showButton && <PlayPauseBtn paused={paused} onClick={() => { void playPause() }} size={micro ? 24 : 30} />}
        <span className="mono" style={timeStyle}>{fmtMs(est)}</span>
        <div
	ref={barRef}
	role={full ? 'slider' : 'progressbar'}
	aria-label="재생 위치"
	aria-valuemin={0}
	aria-valuemax={dur}
	aria-valuenow={Math.round(est)}
	aria-valuetext={`${fmtMs(est)} / ${fmtMs(dur)}`}
	tabIndex={full ? 0 : undefined}
	onClick={full ? e => seekAt(e.clientX) : undefined}
	onKeyDown={full ?
            (e) => {
              if (e.key === 'ArrowLeft') {
                e.preventDefault()
                void seek(Math.max(0, est - 5000))
              }
              else if (e.key === 'ArrowRight') {
                e.preventDefault()
                void seek(Math.min(dur, est + 5000))
              }
            } :
            undefined}
	style={{ position: 'relative', flex: 1, height: 14, display: 'flex', alignItems: 'center', cursor: full ? 'pointer' : 'default', minWidth: 0 }}
        >
          <span style={{ position: 'absolute', left: 0, right: 0, height: 2, background: 'var(--color-border-soft)' }} />
          <span style={{ position: 'absolute', left: 0, width: `${frac * 100}%`, height: 2, background: 'var(--color-text)' }} />
          {full && <span style={{ position: 'absolute', left: `${frac * 100}%`, transform: 'translateX(-50%)', width: 7, height: 7, borderRadius: '50%', background: 'var(--color-accent)' }} />}
        </div>
        <span className="mono" style={timeStyle}>{fmtMs(dur)}</span>
      </div>
      {noteLine}
    </div>
  )
}

/**
 * Live-path artist names (ui-unify playback plumb, executed here per the
 * 2026-07-19 file-ownership decision). Spotify ids pre-resolve to catalog ids
 * (module-cached in @lib/spotifyCatalog); only resolvable artists render as
 * links — the rest stay plain text, so a dead click never exists. Without live
 * artists, falls back to the snapshot's plain artist string.
 */
export function ArtistNames({ artists, text }: { artists?: Array<{ id: string, name: string }>, text?: string | null }) {
  const [ids, setIds] = useState<Record<string, string>>({})
  const list = artists ?? []
  const key = list.map(a => a.id).join(',')
  useEffect(() => {
    if (!key)
      return
    let on = true
    for (const { id } of list) {
      void resolveDbArtistId(id).then((dbId) => {
        if (on && dbId)
          setIds(prev => (prev[id] === dbId ? prev : { ...prev, [id]: dbId }))
      })
    }
    return () => {
      on = false
    }
    // deps: keyed by the joined id list — `list` itself is a fresh array each render.
  }, [key])
  if (!list.length)
    return <>{text}</>
  return (
    <>
      {list.map((a, i) => (
        <span key={a.id}>
          {i > 0 ? ', ' : null}
          {ids[a.id] ?
            <a href={artistHref(ids[a.id])} style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3, textDecorationColor: 'var(--color-faded)' }}>{a.name}</a> :
            a.name}
        </span>
      ))}
    </>
  )
}

/**
 * Inline reconnect line (OQ3 resolution, 2026-07-19): shown along the panel's
 * bottom edge when the member's stored grant is broken (a mint 502 this
 * session, or a 404 following one — see RECONNECT_FLAG). Same slot idiom the
 * Step 4 Connect device hint will use.
 */
function ReconnectLine() {
  return (
    <div className="mono" style={{ borderTop: '1px solid var(--color-border-soft)', padding: '7px 16px 8px', fontSize: 10.5, letterSpacing: '.03em', color: 'var(--color-accent)' }}>
      Spotify 연동이 만료됐어요 —
      {' '}
      <a href="/settings/" style={{ color: 'inherit' }}>설정에서 재연동</a>
    </div>
  )
}

/**
 * Connect-style 'playing elsewhere' device hint (member-player Step 4) — the
 * quiet informational sibling of ReconnectLine in the same panel-bottom-edge
 * slot (full/banner variants). The name comes free with the one-shot
 * `GET /me/player` body, so it refreshes exactly when the existing ↻ sync (or
 * a seek confirmation) fires — never polled (D28). Members without the
 * playback-state scope never reach this: their live read fails before a
 * moment exists, so the line is omitted by construction.
 */
function DeviceHintLine({ name }: { name: string }) {
  return (
    <div className="mono" style={{ borderTop: '1px solid var(--color-border-soft)', padding: '7px 16px 8px', fontSize: 10.5, letterSpacing: '.03em', color: 'var(--color-faded)', display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
      <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" style={{ flex: '0 0 auto' }}>
        <rect x="3" y="0.5" width="6" height="11" rx="1.2" fill="none" stroke="currentColor" />
        <circle cx="6" cy="8.5" r="1.1" fill="currentColor" />
      </svg>
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
        Listening on
        {' '}
        <span style={{ color: 'var(--color-subtle)' }}>{name}</span>
      </span>
    </div>
  )
}

/**
 * The dynamic lyrics entry ("가사"). Rendered ONLY beside a live snapshot; the
 * tap performs the one-shot live read and opens on `playing`. Discovering the
 * snapshot went stale (live read = idle) hides the entry — active-playback-only,
 * no fallback. A transient read failure keeps the button (retryable) with a
 * small note, so the entry is never hidden over a network blip.
 */
function LyricsEntry({ onOpen }: { onOpen: OnOpenLyrics }) {
  const [state, setState] = useState<'ready' | 'busy' | 'gone' | 'failed'>('ready')
  const busyRef = useRef(false)
  const click = async () => {
    if (busyRef.current)
      return
    busyRef.current = true
    setState('busy')
    try {
      const r = await readLivePlayback()
      if (r.state === 'playing') {
        setState('ready')
        onOpen({ trackId: r.trackId, progressMs: r.progressMs, progressAtMs: r.readAtMs, durationMs: r.durationMs, albumCoverUrl: r.albumCoverUrl, track: r.track, artist: r.artist, artists: r.artists })
      }
      else if (r.state === 'idle') {
        setState('gone')
      }
      else {
        setState('failed')
      }
    }
    finally {
      busyRef.current = false
    }
  }
  if (state === 'gone')
    return <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-faded)', letterSpacing: '.04em' }}>재생 중 아님</span>
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {state === 'failed' && <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-faded)', letterSpacing: '.04em' }}>확인 실패</span>}
      {/* Quiet text-link entry (not a boxed button) — same borderless control
          family as the dashboard's 새로고침; keeps the narrow control row on
          one line next to the ↻ iconbtn. */}
      <button
	type="button"
	className="mono"
	onClick={() => {
          void click()
        }}
	disabled={state === 'busy'}
	aria-label="현재 재생 중인 곡 가사 보기"
	style={{ background: 'none', border: 'none', padding: '4px 2px', fontSize: 11, letterSpacing: '.06em', color: 'var(--color-text)', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3, textDecorationColor: 'var(--color-faded)', whiteSpace: 'nowrap', flex: '0 0 auto' }}
      >
        {state === 'busy' ? '…' : '가사'}
      </button>
    </span>
  )
}

/* ── idle / loading shells ─────────────────────────────────────────────────── */

function IdleBox({ compact = false, iso, latest, onSync, syncing, reconnect = false }: { compact?: boolean, iso?: string | null, latest?: RecentTrackItem | null, onSync?: () => void, syncing?: boolean, reconnect?: boolean }) {
  return (
    <div className="panel" style={{ overflow: 'hidden' }}>
      {/* minWidth 140 on the text cell forces the sync controls to wrap below it
          on narrow screens instead of squeezing the track title to nothing. */}
      <div style={{ padding: compact ? 16 : 22, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14, rowGap: 10 }}>
        <Equalizer playing={false} h={14} />
        <div style={{ flex: 1, minWidth: 140 }}>
          <div className="kicker" style={{ color: 'var(--color-faded)', marginBottom: 4 }}>{latest ? '최근 재생' : 'NOW PLAYING'}</div>
          {latest ?
            (
                <>
                  <div className="serif italic" style={{ fontSize: compact ? 16 : 18, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{latest.track_name}</div>
                  <div className="sans" style={{ fontSize: 12, color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{latest.artist_name}</div>
                </>
              ) :
            <div className="serif italic" style={{ fontSize: compact ? 16 : 18, color: 'var(--color-subtle)' }}>재생 중 아님</div>}
        </div>
        <span style={{ marginLeft: 'auto' }}><SyncControl iso={iso} onSync={onSync} syncing={syncing} /></span>
      </div>
      {reconnect && <ReconnectLine />}
    </div>
  )
}

/* ── full variant ──────────────────────────────────────────────────────────── */

function NowPlayingFull({ np, state, sync, syncing, latest, onOpenLyrics, moment, paused, tier, reconnect, note, playPause, seek }: NpShared) {
  const narrow = useNarrow()
  const onSync = () => {
    void sync()
  }
  if (state === 'loading')
    return <div className="panel" style={{ padding: 18 }}><span className="meta">불러오는 중…</span></div>
  if (!np || !np.is_playing || !np.track)
    return <IdleBox iso={np?.updated_at} latest={latest} onSync={onSync} syncing={syncing} reconnect={reconnect} />
  return (
    <div className="panel" style={{ overflow: 'hidden' }}>
      <div style={{ padding: narrow ? 14 : 18, display: 'flex', gap: narrow ? 14 : 18, alignItems: 'center' }}>
        <AlbumCoverLink id={np.album_id} title={np.album} artist={np.artist} cover={np.album_cover_url} label={np.album ?? np.track ?? '?'} size={narrow ? 64 : 88} radius={4} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, rowGap: 6, marginBottom: 6 }}>
            <Equalizer playing={!paused} h={12} />
            <span className="kicker" style={{ color: 'var(--color-accent)', whiteSpace: 'nowrap' }}>NOW PLAYING</span>
            <span style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 10, rowGap: 6, minWidth: 0 }}>
              {onOpenLyrics && <LyricsEntry onOpen={onOpenLyrics} />}
              <SyncControl iso={np.updated_at} onSync={onSync} syncing={syncing} />
            </span>
          </div>
          <div className="serif italic" style={{ fontSize: narrow ? 18 : 22, fontWeight: 500, letterSpacing: '-.01em', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{np.track}</div>
          <div className="sans" style={{ fontSize: 12.5, color: 'var(--color-subtle)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <ArtistNames artists={moment?.artists} text={np.artist} />
            {np.artist && np.album ? ' — ' : null}
            <AlbumTextLink id={np.album_id} title={np.album} artist={np.artist} cover={np.album_cover_url} />
          </div>
          {moment && (
            <div style={{ marginTop: narrow ? 10 : 12 }}>
              <Transport moment={moment} paused={paused} tier={tier} playPause={playPause} seek={seek} note={note} />
            </div>
          )}
        </div>
      </div>
      {moment?.deviceName != null && <DeviceHintLine name={moment.deviceName} />}
      {reconnect && tier === 'fallback' && <ReconnectLine />}
    </div>
  )
}

/* ── list variant (now-playing + recently-listened albums) ───────────────────── */

function NowPlayingList({ np, state, sync, syncing, latest, onOpenLyrics, moment, paused, tier, reconnect, note, playPause, seek }: NpShared) {
  const onSync = () => {
    void sync()
  }
  const [recent, setRecent] = useState<RecentlyListenedItem[] | null>(null)
  useEffect(() => {
    let on = true
    listRecentlyListened().then(r => on && setRecent(r.items)).catch(() => on && setRecent([]))
    return () => {
      on = false
    }
  }, [])
  const live = liveSnapshot(np)
  return (
    <div className="panel" style={{ overflow: 'hidden' }}>
      {state === 'loading' ?
        <div style={{ padding: 16 }}><span className="meta">불러오는 중…</span></div> :
        live ?
          (
              <div style={{ padding: 16, borderBottom: '1px solid var(--color-border-soft)' }}>
                <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                  <AlbumCoverLink id={live.album_id} title={live.album} artist={live.artist} cover={live.album_cover_url} label={live.album ?? live.track ?? '?'} size={50} radius={3} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="kicker" style={{ color: 'var(--color-accent)', marginBottom: 4, display: 'flex', flexWrap: 'wrap', gap: 8, rowGap: 4, alignItems: 'center' }}>
                      <span style={{ whiteSpace: 'nowrap' }}>● 재생 중</span>
                      <span style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 8, rowGap: 4, minWidth: 0 }}>
                        {onOpenLyrics && <LyricsEntry onOpen={onOpenLyrics} />}
                        <SyncControl iso={live.updated_at} onSync={onSync} syncing={syncing} />
                      </span>
                    </div>
                    <div className="serif italic" style={{ fontSize: 17, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{live.track}</div>
                    <div className="sans" style={{ fontSize: 12, color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><ArtistNames artists={moment?.artists} text={live.artist} /></div>
                  </div>
                  {tier === 'full' && moment ?
                    <PlayPauseBtn paused={paused} onClick={() => { void playPause() }} size={26} /> :
                    <Equalizer playing={!paused} h={16} />}
                </div>
                {moment && (
                  <div style={{ marginTop: 10 }}>
                    <Transport moment={moment} paused={paused} tier={tier} playPause={playPause} seek={seek} note={note} micro showButton={false} />
                  </div>
                )}
              </div>
            ) :
          <div style={{ borderBottom: '1px solid var(--color-border-soft)' }}><IdleBox compact iso={np?.updated_at} latest={latest} onSync={onSync} syncing={syncing} reconnect={reconnect} /></div>}

      <div style={{ padding: '10px 8px 8px' }}>
        <div className="meta" style={{ padding: '0 8px 8px' }}>최근 들은 앨범</div>
        {recent == null && <div className="meta" style={{ padding: '4px 8px' }}>불러오는 중…</div>}
        {recent != null && recent.length === 0 && <div className="meta" style={{ padding: '4px 8px' }}>기록이 없습니다</div>}
        {(recent ?? []).slice(0, 6).map((it, i) => (
          <button type="button" key={it.album_id} onClick={() => openAlbum({ albumId: it.album_id, title: it.album?.title, artist: (it.album?.artist_names ?? []).join(', ') || undefined, cover: it.album?.cover_url })} style={{ display: 'flex', gap: 12, alignItems: 'center', width: '100%', border: 'none', background: 'none', padding: 8, cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit', borderTop: i ? '1px solid var(--color-border-soft)' : 'none' }}>
            <NpCover url={it.album?.cover_url} label={it.album?.title ?? '?'} size={32} radius={2} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="serif" style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.album?.title}</div>
              <div className="sans" style={{ fontSize: 11.5, color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(it.album?.artist_names ?? []).join(', ')}</div>
            </div>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-faded)', letterSpacing: '.04em', whiteSpace: 'nowrap', flex: '0 0 auto' }}>{fmtSince(it.last_played_at)}</span>
          </button>
        ))}
      </div>
      {live && reconnect && tier === 'fallback' && <ReconnectLine />}
    </div>
  )
}

/* ── banner variant (overview default) ───────────────────────────────────────── */

function NowPlayingBanner({ np, state, sync, syncing, latest, onOpenLyrics, moment, paused, tier, reconnect, note, playPause, seek }: NpShared) {
  const narrow = useNarrow()
  const onSync = () => {
    void sync()
  }
  const live = liveSnapshot(np)
  // 2-line clamp instead of single-line ellipsis: the banner title is the
  // centerpiece, and long titles were clipping to a handful of characters in
  // narrow columns (worst on mobile).
  const titleStyle = {
    fontSize: narrow ? 'clamp(20px,5.8vw,26px)' : 'clamp(26px,3.4vw,38px)',
    fontWeight: 500,
    letterSpacing: '-.02em',
    lineHeight: 1.08,
    marginBottom: 6,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    overflowWrap: 'anywhere',
  } as const
  if (state === 'loading') {
    return (
      <div className="panel" style={{ padding: 24, borderTop: '2px solid var(--color-text)', borderBottom: '2px solid var(--color-text)', borderLeft: 0, borderRight: 0, borderRadius: 0 }}>
        <span className="meta">불러오는 중…</span>
      </div>
    )
  }
  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden', borderTop: '2px solid var(--color-text)', borderBottom: '2px solid var(--color-text)', borderLeft: '0', borderRight: '0', borderRadius: 0, background: 'var(--color-bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: narrow ? 14 : 22, padding: narrow ? 16 : 24 }}>
        <AlbumCoverLink id={live ? live.album_id : latest?.album_id} title={live ? live.album : latest?.album_name} artist={live ? live.artist : latest?.artist_name} cover={live ? live.album_cover_url : (latest?.album?.cover_url ?? null)} label={(live ? live.album ?? live.track : latest ? latest.album_name ?? latest.track_name : '—') ?? '—'} size={narrow ? 84 : 116} radius={4} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="kicker" style={{ marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 10, rowGap: 6, alignItems: 'center' }}>
            <span style={{ whiteSpace: 'nowrap', color: live ? 'var(--color-accent)' : latest ? 'var(--color-text)' : 'var(--color-faded)' }}>{live || !latest ? 'NOW PLAYING' : '최근 재생'}</span>
            <span style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 10, rowGap: 6, minWidth: 0 }}>
              {live && onOpenLyrics && <LyricsEntry onOpen={onOpenLyrics} />}
              <SyncControl iso={np?.updated_at} onSync={onSync} syncing={syncing} />
            </span>
          </div>

          {live ?
            (
                <>
                  <div className="serif italic" style={titleStyle}>{live.track}</div>
                  <div className="sans" style={{ fontSize: 13.5, color: 'var(--color-subtle)', marginBottom: narrow ? 12 : 18, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <ArtistNames artists={moment?.artists} text={live.artist} />
                    {live.artist && live.album ? ' — ' : null}
                    <AlbumTextLink id={live.album_id} title={live.album} artist={live.artist} cover={live.album_cover_url} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: narrow ? 22 : 30, marginBottom: moment ? (narrow ? 10 : 12) : (narrow ? 8 : 14) }}>
                    {Array.from({ length: 32 }).map((_, i) => (
                      <span
	key={i}
	className="lf-eq-bar"
	style={{
                          flex: 1,
                          transformOrigin: 'bottom',
                          height: '100%',
                          background: i / 32 > 0.82 ? 'var(--color-accent)' : 'var(--color-text)',
                          opacity: i / 32 > 0.82 ? 1 : 0.65 - (i / 32) * 0.25,
                          animationDuration: `${0.5 + (i % 5) * 0.16}s`,
                          animationDelay: `${i * 0.035}s`,
                          animationPlayState: paused ? 'paused' as const : undefined,
                        }}
                      />
                    ))}
                  </div>
                  {/* Narrow banners hoist the transport below the flex row
                      (full card width) — inside this cover-squeezed column the
                      seek surface shrinks to ~60px, too small a touch target. */}
                  {moment && !narrow && (
                    <div style={{ marginBottom: 6 }}>
                      <Transport moment={moment} paused={paused} tier={tier} playPause={playPause} seek={seek} note={note} />
                    </div>
                  )}
                </>
              ) :
            latest ?
              (
                  <>
                    <div className="serif italic" style={titleStyle}>{latest.track_name}</div>
                    <div className="sans" style={{ fontSize: 13.5, color: 'var(--color-subtle)', marginBottom: narrow ? 12 : 18, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {latest.artist_name}
                      {latest.artist_name && latest.album_name ? ' — ' : null}
                      <AlbumTextLink id={latest.album_id} title={latest.album_name} artist={latest.artist_name} cover={latest.album?.cover_url} />
                    </div>
                  </>
                ) :
              (
                  <div className="serif italic" style={{ fontSize: narrow ? 'clamp(18px,5vw,22px)' : 'clamp(22px,3vw,30px)', fontWeight: 500, color: 'var(--color-subtle)', lineHeight: 1.1, padding: '6px 0 4px' }}>
                    재생 중 아님
                  </div>
                )}
        </div>
      </div>
      {live && moment && narrow && (
        <div style={{ padding: '0 16px 14px' }}>
          <Transport moment={moment} paused={paused} tier={tier} playPause={playPause} seek={seek} note={note} />
        </div>
      )}
      {live && moment?.deviceName != null && <DeviceHintLine name={moment.deviceName} />}
      {reconnect && tier === 'fallback' && <ReconnectLine />}
    </div>
  )
}

export function NowPlaying({ variant, onOpenLyrics }: { variant: NpStyle, onOpenLyrics?: OnOpenLyrics }) {
  // Data lives here, above the variant switch: toggling 배너/플레이어/리스트
  // remounts the variant component but must NOT re-fire the snapshot GET +
  // one-shot live Spotify read (they used to run per variant mount) — and the
  // capability tier / pause freeze / transport anchor survive the toggle too.
  const { np, state, sync, syncing, moment, paused, tier, reconnect, note, playPause, seek } = useNowPlaying()
  const latest = useLatestPlayed(state === 'ready' && !liveSnapshot(np))
  const shared: NpShared = { np, state, sync, syncing, latest, onOpenLyrics, moment, paused, tier, reconnect, note, playPause, seek }
  if (variant === 'list')
    return <NowPlayingList {...shared} />
  if (variant === 'banner')
    return <NowPlayingBanner {...shared} />
  return <NowPlayingFull {...shared} />
}
