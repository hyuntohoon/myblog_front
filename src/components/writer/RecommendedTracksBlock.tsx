import { useCallback, useState } from 'react'
import type { AlbumDetail } from './types'

interface Props {
  subject: AlbumDetail | null
  value: string[]
  onChange: (next: string[]) => void
}

const pad = (n: number) => String(n).padStart(2, '0')

// Direction C — "추천 트랙" as a vertical, collapsible chart list. Each row
// is a ★/☆ toggle; picked tracks get highlighted in the published read page.
export default function RecommendedTracksBlock({ subject, value, onChange }: Props) {
  const [open, setOpen] = useState(true)
  const picked = new Set(value)

  const toggle = useCallback(
    (trackId: string) => {
      if (!subject)
        return
      if (picked.has(trackId))
        onChange(value.filter(id => id !== trackId))
      else
        onChange([...value, trackId])
    },
    [subject, value, picked, onChange],
  )

  if (!subject)
    return null

  const tracks = subject.tracks ?? []

  if (tracks.length === 0) {
    return (
      <section className="wr-picks">
        <div className="wr-picks-head wr-picks-head--static">
          <span className="lh">
            <span className="wr-seclabel">추천 트랙</span>
          </span>
        </div>
        <p className="wr-picks-empty mono">트랙 정보 없음</p>
      </section>
    )
  }

  return (
    <section className="wr-picks">
      <button type="button" className="wr-picks-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="lh">
          <span className="wr-picks-chev" data-open={open} aria-hidden>▸</span>
          <span className="wr-seclabel">추천 트랙</span>
          <span className="wr-picks-count">
            <b>{picked.size}</b>
            곡 추천
          </span>
        </span>
        <span className="wr-picks-hint mono">{open ? '접기' : '펼치기'}</span>
      </button>
      {open && (
        <div className="wr-plist">
          {tracks.map((t, i) => {
            const on = picked.has(t.id)
            return (
              <button
	key={t.id}
	type="button"
	className={`wr-prow${on ? ' on' : ''}`}
	aria-pressed={on}
	onClick={() => toggle(t.id)}
              >
                <span className="wr-prow-star" aria-hidden>{on ? '★' : '☆'}</span>
                <span className="wr-prow-no mono">{pad(t.track_no ?? i + 1)}</span>
                <span className="wr-prow-title">{t.title}</span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
