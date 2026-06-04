// Member dashboard — album detail slide-over.
//
// Two bodies share one slide-over shell:
//   - RealBody  (DetailTarget.real): real cover + metadata from a backed surface
//     (e.g. 최근 들은 앨범). No fabricated tracklist/tags, no "샘플" badge.
//   - SampleBody: the original sample slide-over — tracklist/tags/length are SAMPLE
//     (deterministic from the title), shown with a "샘플" badge. Still used by every
//     surface the backend can't supply yet. Ported from albumdetail.jsx.
import type { DetailTarget } from '@lib/member'
import { useEffect } from 'react'
import { albumDetail } from '@lib/member'
import { AlbumArt, Cover, SampleBadge, ScoreNum, Stars } from './ui'

export function AlbumDetail({ album, onClose }: { album: DetailTarget, onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape')
        onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="lf-scrim" onClick={onClose} role="presentation">
      <aside className="lf-slideover" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="앨범 상세">
        <button type="button" className="lf-iconbtn" onClick={onClose} aria-label="닫기" style={{ position: 'absolute', top: 16, right: 16, width: 30, height: 30, borderColor: 'var(--color-border-soft)' }}>✕</button>
        {album.real ? <RealBody album={album} /> : <SampleBody album={album} />}
      </aside>
    </div>
  )
}

/**
 * Real-album panel: real cover + metadata, no "샘플" badge. Spotify gives us no
 * tracklist here and there is no album page to deep-link, so this stays an honest
 * metadata card rather than fabricating tracks/tags/length.
 */
function RealBody({ album }: { album: DetailTarget }) {
  return (
    <>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ width: 116, flex: '0 0 auto' }}>
          <AlbumArt url={album.cover} label={album.album} size={116} />
        </div>
        <div style={{ minWidth: 0, flex: 1, paddingTop: 2 }}>
          <div className="lf-kicker" style={{ marginBottom: 5 }}>앨범</div>
          <h2 className="lf-serif lf-italic" style={{ fontSize: 24, fontWeight: 500, lineHeight: 1.15, margin: 0 }}>{album.album}</h2>
          {album.artist && <div className="lf-sans" style={{ fontSize: 13, color: 'var(--color-subtle)', marginTop: 6 }}>{album.artist}</div>}
        </div>
      </div>

      <div style={{ marginTop: 24, paddingTop: 22, borderTop: '1px solid var(--color-border-soft)' }}>
        <div className="lf-meta" style={{ marginBottom: 8 }}>발매 정보</div>
        <div className="lf-sans" style={{ fontSize: 13.5, color: 'var(--color-subtle)', lineHeight: 1.7 }}>
          {album.year ? `${album.year}년 발매` : '발매 연도 정보 없음'}
        </div>
      </div>
    </>
  )
}

/** Original sample slide-over (tracklist/tags/length are sample data). */
function SampleBody({ album }: { album: DetailTarget }) {
  const d = albumDetail(album)
  const rated = album.rating != null
  return (
    <>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <Cover label={album.album} size={116} radius={4} />
        <div style={{ minWidth: 0, flex: 1, paddingTop: 2 }}>
          <div className="lf-kicker" style={{ marginBottom: 5, display: 'flex', gap: 8, alignItems: 'center' }}>
{album.track ? '트랙' : '앨범'}
{' '}
<SampleBadge />
          </div>
          <h2 className="lf-serif lf-italic" style={{ fontSize: 24, fontWeight: 500, lineHeight: 1.15, margin: 0 }}>{album.track || album.album}</h2>
          {album.track && (
<div className="lf-serif" style={{ fontSize: 14, color: 'var(--color-subtle)', marginTop: 2 }}>
수록:
{album.album}
</div>
)}
          {album.artist && <div className="lf-sans" style={{ fontSize: 13, color: 'var(--color-subtle)', marginTop: 6 }}>{album.artist}</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 12 }}>
            {d.tags.map(t => <span key={t} className="lf-mono" style={{ fontSize: 9.5, letterSpacing: '.06em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 999, border: '1px solid var(--color-border)', color: 'var(--color-subtle)' }}>{t}</span>)}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '22px 0', padding: '16px 0', borderTop: '1px solid var(--color-border-soft)', borderBottom: '1px solid var(--color-border-soft)' }}>
        {rated ?
          (
<>
<Stars score={album.rating ?? null} size={20} />
<ScoreNum score={album.rating ?? null} size={16} />
</>
) :
          <span className="lf-unrated">미평가</span>}
        <span className="lf-meta" style={{ marginLeft: 'auto' }}>{d.length}</span>
      </div>

      <button type="button" className="lf-btn lf-btn-solid" style={{ width: '100%' }}>{rated ? '평론 다시 보기' : '평론 작성'}</button>

      <div style={{ marginTop: 26 }}>
        <div className="lf-meta" style={{ marginBottom: 8 }}>발매 정보</div>
        <div className="lf-sans" style={{ fontSize: 13.5, color: 'var(--color-subtle)', lineHeight: 1.7 }}>
          {album.artist || '—'}
<br />
{album.genre || '—'}
{' '}
·
{album.year || '—'}
{' '}
·
{d.label}
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <div className="lf-meta" style={{ marginBottom: 10 }}>트랙리스트</div>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {d.tracks.map(t => (
            <li key={t.no} style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--color-border-soft)' }}>
              <span className="lf-mono" style={{ fontSize: 11, color: 'var(--color-faded)', width: 22, textAlign: 'right', flex: '0 0 auto' }}>{t.no}</span>
              <span className="lf-serif" style={{ fontSize: 15, flex: 1, color: t.title === album.track ? 'var(--color-accent)' : 'var(--color-text)' }}>{t.title}</span>
              <span className="lf-mono" style={{ fontSize: 11, color: 'var(--color-faded)' }}>{t.len}</span>
            </li>
          ))}
        </ol>
      </div>
    </>
  )
}
