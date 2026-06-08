import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { allGenres, allTags, allYears, selectFeatured } from '@lib/reviews'
import type { ReviewCard } from '@lib/reviews'

/**
 * /reviews interactive island (RFC FEAT-reviews-redesign, Steps 2–3).
 *
 * Fed a JSON-safe, date-desc `reviews` array serialized by reviews/index.astro.
 * Owns genre / sort / search / BNM / year / view / load-more state. Every filter
 * (everything except the load-more cursor) is mirrored to the URL querystring
 * (pushState + popstate) so deep-links and the back button restore the view.
 * The featured row hides as soon as any narrowing filter is active.
 */

type SortKey = 'date' | 'score' | 'artist'
type ViewKey = 'grid' | 'list'

interface Filters {
  genre: string
  tag: string
  sort: SortKey
  q: string
  bnm: boolean
  year: string
  view: ViewKey
}

const PAGE = 9
const STEP = 6
const DEFAULTS: Filters = { genre: 'all', tag: 'all', sort: 'date', q: '', bnm: false, year: 'all', view: 'grid' }

function parseFilters(): Filters {
  if (typeof window === 'undefined')
    return DEFAULTS
  const p = new URLSearchParams(window.location.search)
  const sort = p.get('sort')
  const view = p.get('view')
  return {
    genre: p.get('genre') ?? 'all',
    tag: p.get('tag') ?? 'all',
    sort: sort === 'score' || sort === 'artist' ? sort : 'date',
    q: p.get('q') ?? '',
    bnm: p.get('bnm') === '1',
    year: p.get('year') ?? 'all',
    view: view === 'list' ? 'list' : 'grid',
  }
}

function buildQuery(f: Filters): string {
  const p = new URLSearchParams()
  if (f.genre !== 'all')
    p.set('genre', f.genre)
  if (f.tag !== 'all')
    p.set('tag', f.tag)
  if (f.sort !== 'date')
    p.set('sort', f.sort)
  if (f.q)
    p.set('q', f.q)
  if (f.bnm)
    p.set('bnm', '1')
  if (f.year !== 'all')
    p.set('year', f.year)
  if (f.view !== 'grid')
    p.set('view', f.view)
  return p.toString()
}

function isNarrowed(f: Filters): boolean {
  return f.genre !== 'all' || f.tag !== 'all' || f.q !== '' || f.bnm || f.year !== 'all'
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
        <img src={r.cover} alt={r.album} className="rev-cover-img" loading="lazy" decoding="async" /> :
        (
            <span className="rev-placeholder" style={{ fontSize: ph }}>
              {r.album.slice(0, 2).toUpperCase()}
            </span>
          )}
    </div>
  )
}

export default function ReviewsIndex({
  reviews,
  variant = 'default',
}: {
  reviews: ReviewCard[]
  /** 'editorial' = design C: oversized featured hero over a 3-col big-cover grid. */
  variant?: 'default' | 'editorial'
}) {
  const isEditorial = variant === 'editorial'
  const [filters, setFilters] = useState<Filters>(parseFilters)
  const [visible, setVisible] = useState(PAGE)

  const syncFromUrl = useCallback(() => {
    setFilters(parseFilters())
    setVisible(PAGE)
  }, [])

  useEffect(() => {
    window.addEventListener('popstate', syncFromUrl)
    return () => window.removeEventListener('popstate', syncFromUrl)
  }, [syncFromUrl])

  // Commit a filter change: update state, reset the load-more cursor, mirror to
  // the URL. `replace` (used for live search typing) avoids flooding history.
  function commit(next: Filters, replace = false) {
    setFilters(next)
    setVisible(PAGE)
    const qs = buildQuery(next)
    const url = qs ? `?${qs}` : window.location.pathname
    if (replace)
      window.history.replaceState(null, '', url)
    else
      window.history.pushState(null, '', url)
  }

  // View is a display preference, not a filter — don't reset the load-more cursor.
  function setView(view: ViewKey) {
    const next = { ...filters, view }
    setFilters(next)
    const qs = buildQuery(next)
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
  }

  const genres = useMemo(() => allGenres(reviews), [reviews])
  const tags = useMemo(() => allTags(reviews), [reviews])
  const years = useMemo(() => allYears(reviews), [reviews])

  const filtered = useMemo(() => {
    const { genre, tag, sort, q, bnm, year } = filters
    let list = reviews
    if (genre !== 'all')
      list = list.filter(r => r.genres.includes(genre))
    if (tag !== 'all')
      list = list.filter(r => r.tags.includes(tag))
    if (bnm)
      list = list.filter(r => r.bestNew)
    if (year !== 'all')
      list = list.filter(r => String(r.year) === year)
    if (q) {
      const needle = q.toLowerCase()
      list = list.filter(
        r => r.album.toLowerCase().includes(needle) || r.artist.toLowerCase().includes(needle),
      )
    }
    const sorted = [...list]
    if (sort === 'score')
      sorted.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1))
    else if (sort === 'artist')
      sorted.sort((a, b) => a.artist.localeCompare(b.artist, 'ko') || a.album.localeCompare(b.album, 'ko'))
    else
      sorted.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    return sorted
  }, [reviews, filters])

  const narrowed = isNarrowed(filters)
  const featured = useMemo(
    () => (narrowed ? [] : selectFeatured(reviews)),
    [reviews, narrowed],
  )
  const lead = featured[0]
  const sides = featured.slice(1, 3)
  // Editorial hero shows the lead on its own; drop it from the grid below so it
  // isn't rendered twice. Default variant keeps the lead in the grid (the small
  // featured row is a separate highlight that intentionally overlaps).
  const heroLead = isEditorial && !narrowed ? lead : undefined
  const gridSource = heroLead != null ? filtered.filter(r => r.slug !== heroLead.slug) : filtered
  const shown = gridSource.slice(0, visible)
  const title = filters.genre !== 'all' ? filters.genre : narrowed ? '검색 결과' : '최신 리뷰'

  return (
    <>
      {isEditorial && heroLead != null && (
        <section className="rev-c-hero" aria-label="주요 리뷰">
          <a href={`/blog/${heroLead.slug}`} className="rev-c-hero-cover" tabIndex={-1} aria-hidden="true">
            <Cover r={heroLead} badge={null} ph={80} />
          </a>
          <div className="rev-c-hero-body">
            {heroLead.bestNew && <span className="rev-c-hero-badge">Best New Album</span>}
            {heroLead.artist && <p className="rev-artist">{heroLead.artist}</p>}
            <a href={`/blog/${heroLead.slug}`} className="rev-c-hero-link">
              <h2 className="rev-c-hero-album">{heroLead.album}</h2>
            </a>
            {heroLead.excerpt && <p className="rev-c-hero-pull">{heroLead.excerpt}</p>}
            <div className="rev-c-hero-foot">
              <Stars value={heroLead.rating} size={30} />
              <span className="rev-c-hero-date">{fmtDate(heroLead.date)}</span>
            </div>
          </div>
        </section>
      )}

      {!isEditorial && lead != null && (
        <section className="rev-featured" aria-label="주요 리뷰">
          <a href={`/blog/${lead.slug}`} className="rev-lead">
            <Cover r={lead} badge="full" ph={64} />
            <div className="rev-lead-body">
              <p className="rev-meta">{`${lead.genres[0]} · ${fmtDate(lead.date)}`}</p>
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
                    <p className="rev-meta">{`${r.genres[0]} · ${fmtDate(r.date)}`}</p>
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
          <h2 className="rev-controls-title">{title}</h2>
          <span className="rev-count">{`${filtered.length}편`}</span>
        </div>
        <div className="rev-controls-right">
          <input
	type="search"
	className="rev-search"
	placeholder="검색"
	aria-label="앨범·아티스트 검색"
	value={filters.q}
	onChange={e => commit({ ...filters, q: e.target.value }, true)}
          />
          <select
	className="rev-field"
	aria-label="정렬"
	value={filters.sort}
	onChange={e => commit({ ...filters, sort: e.target.value as SortKey })}
          >
            <option value="date">최신순</option>
            <option value="score">평점순</option>
            <option value="artist">가나다순</option>
          </select>
          <select
	className="rev-field"
	aria-label="발매 연도"
	value={filters.year}
	onChange={e => commit({ ...filters, year: e.target.value })}
          >
            <option value="all">전체 연도</option>
            {years.map(y => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </select>
          <button
	type="button"
	className="rev-toggle"
	aria-pressed={filters.bnm}
	onClick={() => commit({ ...filters, bnm: !filters.bnm })}
          >
            BEST NEW만
          </button>
          <div className="rev-viewtoggle" role="group" aria-label="보기 방식">
            <button
	type="button"
	aria-pressed={filters.view === 'grid'}
	onClick={() => setView('grid')}
            >
              그리드
            </button>
            <button
	type="button"
	aria-pressed={filters.view === 'list'}
	onClick={() => setView('list')}
            >
              리스트
            </button>
          </div>
        </div>
      </div>

      <nav className="rev-chips" aria-label="장르 필터">
        <button
	type="button"
	className={`rev-chip${filters.genre === 'all' ? ' is-active' : ''}`}
	onClick={() => commit({ ...filters, genre: 'all' })}
        >
          전체
        </button>
        {genres.map(g => (
          <button
	key={g}
	type="button"
	className={`rev-chip${filters.genre === g ? ' is-active' : ''}`}
	onClick={() => commit({ ...filters, genre: g })}
          >
            {g}
          </button>
        ))}
      </nav>

      {tags.length > 0 && (
        <nav className="rev-chips rev-chips-tags" aria-label="리뷰 태그 필터">
          <button
	type="button"
	className={`rev-chip${filters.tag === 'all' ? ' is-active' : ''}`}
	onClick={() => commit({ ...filters, tag: 'all' })}
          >
            모든 태그
          </button>
          {tags.map(t => (
            <button
	key={t}
	type="button"
	className={`rev-chip rev-chip-tag${filters.tag === t ? ' is-active' : ''}`}
	onClick={() => commit({ ...filters, tag: t })}
            >
              {t}
            </button>
          ))}
        </nav>
      )}

      {filtered.length === 0 ?
        (
            <div className="rev-empty">
              <p className="rev-empty-title">검색 결과가 없습니다</p>
              <p className="rev-empty-sub">다른 조건으로 다시 시도해 보세요.</p>
              <button
	type="button"
	className="rev-loadmore"
	onClick={() => commit({ ...filters, genre: 'all', tag: 'all', q: '', bnm: false, year: 'all' })}
              >
                필터 초기화
              </button>
            </div>
          ) :
        filters.view === 'list' ?
          (
              <ul className="rev-list">
                {shown.map(r => (
                  <li key={r.slug}>
                    <a href={`/blog/${r.slug}`} className="rev-row">
                      <Cover r={r} badge="mini" ph={18} />
                      <div className="rev-row-main">
                        <h3 className="rev-row-album">{r.album}</h3>
                        <span className="rev-row-sub">
                          {[r.artist, r.genres.join(', '), fmtDate(r.date)].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                      <span className="rev-row-stars"><Stars value={r.rating} size={15} /></span>
                    </a>
                  </li>
                ))}
              </ul>
            ) :
          (
              <ul className={isEditorial ? 'rev-grid rev-c-grid' : 'rev-grid'}>
                {shown.map(r => (
                  <li key={r.slug}>
                    <a href={`/blog/${r.slug}`} className="rev-card">
                      <Cover r={r} badge="full" ph={34} />
                      <div className="rev-card-body">
                        <p className="rev-meta">{`${r.genres[0]} · ${fmtDate(r.date)}`}</p>
                        {r.artist && <p className="rev-artist">{r.artist}</p>}
                        <h3 className="rev-card-album">{r.album}</h3>
                        {!isEditorial && r.excerpt && <p className="rev-excerpt">{r.excerpt}</p>}
                        {!isEditorial && r.tags.length > 0 && (
                          <ul className="rev-card-tags" aria-label="리뷰 태그">
                            {r.tags.map(t => <li key={t} className="rev-card-tag">{t}</li>)}
                          </ul>
                        )}
                        <div className="rev-foot">
                          <Stars value={r.rating} size={16} />
                        </div>
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            )}

      {gridSource.length > visible && (
        <div className="rev-loadmore-wrap">
          <button type="button" className="rev-loadmore" onClick={() => setVisible(v => v + STEP)}>
            {`더 보기 (${gridSource.length - visible})`}
          </button>
        </div>
      )}
    </>
  )
}
