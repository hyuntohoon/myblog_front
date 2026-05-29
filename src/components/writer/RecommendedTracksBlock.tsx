import { useCallback } from 'react'
import type { AlbumDetail, RecommendedTrack } from './types'
import { RECOMMENDED_TRACK_LIMIT } from './types'

interface Props {
  subject: AlbumDetail | null
  value: RecommendedTrack[]
  onChange: (next: RecommendedTrack[]) => void
}

export default function RecommendedTracksBlock({ subject, value, onChange }: Props) {
  const selectedIds = new Set(value.map(rt => rt.track_id))

  const toggle = useCallback(
    (trackId: string) => {
      if (!subject)
        return
      if (selectedIds.has(trackId)) {
        const next = value
          .filter(rt => rt.track_id !== trackId)
          .map((rt, i) => ({ ...rt, position: i }))
        onChange(next)
        return
      }
      if (value.length >= RECOMMENDED_TRACK_LIMIT)
        return
      onChange([
        ...value,
        { album_id: subject.id, track_id: trackId, position: value.length },
      ])
    },
    [subject, value, selectedIds, onChange],
  )

  const updateNote = useCallback(
    (trackId: string, note: string) => {
      const next = value.map(rt => rt.track_id === trackId ?
        { ...rt, note: note.length > 0 ? note : undefined } :
        rt)
      onChange(next)
    },
    [value, onChange],
  )

  if (!subject)
    return null

  const tracks = subject.tracks ?? []

  if (tracks.length === 0) {
    return (
      <section className="recommended-tracks-block">
        <h3 className="block-heading">추천 트랙</h3>
        <p className="muted">이 앨범의 트랙 정보가 아직 동기화되지 않았습니다.</p>
      </section>
    )
  }

  return (
    <section className="recommended-tracks-block">
      <header className="block-heading-row">
        <h3 className="block-heading">추천 트랙</h3>
        <span className="muted">
          {value.length}
          /
          {RECOMMENDED_TRACK_LIMIT}
          {' '}
          (선택 순서 = 표시 순서)
        </span>
      </header>
      <ol className="rt-track-list">
        {tracks.map((t) => {
          const picked = value.find(rt => rt.track_id === t.id)
          const isSelected = !!picked
          const atLimit = !isSelected && value.length >= RECOMMENDED_TRACK_LIMIT
          return (
            <li key={t.id} className={`rt-track-row${isSelected ? ' is-selected' : ''}`}>
              <label className="rt-track-label">
                <input
	type="checkbox"
	checked={isSelected}
	disabled={atLimit}
	onChange={() => toggle(t.id)}
                />
                <span className="rt-track-no">{t.track_no ?? '—'}</span>
                <span className="rt-track-title">{t.title}</span>
                {isSelected && (
                  <span className="rt-track-position">
                    #
                    {(picked!.position ?? 0) + 1}
                  </span>
                )}
              </label>
              {isSelected && (
                <textarea
	className="rt-track-note"
	rows={2}
	placeholder="짧은 코멘트 (선택)"
	value={picked!.note ?? ''}
	onChange={e => updateNote(t.id, e.target.value)}
                />
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
