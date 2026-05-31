import {  useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { allGenres,  selectFeatured } from '@lib/reviews'
import type { ReviewCard } from '@lib/reviews'

/**
 * /reviews interactive island (RFC FEAT-reviews-redesign, Steps 2–3).
 *
 * Fed a JSON-safe, date-desc `reviews` array serialized by reviews/index.astro.
 * Owns genre / sort / load-more state (Step 2). All filter state is mirrored to
 * the URL querystring (pushState + popstate) so deep-links and the back button
 * restore the view. Featured row hides once a genre filter is active.
 */

type SortKey = 'date' | 'score' | 'artist'

interface Filters {
  genre: string
  sort: SortKey
}

const PAGE = 9
const STEP = 6
const DEFAULTS: Filters = { genre: 'all', sort: 'date' }

function parseFilters(): Filters {
  if (typeof window === 'undefined')
return DEFAULTS
  const p = new URLSearchParams(window.location.search)
  const sort = p.get('sort')
  return {
    genre: p.get('genre') ?? 'all',
    sort: sort === 'score' || sort === 'artist' ? sort : 'date',
  }
}

function buildQuery(f: Filters): string {
  const p = new URLSearchParams()
  if (f.genre !== 'all')
p.set('genre', f.genre)
  if (f.sort !== 'date')
p.set('sort', f.sort)
  return p.toString()
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function Stars({ value, size }: { value: number | null, size: number }) {
  if (value == null)
return <span className="rev-unrated">미평가</span>
  const style = {
    '--rev-star-size': `${size}px`,
    '--rev-star-pct': `${(value / 5) * 100}%`,
  } as CSSProperties
  return (
    <span className="rev-stars" role="img" aria-label={`별점 ${value} / 5`} style={style}>
      <span className="rev-stars-bg" aria-hidden="true">★★★★★</span>
      <span className="rev-stars-fg" aria-hidden="true">★★★★★</span>
    </span>
  )
}

function Cover({ r, badge, ph }: { r: ReviewCard, badge: 'full' | 'mini' | null, ph: number }) {
  return (
    <div className="rev-cover">
      {r.bestNew && badge != null && (
        <span className="rev-badge">{badge === 'mini' ? 'BNM' : 'Best New'}</span>
      )}
      {r.cover != null ?
        <img src={r.cover} alt={r.album} className="rev-cover-img" loading="lazy" /> :
        (
            <span className="rev-placeholder" style={{ fontSize: ph }}>
              {r.album.slice(0, 2).toUpperCase()}
            </span>
          )}
    </div>
  )
}

export default function ReviewsIndex({ reviews }: { reviews: ReviewCard[] }) {
  const [filters, setFilters] = useState<Filters>(parseFilters)
  const [visible, setVisible] = useState(PAGE)

  useEffect(() => {
    const onPop = () => {
      setFilters(parseFilters())
      setVisible(PAGE)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function applyFilters(next: Filters) {
    setFilters(next)
    setVisible(PAGE)
    const qs = buildQuery(next)
    window.history.pushState(null, '', qs ? `?${qs}` : window.location.pathname)
  }

  const genres = useMemo(() => allGenres(reviews), [reviews])

  const filtered = useMemo(() => {
    const { genre, sort } = filters
    const list = genre === 'all' ? reviews : reviews.filter(r => r.genres.includes(genre))
    const sorted = [...list]
    if (sort === 'score')
      sorted.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1))
    else if (sort === 'artist')
      sorted.sort((a, b) => a.artist.localeCompare(b.artist, 'ko') || a.album.localeCompare(b.album, 'ko'))
    else
      sorted.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    return sorted
  }, [reviews, filters])

  const showFeatured = filters.genre === 'all'
  const featured = useMemo(
    () => (showFeatured ? selectFeatured(reviews) : []),
    [reviews, showFeatured],
  )
  const lead = featured[0]
  const sides = featured.slice(1, 3)
  const shown = filtered.slice(0, visible)

  return (
    <>
      {lead != null && (
        <section className="rev-featured" aria-label="주요 리뷰">
          <a href={`/blog/${lead.slug}`} className="rev-lead">
            <Cover r={lead} badge="full" ph={64} />
            <div className="rev-lead-body">
              <p className="rev-meta">
                {lead.genres[0]}
                {' · '}
                {fmtDate(lead.date)}
              </p>
              {lead.artist && <p className="rev-artist">{lead.artist}</p>}
              <h2 className="rev-lead-album">{lead.album}</h2>
              {lead.excerpt && <p className="rev-excerpt">{lead.excerpt}</p>}
              <div className="rev-foot">
                <Stars value={lead.rating} size={26} />
              </div>
            </div>
          </a>

          {sides.length > 0 && (
            <div className="rev-side">
              {sides.map(r => (
                <a key={r.slug} href={`/blog/${r.slug}`} className="rev-side-card">
                  <Cover r={r} badge="mini" ph={24} />
                  <div className="rev-side-body">
                    <p className="rev-meta">
                      {r.genres[0]}
                      {' · '}
                      {fmtDate(r.date)}
                    </p>
                    <h3 className="rev-side-album">{r.album}</h3>
                    <Stars value={r.rating} size={14} />
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="rev-controls">
        <div className="rev-controls-left">
          <h2 className="rev-controls-title">{showFeatured ? '최신 리뷰' : filters.genre}</h2>
          <span className="rev-count">
            {filtered.length}
            편
          </span>
        </div>
        <div className="rev-controls-right">
          <div className="rev-chips" role="group" aria-label="장르 필터">
            <button
	type="button"
	className={`rev-chip${filters.genre === 'all' ? ' is-active' : ''}`}
	onClick={() => applyFilters({ ...filters, genre: 'all' })}
            >
              전체
            </button>
            {genres.map(g => (
              <button
	key={g}
	type="button"
	className={`rev-chip${filters.genre === g ? ' is-active' : ''}`}
	onClick={() => applyFilters({ ...filters, genre: g })}
              >
                {g}
              </button>
            ))}
          </div>
          <select
	className="rev-field"
	aria-label="정렬"
	value={filters.sort}
	onChange={e => applyFilters({ ...filters, sort: e.target.value as SortKey })}
          >
            <option value="date">최신순</option>
            <option value="score">평점순</option>
            <option value="artist">가나다순</option>
          </select>
        </div>
      </div>

      <ul className="rev-grid">
        {shown.map(r => (
          <li key={r.slug}>
            <a href={`/blog/${r.slug}`} className="rev-card">
              <Cover r={r} badge="full" ph={34} />
              <div className="rev-card-body">
                <p className="rev-meta">
                  {r.genres[0]}
                  {' · '}
                  {fmtDate(r.date)}
                </p>
                {r.artist && <p className="rev-artist">{r.artist}</p>}
                <h3 className="rev-card-album">{r.album}</h3>
                {r.excerpt && <p className="rev-excerpt">{r.excerpt}</p>}
                <div className="rev-foot">
                  <Stars value={r.rating} size={16} />
                </div>
              </div>
            </a>
          </li>
        ))}
      </ul>

      {filtered.length > visible && (
        <div className="rev-loadmore-wrap">
          <button
	type="button"
	className="rev-loadmore"
	onClick={() => setVisible(v => v + STEP)}
          >
            더 보기 (
            {filtered.length - visible}
            )
          </button>
        </div>
      )}
    </>
  )
}
