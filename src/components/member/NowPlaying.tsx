// Member dashboard — Now Playing (FEAT-member-dashboard Step 3, D5/D26).
//
// A READ-ONLY display of a worker-fed cache snapshot (GET /api/library/now-playing),
// not a player: we hold only user-read scopes (no playback control, D11), and the
// data can be up to ~1h stale (hourly cron + manual refresh). So: no play/pause,
// no live-ticking seek — just the snapshot track + a static progress bar and an
// honest "동기화 …" line. When nothing is playing, a calm idle state. The decorative
// equalizer animates only while is_playing. Three variants (banner/full/list) share
// the same snapshot; the list variant pairs it with recently-listened albums.
import { useEffect, useState } from 'react'
import { getNowPlayingData, listRecentlyListened } from './spotify.api'
import type { NowPlaying as NowPlayingData, RecentlyListenedItem } from './spotify.api'
import { Cover, Equalizer } from './ui'

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

/** Shared fetch — one snapshot, loading/error tracked. */
function useNowPlaying() {
  const [np, setNp] = useState<NowPlayingData | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => {
    let on = true
    getNowPlayingData()
      .then(d => on && (setNp(d), setState('ready')))
      .catch(() => on && setState('error'))
    return () => {
      on = false
    }
  }, [])
  return { np, state }
}

/**
 * The snapshot when something is actually playing, else null (present-but-idle
 *  snapshots still expose updated_at for the sync note).
 */
function liveSnapshot(np: NowPlayingData | null): NowPlayingData | null {
  return np && np.is_playing === true && np.track ? np : null
}

/* ── idle / loading shells ─────────────────────────────────────────────────── */

function IdleBox({ compact = false, iso }: { compact?: boolean, iso?: string | null }) {
  return (
    <div className="lf-panel" style={{ padding: compact ? 16 : 22, display: 'flex', alignItems: 'center', gap: 14 }}>
      <Equalizer playing={false} h={14} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="lf-kicker" style={{ color: 'var(--color-faded)', marginBottom: 4 }}>NOW PLAYING</div>
        <div className="lf-serif lf-italic" style={{ fontSize: compact ? 16 : 18, color: 'var(--color-subtle)' }}>지금 재생 중인 곡이 없습니다</div>
      </div>
      <SyncNote iso={iso} />
    </div>
  )
}

/* ── full variant ──────────────────────────────────────────────────────────── */

function NowPlayingFull() {
  const { np, state } = useNowPlaying()
  if (state === 'loading')
    return <div className="lf-panel" style={{ padding: 18 }}><span className="lf-meta">불러오는 중…</span></div>
  if (!np || !np.is_playing || !np.track)
    return <IdleBox iso={np?.updated_at} />
  return (
    <div className="lf-panel" style={{ padding: 18, display: 'flex', gap: 18, alignItems: 'center' }}>
      <Cover label={np.album ?? np.track ?? '?'} size={88} radius={4} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Equalizer playing h={12} />
          <span className="lf-kicker" style={{ color: 'var(--color-accent)' }}>NOW PLAYING</span>
          <span style={{ marginLeft: 'auto' }}><SyncNote iso={np.updated_at} /></span>
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

function NowPlayingList() {
  const { np, state } = useNowPlaying()
  const [recent, setRecent] = useState<RecentlyListenedItem[] | null>(null)
  useEffect(() => {
    let on = true
    listRecentlyListened().then(r => on && setRecent(r)).catch(() => on && setRecent([]))
    return () => {
      on = false
    }
  }, [])
  const live = liveSnapshot(np)
  return (
    <div className="lf-panel" style={{ overflow: 'hidden' }}>
      {state === 'loading' ?
        <div style={{ padding: 16 }}><span className="lf-meta">불러오는 중…</span></div> :
        live ?
          (
              <div style={{ padding: 16, display: 'flex', gap: 14, alignItems: 'center', borderBottom: '1px solid var(--color-border-soft)' }}>
                <Cover label={live.album ?? live.track ?? '?'} size={50} radius={3} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="lf-kicker" style={{ color: 'var(--color-accent)', marginBottom: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
                    ● 재생 중
                    <span style={{ marginLeft: 'auto' }}><SyncNote iso={live.updated_at} /></span>
                  </div>
                  <div className="lf-serif lf-italic" style={{ fontSize: 17, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{live.track}</div>
                  <div className="lf-sans" style={{ fontSize: 12, color: 'var(--color-subtle)' }}>{live.artist}</div>
                </div>
                <Equalizer playing h={16} />
              </div>
            ) :
          <div style={{ borderBottom: '1px solid var(--color-border-soft)' }}><IdleBox compact iso={np?.updated_at} /></div>}

      <div style={{ padding: '10px 8px 8px' }}>
        <div className="lf-meta" style={{ padding: '0 8px 8px' }}>최근 들은 앨범</div>
        {recent == null && <div className="lf-meta" style={{ padding: '4px 8px' }}>불러오는 중…</div>}
        {recent != null && recent.length === 0 && <div className="lf-meta" style={{ padding: '4px 8px' }}>기록이 없습니다</div>}
        {(recent ?? []).slice(0, 6).map((it, i) => (
          <div key={it.album_id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px', borderTop: i ? '1px solid var(--color-border-soft)' : 'none' }}>
            <Cover label={it.album?.title ?? '?'} size={32} radius={2} />
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

function NowPlayingBanner() {
  const { np, state } = useNowPlaying()
  const live = liveSnapshot(np)
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
        <Cover label={(live ? live.album ?? live.track : '—') ?? '—'} size={116} radius={4} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="lf-kicker" style={{ marginBottom: 8, display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ color: live ? 'var(--color-accent)' : 'var(--color-faded)' }}>NOW PLAYING</span>
            <span style={{ marginLeft: 'auto' }}><SyncNote iso={np?.updated_at} /></span>
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
            (
                <div className="lf-serif lf-italic" style={{ fontSize: 'clamp(22px,3vw,30px)', fontWeight: 500, color: 'var(--color-subtle)', lineHeight: 1.1, padding: '6px 0 4px' }}>
                  지금 재생 중인 곡이 없습니다
                </div>
              )}
        </div>
      </div>
    </div>
  )
}

export function NowPlaying({ variant }: { variant: NpStyle }) {
  if (variant === 'list')
    return <NowPlayingList />
  if (variant === 'banner')
    return <NowPlayingBanner />
  return <NowPlayingFull />
}
