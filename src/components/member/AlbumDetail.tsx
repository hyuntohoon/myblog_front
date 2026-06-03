// Member dashboard — album detail slide-over. Tracklist/tags are SAMPLE
// (deterministic from the title) until a real album-detail API is wired.
// Ported from albumdetail.jsx.
import type { DetailTarget } from '@lib/member'
import { useEffect } from 'react'
import { albumDetail } from '@lib/member'
import { Cover, SampleBadge, ScoreNum, Stars } from './ui'

export function AlbumDetail({ album, onClose }: { album: DetailTarget, onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape')
        onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const d = albumDetail(album)
  const rated = album.rating != null
  return (
    <div className="lf-scrim" onClick={onClose} role="presentation">
      <aside className="lf-slideover" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="앨범 상세">
        <button type="button" className="lf-iconbtn" onClick={onClose} aria-label="닫기" style={{ position: 'absolute', top: 16, right: 16, width: 30, height: 30, borderColor: 'var(--color-border-soft)' }}>✕</button>

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
      </aside>
    </div>
  )
}
