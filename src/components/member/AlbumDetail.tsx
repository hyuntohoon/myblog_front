// Member dashboard — album detail slide-over.
//
// Two bodies share one slide-over shell:
//   - RealBody  (DetailTarget.real): real cover + metadata from a backed surface
//     (e.g. 최근 들은 앨범). No fabricated tracklist/tags, no "샘플" badge.
//   - SampleBody: the original sample slide-over — tracklist/tags/length are SAMPLE
//     (deterministic from the title), shown with a "샘플" badge. Still used by every
//     surface the backend can't supply yet. Ported from albumdetail.jsx.
import type { DetailTarget } from '@lib/member'
import { useEffect, useRef, useState } from 'react'
import { albumDetail } from '@lib/member'
import { useDismissable } from '@lib/useDismissable'
import { AlbumArt, Cover, fmtTime, SampleBadge, ScoreNum, Stars } from './ui'

// Shape of GET /api/music/albums/{id} (myblog_music AlbumDetail). Public DB-only
// read — no synchronous Spotify call. Defined locally: this music-service endpoint
// is not in the backend-derived api.gen.ts, and the front already calls it via
// plain fetch + PUBLIC_API_URL elsewhere (AddAlbumModal).
interface MusicTrack { id: string, title: string, track_no: number | null, duration_sec: number | null, feat_artist_names: string[] }
interface MusicArtist { id: string, name: string, photo_url: string | null, genres: string[], popularity: number | null }
interface MusicAlbumOut { id: string, title: string, release_date: string | null, cover_url: string | null, album_type: string | null, label: string | null }
interface AlbumDetailResp { album: MusicAlbumOut, artists: MusicArtist[], tracks: MusicTrack[] }

export function AlbumDetail({ album, onClose }: { album: DetailTarget, onClose: () => void }) {
  // ESC + focus trap + focus restore (mounted-when-open → open=true).
  const ref = useRef<HTMLElement>(null)
  useDismissable(true, onClose, ref)

  return (
    <div className="lf-scrim" onClick={onClose} role="presentation">
      <aside ref={ref} className="lf-slideover" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="앨범 상세">
        <button type="button" className="lf-iconbtn" onClick={onClose} aria-label="닫기" style={{ position: 'absolute', top: 16, right: 16, width: 30, height: 30, borderColor: 'var(--color-border-soft)' }}>✕</button>
        {album.real ? <RealBody album={album} /> : <SampleBody album={album} />}
      </aside>
    </div>
  )
}

/**
 * Real-album panel: real cover + metadata, no "샘플" badge. On open it fetches the
 * DB-only `GET /api/music/albums/{id}` (tracklist/label/per-artist genres the
 * worker already synced — no synchronous Spotify call) and renders a meta row,
 * an artist strip, and the full tracklist. On fetch failure / empty payload it
 * degrades to the minimal cover+title+artist+year card.
 */
function RealBody({ album }: { album: DetailTarget }) {
  const [data, setData] = useState<AlbumDetailResp | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')

  useEffect(() => {
    if (!album.albumId) {
      setState('error')
      return
    }
    let alive = true
    const base = import.meta.env.PUBLIC_API_URL as string
    fetch(`${base}/api/music/albums/${album.albumId}`)
      .then(r => (r.ok ? r.json() as Promise<AlbumDetailResp> : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json) => {
        if (!alive)
          return
        setData(json)
        setState('ok')
      })
      .catch(() => alive && setState('error'))
    return () => {
      alive = false
    }
  }, [album.albumId])

  const a = data?.album
  const metaParts: string[] = []
  if (a?.album_type)
    metaParts.push(a.album_type.toUpperCase())
  if (a?.release_date)
    metaParts.push(a.release_date)
  if (data?.tracks?.length)
    metaParts.push(`${data.tracks.length}곡`)
  if (a?.label)
    metaParts.push(a.label)

  return (
    <>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ width: 116, flex: '0 0 auto' }}>
          <AlbumArt url={a?.cover_url ?? album.cover} label={album.album} size={116} />
        </div>
        <div style={{ minWidth: 0, flex: 1, paddingTop: 2 }}>
          <div className="lf-kicker" style={{ marginBottom: 5 }}>앨범</div>
          <h2 className="lf-serif lf-italic" style={{ fontSize: 24, fontWeight: 500, lineHeight: 1.15, margin: 0 }}>{album.album}</h2>
          {album.artist && <div className="lf-sans" style={{ fontSize: 13, color: 'var(--color-subtle)', marginTop: 6 }}>{album.artist}</div>}
          {metaParts.length > 0 && (
            <div className="lf-mono" style={{ fontSize: 10.5, letterSpacing: '0.04em', color: 'var(--color-faded)', marginTop: 10, lineHeight: 1.5 }}>{metaParts.join(' · ')}</div>
          )}
        </div>
      </div>

      {state === 'loading' && (
        <div className="lf-meta" style={{ marginTop: 24, paddingTop: 22, borderTop: '1px solid var(--color-border-soft)' }}>상세 정보를 불러오는 중…</div>
      )}

      {state === 'error' && (
        <div style={{ marginTop: 24, paddingTop: 22, borderTop: '1px solid var(--color-border-soft)' }}>
          <div className="lf-meta" style={{ marginBottom: 8 }}>발매 정보</div>
          <div className="lf-sans" style={{ fontSize: 13.5, color: 'var(--color-subtle)', lineHeight: 1.7 }}>
            {album.year ? `${album.year}년 발매` : '발매 연도 정보 없음'}
          </div>
        </div>
      )}

      {state === 'ok' && data && (
        <>
          {data.artists.length > 0 && (
            <div style={{ marginTop: 24, paddingTop: 22, borderTop: '1px solid var(--color-border-soft)' }}>
              <div className="lf-meta" style={{ marginBottom: 12 }}>아티스트</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {data.artists.map(ar => (
                  <div key={ar.id} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div style={{ width: 40, flex: '0 0 auto' }}>
                      <AlbumArt url={ar.photo_url} label={ar.name} size={40} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="lf-serif" style={{ fontSize: 14, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ar.name}</div>
                      {ar.genres.length > 0 && (
                        <div className="lf-mono" style={{ fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-faded)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{ar.genres.join(' · ')}</div>
                      )}
                    </div>
                    {ar.popularity != null && (
                      <span className="lf-mono" style={{ fontSize: 10, color: 'var(--color-faded)', flex: '0 0 auto' }}>{`● ${ar.popularity}`}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.tracks.length > 0 ?
            (
                <div style={{ marginTop: 24, paddingTop: 22, borderTop: '1px solid var(--color-border-soft)' }}>
                  <div className="lf-meta" style={{ marginBottom: 10 }}>트랙리스트</div>
                  <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {data.tracks.map(t => (
                      <li key={t.id} style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--color-border-soft)' }}>
                        <span className="lf-mono" style={{ fontSize: 11, color: 'var(--color-faded)', width: 22, textAlign: 'right', flex: '0 0 auto' }}>{t.track_no ?? '·'}</span>
                        <span className="lf-serif" style={{ fontSize: 15, flex: 1, minWidth: 0 }}>
                          {t.title}
                          {t.feat_artist_names.length > 0 && (
                            <span className="lf-sans" style={{ fontSize: 11.5, color: 'var(--color-faded)' }}>{` feat. ${t.feat_artist_names.join(', ')}`}</span>
                          )}
                        </span>
                        {t.duration_sec != null && (
                          <span className="lf-mono" style={{ fontSize: 11, color: 'var(--color-faded)', flex: '0 0 auto' }}>{fmtTime(t.duration_sec)}</span>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              ) :
            (
                <div style={{ marginTop: 24, paddingTop: 22, borderTop: '1px solid var(--color-border-soft)' }}>
                  <div className="lf-meta" style={{ marginBottom: 8 }}>발매 정보</div>
                  <div className="lf-sans" style={{ fontSize: 13.5, color: 'var(--color-subtle)', lineHeight: 1.7 }}>
                    {album.year ? `${album.year}년 발매` : '발매 연도 정보 없음'}
                  </div>
                </div>
              )}
        </>
      )}
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
