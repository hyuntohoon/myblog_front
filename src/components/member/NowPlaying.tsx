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
import { readLivePlayback } from './lyrics/playback.api'
import type { LivePlayback } from './lyrics/playback.api'
import { getNowPlayingData, listRecentlyListened, listRecentTracks } from './spotify.api'
import type { NowPlaying as NowPlayingData, RecentlyListenedItem, RecentTrackItem } from './spotify.api'
import { Cover, Equalizer } from './ui'

export interface LyricsOpenTarget { trackId: string, progressMs: number | null }
export type OnOpenLyrics = (t: LyricsOpenTarget) => void

export type NpStyle = 'banner' | 'full' | 'list'

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
  return <span className="lf-mono" style={{ fontSize: 11, color: 'var(--color-faded)' }}>{`동기화 ${s}`}</span>
}

/**
 * Sync note + the 「동기화」 button (FEAT-nowplaying-live-sync). The button
 * re-fires the one-shot live read; double-fire is guarded in the hook.
 */
function SyncControl({ iso, onSync, syncing }: { iso?: string | null, onSync?: () => void, syncing?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <SyncNote iso={iso} />
      {onSync && (
        <button
	type="button"
	className="lf-btn lf-mono"
	onClick={onSync}
	disabled={syncing}
	aria-label="지금 재생 상태 동기화"
	style={{ padding: '3px 8px', fontSize: 10.5, letterSpacing: '.06em', borderRadius: 3, whiteSpace: 'nowrap', flex: '0 0 auto' }}
        >
          {syncing ? '…' : '동기화'}
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

/**
 * Shared fetch — the worker-fed snapshot, overlaid by a one-shot live read.
 * Snapshot and live read fire in parallel on mount; a decisive live result
 * (`playing`/`idle`) wins regardless of arrival order, `unavailable` silently
 * keeps the snapshot. `sync()` re-fires the live read (동기화 button); the
 * busyRef guard makes it single-flight.
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
        onOpen({ trackId: r.trackId, progressMs: r.progressMs })
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
    return <span className="lf-mono" style={{ fontSize: 10.5, color: 'var(--color-faded)', letterSpacing: '.04em' }}>재생 중 아님</span>
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {state === 'failed' && <span className="lf-mono" style={{ fontSize: 10.5, color: 'var(--color-faded)', letterSpacing: '.04em' }}>확인 실패</span>}
      <button
	type="button"
	className="lf-btn lf-mono"
	onClick={() => {
          void click()
        }}
	disabled={state === 'busy'}
	aria-label="현재 재생 중인 곡 가사 보기"
	style={{ padding: '4px 10px', fontSize: 10.5, letterSpacing: '.06em', borderRadius: 3, whiteSpace: 'nowrap', flex: '0 0 auto' }}
      >
        {state === 'busy' ? '…' : '가사'}
      </button>
    </span>
  )
}

/* ── idle / loading shells ─────────────────────────────────────────────────── */

function IdleBox({ compact = false, iso, latest, onSync, syncing }: { compact?: boolean, iso?: string | null, latest?: RecentTrackItem | null, onSync?: () => void, syncing?: boolean }) {
  return (
    <div className="lf-panel" style={{ padding: compact ? 16 : 22, display: 'flex', alignItems: 'center', gap: 14 }}>
      <Equalizer playing={false} h={14} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="lf-kicker" style={{ color: 'var(--color-faded)', marginBottom: 4 }}>{latest ? '최근 재생' : 'NOW PLAYING'}</div>
        {latest ?
          (
              <>
                <div className="lf-serif lf-italic" style={{ fontSize: compact ? 16 : 18, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{latest.track_name}</div>
                <div className="lf-sans" style={{ fontSize: 12, color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{latest.artist_name}</div>
              </>
            ) :
          <div className="lf-serif lf-italic" style={{ fontSize: compact ? 16 : 18, color: 'var(--color-subtle)' }}>재생 중 아님</div>}
      </div>
      <SyncControl iso={iso} onSync={onSync} syncing={syncing} />
    </div>
  )
}

/* ── full variant ──────────────────────────────────────────────────────────── */

function NowPlayingFull({ onOpenLyrics }: { onOpenLyrics?: OnOpenLyrics }) {
  const { np, state, sync, syncing } = useNowPlaying()
  const onSync = () => {
    void sync()
  }
  const idle = state === 'ready' && !liveSnapshot(np)
  const latest = useLatestPlayed(idle)
  if (state === 'loading')
    return <div className="lf-panel" style={{ padding: 18 }}><span className="lf-meta">불러오는 중…</span></div>
  if (!np || !np.is_playing || !np.track)
    return <IdleBox iso={np?.updated_at} latest={latest} onSync={onSync} syncing={syncing} />
  return (
    <div className="lf-panel" style={{ padding: 18, display: 'flex', gap: 18, alignItems: 'center' }}>
      <NpCover url={np.album_cover_url} label={np.album ?? np.track ?? '?'} size={88} radius={4} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Equalizer playing h={12} />
          <span className="lf-kicker" style={{ color: 'var(--color-accent)' }}>NOW PLAYING</span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            {onOpenLyrics && <LyricsEntry onOpen={onOpenLyrics} />}
            <SyncControl iso={np.updated_at} onSync={onSync} syncing={syncing} />
          </span>
        </div>
        <div className="lf-serif lf-italic" style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-.01em', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{np.track}</div>
        <div className="lf-sans" style={{ fontSize: 12.5, color: 'var(--color-subtle)', marginTop: 3 }}>
          {[np.artist, np.album].filter(Boolean).join(' — ')}
        </div>
      </div>
    </div>
  )
}

/* ── list variant (now-playing + recently-listened albums) ───────────────────── */

function NowPlayingList({ onOpenLyrics }: { onOpenLyrics?: OnOpenLyrics }) {
  const { np, state, sync, syncing } = useNowPlaying()
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
  const latest = useLatestPlayed(state === 'ready' && !live)
  return (
    <div className="lf-panel" style={{ overflow: 'hidden' }}>
      {state === 'loading' ?
        <div style={{ padding: 16 }}><span className="lf-meta">불러오는 중…</span></div> :
        live ?
          (
              <div style={{ padding: 16, display: 'flex', gap: 14, alignItems: 'center', borderBottom: '1px solid var(--color-border-soft)' }}>
                <NpCover url={live.album_cover_url} label={live.album ?? live.track ?? '?'} size={50} radius={3} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="lf-kicker" style={{ color: 'var(--color-accent)', marginBottom: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
                    ● 재생 중
                    <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      {onOpenLyrics && <LyricsEntry onOpen={onOpenLyrics} />}
                      <SyncControl iso={live.updated_at} onSync={onSync} syncing={syncing} />
                    </span>
                  </div>
                  <div className="lf-serif lf-italic" style={{ fontSize: 17, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{live.track}</div>
                  <div className="lf-sans" style={{ fontSize: 12, color: 'var(--color-subtle)' }}>{live.artist}</div>
                </div>
                <Equalizer playing h={16} />
              </div>
            ) :
          <div style={{ borderBottom: '1px solid var(--color-border-soft)' }}><IdleBox compact iso={np?.updated_at} latest={latest} onSync={onSync} syncing={syncing} /></div>}

      <div style={{ padding: '10px 8px 8px' }}>
        <div className="lf-meta" style={{ padding: '0 8px 8px' }}>최근 들은 앨범</div>
        {recent == null && <div className="lf-meta" style={{ padding: '4px 8px' }}>불러오는 중…</div>}
        {recent != null && recent.length === 0 && <div className="lf-meta" style={{ padding: '4px 8px' }}>기록이 없습니다</div>}
        {(recent ?? []).slice(0, 6).map((it, i) => (
          <div key={it.album_id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px', borderTop: i ? '1px solid var(--color-border-soft)' : 'none' }}>
            <NpCover url={it.album?.cover_url} label={it.album?.title ?? '?'} size={32} radius={2} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="lf-serif" style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.album?.title}</div>
              <div className="lf-sans" style={{ fontSize: 11.5, color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(it.album?.artist_names ?? []).join(', ')}</div>
            </div>
            <span className="lf-mono" style={{ fontSize: 10.5, color: 'var(--color-faded)', letterSpacing: '.04em' }}>{fmtSince(it.last_played_at)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── banner variant (overview default) ───────────────────────────────────────── */

function NowPlayingBanner({ onOpenLyrics }: { onOpenLyrics?: OnOpenLyrics }) {
  const { np, state, sync, syncing } = useNowPlaying()
  const onSync = () => {
    void sync()
  }
  const live = liveSnapshot(np)
  const latest = useLatestPlayed(state === 'ready' && !live)
  if (state === 'loading') {
    return (
      <div className="lf-panel" style={{ padding: 24, borderTop: '2px solid var(--color-text)', borderBottom: '2px solid var(--color-text)', borderLeft: 0, borderRight: 0, borderRadius: 0 }}>
        <span className="lf-meta">불러오는 중…</span>
      </div>
    )
  }
  return (
    <div className="lf-panel" style={{ padding: 0, overflow: 'hidden', borderTop: '2px solid var(--color-text)', borderBottom: '2px solid var(--color-text)', borderLeft: '0', borderRight: '0', borderRadius: 0, background: 'var(--color-bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, padding: 24 }}>
        <NpCover url={live ? live.album_cover_url : (latest?.album?.cover_url ?? null)} label={(live ? live.album ?? live.track : latest ? latest.album_name ?? latest.track_name : '—') ?? '—'} size={116} radius={4} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="lf-kicker" style={{ marginBottom: 8, display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ color: live ? 'var(--color-accent)' : latest ? 'var(--color-text)' : 'var(--color-faded)' }}>{live || !latest ? 'NOW PLAYING' : '최근 재생'}</span>
            <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              {live && onOpenLyrics && <LyricsEntry onOpen={onOpenLyrics} />}
              <SyncControl iso={np?.updated_at} onSync={onSync} syncing={syncing} />
            </span>
          </div>

          {live ?
            (
                <>
                  <div className="lf-serif lf-italic" style={{ fontSize: 'clamp(26px,3.4vw,38px)', fontWeight: 500, letterSpacing: '-.02em', lineHeight: 1, marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{live.track}</div>
                  <div className="lf-sans" style={{ fontSize: 13.5, color: 'var(--color-subtle)', marginBottom: 18 }}>
                    {[live.artist, live.album].filter(Boolean).join(' — ')}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 30, marginBottom: 14 }}>
                    {Array.from({ length: 32 }).map((_, i) => (
                      <span
	key={i}
	style={{
                          flex: 1,
                          transformOrigin: 'bottom',
                          height: '100%',
                          background: i / 32 > 0.82 ? 'var(--color-accent)' : 'var(--color-text)',
                          opacity: i / 32 > 0.82 ? 1 : 0.65 - (i / 32) * 0.25,
                          animation: `lf-eq ${0.5 + (i % 5) * 0.16}s ease-in-out ${i * 0.035}s infinite`,
                        }}
                      />
                    ))}
                  </div>
                </>
              ) :
            latest ?
              (
                  <>
                    <div className="lf-serif lf-italic" style={{ fontSize: 'clamp(26px,3.4vw,38px)', fontWeight: 500, letterSpacing: '-.02em', lineHeight: 1, marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{latest.track_name}</div>
                    <div className="lf-sans" style={{ fontSize: 13.5, color: 'var(--color-subtle)', marginBottom: 18 }}>
                      {[latest.artist_name, latest.album_name].filter(Boolean).join(' — ')}
                    </div>
                  </>
                ) :
              (
                  <div className="lf-serif lf-italic" style={{ fontSize: 'clamp(22px,3vw,30px)', fontWeight: 500, color: 'var(--color-subtle)', lineHeight: 1.1, padding: '6px 0 4px' }}>
                    재생 중 아님
                  </div>
                )}
        </div>
      </div>
    </div>
  )
}

export function NowPlaying({ variant, onOpenLyrics }: { variant: NpStyle, onOpenLyrics?: OnOpenLyrics }) {
  if (variant === 'list')
    return <NowPlayingList onOpenLyrics={onOpenLyrics} />
  if (variant === 'banner')
    return <NowPlayingBanner onOpenLyrics={onOpenLyrics} />
  return <NowPlayingFull onOpenLyrics={onOpenLyrics} />
}
