// Member dashboard — Now Playing (FEAT-member-dashboard Step 3, D5/D26).
//
// A READ-ONLY display, not a player: we hold only user-read scopes (no playback
// control, D11). So: no play/pause, no live-ticking seek — just the current track
// + an honest "동기화 …" line. When nothing is playing, a calm idle state. The
// decorative equalizer animates only while is_playing. Three variants
// (banner/full/list) share the same data; the list variant pairs it with
// recently-listened albums.
//
// FEAT-nowplaying-live-sync — the worker-fed cache snapshot
// (GET /api/library/now-playing, hourly cron, up to ~1h stale) is now only the
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
import { useEffect, useRef, useState } from 'react'
import { openAlbum } from '@lib/entityEvents'
import { readLivePlayback } from './lyrics/playback.api'
import type { LivePlayback } from './lyrics/playback.api'
import { getNowPlayingData, listRecentlyListened, listRecentTracks } from './spotify.api'
import type { NowPlaying as NowPlayingData, RecentlyListenedItem, RecentTrackItem } from './spotify.api'
import { Cover, Equalizer } from './ui'

export interface LyricsOpenTarget { trackId: string, progressMs: number | null, progressAtMs: number | null, durationMs: number | null, albumCoverUrl: string | null, track: string | null, artist: string | null }
export type OnOpenLyrics = (t: LyricsOpenTarget) => void

export type NpStyle = 'banner' | 'full' | 'list'

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
  const busyRef = useRef(false)
  const liveWonRef = useRef(false)
  const onRef = useRef(true)

  const applyLive = (r: LivePlayback) => {
    if (r.state === 'unavailable')
      return
    liveWonRef.current = true
    if (r.state === 'playing') {
      // RFC Step 4 contract: the one-shot live chain does not supply album_id yet.
      setNp({
        is_playing: true,
        track: r.track,
        artist: r.artist,
        album: r.album,
        album_cover_url: r.albumCoverUrl,
        updated_at: new Date().toISOString(),
      })
    }
    else {
      // Live says nothing is playing — force the idle branch even if the stale
      // snapshot claimed otherwise. Keep whatever fields are already there.
      setNp(prev => ({ ...(prev ?? {}), is_playing: false, updated_at: new Date().toISOString() }))
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
    return () => {
      onRef.current = false
    }
  }, [])
  return { np, state, sync, syncing }
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
        onOpen({ trackId: r.trackId, progressMs: r.progressMs, progressAtMs: r.readAtMs, durationMs: r.durationMs, albumCoverUrl: r.albumCoverUrl, track: r.track, artist: r.artist })
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

function IdleBox({ compact = false, iso, latest, onSync, syncing }: { compact?: boolean, iso?: string | null, latest?: RecentTrackItem | null, onSync?: () => void, syncing?: boolean }) {
  return (
    // minWidth 140 on the text cell forces the sync controls to wrap below it on
    // narrow screens instead of squeezing the track title to nothing.
    <div className="panel" style={{ padding: compact ? 16 : 22, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14, rowGap: 10 }}>
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
  )
}

/* ── full variant ──────────────────────────────────────────────────────────── */

function NowPlayingFull({ np, state, sync, syncing, latest, onOpenLyrics }: NpShared) {
  const narrow = useNarrow()
  const onSync = () => {
    void sync()
  }
  if (state === 'loading')
    return <div className="panel" style={{ padding: 18 }}><span className="meta">불러오는 중…</span></div>
  if (!np || !np.is_playing || !np.track)
    return <IdleBox iso={np?.updated_at} latest={latest} onSync={onSync} syncing={syncing} />
  return (
    <div className="panel" style={{ padding: narrow ? 14 : 18, display: 'flex', gap: narrow ? 14 : 18, alignItems: 'center' }}>
      <AlbumCoverLink id={np.album_id} title={np.album} artist={np.artist} cover={np.album_cover_url} label={np.album ?? np.track ?? '?'} size={narrow ? 64 : 88} radius={4} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, rowGap: 6, marginBottom: 6 }}>
          <Equalizer playing h={12} />
          <span className="kicker" style={{ color: 'var(--color-accent)', whiteSpace: 'nowrap' }}>NOW PLAYING</span>
          <span style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 10, rowGap: 6, minWidth: 0 }}>
            {onOpenLyrics && <LyricsEntry onOpen={onOpenLyrics} />}
            <SyncControl iso={np.updated_at} onSync={onSync} syncing={syncing} />
          </span>
        </div>
        <div className="serif italic" style={{ fontSize: narrow ? 18 : 22, fontWeight: 500, letterSpacing: '-.01em', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{np.track}</div>
        <div className="sans" style={{ fontSize: 12.5, color: 'var(--color-subtle)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {np.artist}
          {np.artist && np.album ? ' — ' : null}
          <AlbumTextLink id={np.album_id} title={np.album} artist={np.artist} cover={np.album_cover_url} />
        </div>
      </div>
    </div>
  )
}

/* ── list variant (now-playing + recently-listened albums) ───────────────────── */

function NowPlayingList({ np, state, sync, syncing, latest, onOpenLyrics }: NpShared) {
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
              <div style={{ padding: 16, display: 'flex', gap: 14, alignItems: 'center', borderBottom: '1px solid var(--color-border-soft)' }}>
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
                  <div className="sans" style={{ fontSize: 12, color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{live.artist}</div>
                </div>
                <Equalizer playing h={16} />
              </div>
            ) :
          <div style={{ borderBottom: '1px solid var(--color-border-soft)' }}><IdleBox compact iso={np?.updated_at} latest={latest} onSync={onSync} syncing={syncing} /></div>}

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
    </div>
  )
}

/* ── banner variant (overview default) ───────────────────────────────────────── */

function NowPlayingBanner({ np, state, sync, syncing, latest, onOpenLyrics }: NpShared) {
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
                    {live.artist}
                    {live.artist && live.album ? ' — ' : null}
                    <AlbumTextLink id={live.album_id} title={live.album} artist={live.artist} cover={live.album_cover_url} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: narrow ? 22 : 30, marginBottom: narrow ? 8 : 14 }}>
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
                        }}
                      />
                    ))}
                  </div>
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
    </div>
  )
}

export function NowPlaying({ variant, onOpenLyrics }: { variant: NpStyle, onOpenLyrics?: OnOpenLyrics }) {
  // Data lives here, above the variant switch: toggling 배너/플레이어/리스트
  // remounts the variant component but must NOT re-fire the snapshot GET +
  // one-shot live Spotify read (they used to run per variant mount).
  const { np, state, sync, syncing } = useNowPlaying()
  const latest = useLatestPlayed(state === 'ready' && !liveSnapshot(np))
  const shared: NpShared = { np, state, sync, syncing, latest, onOpenLyrics }
  if (variant === 'list')
    return <NowPlayingList {...shared} />
  if (variant === 'banner')
    return <NowPlayingBanner {...shared} />
  return <NowPlayingFull {...shared} />
}
