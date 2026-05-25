import { useEffect, useMemo, useRef, useState } from 'react'
import type { AlbumDetail, AlbumSearchResult } from './types'
import { apiFetch } from '../../lib/api'

const API_BASE = import.meta.env.PUBLIC_API_URL as string

interface Props {
  subject: AlbumDetail | null
  score: number
  bestNew: boolean
  onSubjectSelect: (album: AlbumDetail) => void
  onScoreChange: (score: number) => void
  onBestNewToggle: () => void
}

interface CandidateAlbum {
  spotify_id: string | null
  title: string | null
  cover_url: string | null
  release_date: string | null
  artist_name: string | null
}

export default function SubjectBlock({ subject, score, bestNew, onSubjectSelect, onScoreChange, onBestNewToggle }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AlbumSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [hoverStar, setHoverStar] = useState(0)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showSearch = !subject || searching

  useEffect(() => {
    if (debounce.current)
      clearTimeout(debounce.current)
    if (query.length < 2) {
      setResults([])
      return
    }
    debounce.current = setTimeout(async () => {
      setLoading(true)
      try {
        // Primary: Spotify candidates search (auth required, also triggers SQS album sync)
        const r = await apiFetch(
          `${API_BASE}/api/music/search/candidates?q=${encodeURIComponent(query)}&type=album&limit=20`,
        )
        if (r && r.ok) {
          const data = await r.json()
          const albums: AlbumSearchResult[] = (data.albums || []).map((a: CandidateAlbum) => ({
            id: a.spotify_id ?? '',
            title: a.title ?? '',
            cover_url: a.cover_url ?? null,
            release_date: a.release_date ?? null,
            artist_name: a.artist_name ?? null,
            spotify_id: a.spotify_id ?? null,
          }))
          setResults(albums)
          return
        }
        // Fallback: DB-only unified search (public, no auth)
        const fb = await fetch(
          `${API_BASE}/api/music/search/unified?q=${encodeURIComponent(query)}&limit=20&offset=0`,
        )
        if (!fb.ok)
          throw new Error(`HTTP ${fb.status}`)
        const data = await fb.json()
        setResults((data.albums || []) as AlbumSearchResult[])
      }
      catch {
        setResults([])
      }
      finally {
        setLoading(false)
      }
    }, 300)
  }, [query])

  const displayStars = useMemo(() => hoverStar || Math.round(score), [hoverStar, score])

  async function onPick(sr: AlbumSearchResult) {
    const lookupId = sr.spotify_id || sr.id
    try {
      const r = await fetch(`${API_BASE}/api/music/albums/${encodeURIComponent(lookupId)}`)
      if (!r.ok)
        throw new Error(`HTTP ${r.status}`)
      const detail = await r.json() as AlbumDetail
      onSubjectSelect(detail)
    }
    catch {
      onSubjectSelect({
        id: lookupId,
        title: sr.title,
        cover_url: sr.cover_url,
        release_date: sr.release_date,
        artists: sr.artist_name ? [{ id: '', name: sr.artist_name }] : [],
      })
    }
    setSearching(false)
    setQuery('')
    setResults([])
  }

  return (
    <div className="hdr-block">
      {subject && !searching && (
        <div className="hdr-card">
          <div className="hdr-cover">
            {subject.cover_url ?
              <img src={subject.cover_url} alt={subject.title} /> :
              <span className="cover-fallback">{subject.title[0]}</span>}
          </div>
          <div className="hdr-info">
            <div className="hdr-kicker">
              앨범
              {subject.artists[0]?.name ? ` · ${subject.artists[0].name}` : ''}
              {subject.release_date ? ` · ${subject.release_date.slice(0, 4)}` : ''}
            </div>
            <div className="hdr-title">
              {subject.artists[0]?.name && (
                <>
                  <span className="hdr-by">{subject.artists[0].name}</span>
                  <span className="hdr-dash">—</span>
                </>
              )}
              <em className="hdr-name">{subject.title}</em>
            </div>
          </div>
          <div className="hdr-rating">
            <div className="hdr-stars" onMouseLeave={() => setHoverStar(0)}>
              {[1, 2, 3, 4, 5].map(i => (
                <button
	key={i}
	type="button"
	className={`hdr-star${i <= displayStars ? ' on' : ''}`}
	onMouseEnter={() => setHoverStar(i)}
	onClick={() => onScoreChange(i)}
	aria-label={`${i}점`}
                >
                  {i <= displayStars ? '★' : '☆'}
                </button>
              ))}
            </div>
            <div className="hdr-num-wrap">
              <input
	type="number"
	className="hdr-num"
	min={0}
	max={5}
	step={0.5}
	value={score || ''}
	placeholder="—"
	onChange={(e) => {
                  const v = Number.parseFloat(e.target.value)
                  if (!Number.isNaN(v))
                    onScoreChange(Math.max(0, Math.min(5, v)))
                }}
              />
              <span className="hdr-num-denom">/5</span>
            </div>
          </div>
          <button type="button" className="hdr-change" onClick={() => setSearching(true)} title="다른 앨범 검색">↻</button>
          <button
	type="button"
	className={`hdr-bnm${bestNew ? ' on' : ''}`}
	onClick={onBestNewToggle}
          >
            BEST NEW
          </button>
        </div>
      )}

      {showSearch && (
        <div className="hdr-search-block">
          <div className="hdr-search-row">
            <div className="hdr-search">
              <span className="hdr-search-icon">⌕</span>
              <input
	className="hdr-search-input"
	placeholder={subject ? '다른 앨범 검색…' : '어떤 앨범을 리뷰할까요? 검색하세요…'}
	value={query}
	onChange={e => setQuery(e.target.value)}
	autoComplete="off"
              />
              {query && (
                <button type="button" className="hdr-search-clear" onClick={() => setQuery('')}>✕</button>
              )}
            </div>
            {subject && (
              <button
	type="button"
	className="hdr-cancel"
	onClick={() => {
                  setSearching(false)
                  setQuery('')
                }}
              >
                취소
              </button>
            )}
          </div>

          {query.length >= 2 && !loading && results.length === 0 ?
            (
              <div className="hdr-results-empty">검색 결과가 없습니다.</div>
            ) :
            results.length > 0 ?
              (
                <div className="hdr-grid">
                  {results.map(r => (
                    <button
	key={r.id}
	type="button"
	className={`hdr-tile${subject?.id === r.id ? ' is-current' : ''}`}
	onClick={() => onPick(r)}
                    >
                      <div className="hdr-tile-cover">
                        {r.cover_url ?
                          <img src={r.cover_url} alt={r.title} /> :
                          <span className="cover-fallback">{r.title[0]}</span>}
                      </div>
                      <div className="hdr-tile-body">
                        <div className="hdr-tile-name"><em>{r.title}</em></div>
                        <div className="hdr-tile-by">{r.artist_name}</div>
                        <div className="hdr-tile-meta">
                          {r.release_date && <span>{r.release_date.slice(0, 4)}</span>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) :
              null}
          {loading && (
            <div className="hdr-results-empty">검색 중…</div>
          )}
        </div>
      )}
    </div>
  )
}
