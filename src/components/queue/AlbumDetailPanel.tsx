// FEAT-review-bucket-board Step 4 — slide-over album detail. Reads the full
// album (artists + tracklist) from the music service. Informational only;
// inline review authoring lands in Step 5 (ReviewDrawer).
import { useEffect, useState } from 'react'
import type { BucketItem } from './api'

const MUSIC = import.meta.env.PUBLIC_API_URL as string

interface AlbumDetail {
  title: string
  cover_url: string | null
  release_date: string | null
  artists: Array<{ id: string, name: string }>
  tracks: Array<{ id: string, title: string, track_no: number | null }>
}

interface Props {
  item: BucketItem
  onClose: () => void
  onWriteReview: () => void
}

export default function AlbumDetailPanel({ item, onClose, onWriteReview }: Props) {
  const [detail, setDetail] = useState<AlbumDetail | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')

  useEffect(() => {
    let alive = true
    setState('loading')
    setDetail(null)
    void (async () => {
      try {
        const r = await fetch(`${MUSIC}/api/music/albums/${encodeURIComponent(item.album_id)}`)
        if (!r.ok)
          throw new Error(`HTTP ${r.status}`)
        const json = await r.json() as {
          album: { title: string, cover_url: string | null, release_date: string | null }
          artists?: Array<{ id: string, name: string }>
          tracks?: Array<{ id: string, title: string, track_no: number | null }>
        }
        if (!alive)
          return
        setDetail({
          title: json.album.title,
          cover_url: json.album.cover_url,
          release_date: json.album.release_date,
          artists: json.artists ?? [],
          tracks: json.tracks ?? [],
        })
        setState('ok')
      }
      catch {
        if (alive)
          setState('error')
      }
    })()
    return () => {
      alive = false
    }
  }, [item.album_id])

  const brief = item.album
  const title = detail?.title ?? brief.title
  const cover = detail?.cover_url ?? brief.cover_url ?? null
  const artistLine = detail?.artists.length ?
    detail.artists.map(a => a.name).join(', ') :
    (brief.artist_names?.join(', ') ?? null)
  const year = (detail?.release_date ?? brief.release_date)?.slice(0, 4) ?? null

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape')
        onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="qb-detail-scrim" onClick={onClose} role="presentation">
      <aside className="qb-detail" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="앨범 상세">
        <button type="button" className="qb-detail-close" onClick={onClose} aria-label="닫기">✕</button>

        <div className="qb-detail-hero">
          <div className="qb-detail-cover">
            {cover ?
              <img src={cover} alt={title} /> :
              <span className="qb-detail-cover-ph">{(title || '?').slice(0, 2).toUpperCase()}</span>}
          </div>
          <div className="qb-detail-heroinfo">
            <p className="qb-detail-kicker">앨범</p>
            <h2 className="qb-detail-title"><em>{title}</em></h2>
            {artistLine && <p className="qb-detail-artist">{artistLine}</p>}
            <div className="qb-detail-tags">
              {year && <span className="qb-chip">{year}</span>}
              {item.rec_reason && <span className="qb-chip qb-chip-rec">{item.rec_reason}</span>}
              {item.already_reviewed && <span className="qb-chip qb-chip-reviewed">이미 리뷰함</span>}
              {item.status === 'published' && <span className="qb-chip qb-chip-done">발행됨</span>}
            </div>
          </div>
        </div>

        <div className="qb-detail-actions">
          <button type="button" className="qb-detail-write" onClick={onWriteReview}>
            {item.status === 'published' ? '평론 다시 보기' : '평론 작성'}
          </button>
        </div>

        {item.note && (
          <div className="qb-detail-note">
            <p className="qb-detail-section-label">메모</p>
            <p>{item.note}</p>
          </div>
        )}

        <div className="qb-detail-tracks">
          <p className="qb-detail-section-label">트랙리스트</p>
          {state === 'loading' && <p className="qb-detail-muted">불러오는 중…</p>}
          {state === 'error' && <p className="qb-detail-muted">트랙 정보를 불러오지 못했습니다.</p>}
          {state === 'ok' && detail && detail.tracks.length === 0 && <p className="qb-detail-muted">트랙 정보가 없습니다.</p>}
          {state === 'ok' && detail && detail.tracks.length > 0 && (
            <ol className="qb-detail-tracklist">
              {detail.tracks.map((t, i) => (
                <li key={t.id} className="qb-detail-track">
                  <span className="qb-detail-trackno">{t.track_no ?? i + 1}</span>
                  <span className="qb-detail-trackname">{t.title}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>
    </div>
  )
}
