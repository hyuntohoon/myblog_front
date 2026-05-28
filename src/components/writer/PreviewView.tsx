import type { AlbumDetail } from './types'

interface State {
  subject: AlbumDetail | null
  score: number
  headline: string
  dek: string
  body: string
  publishDate: string
}

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let buf = ''
  let i = 0
  while (i < text.length) {
    if (text.slice(i, i + 2) === '**') {
      if (buf) {
        parts.push(buf)
        buf = ''
      }
      const end = text.indexOf('**', i + 2)
      if (end > -1) {
        parts.push(<strong key={i}>{text.slice(i + 2, end)}</strong>)
        i = end + 2
      }
      else {
        buf += text[i]
        i++
      }
    }
    else if (text[i] === '*') {
      if (buf) {
        parts.push(buf)
        buf = ''
      }
      const end = text.indexOf('*', i + 1)
      if (end > -1) {
        parts.push(<em key={i}>{text.slice(i + 1, end)}</em>)
        i = end + 1
      }
      else {
        buf += text[i]
        i++
      }
    }
    else {
      buf += text[i]
      i++
    }
  }
  if (buf)
    parts.push(buf)
  return parts
}

export default function PreviewView({ s }: { s: State }) {
  const stars = Math.round(s.score)
  const paragraphs = s.body.split(/\n{2,}/).filter(Boolean)
  const artistName = s.subject?.artists.map(a => a.name).join(', ') ?? ''

  return (
    <article className="preview-article">
      <div className="prev-kicker">
        <span style={{ color: 'var(--accent)' }}>
          리뷰 ·
          {' '}
          앨범
        </span>
        <span>·</span>
        <span>{s.publishDate}</span>
      </div>
      <h1 className="prev-headline">{s.headline || '제목 없음'}</h1>
      {s.dek && <p className="prev-dek"><em>{s.dek}</em></p>}
      {s.subject && (
        <div className="prev-subject">
          <div className="prev-cover">
            {s.subject.cover_url ?
              <img src={s.subject.cover_url} alt={s.subject.title} /> :
              <span className="cover-fallback">{s.subject.title[0]}</span>}
          </div>
          <div className="prev-subj-body">
            <div className="prev-subj-by">{artistName}</div>
            <div className="prev-subj-name"><em>{s.subject.title}</em></div>
            {s.score > 0 && (
              <div className="prev-score-row">
                <span className="prev-stars">
                  {'★'.repeat(stars)}
                  {'☆'.repeat(5 - stars)}
                </span>
                <span className="prev-num">{s.score.toFixed(1)}</span>
                <span className="prev-denom">/ 5</span>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="prev-body">
        {paragraphs.length === 0 ?
          <p className="prev-empty">본문이 비어 있습니다.</p> :
          paragraphs.map((p, idx) => {
              if (p.startsWith('> '))
                return <blockquote key={idx} className="prev-quote">{renderInline(p.slice(2))}</blockquote>
              return <p key={idx}>{renderInline(p)}</p>
            })}
      </div>
    </article>
  )
}
