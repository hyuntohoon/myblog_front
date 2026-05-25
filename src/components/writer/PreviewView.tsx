import type { AlbumDetail } from './types'

interface Props {
  subject: AlbumDetail | null
  score: number
  bestNew: boolean
  headline: string
  dek: string
  body: string
  author: string
  authorRole: string
  publishDate: string
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderBody(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => {
      para = para.trim()
      if (!para)
        return ''
      const isQuote = para.startsWith('> ')
      const content = escapeHtml(isQuote ? para.slice(2) : para)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/_(.+?)_/g, '<em>$1</em>')
      return isQuote ? `<blockquote>${content}</blockquote>` : `<p>${content}</p>`
    })
    .join('')
}

export default function PreviewView({
  subject,
score,
bestNew,
headline,
dek,
body,
author,
authorRole,
publishDate,
}: Props) {
  const artistName = subject?.artists.map(a => a.name).join(', ') ?? ''
  const year = subject?.release_date?.slice(0, 4) ?? ''
  const dateLabel = publishDate ?
    new Date(publishDate).toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }) :
    ''
  const full = Math.floor(score)
  const half = score % 1 >= 0.5

  return (
    <article className="wr-preview-article">
      {bestNew && <span className="wr-prev-bnm">Best New Music</span>}

      {subject && (
        <div className="wr-prev-subject">
          <div className="wr-prev-cover">
            {subject.cover_url ?
              <img src={subject.cover_url} alt={subject.title} /> :
              <span className="wr-cover-fallback">{subject.title[0]}</span>}
          </div>
          <div className="wr-prev-subj-body">
            <span className="wr-prev-subj-by">
{artistName}
{year ? ` · ${year}` : ''}
            </span>
            <span className="wr-prev-subj-name">{subject.title}</span>
            <div className="wr-prev-score-row">
              <span className="wr-prev-stars">
                {[1, 2, 3, 4, 5].map(i =>
                  i <= full ?
                    '★' :
                    i === full + 1 && half ?
                      '⯨' :
                      '☆',
                ).join('')}
              </span>
              <span className="wr-prev-num">{score.toFixed(1)}</span>
              <span className="wr-prev-denom">/5</span>
            </div>
          </div>
        </div>
      )}

      {headline && <h1 className="wr-prev-headline">{headline}</h1>}
      {dek && <p className="wr-prev-dek">{dek}</p>}

      {(author || dateLabel) && (
        <div className="wr-prev-byline">
          {author && (
            <span>
              By
              {' '}
              <strong>{author}</strong>
              {authorRole ? ` · ${authorRole}` : ''}
            </span>
          )}
          {dateLabel && <span>{dateLabel}</span>}
        </div>
      )}

      {body ?
        (
          <div
	className="wr-prev-body"
            // renderBody escapes all user-typed HTML before applying inline markdown transforms
	dangerouslySetInnerHTML={{ __html: renderBody(body) }}
          />
        ) :
        <p className="wr-prev-empty">미리볼 내용이 없습니다.</p>}
    </article>
  )
}
