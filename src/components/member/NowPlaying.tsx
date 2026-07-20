// Member dashboard — Now Playing (FEAT-member-dashboard Step 3, D5/D26).
//
// The live overlay is a capability-tiered Spotify Connect remote: a successful
// `/me/player` probe enables play/pause + seek, while older grants fall back to
// progress-only display through `/currently-playing`. Control failures degrade
// the session by response semantics; no product/account metadata is consulted.
//
// FEAT-nowplaying-live-sync — the worker-fed cache snapshot
// (GET /api/library/now-playing, hourly cron, up to ~1h stale) is now only the
// fallback: on mount the card also fires ONE `readLivePlayback()` and lets the
// live moment win (playing/paused → live card, idle → idle branch even if the
// snapshot claimed playing; unavailable → snapshot as-is). A 「동기화」
// button re-fires the same one-shot read. Never polled.
//
// FEAT-lyrics-viewer Step 3 — the dynamic lyrics entry lives here, on the live
// branches only (active-playback-only; the idle/최근 재생 branches never get one —
// no recent-history fallback). The snapshot only gates VISIBILITY; the tap does a
// one-shot live playback read (token mint stays lazy, on the explicit action) and
// opens with the live `item.id` + position — the snapshot stores no track id. A
// tap that discovers playback has stopped hides the entry instead of opening.
import type { KeyboardEvent, PointerEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { isLoggedIn } from '@lib/auth'
import { openAlbum } from '@lib/entityEvents'
import { estimatedMs } from './lyrics/clockEstimate'
import type { ClockAnchor } from './lyrics/clockEstimate'
import { readLivePlayback } from './lyrics/playback.api'
import type { LivePlayback } from './lyrics/playback.api'
import { pauseRemote, resumeRemote, seekRemote } from './playerRemote'
import type { RemoteResult } from './playerRemote'
import { getNowPlayingData, listRecentlyListened, listRecentTracks } from './spotify.api'
import type { NowPlaying as NowPlayingData, RecentlyListenedItem, RecentTrackItem } from './spotify.api'
import { Cover, Equalizer } from './ui'

export interface LyricsOpenTarget { trackId: string, progressMs: number | null, progressAtMs: number | null, durationMs: number | null, albumCoverUrl: string | null, track: string | null, artist: string | null }
export type OnOpenLyrics = (t: LyricsOpenTarget) => void

export type NpStyle = 'banner' | 'full' | 'list'

interface LiveMoment {
	anchor: ClockAnchor | null
	durationMs: number | null
	paused: boolean
	source: 'player' | 'currently-playing'
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
 * (`playing`/`paused`/`idle`) wins regardless of arrival order, `unavailable`
 * keeps the snapshot. `sync()` re-fires the live read (동기화 button); the
 * busyRef guard makes it single-flight. Lives in the NowPlaying wrapper (not
 * the variants) so a banner↔full↔list toggle re-renders without re-firing the
 * snapshot GET + live Spotify read.
 */
function useNowPlaying() {
  const [np, setNp] = useState<NowPlayingData | null>(null)
  const [liveMoment, setLiveMoment] = useState<LiveMoment | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [syncing, setSyncing] = useState(false)
  const busyRef = useRef(false)
  const liveWonRef = useRef(false)
  const onRef = useRef(true)

  const applyLive = (r: LivePlayback) => {
    if (!onRef.current)
      return
    if (r.state === 'unavailable')
      return
    liveWonRef.current = true
    if (r.state === 'playing' || r.state === 'paused') {
      // RFC Step 4 contract: the one-shot live chain does not supply album_id yet.
      setNp({
        is_playing: true,
        track: r.track,
        artist: r.artist,
        album: r.album,
        album_cover_url: r.albumCoverUrl,
        updated_at: new Date().toISOString(),
      })
      setLiveMoment({
        anchor: r.progressMs != null ? { ms: r.progressMs, wallMs: r.readAtMs } : null,
        durationMs: r.durationMs,
        paused: r.state === 'paused',
        source: r.source,
      })
    }
    else {
      // Live says nothing is playing — force the idle branch even if the stale
      // snapshot claimed otherwise. Keep whatever fields are already there.
      setNp(prev => ({ ...(prev ?? {}), is_playing: false, updated_at: new Date().toISOString() }))
      setLiveMoment(null)
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
  return { np, state, sync, syncing, liveMoment, setLiveMoment, applyLive }
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
 * Advance a display-only clock from a one-shot Spotify anchor. The 500ms
 * interval performs no I/O: hidden documents stop rendering ticks, paused
 * anchors stay frozen, and reaching the known duration tears the clock down
 * without attempting an end-of-track refresh.
 */
function usePlayerClock(anchor: ClockAnchor | null, durationMs: number | null, paused: boolean): number | null {
	const [clock, setClock] = useState<number | null>(anchor?.ms ?? null)
	useEffect(() => {
		if (!anchor) {
			setClock(null)
			return
		}
		const cap = durationMs ?? Number.POSITIVE_INFINITY
		const clamp = (ms: number) => Math.max(0, Math.min(cap, ms))
		if (paused) {
			setClock(clamp(anchor.ms))
			return
		}

		let interval: number | null = null
		const tick = () => {
			if (document.hidden)
				return
			const next = clamp(estimatedMs(anchor))
			setClock(next)
			if (durationMs != null && next >= durationMs && interval != null) {
				window.clearInterval(interval)
				interval = null
			}
		}
		const onVisibility = () => {
			if (!document.hidden)
				tick()
		}
		tick()
		if (durationMs == null || estimatedMs(anchor) < durationMs)
			interval = window.setInterval(tick, 500)
		document.addEventListener('visibilitychange', onVisibility)
		return () => {
			if (interval != null)
				window.clearInterval(interval)
			document.removeEventListener('visibilitychange', onVisibility)
		}
	}, [anchor, durationMs, paused])
	if (!anchor)
		return null
	if (paused)
		return Math.max(0, Math.min(durationMs ?? Number.POSITIVE_INFINITY, anchor.ms))
	return clock
}

function fmtTime(ms: number): string {
	const seconds = Math.floor(Math.max(0, ms) / 1000)
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

interface SpectralStripProps {
	barCount: number
	height: number
	gap: number
	clock: number | null
	durationMs: number | null
	paused: boolean
	canSeek: boolean
	onSeek: (positionMs: number) => void
}

/**
 * Shared spectral playhead. Without both clock and duration it preserves the
 * legacy decorative animation exactly; only the full capability tier receives
 * slider semantics or pointer/keyboard handlers.
 */
function SpectralStrip({ barCount, height, gap, clock, durationMs, paused, canSeek, onSeek }: SpectralStripProps) {
	const timed = clock != null && durationMs != null && durationMs > 0
	const interactive = timed && canSeek
	const position = clock ?? 0
	const duration = durationMs ?? 0
	const frac = timed ? Math.max(0, Math.min(1, position / duration)) : null
	const seekAt = (clientX: number, el: HTMLDivElement) => {
		if (!interactive)
			return
		const rect = el.getBoundingClientRect()
		const x = Math.max(0, Math.min(rect.width, clientX - rect.left))
		onSeek((x / rect.width) * duration)
	}
	const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
		if (!interactive || e.button !== 0)
			return
		e.currentTarget.setPointerCapture(e.pointerId)
	}
	const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
		if (!interactive)
			return
		seekAt(e.clientX, e.currentTarget)
		if (e.currentTarget.hasPointerCapture(e.pointerId))
			e.currentTarget.releasePointerCapture(e.pointerId)
	}
	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		if (!interactive || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight'))
			return
		e.preventDefault()
		onSeek(Math.max(0, Math.min(duration, position + (e.key === 'ArrowLeft' ? -5000 : 5000))))
	}
	const style = { display: 'flex', alignItems: 'flex-end', gap, height, cursor: interactive ? 'pointer' : undefined, touchAction: interactive ? 'none' : undefined } as const
	const bars = Array.from({ length: barCount }).map((_, i) => {
		const played = frac == null || (i + 0.5) / barCount <= frac
		const legacyAccent = i / barCount > 0.82
		return (
			<span
				key={i}
				className={played ? 'lf-eq-bar' : undefined}
				style={{
					flex: 1,
					transformOrigin: 'bottom',
					height: '100%',
					background: played && legacyAccent ? 'var(--color-accent)' : 'var(--color-text)',
					opacity: played ? (legacyAccent ? 1 : 0.65 - (i / barCount) * 0.25) : 0.15,
					animationDuration: `${0.5 + (i % 5) * 0.16}s`,
					animationDelay: `${i * 0.035}s`,
					animationPlayState: frac != null && paused ? 'paused' : undefined,
				}}
			/>
		)
	})
	if (!interactive)
		return <div style={style}>{bars}</div>
	return (
		<div
			role="slider"
			aria-label="재생 위치"
			aria-valuemin={0}
			aria-valuemax={duration}
			aria-valuenow={Math.round(position)}
			tabIndex={0}
			onPointerDown={onPointerDown}
			onPointerUp={onPointerUp}
			onKeyDown={onKeyDown}
			style={style}
		>
			{bars}
		</div>
	)
}

type RemoteReason = Extract<RemoteResult, { ok: false }>['reason']

const NOTICE_MESSAGE = {
	'restricted': '이 Spotify 계정에서는 제어할 수 없어요 — 진행만 표시돼요',
	'no-device': '활성 Spotify 기기가 없어요 — 기기에서 재생을 시작한 뒤 ↻',
	'transient': '요청이 닿지 않았어요 — 다시 시도해 주세요',
} as const satisfies Record<RemoteReason, string>

function Transport({ clock, durationMs, paused, fullTier, busy, notice, source, buttonSize, onToggle }: {
	clock: number | null
	durationMs: number | null
	paused: boolean
	fullTier: boolean
	busy: boolean
	notice: RemoteReason | null
	source: LiveMoment['source'] | null
	buttonSize: number
	onToggle: () => void
}) {
	const timed = clock != null && durationMs != null
	if (!timed && !notice && source !== 'currently-playing')
		return null
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
			{timed && (
				<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
					{fullTier && (
						<button
							type="button"
							className="iconbtn mono"
							onClick={onToggle}
							disabled={busy}
							aria-label={paused ? '재생' : '일시정지'}
							title={paused ? '재생' : '일시정지'}
							style={{ width: buttonSize, height: buttonSize, fontSize: 12, lineHeight: 1, flex: '0 0 auto' }}
						>
							{paused ? '▶' : '⏸'}
						</button>
					)}
					<span className="mono" style={{ fontSize: 11, color: 'var(--color-faded)' }}>{fmtTime(clock)}</span>
					<span style={{ flex: 1 }} />
					<span className="mono" style={{ fontSize: 11, color: 'var(--color-faded)' }}>{fmtTime(durationMs)}</span>
				</div>
			)}
			{notice && <span className="mono" role="status" style={{ fontSize: 10.5, color: 'var(--color-faded)' }}>{NOTICE_MESSAGE[notice]}</span>}
			{source === 'currently-playing' && <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-faded)' }}>재연동하면 재생 컨트롤을 쓸 수 있어요 — 설정 · 연동 탭에서 다시 연결</span>}
		</div>
	)
}

/** The wrapper-owned data bundle every variant renders from. */
interface NpShared {
	np: NowPlayingData | null
	state: 'loading' | 'ready' | 'error'
	sync: () => Promise<void>
	syncing: boolean
	latest: RecentTrackItem | null
	onOpenLyrics?: OnOpenLyrics
	liveMoment: LiveMoment | null
	clock: number | null
	fullTier: boolean
	controlBusy: boolean
	notice: RemoteReason | null
	onToggle: () => void
	onSeek: (positionMs: number) => void
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

function NowPlayingFull({ np, state, sync, syncing, latest, onOpenLyrics, liveMoment, clock, fullTier, controlBusy, notice, onToggle, onSeek }: NpShared) {
	const narrow = useNarrow()
	const paused = liveMoment?.paused ?? false
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
					<Equalizer playing={!paused} h={12} />
					<span className="kicker" style={{ color: paused ? 'var(--color-faded)' : 'var(--color-accent)', whiteSpace: 'nowrap' }}>{paused ? '일시정지' : 'NOW PLAYING'}</span>
					<span style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 10, rowGap: 6, minWidth: 0 }}>
						{onOpenLyrics && <LyricsEntry onOpen={onOpenLyrics} />}
						<SyncControl iso={np.updated_at} onSync={onSync} syncing={syncing} />
					</span>
				</div>
				<div className="serif italic" style={{ fontSize: narrow ? 18 : 22, fontWeight: 500, letterSpacing: '-.01em', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{np.track}</div>
				<div className="sans" style={{ fontSize: 12.5, color: 'var(--color-subtle)', marginTop: 3, marginBottom: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
					{np.artist}
					{np.artist && np.album ? ' — ' : null}
					<AlbumTextLink id={np.album_id} title={np.album} artist={np.artist} cover={np.album_cover_url} />
				</div>
				<div style={{ marginBottom: 6 }}>
					<SpectralStrip barCount={24} height={16} gap={2} clock={clock} durationMs={liveMoment?.durationMs ?? null} paused={paused} canSeek={fullTier} onSeek={onSeek} />
				</div>
				<Transport clock={clock} durationMs={liveMoment?.durationMs ?? null} paused={paused} fullTier={fullTier} busy={controlBusy} notice={notice} source={liveMoment?.source ?? null} buttonSize={24} onToggle={onToggle} />
			</div>
		</div>
	)
}

/* ── list variant (now-playing + recently-listened albums) ───────────────────── */

function NowPlayingList({ np, state, sync, syncing, latest, onOpenLyrics, liveMoment, clock, fullTier, controlBusy, notice, onToggle }: NpShared) {
  const onSync = () => {
    void sync()
  }
	const paused = liveMoment?.paused ?? false
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
              <div style={{ position: 'relative', padding: 16, display: 'flex', gap: 14, alignItems: 'center', borderBottom: '1px solid var(--color-border-soft)' }}>
                <AlbumCoverLink id={live.album_id} title={live.album} artist={live.artist} cover={live.album_cover_url} label={live.album ?? live.track ?? '?'} size={50} radius={3} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="kicker" style={{ color: paused ? 'var(--color-faded)' : 'var(--color-accent)', marginBottom: 4, display: 'flex', flexWrap: 'wrap', gap: 8, rowGap: 4, alignItems: 'center' }}>
                    <span style={{ whiteSpace: 'nowrap' }}>{paused ? '❚❚ 일시정지' : '● 재생 중'}</span>
					{clock != null && liveMoment?.durationMs != null && <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-faded)', letterSpacing: 0 }}>{`${fmtTime(clock)} / ${fmtTime(liveMoment.durationMs)}`}</span>}
                    <span style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 8, rowGap: 4, minWidth: 0 }}>
                      {onOpenLyrics && <LyricsEntry onOpen={onOpenLyrics} />}
					{fullTier && (
						<button type="button" className="iconbtn mono" onClick={onToggle} disabled={controlBusy} aria-label={paused ? '재생' : '일시정지'} title={paused ? '재생' : '일시정지'} style={{ width: 22, height: 22, fontSize: 10, lineHeight: 1, flex: '0 0 auto' }}>
							{paused ? '▶' : '⏸'}
						</button>
					)}
                      <SyncControl iso={live.updated_at} onSync={onSync} syncing={syncing} />
                    </span>
                  </div>
                  <div className="serif italic" style={{ fontSize: 17, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{live.track}</div>
                  <div className="sans" style={{ fontSize: 12, color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{live.artist}</div>
						{notice && <div className="mono" role="status" style={{ marginTop: 3, fontSize: 10.5, color: 'var(--color-faded)' }}>{NOTICE_MESSAGE[notice]}</div>}
						{liveMoment?.source === 'currently-playing' && <div className="mono" style={{ marginTop: 3, fontSize: 10.5, color: 'var(--color-faded)' }}>재연동하면 재생 컨트롤을 쓸 수 있어요 — 설정 · 연동 탭에서 다시 연결</div>}
                </div>
				<Equalizer playing={!paused} h={16} />
				{clock != null && liveMoment?.durationMs != null && liveMoment.durationMs > 0 && (
					<div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: 'var(--color-border-soft)' }}>
						<span style={{ display: 'block', width: `${Math.max(0, Math.min(1, clock / liveMoment.durationMs)) * 100}%`, height: '100%', background: 'var(--color-accent)' }} />
					</div>
				)}
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

function NowPlayingBanner({ np, state, sync, syncing, latest, onOpenLyrics, liveMoment, clock, fullTier, controlBusy, notice, onToggle, onSeek }: NpShared) {
  const narrow = useNarrow()
	const paused = liveMoment?.paused ?? false
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
            <span style={{ whiteSpace: 'nowrap', color: paused ? 'var(--color-faded)' : live ? 'var(--color-accent)' : latest ? 'var(--color-text)' : 'var(--color-faded)' }}>{paused ? '일시정지' : live || !latest ? 'NOW PLAYING' : '최근 재생'}</span>
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
						<div style={{ marginBottom: narrow ? 8 : 14 }}>
					<SpectralStrip barCount={32} height={narrow ? 22 : 30} gap={3} clock={clock} durationMs={liveMoment?.durationMs ?? null} paused={paused} canSeek={fullTier} onSeek={onSeek} />
						</div>
						<Transport clock={clock} durationMs={liveMoment?.durationMs ?? null} paused={paused} fullTier={fullTier} busy={controlBusy} notice={notice} source={liveMoment?.source ?? null} buttonSize={26} onToggle={onToggle} />
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
	// Data and capability state live above the variant switch: changing the
	// presentation must neither re-read Spotify nor reset a session degradation.
	const { np, state, sync, syncing, liveMoment, setLiveMoment, applyLive } = useNowPlaying()
	const [loggedIn, setLoggedIn] = useState(false)
	const [degraded, setDegraded] = useState<'restricted' | 'no-device' | null>(null)
	const [notice, setNotice] = useState<RemoteReason | null>(null)
	const [controlBusy, setControlBusy] = useState(false)
	const noticeTimer = useRef<number | null>(null)
	const remoteBusy = useRef(false)
	const noDeviceAt = useRef(0)
	const clock = usePlayerClock(liveMoment?.anchor ?? null, liveMoment?.durationMs ?? null, liveMoment?.paused ?? false)

	useEffect(() => {
		setLoggedIn(isLoggedIn())
	}, [])
	useEffect(() => () => {
		if (noticeTimer.current != null)
			window.clearTimeout(noticeTimer.current)
	}, [])
	useEffect(() => {
		if (degraded === 'no-device' && liveMoment?.source === 'player' && liveMoment.anchor && liveMoment.anchor.wallMs > noDeviceAt.current)
			setDegraded(null)
	}, [degraded, liveMoment])

	const showNotice = (reason: RemoteReason) => {
		setNotice(reason)
		if (noticeTimer.current != null)
			window.clearTimeout(noticeTimer.current)
		noticeTimer.current = window.setTimeout(() => {
			setNotice(null)
			noticeTimer.current = null
		}, 5000)
	}
	const applyRemoteFailure = (reason: RemoteReason) => {
		showNotice(reason)
		if (reason === 'restricted') {
			setDegraded('restricted')
		}
		else if (reason === 'no-device') {
			noDeviceAt.current = performance.now()
			setDegraded(prev => prev === 'restricted' ? prev : 'no-device')
		}
	}
	const fullTier = liveMoment != null && liveMoment.source === 'player' && loggedIn && degraded == null

	const onToggle = async () => {
		if (!fullTier || !liveMoment || remoteBusy.current)
			return
		remoteBusy.current = true
		setControlBusy(true)
		const wasPaused = liveMoment.paused
		try {
			const result = wasPaused ? await resumeRemote() : await pauseRemote()
			if (!result.ok) {
				applyRemoteFailure(result.reason)
				return
			}
			setLiveMoment((prev) => {
				if (!prev)
					return prev
				const rawMs = prev.anchor ? (wasPaused ? prev.anchor.ms : estimatedMs(prev.anchor)) : clock
				const ms = rawMs == null ? null : Math.max(0, Math.min(prev.durationMs ?? Number.POSITIVE_INFINITY, rawMs))
				return {
					...prev,
					anchor: ms == null ? null : { ms, wallMs: performance.now() },
					paused: !wasPaused,
				}
			})
		}
		finally {
			remoteBusy.current = false
			setControlBusy(false)
		}
	}

	const onSeek = async (positionMs: number) => {
		if (!fullTier || !liveMoment || remoteBusy.current)
			return
		remoteBusy.current = true
		setControlBusy(true)
		const target = Math.max(0, Math.min(liveMoment.durationMs ?? Number.POSITIVE_INFINITY, Math.round(positionMs)))
		// Optimistic re-anchor for instant feedback; a failed PUT restores the
		// pre-seek anchor so the bar never keeps showing a position the device
		// never reached.
		const prevAnchor = liveMoment.anchor
		setLiveMoment(prev => prev ? { ...prev, anchor: { ms: target, wallMs: performance.now() } } : prev)
		try {
			const result = await seekRemote(target)
			if (!result.ok) {
				setLiveMoment(prev => prev ? { ...prev, anchor: prevAnchor } : prev)
				applyRemoteFailure(result.reason)
				return
			}
			// OQ2: one successful seek produces exactly one event-driven re-anchor
			// read. `applyLive` is the same path used by mount and ↻ synchronization.
			applyLive(await readLivePlayback())
		}
		finally {
			remoteBusy.current = false
			setControlBusy(false)
		}
	}

	const latest = useLatestPlayed(state === 'ready' && !liveSnapshot(np))
	const shared: NpShared = {
		np,
		state,
		sync,
		syncing,
		latest,
		onOpenLyrics,
		liveMoment,
		clock,
		fullTier,
		controlBusy,
		notice,
		onToggle: () => {
			void onToggle()
		},
		onSeek: (positionMs) => {
			void onSeek(positionMs)
		},
	}
	if (variant === 'list')
		return <NowPlayingList {...shared} />
	if (variant === 'banner')
		return <NowPlayingBanner {...shared} />
	return <NowPlayingFull {...shared} />
}
