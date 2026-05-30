import { useCallback } from 'react'
import type { AlbumDetail } from './types'

interface Props {
  subject: AlbumDetail | null
  value: string[]
  onChange: (next: string[]) => void
}

export default function RecommendedTracksBlock({ subject, value, onChange }: Props) {
  const picked = new Set(value)

  const toggle = useCallback(
    (trackId: string) => {
      if (!subject)
        return
      if (picked.has(trackId)) {
        onChange(value.filter(id => id !== trackId))
      }
      else {
        onChange([...value, trackId])
      }
    },
    [subject, value, picked, onChange],
  )

  if (!subject)
    return null

  const tracks = subject.tracks ?? []

  if (tracks.length === 0) {
    return (
      <section className="recommended-tracks-block">
        <h3 className="block-heading">비평가의 픽</h3>
        <p className="muted">이 앨범의 트랙 정보가 아직 동기화되지 않았습니다.</p>
      </section>
    )
  }

  return (
    <section className="recommended-tracks-block">
      <header className="block-heading-row">
        <h3 className="block-heading">비평가의 픽</h3>
        <span className="muted">
          ★ 표시한 트랙은 글에서 강조 표시됩니다
        </span>
      </header>
      <ol className="rt-track-list">
        {tracks.map((t) => {
          const isSelected = picked.has(t.id)
          return (
            <li key={t.id} className={`rt-track-row${isSelected ? ' is-selected' : ''}`}>
              <label className="rt-track-label">
                <input
	type="checkbox"
	checked={isSelected}
	onChange={() => toggle(t.id)}
                />
                <span className="rt-track-no">{t.track_no ?? '—'}</span>
                <span className="rt-track-title">{t.title}</span>
                {isSelected && <span className="rt-track-pick" aria-hidden>★</span>}
              </label>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
