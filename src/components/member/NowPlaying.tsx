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
// with ONE one-shot read (OQ2) — skipped while paused, where the optimistic
// anchor is already exact. D28 holds: never polled; the
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
import type { PlayerCommandOutcome, RepeatMode } from '@lib/spotifyPlayback'
import type { LikedState, PlaybackModeCommand, CapabilityTier as Tier } from '@lib/playback/session'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { estimateMs, useClockEstimate } from '@lib/clockEstimate'
import { openAlbum } from '@lib/entityEvents'
import { artistHref } from '@lib/entityLinks'
import { playbackSession } from '@lib/playback/session'
import { getResolvedDbArtistId, resolveDbAlbumId, resolveDbArtistId } from '@lib/spotifyCatalog'
import { readSpotifyCapabilityStanding, rememberSpotifyTransportProbe } from '@lib/spotifyCapability'
import { bindMediaSessionHandlers, publishNowPlaying, publishPlaybackState, publishPosition } from '@lib/mediaSession'
import { isLoggedIn } from '@lib/auth'
import { getActiveRung, MYBLOG_PLAYBACK_CHANGED, play, sendPlayerCommand } from '@lib/spotifyPlayback'
import { whyNoControls } from '@lib/playerCapabilityMatrix'
import { useDismissable } from '@lib/useDismissable'
import type { SpotifyScopeGeneration } from './integrations.api'
import { getIntegrations, spotifyScopeGeneration } from './integrations.api'
import { readLivePlayback } from './lyrics/playback.api'
import type { LivePlayback } from './lyrics/playback.api'
import { getNowPlayingData, listRecentlyListened, listRecentTracks } from './spotify.api'
import type { NowPlaying as NowPlayingData, RecentlyListenedItem, RecentTrackItem } from './spotify.api'
import { Cover, Equalizer } from './ui'
import { PlaybackDevicePicker, PlaybackLikeControl, PlaybackModeControls, seekPlayback, setPlaybackMode, togglePlaybackLiked, useSeekControl } from './playback/PlaybackControls'

export interface LyricsOpenTarget { trackId: string, progressMs: number | null, progressAtMs: number | null, durationMs: number | null, albumCoverUrl: string | null, track: string | null, artist: string | null, artists: Array<{ id: string, name: string }> }
export type OnOpenLyrics = (t: LyricsOpenTarget) => void

export type NpStyle = 'banner' | 'full' | 'list'

/**
 * Capability tier (D1). `full` is optimistic — granted once a token mints; the
 * first control call answering 403/404 (Premium missing / scope not granted /
 * no active device) drops the session to `fallback` (403-probe model, D5).
 */
/** The live playback moment the transport renders from (one-shot sourced). */
interface LiveMomentCore {
  trackId: string
  /** null when the read carried no progress_ms — bar hidden, card still live. */
  anchor: ClockAnchor | null
  durationMs: number | null
  artists: Array<{ id: string, name: string }>
  albumSpotifyId: string | null
  /** Active Connect device name (Step 4 'playing elsewhere' hint), if known. */
  deviceName: string | null
}

interface LiveMoment extends LiveMomentCore {
  shuffle: boolean | null
  repeat: RepeatMode | null
  volumePercent: number | null
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
export function useNowPlaying() {
  const [np, setNp] = useState<NowPlayingData | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [syncing, setSyncing] = useState(false)
  const [moment, setMoment] = useState<LiveMomentCore | null>(null)
  // Client-side pause: freezes the clock anchor without a follow-up read. The
  // old reason — "a paused read collapses the card" — stopped being true in two
  // steps (FEAT-lyrics-sync-precision Step 2 split `paused` out of `idle`; OQ4
  // taught `applyLive` to render it), but the behaviour stands on its own: the
  // frozen anchor IS the held position, so a read would confirm what we know.
  const [paused, setPaused] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const busyRef = useRef(false)
  const controlBusyRef = useRef(false)
  const modeBusyRef = useRef(false)
  const seekBusyRef = useRef(false)
  /**
   * Bumped once per LOCAL authoritative write (a control call whose command
   * came back ok) — same shape as `session.ts`'s `localWriteSeq`. `onPlaybackChanged`
   * captures this before starting its own read and discards that read if the
   * counter moved in the meantime, rather than `controlBusyRef`'s old blanket
   * "ignore every event while ANY control call is in flight", which dropped a
   * genuinely external change landing in the same window along with our own echo.
   */
  const localWriteSeqRef = useRef(0)
  const liveWonRef = useRef(false)
  const onRef = useRef(true)
  const noteTimer = useRef<number | null>(null)
  /**
   * ARCH-entity-interaction-domain-audit Step 3b — the Playback Bucket panel's
   * own tracker, subscribed read-only so a play started there converges here
   * too. `sessionReady` gates the effect below until `playbackSession`'s own
   * first live read (kicked off in the mount effect) has actually landed —
   * without it, the session's initial EMPTY snapshot would flash this card to
   * idle before that first read has a chance to say otherwise.
   */
  const sessionState = useSyncExternalStore(playbackSession.subscribe, playbackSession.getSnapshot, playbackSession.getServerSnapshot)
  const [sessionReady, setSessionReady] = useState(false)
  const tier = sessionState.capabilityTier
  const likedState = sessionState.liked
  const reconnect = sessionState.reconnect
  const renderedMoment: LiveMoment | null = moment ?
    {
      ...moment,
      shuffle: sessionState.shuffle,
      repeat: sessionState.repeat,
      volumePercent: sessionState.volumePercent,
    } :
    null

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
    if (r.state === 'playing' || r.state === 'paused') {
      // BUG-28: this card's projection and playbackSession now share one
      // in-flight read, eliminating the old two-response ordering race. Keep
      // this identity guard because the shared provider answer can still be
      // older than a session-local authoritative write (`localWriteSeq`): in
      // that case session adoption discards it, and this projection must do the
      // same rather than flash back to the provider's pre-write track.
      const sessionTrackId = playbackSession.currentSpotifyTrackId()
      if (sessionTrackId && sessionTrackId !== r.trackId)
        return
      // `paused` joins `playing` here as of OQ4 (2026-08-03). It used to fall to
      // the idle branch below, which cleared `moment` and reset `paused` — fine
      // while nothing could deliver a paused read mid-session, but OQ4 makes
      // every transport command dispatch MYBLOG_PLAYBACK_CHANGED, so a ⏸ pressed
      // in the lyrics viewer or on a headset now lands one here. Through the old
      // branch that read would have wiped the progress bar, duration, device and
      // mode controls and flipped the button back to ▶ — the card collapsing in
      // response to its own pause.
      //
      // `is_playing: true` for a held track is deliberate and not new: it means
      // "a track is current", and `paused` is the separate flag the render reads
      // (Equalizer, PlayPauseBtn, useClockEstimate). This is exactly the state
      // `playPause`'s optimistic path already produces for a pause.
      //
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
      playbackSession.loadLiked(r.trackId)
      setPaused(r.state === 'paused')
      if (r.albumSpotifyId) {
        void resolveDbAlbumId(r.albumSpotifyId).then((id) => {
          // Same-track guard: a later read may have swapped the card.
          if (id && onRef.current)
            setNp(prev => (prev && prev.is_playing && prev.track === r.track ? { ...prev, album_id: id } : prev))
        })
      }
    }
    else if (!playbackSession.getSnapshot().currentItemId && !playbackSession.getSnapshot().external) {
      // Live says nothing is playing — force the idle branch even if the stale
      // snapshot claimed otherwise. Keep whatever fields are already there.
      // Only `idle` reaches here now; `paused` moved up to the track branch with
      // OQ4 (see there). `idle` means there is no track at all, so clearing is
      // right — that has not changed.
      //
      // Step 3b guard: `playbackSession` is checked fresh (not the closed-over
      // `sessionState`) because this is the exact race real-browser
      // verification caught — a play started in the Playback Bucket panel
      // sets `playbackSession`'s state synchronously (`playFrom`'s
      // `authoritativePatch`, no read involved), but THIS card's own read
      // (fired by the very same `MYBLOG_PLAYBACK_CHANGED`) can still be
      // in flight against Spotify's ack→apply lag and land here with a
      // stale 'idle' a moment later, wiping the card the session's own
      // subscription effect just correctly populated. Session's authoritative
      // "something is playing" wins; only clear when session agrees too.
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
      const sessionSync = playbackSession.syncFromLive()
      const r = await readLivePlayback()
      await sessionSync
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
      playbackSession.recordControlFailure(r)
      flashNote('이 계정/기기에선 재생 제어를 사용할 수 없어요')
      return
    }
    if (r.reason === 'token') {
      playbackSession.recordControlFailure(r)
      return
    }
    flashNote('제어에 실패했어요. 잠시 후 다시 시도해 주세요')
  }

  const playPause = async () => {
    if (controlBusyRef.current || modeBusyRef.current || seekBusyRef.current)
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
      rememberSpotifyTransportProbe('available')
      localWriteSeqRef.current += 1
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
    if (controlBusyRef.current || modeBusyRef.current || seekBusyRef.current)
      return
    seekBusyRef.current = true
    try {
      await seekPlayback(
        ms,
        message => onRef.current && flashNote(message),
        () => { localWriteSeqRef.current += 1 },
      )
    }
    finally {
      seekBusyRef.current = false
    }
  }

  const skip = async (kind: 'next' | 'previous') => {
    if (controlBusyRef.current || modeBusyRef.current || seekBusyRef.current)
      return
    controlBusyRef.current = true
    try {
      const r = await sendPlayerCommand({ kind })
      if (!onRef.current)
        return
      if (!r.ok) {
        handleControlFailure(r)
        return
      }
      rememberSpotifyTransportProbe('available')
      localWriteSeqRef.current += 1
      // POST has no body: exactly one one-shot read refreshes identity + anchor.
      const live = await readLivePlayback()
      if (onRef.current)
        applyLive(live)
    }
    finally {
      controlBusyRef.current = false
    }
  }

  /**
   * Shuffle / repeat / volume (Step 6e). Optimistic like the transport, with one
   * rule the other controls do not need: **a volume failure must not degrade the
   * tier.** Plenty of real Connect targets accept transport and reject volume, and
   * Spotify answers that with the same 403 it uses for "not Premium" — routing it
   * through `rememberSpotifyTransportProbe` would hide play/pause because a speaker
   * has no volume API. `sendPlaybackMode` separates the two; this just honors it.
   */
  const setMode = async (cmd: PlaybackModeCommand) => {
    if (controlBusyRef.current || modeBusyRef.current || seekBusyRef.current)
      return
    modeBusyRef.current = true
    try {
      await setPlaybackMode(cmd, message => onRef.current && flashNote(message))
    }
    finally {
      modeBusyRef.current = false
    }
  }

  const toggleLiked = async () => {
    await togglePlaybackLiked(message => onRef.current && flashNote(message))
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
    // Step 3b: sync() starts the session adoption and this card's richer live
    // projection together; readLivePlayback's single-flight makes them one GET.
    void sync().finally(() => {
      if (onRef.current)
        setSessionReady(true)
    })
    // Tier resolve (optimistic controls): a minting token ⇒ full until a probe
    // says otherwise. Shares the in-flight mint with the live read above, so
    // this adds no extra request. 502 ⇒ the stored grant is broken (revoked /
    // invalid_grant) → inline reconnect line; 404 after a same-session 502
    // keeps it up via the sessionStorage flag.
    void playbackSession.resolveCapability()
    const onPlaybackChanged = () => {
      // Since OQ4 (2026-08-03) every successful transport command dispatches this,
      // including the ones this card issues itself — `playPause`/`seek`/`skip`
      // already dispatch it synchronously, BEFORE their transport path resolves
      // back to them (same ordering `session.ts` relies on for
      // `localWriteSeq`). So this handler's read always starts before that control
      // call bumps `localWriteSeqRef` a moment later, and self-discards once it
      // does — the same echo `controlBusyRef`'s old blanket guard used to swallow,
      // but now discarded per-read instead of by refusing to even start the read.
      // That is the fix: a blanket "ignore every event while ANY control call is in
      // flight" also dropped a genuinely external change landing in the same
      // window (someone pausing from their phone mid-flight of our own pause) —
      // this only discards a read raced by a newer LOCAL write, so an external
      // event's read lands normally. `playPause` stays fully optimistic (no local
      // read of its own), so its bump still wins the race against its own echo.
      const seqAtStart = localWriteSeqRef.current
      void readLivePlayback().then((r) => {
        if (!onRef.current)
          return
        if (localWriteSeqRef.current !== seqAtStart)
          return
        applyLive(r)
      })
    }
    window.addEventListener(MYBLOG_PLAYBACK_CHANGED, onPlaybackChanged)
    return () => {
      onRef.current = false
      window.removeEventListener(MYBLOG_PLAYBACK_CHANGED, onPlaybackChanged)
      if (noteTimer.current != null)
        window.clearTimeout(noteTimer.current)
    }
  }, [])

  /**
   * Step 3b — converge track identity + anchor from `playbackSession`.
   *
   * The card's reads still project rich display metadata (`np`, artists,
   * album and cover). Session-owned capability/mode/like/device/reconnect
   * axes come straight from `sessionState`; this effect only projects track
   * identity/anchor/duration/paused into the card's rendering model.
   *
   * `np` (title/artist/cover) is seeded too, minimally, off the queue row or
   * `external` — the render gate below is `np.is_playing && np.track`, not
   * `moment`, so without this the card stayed on `IdleBox` even once `moment`
   * had already converged (caught in real-browser verification: a play
   * started from the Playback Bucket panel updated `PlaybackMini` instantly
   * but this card sat idle until its own next read happened to land — this
   * card's own `onPlaybackChanged` read is racing the same ack→apply lag
   * `session.ts`'s `localWriteSeq` exists for, except THIS card never issued
   * the command, so it has no authoritative write of its own to prefer over
   * a stale read; `playbackSession`'s state has no such race, since
   * `playFrom`'s `authoritativePatch` sets it from the command's own result,
   * never from a read). This card's own next read still overwrites `np` with
   * the fuller picture (album, cover, artists) once it lands.
   *
   * Gated on `controlBusyRef` for the same reason Step 3a exists: a session
   * read landing while THIS card has its own direct optimistic write in flight
   * (`playPause`/`skip`) is that exact race, just crossing components —
   * `playbackSession`'s `localWriteSeq` has no visibility into a write this card
   * made directly via `sendPlayerCommand`, so it cannot guard against it alone.
   * Seek is session-owned now and deliberately does not enter this gate; its
   * optimistic anchor emits here immediately, while the re-anchor callback bumps
   * this card's `localWriteSeqRef` so the card's pre-write event read self-discards.
   *
   * BUG-22 no longer needs a replay counter: `setMode` now writes through the
   * session and deliberately does not enter this card's local control-busy
   * window. Its optimistic mode write therefore emits directly, and any track
   * update arriving during the request converges here immediately. The gate is
   * still required for play/pause/skip, whose optimistic identity/anchor
   * writes remain local to this card.
   */
  useEffect(() => {
    if (!sessionReady || controlBusyRef.current)
      return
    const row = playbackSession.currentRow()
    // CHORE-nowplaying-trackid-namespace: `row?.trackId` is a DB catalog UUID,
    // not a Spotify id — using it raw here fed `getTrackLiked()` (below,
    // `/me/tracks/contains`) a DB id whenever the sounding track was matched to
    // a queue row. `currentSpotifyTrackId()` already resolves it through the
    // same cache-only lookup `rowForSpotifyTrack` uses in the other direction,
    // exactly the pattern `PocketTray.tsx`'s `openPlaybackLyrics` already gets
    // right for the identical field.
    const trackId = playbackSession.currentSpotifyTrackId()
    if (!trackId) {
      setMoment(null)
      setNp(prev => (prev ? { ...prev, is_playing: false, updated_at: new Date().toISOString() } : prev))
      setPaused(false)
      return
    }
    const isNewTrack = !(moment && moment.trackId === trackId)
    setMoment(m => (m && m.trackId === trackId ?
      { ...m, anchor: sessionState.anchor, durationMs: sessionState.durationMs } :
      {
        trackId,
        anchor: sessionState.anchor,
        durationMs: sessionState.durationMs,
        artists: [],
        albumSpotifyId: null,
        deviceName: null,
      }))
    if (isNewTrack) {
      setNp({
        is_playing: true,
        track: sessionState.external?.title ?? row?.title ?? null,
        artist: sessionState.external?.artist ?? row?.artist ?? null,
        album: null,
        album_cover_url: row?.cover ?? sessionState.external?.albumCoverUrl ?? null,
        updated_at: new Date().toISOString(),
      })
    }
    setPaused(!sessionState.playing)
    playbackSession.loadLiked(trackId)
  }, [sessionReady, sessionState.currentItemId, sessionState.external, sessionState.anchor, sessionState.playing, sessionState.durationMs])

  /**
   * OS media integration (member-player Step 5) — **rung 2 only**.
   *
   * The moment this tab emits audio it must own the media keys, the lock screen
   * and headset buttons, or the sound has no visible source and no way to stop it
   * short of hunting for the tab. On rung 1 a real Connect device is playing and
   * its own app owns that surface; claiming it here would put a second, competing
   * control on the lock screen — so `@lib/mediaSession` no-ops unless the active
   * rung is in-page, and this effect just keeps it fed.
   *
   * The handlers route to the SAME transport the on-screen buttons use, so a
   * headset click and a click on the bar cannot diverge.
   */
  useEffect(() => {
    if (getActiveRung() !== 'in-page')
      return
    const teardown = bindMediaSessionHandlers({
      onPlay: () => { void playPause() },
      onPause: () => { void playPause() },
      onNext: () => { void skip('next') },
      onPrevious: () => { void skip('previous') },
      onSeek: (ms) => { void seek(ms) },
    })
    return teardown
    // Rebinding on the live track keeps the closures pointing at current state;
    // the handlers read `paused` through playPause, which reads it fresh.
  }, [moment?.trackId, paused])

  useEffect(() => {
    const live = liveSnapshot(np)
    if (!moment) {
      publishNowPlaying(null)
      return
    }
    publishNowPlaying({
      title: live?.track ?? '재생 중',
      artist: live?.artist ?? undefined,
      album: live?.album ?? undefined,
      artwork: live?.album_cover_url ?? undefined,
    })
    publishPlaybackState(paused)
    if (moment.anchor && moment.durationMs != null)
      publishPosition(moment.durationMs, estimateMs(moment.anchor))
  }, [np, moment, paused])

  return { np, state, sync, syncing, moment: renderedMoment, paused, tier, likedState, reconnect, note, playPause, seek, skip, toggleLiked, setMode }
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
  likedState: LikedState
  reconnect: boolean
  note: string | null
  playPause: () => Promise<void>
  seek: (ms: number) => Promise<void>
  skip: (kind: 'next' | 'previous') => Promise<void>
  toggleLiked: () => Promise<void>
  setMode: (cmd: { kind: 'shuffle', on: boolean } | { kind: 'repeat', mode: RepeatMode } | { kind: 'volume', percent: number }) => Promise<void>
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

function SkipBtn({ kind, onClick, size }: { kind: 'next' | 'previous', onClick: () => void, size: number }) {
  const previous = kind === 'previous'
  return (
    <button
	type="button"
	onClick={onClick}
	aria-label={previous ? '이전 곡' : '다음 곡'}
	title={previous ? '이전 곡' : '다음 곡'}
	style={{ width: size, height: size, border: 'none', background: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', flex: '0 0 auto', padding: 0, color: 'var(--color-text)' }}
    >
      <svg width={Math.round(size * 0.56)} height={Math.round(size * 0.48)} viewBox="0 0 14 12" aria-hidden="true">
        {previous ?
(
          <>
<rect width="2" height="12" fill="currentColor" />
<path d="M13 0 3 6l10 6Z" fill="currentColor" />
          </>
        ) :
(
          <>
<path d="M1 0l10 6L1 12Z" fill="currentColor" />
<rect x="12" width="2" height="12" fill="currentColor" />
          </>
        )}
      </svg>
    </button>
  )
}

/** Profile keeps its existing narrow-screen reduction; other surfaces decide independently. */
function ProfileModeControls({ shuffle, repeat, volumePercent, onSet, micro }: {
  shuffle: boolean | null
  repeat: RepeatMode | null
  volumePercent: number | null
  onSet: (cmd: PlaybackModeCommand) => Promise<void>
  micro: boolean
}) {
  const narrow = useNarrow()
  return <PlaybackModeControls shuffle={shuffle} repeat={repeat} volumePercent={volumePercent} onSet={onSet} micro={micro} hidden={narrow} />
}

/**
 * Hairline transport: [⏯] elapsed ── 2px hairline ── total. Renders nothing
 * without a position anchor + duration (the card then reads as before Step 3).
 * Full tier: button + click/keyboard seek + accent knob. Fallback tier:
 * display-only — controls hidden (not disabled, D1), the estimate still ticks.
 */
function Transport({ moment, paused, tier, playPause, seek, note, micro = false, showButton = true, showExtendedControls = false, likedState = 'unknown', skip, toggleLiked, setMode }: {
  moment: LiveMoment
  paused: boolean
  tier: Tier
  playPause: () => Promise<void>
  seek: (ms: number) => Promise<void>
  note: string | null
  micro?: boolean
  showButton?: boolean
  showExtendedControls?: boolean
  likedState?: LikedState
  skip?: (kind: 'next' | 'previous') => Promise<void>
  toggleLiked?: () => Promise<void>
  setMode?: (cmd: { kind: 'shuffle', on: boolean } | { kind: 'repeat', mode: RepeatMode } | { kind: 'volume', percent: number }) => Promise<void>
}) {
  const est = useClockEstimate(moment.anchor, !paused, moment.durationMs)
  const dur = moment.durationMs
  const noteLine = note ?
    <div className="mono" style={{ marginTop: 6, fontSize: 10.5, color: 'var(--color-faded)', letterSpacing: '.03em' }}>{note}</div> :
    null
  const hasProgress = est != null && dur != null && dur > 0
  const frac = hasProgress ? Math.min(1, Math.max(0, est / dur)) : 0
  const full = tier === 'full'
  const timeStyle = { fontSize: micro ? 9.5 : 10.5, color: 'var(--color-faded)', letterSpacing: '.03em', whiteSpace: 'nowrap' as const }
  const seekControl = useSeekControl({
    enabled: full,
    durationMs: dur ?? 0,
    elapsedMs: est ?? 0,
    onSeek: (ms) => { void seek(ms) },
  })
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: micro ? 8 : 10 }}>
        {(full && showButton) || showExtendedControls ?
          (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: micro ? 1 : 2, flex: '0 0 auto' }}>
              {full && showExtendedControls && skip && <SkipBtn kind="previous" onClick={() => { void skip('previous') }} size={micro ? 22 : 26} />}
              {full && showButton && <PlayPauseBtn paused={paused} onClick={() => { void playPause() }} size={micro ? 24 : 30} />}
              {full && showExtendedControls && skip && <SkipBtn kind="next" onClick={() => { void skip('next') }} size={micro ? 22 : 26} />}
              {showExtendedControls && toggleLiked && <PlaybackLikeControl state={likedState} onToggle={() => { void toggleLiked() }} size={micro ? 23 : 27} />}
              {full && showExtendedControls && setMode && (
                <ProfileModeControls shuffle={moment.shuffle} repeat={moment.repeat} volumePercent={moment.volumePercent} onSet={setMode} micro={micro} />
              )}
            </span>
          ) :
null}
        {hasProgress && <span className="mono" style={timeStyle}>{fmtMs(est)}</span>}
        {hasProgress && (
<div
	ref={seekControl.ref}
	role={full ? 'slider' : 'progressbar'}
	aria-label="재생 위치"
	aria-valuemin={0}
	aria-valuemax={dur ?? 0}
	aria-valuenow={Math.round(est ?? 0)}
	aria-valuetext={`${fmtMs(est ?? 0)} / ${fmtMs(dur ?? 0)}`}
	tabIndex={full ? 0 : undefined}
	onClick={seekControl.onClick}
	onKeyDown={seekControl.onKeyDown}
	style={{ position: 'relative', flex: 1, height: 14, display: 'flex', alignItems: 'center', cursor: full ? 'pointer' : 'default', minWidth: 0 }}
>
          <span style={{ position: 'absolute', left: 0, right: 0, height: 2, background: 'var(--color-border-soft)' }} />
          <span style={{ position: 'absolute', left: 0, width: `${frac * 100}%`, height: 2, background: 'var(--color-text)' }} />
          {full && <span style={{ position: 'absolute', left: `${frac * 100}%`, transform: 'translateX(-50%)', width: 7, height: 7, borderRadius: '50%', background: 'var(--color-accent)' }} />}
</div>
)}
        {hasProgress && <span className="mono" style={timeStyle}>{fmtMs(dur)}</span>}
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
  const list = artists ?? []
  const key = list.map(a => a.id).join(',')
  // Seeded from the synchronous cache, not an empty object: an id another
  // instance already resolved must render as a link on the very first paint,
  // not flash to plain text while this instance re-awaits the same promise.
  const [ids, setIds] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {}
    for (const { id } of list) {
      const dbId = getResolvedDbArtistId(id)
      if (dbId)
        seed[id] = dbId
    }
    return seed
  })
  useEffect(() => {
    if (!key)
      return
    let on = true
    for (const { id } of list) {
      // Route every id through the synchronous cache (E1 Rule 0, G5): render
      // state must always equal what `getResolvedDbArtistId` would return, so
      // a future drag source reading that getter at `dragstart` never diverges
      // from what's on screen. `resolveDbArtistId` still does the actual
      // network round-trip (module-cached, so a warm id costs no fetch) —
      // only the source of truth for `ids` changes, not the resolution path.
      const cached = getResolvedDbArtistId(id)
      if (cached) {
        setIds(prev => (prev[id] === cached ? prev : { ...prev, [id]: cached }))
        continue
      }
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
/**
 * "왜 컨트롤이 없나요?" — Step 7b.
 *
 * Replaces the one-shot degrade toast as the *durable* explanation. The toast says
 * it once, at the moment of failure, and then the bar just looks broken forever;
 * a member who arrives later never sees any reason at all. This sits quietly in
 * the same panel-bottom-edge slot as ReconnectLine / the device line, and names
 * the ONE next action rather than listing capabilities — `whyNoControls` returns
 * null when nothing is wrong, so the affordance is absent exactly when it should be.
 */
function WhyNoControlsLine() {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  useDismissable(open, () => setOpen(false), boxRef)
  const [conn, setConn] = useState<{ connected: boolean, generation: SpotifyScopeGeneration } | null>(null)

  useEffect(() => {
    let on = true
    // One read, only when the member actually asks — a bar that is merely
    // fallback-tier must not cost an integrations fetch on every mount.
    if (!open || conn)
      return
    void getIntegrations().then((list) => {
      if (!on)
        return
      const sp = list.find(i => i.provider === 'spotify') ?? null
      const connected = sp?.status === 'connected'
      setConn({ connected, generation: spotifyScopeGeneration(sp?.scope, connected) })
    }).catch(() => {})
    return () => {
      on = false
    }
  }, [open, conn])

  const why = conn ? whyNoControls({ ...conn, probe: readSpotifyCapabilityStanding() }) : null

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button
	type="button"
	onClick={() => setOpen(o => !o)}
	aria-expanded={open}
	className="mono"
	style={{ width: '100%', textAlign: 'left', borderTop: '1px solid var(--color-border-soft)', borderLeft: 0, borderRight: 0, borderBottom: 0, background: 'transparent', padding: '7px 16px 8px', fontSize: 10.5, letterSpacing: '.03em', color: 'var(--color-faded)', cursor: 'pointer' }}
      >
        왜 컨트롤이 없나요?
      </button>
      {open && (
        <div
	role="status"
	style={{ position: 'absolute', left: 8, right: 8, bottom: '100%', marginBottom: 4, zIndex: 40, background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 7, boxShadow: '0 18px 44px rgba(0,0,0,.32)', padding: '11px 12px' }}
        >
          {!conn && <div className="mono" style={{ fontSize: 10.5, color: 'var(--color-faded)' }}>확인 중…</div>}
          {conn && !why && (
            <div className="sans" style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--color-subtle)' }}>
              컨트롤을 막는 조건은 없어요. 재생 중인 기기가 없으면 잠시 뒤 다시 보입니다.
            </div>
          )}
          {why && (
            <>
              <div className="sans" style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--color-subtle)' }}>{why.reason}</div>
              {why.href && (
                <a className="sans" href={why.href} style={{ display: 'inline-block', marginTop: 8, fontSize: 12, color: 'var(--color-accent)' }}>
{why.action}
{' '}
→
                </a>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

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
function DeviceHintLine({ name, onSwitched }: { name: string | null, onSwitched: () => void }) {
  const sessionState = useSyncExternalStore(playbackSession.subscribe, playbackSession.getSnapshot, playbackSession.getServerSnapshot)
  return (
    <PlaybackDevicePicker
	name={name}
	devices={sessionState.devices}
	activeDeviceId={sessionState.activeDeviceId}
	onRefresh={playbackSession.refreshDevices}
	onTransfer={playbackSession.transferTo}
	onSwitched={onSwitched}
    />
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
      // `paused` must land with `idle`, NOT in the failure branch: a held
      // player is "재생 중 아님", not "확인 실패". (FEAT-lyrics-sync-precision
      // Step 2 split it out of `idle`; this entry's behavior is unchanged.)
      else if (r.state === 'idle' || r.state === 'paused') {
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

/**
 * The idle bar — and, since 2026-08-02, the site's only visible way to START.
 *
 * Step 5 fixed the cold-start 404 but gave it no entrance: every play affordance
 * sat behind an album overlay, a bucket action sheet, the pocket tray, or a review
 * page that does not exist yet, and the transport only appears once something is
 * already playing. Opening the site with nothing playing, there was nothing to
 * press. This is the screen that is showing at exactly that moment, so the
 * entrance belongs here.
 *
 * `이어듣기` plays the last track the member heard. It needs no catalog resolve —
 * the recent-tracks cache already carries `spotify_track_id` — and it goes through
 * the ladder, so with no active device it raises this tab instead of failing.
 */
/**
 * "▶ 이어듣기" — plays the last track the member heard.
 *
 * Shared by every idle rendering (the full/list `IdleBox` and the banner's own
 * inline idle branch) instead of copied into each: the banner keeps its own idle
 * markup, and duplicating this is exactly how the capability matrix drifted.
 *
 * No catalog resolve — the recent-tracks cache already carries `spotify_track_id`.
 * It goes through the ladder, so with no active device it raises this tab rather
 * than failing, which is the whole point of putting an entrance here.
 */
function ResumeLastButton({ latest, onStarted, onNote }: { latest: RecentTrackItem, onStarted: () => void, onNote: (m: string) => void }) {
  const [busy, setBusy] = useState(false)
  const resume = async () => {
    if (busy)
      return
    setBusy(true)
    const r = await play({ kind: 'uris', uris: [`spotify:track:${latest.spotify_track_id}`] })
    setBusy(false)
    onNote(r.message)
    if (r.ok)
      onStarted()
  }
  return (
    <button
	type="button"
	onClick={() => { void resume() }}
	disabled={busy}
	className="sans"
	aria-label={`${latest.track_name} 이어듣기`}
	title="마지막에 들은 곡부터 이어듣기"
	style={{ padding: '5px 11px', borderRadius: 5, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text)', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.55 : 1, fontSize: 12, whiteSpace: 'nowrap' }}
    >
      {busy ? '재생 요청 중…' : '▶ 이어듣기'}
    </button>
  )
}

function IdleBox({ compact = false, iso, latest, onSync, syncing, reconnect = false, onSwitched }: { compact?: boolean, iso?: string | null, latest?: RecentTrackItem | null, onSync?: () => void, syncing?: boolean, reconnect?: boolean, onSwitched?: () => void }) {
  const [note, setNote] = useState<string | null>(null)
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
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {latest?.spotify_track_id && isLoggedIn() && (
            <ResumeLastButton latest={latest} onStarted={() => onSwitched?.()} onNote={setNote} />
          )}
          <SyncControl iso={iso} onSync={onSync} syncing={syncing} />
        </span>
      </div>
      {note && <div className="mono" style={{ padding: '0 16px 9px', fontSize: 10.5, letterSpacing: '.03em', color: 'var(--color-faded)' }}>{note}</div>}
      {/* With nothing playing there is no active device, so this is the ONLY place
          the member can hand playback to this browser on purpose. */}
      {isLoggedIn() && <DeviceHintLine name={null} onSwitched={() => onSwitched?.()} />}
      {reconnect && <ReconnectLine />}
    </div>
  )
}

/* ── full variant ──────────────────────────────────────────────────────────── */

function NowPlayingFull({ np, state, sync, syncing, latest, onOpenLyrics, moment, paused, tier, likedState, reconnect, note, playPause, seek, skip, toggleLiked, setMode }: NpShared) {
  const narrow = useNarrow()
  const onSync = () => {
    void sync()
  }
  if (state === 'loading')
    return <div className="panel" style={{ padding: 18 }}><span className="meta">불러오는 중…</span></div>
  if (!np || !np.is_playing || !np.track)
    return <IdleBox iso={np?.updated_at} latest={latest} onSync={onSync} syncing={syncing} reconnect={reconnect} onSwitched={() => { void sync() }} />
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
              <Transport moment={moment} paused={paused} tier={tier} playPause={playPause} seek={seek} note={note} showExtendedControls likedState={likedState} skip={skip} toggleLiked={toggleLiked} setMode={setMode} />
            </div>
          )}
        </div>
      </div>
      {moment?.deviceName != null && <DeviceHintLine name={moment.deviceName} onSwitched={() => { void sync() }} />}
      {reconnect && tier === 'fallback' && <ReconnectLine />}
      {moment && tier === 'fallback' && !reconnect && <WhyNoControlsLine />}
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
          <div style={{ borderBottom: '1px solid var(--color-border-soft)' }}><IdleBox compact iso={np?.updated_at} latest={latest} onSync={onSync} syncing={syncing} reconnect={reconnect} onSwitched={() => { void sync() }} /></div>}

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

function NowPlayingBanner({ np, state, sync, syncing, latest, onOpenLyrics, moment, paused, tier, likedState, reconnect, note, playPause, seek, skip, toggleLiked, setMode }: NpShared) {
  const [idleNote, setIdleNote] = useState<string | null>(null)
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
              {!live && latest?.spotify_track_id && isLoggedIn() && (
                <ResumeLastButton latest={latest} onStarted={() => { void sync() }} onNote={setIdleNote} />
              )}
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
                      <Transport moment={moment} paused={paused} tier={tier} playPause={playPause} seek={seek} note={note} showExtendedControls likedState={likedState} skip={skip} toggleLiked={toggleLiked} setMode={setMode} />
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
          <Transport moment={moment} paused={paused} tier={tier} playPause={playPause} seek={seek} note={note} showExtendedControls likedState={likedState} skip={skip} toggleLiked={toggleLiked} setMode={setMode} />
        </div>
      )}
      {idleNote && !live && <div className="mono" style={{ padding: '0 16px 10px', fontSize: 10.5, letterSpacing: '.03em', color: 'var(--color-faded)' }}>{idleNote}</div>}
      {live && moment?.deviceName != null && <DeviceHintLine name={moment.deviceName} onSwitched={() => { void sync() }} />}
      {/* Idle: no active device exists, so this is the only place the member can
          hand playback to this browser deliberately (see DeviceHintLine's note). */}
      {!live && isLoggedIn() && <DeviceHintLine name={null} onSwitched={() => { void sync() }} />}
      {reconnect && tier === 'fallback' && <ReconnectLine />}
      {live && moment && tier === 'fallback' && !reconnect && <WhyNoControlsLine />}
    </div>
  )
}

export function NowPlaying({ variant, onOpenLyrics }: { variant: NpStyle, onOpenLyrics?: OnOpenLyrics }) {
  // Data lives here, above the variant switch: toggling 배너/플레이어/리스트
  // remounts the variant component but must NOT re-fire the snapshot GET +
  // one-shot live Spotify read (they used to run per variant mount) — and the
  // capability tier / pause freeze / transport anchor survive the toggle too.
  const { np, state, sync, syncing, moment, paused, tier, likedState, reconnect, note, playPause, seek, skip, toggleLiked, setMode } = useNowPlaying()
  const latest = useLatestPlayed(state === 'ready' && !liveSnapshot(np))
  const shared: NpShared = { np, state, sync, syncing, latest, onOpenLyrics, moment, paused, tier, likedState, reconnect, note, playPause, seek, skip, toggleLiked, setMode }
  if (variant === 'list')
    return <NowPlayingList {...shared} />
  if (variant === 'banner')
    return <NowPlayingBanner {...shared} />
  return <NowPlayingFull {...shared} />
}
