import type { CSSProperties } from 'react'
import { AlbumCard } from '@components/shared/AlbumCard'
import DragRatingInput from './DragRatingInput'
import type { AlbumDetail } from './types'

interface Props {
  subject: AlbumDetail | null
  score: number
  onScoreChange: (score: number) => void
  subjectBestNew: boolean
  onSubjectBestNewChange: (next: boolean) => void
  onOpenSearch: () => void
}

type EditorialAlbumSubject = Omit<AlbumDetail, 'kind'> & { kind?: 'album' }

function isEditorialAlbumSubject(subject: AlbumDetail): subject is EditorialAlbumSubject {
  return subject.kind !== 'artist'
}

// Stable hue [0,360) derived from the subject identity. The design tints the
// hero from the album cover's dominant color; sampling a cross-origin S3 /
// Spotify image via canvas is CORS-fragile, so we hash the id/title instead —
// a deterministic, theme-adaptive pastel that never flickers between loads.
function hueFor(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++)
    h = (h * 31 + seed.charCodeAt(i)) % 360
  return h
}

function editorialControls({
  score,
  onScoreChange,
  onOpenSearch,
}: Pick<Props, 'score' | 'onScoreChange' | 'onOpenSearch'>) {
  return (
    <div className="wr-hero-controls">
      <DragRatingInput value={score} onChange={onScoreChange} max={5} size={30} />
      <button type="button" className="wr-btn ghost" onClick={onOpenSearch}>작품 변경 ↺</button>
    </div>
  )
}

/** Writer-owned adapter: editorial state stays outside the shared card. */
export function EditorialAlbumTargetAdapter({
  subject,
  score,
  onScoreChange,
  subjectBestNew,
  onSubjectBestNewChange,
  onOpenSearch,
}: Omit<Props, 'subject'> & { subject: EditorialAlbumSubject }) {
  const artist = subject.artists[0]
  const year = subject.release_date ? Number(subject.release_date.slice(0, 4)) || null : null

  return (
    <AlbumCard
	data={{
        catalogAlbumId: subject.id,
        spotifyAlbumId: null,
        title: subject.title,
        artist: artist?.name ?? null,
        artistId: artist?.id ?? null,
        cover: subject.cover_url,
        year,
      }}
	layout="row"
	titleAs="h1"
	capabilities={{
        open: {
          fire: onOpenSearch,
          label: `${subject.title} 작품 변경`,
        },
      }}
	eyebrow={(
        <span className="wr-hero-eyebrow">
          <button
	type="button"
	className={`wr-bnm-badge${subjectBestNew ? ' on' : ''}`}
	aria-pressed={subjectBestNew}
	onClick={() => onSubjectBestNewChange(!subjectBestNew)}
	title={subjectBestNew ? '베스트 신보 해제' : '베스트 신보로 표시'}
          >
            BEST NEW MUSIC
          </button>
          <span className="wr-hero-kicker mono">리뷰 · 앨범</span>
        </span>
      )}
	secondaryLine={editorialControls({ score, onScoreChange, onOpenSearch })}
    />
  )
}

/** Empty and artist subjects intentionally remain outside the album-card contract. */
function NonAlbumSubjectHero({
  subject,
  score,
  onScoreChange,
  onOpenSearch,
}: Pick<Props, 'subject' | 'score' | 'onScoreChange' | 'onOpenSearch'>) {
  if (!subject) {
    return (
      <section className="wr-hero-empty-wrap">
        <button type="button" className="wr-hero-empty" onClick={onOpenSearch}>
          <span className="wr-hero-empty-ico serif">⌕</span>
          <span className="wr-hero-empty-title serif">작품 선택</span>
          <span className="wr-hero-empty-sub mono">
            앨범 · 아티스트 · 트랙 검색
            <kbd>⌘K</kbd>
          </span>
        </button>
      </section>
    )
  }

  const hue = hueFor(subject.id || subject.title)
  const coverColor = `oklch(0.68 0.105 ${hue})`
  const heroStyle = {
    '--wr-hero-cover-color': coverColor,
    '--wr-hero-glow': `oklch(0.72 0.13 ${hue})`,
  } as CSSProperties
  return (
    <section className="wr-hero" style={heroStyle}>
      <div className="wr-hero-glow" aria-hidden />
      <div className="wr-hero-inner">
        <div className="wr-hero-cover">
          {subject.cover_url ?
            <img src={subject.cover_url} alt={subject.title} /> :
            <span className="wr-hero-cover-fallback serif">{(subject.title || '?')[0]}</span>}
        </div>
        <div className="wr-hero-meta">
          <span className="wr-hero-kicker mono">리뷰 · 아티스트</span>
          <h1 className="wr-hero-title serif">{subject.title}</h1>
          <div className="wr-hero-controls">
            <DragRatingInput value={score} onChange={onScoreChange} max={5} size={30} />
            <button type="button" className="wr-btn ghost" onClick={onOpenSearch}>작품 변경 ↺</button>
          </div>
        </div>
      </div>
    </section>
  )
}

export default function SubjectHero(props: Props) {
  const { subject } = props
  if (!subject || !isEditorialAlbumSubject(subject))
    return <NonAlbumSubjectHero {...props} />

  const hue = hueFor(subject.id || subject.title)
  const heroStyle = {
    '--wr-hero-cover-color': `oklch(0.68 0.105 ${hue})`,
    '--wr-hero-glow': `oklch(0.72 0.13 ${hue})`,
  } as CSSProperties

  return (
    <section className="wr-hero" style={heroStyle}>
      <div className="wr-hero-glow" aria-hidden />
      <div className="wr-hero-inner">
        <EditorialAlbumTargetAdapter {...props} subject={subject} />
      </div>
    </section>
  )
}
