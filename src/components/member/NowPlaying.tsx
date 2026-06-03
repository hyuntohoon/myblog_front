// Member dashboard — Now Playing variants. SAMPLE data (hard rule #9 forbids a
// synchronous Spotify call on a user-facing surface; a worker-fed cache is a
// later RFC step). Ported from nowplaying.jsx.
import { useEffect, useState } from 'react'
import { getNowPlaying, getRecentTracks } from '@lib/member'
import { Cover, Equalizer, fmtTime, Progress, SampleBadge } from './ui'

export type NpStyle = 'banner' | 'full' | 'list'

function usePlayhead(duration: number, start: number) {
  const [elapsed, setElapsed] = useState(start)
  const [playing, setPlaying] = useState(true)
  useEffect(() => {
    if (!playing)
      return
    const id = setInterval(() => setElapsed(e => (e >= duration ? 0 : e + 1)), 1000)
    return () => clearInterval(id)
  }, [playing, duration])
  return { elapsed, setElapsed, playing, setPlaying, pct: (elapsed / duration) * 100 }
}

function PlayBtn({ playing, onClick, size = 46 }: { playing: boolean, onClick: () => void, size?: number }) {
  return (
    <button
	type="button"
	onClick={onClick}
	aria-label={playing ? '일시정지' : '재생'}
	style={{ width: size, height: size, borderRadius: '50%', border: '1px solid var(--color-text)', background: 'var(--color-text)', color: 'var(--color-bg)', display: 'grid', placeItems: 'center', flex: '0 0 auto', transition: 'opacity .14s, transform .12s' }}
    >
      {playing ?
(
        <svg width={size * 0.36} height={size * 0.36} viewBox="0 0 24 24" fill="currentColor">
<rect x="5" y="4" width="5" height="16" rx="1" />
<rect x="14" y="4" width="5" height="16" rx="1" />
        </svg>
      ) :
        <svg width={size * 0.4} height={size * 0.4} viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z" /></svg>}
    </button>
  )
}

function NowPlayingFull() {
  const np = getNowPlaying()
  const { elapsed, setElapsed, playing, setPlaying } = usePlayhead(np.duration, np.elapsed)
  return (
    <div className="lf-panel" style={{ padding: 18, display: 'flex', gap: 18, alignItems: 'center' }}>
      <Cover label={np.album} size={88} radius={4} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Equalizer playing={playing} h={12} />
          <span className="lf-kicker" style={{ color: 'var(--color-accent)' }}>NOW PLAYING</span>
          <SampleBadge />
        </div>
        <div className="lf-serif lf-italic" style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-.01em', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{np.track}</div>
        <div className="lf-sans" style={{ fontSize: 12.5, color: 'var(--color-subtle)', marginTop: 3, marginBottom: 14 }}>
{np.artist}
{' '}
—
{' '}
{np.album}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="lf-mono" style={{ fontSize: 11, color: 'var(--color-faded)', width: 30 }}>{fmtTime(elapsed)}</span>
          <input type="range" min={0} max={np.duration} value={elapsed} onChange={e => setElapsed(+e.target.value)} style={{ flex: 1, accentColor: 'var(--color-accent)' }} />
          <span className="lf-mono" style={{ fontSize: 11, color: 'var(--color-faded)', width: 30, textAlign: 'right' }}>{fmtTime(np.duration)}</span>
        </div>
      </div>
      <PlayBtn playing={playing} onClick={() => setPlaying(p => !p)} size={50} />
    </div>
  )
}

function NowPlayingList() {
  const np = getNowPlaying()
  const recent = getRecentTracks()
  const { playing, setPlaying } = usePlayhead(np.duration, np.elapsed)
  return (
    <div className="lf-panel" style={{ overflow: 'hidden' }}>
      <div style={{ padding: 16, display: 'flex', gap: 14, alignItems: 'center', borderBottom: '1px solid var(--color-border-soft)' }}>
        <Cover label={np.album} size={50} radius={3} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="lf-kicker" style={{ color: 'var(--color-accent)', marginBottom: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
● 재생 중
<SampleBadge />
          </div>
          <div className="lf-serif lf-italic" style={{ fontSize: 17, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{np.track}</div>
          <div className="lf-sans" style={{ fontSize: 12, color: 'var(--color-subtle)' }}>{np.artist}</div>
        </div>
        <Equalizer playing={playing} h={16} />
        <PlayBtn playing={playing} onClick={() => setPlaying(p => !p)} size={38} />
      </div>
      <div style={{ padding: '10px 8px 8px' }}>
        <div className="lf-meta" style={{ padding: '0 8px 8px' }}>최근 재생</div>
        {recent.map((r, i) => (
          <div key={r.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px', borderTop: i ? '1px solid var(--color-border-soft)' : 'none' }}>
            <Cover label={r.album} size={32} radius={2} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="lf-serif" style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.track}</div>
              <div className="lf-sans" style={{ fontSize: 11.5, color: 'var(--color-subtle)' }}>{r.artist}</div>
            </div>
            <span className="lf-mono" style={{ fontSize: 10.5, color: 'var(--color-faded)', letterSpacing: '.04em' }}>{r.when}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function NowPlayingBanner() {
  const np = getNowPlaying()
  const { elapsed, playing, setPlaying, pct } = usePlayhead(np.duration, np.elapsed)
  return (
    <div className="lf-panel" style={{ padding: 0, overflow: 'hidden', borderTop: '2px solid var(--color-text)', borderBottom: '2px solid var(--color-text)', borderLeft: '0', borderRight: '0', borderRadius: 0, background: 'var(--color-bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, padding: 24 }}>
        <Cover label={np.album} size={116} radius={4} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="lf-kicker" style={{ marginBottom: 8, display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ color: 'var(--color-accent)' }}>NOW PLAYING</span>
            <span style={{ color: 'var(--color-faded)' }}>
·
{np.device}
            </span>
            <SampleBadge />
          </div>
          <div className="lf-serif lf-italic" style={{ fontSize: 'clamp(26px,3.4vw,38px)', fontWeight: 500, letterSpacing: '-.02em', lineHeight: 1, marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{np.track}</div>
          <div className="lf-sans" style={{ fontSize: 13.5, color: 'var(--color-subtle)', marginBottom: 18 }}>
{np.artist}
{' '}
—
{' '}
{np.album}
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
                  animation: playing ? `lf-eq ${0.5 + (i % 5) * 0.16}s ease-in-out ${i * 0.035}s infinite` : 'none',
                  transform: playing ? undefined : 'scaleY(0.15)',
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <PlayBtn playing={playing} onClick={() => setPlaying(p => !p)} size={42} />
            <span className="lf-mono" style={{ fontSize: 12, color: 'var(--color-subtle)' }}>
{fmtTime(elapsed)}
{' '}
/
{' '}
{fmtTime(np.duration)}
            </span>
            <div style={{ flex: 1 }}><Progress pct={pct} accent /></div>
          </div>
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
