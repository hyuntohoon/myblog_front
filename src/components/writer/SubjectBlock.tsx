import { useEffect, useRef, useState } from 'react'
import type { AlbumDetail, AlbumSearchResult } from './types'

const API_BASE = import.meta.env.PUBLIC_API_URL as string

interface Props {
  subject: AlbumDetail | null
  score: number
  bestNew: boolean
  onSubjectSelect: (album: AlbumDetail) => void
  onScoreChange: (score: number) => void
  onBestNewToggle: () => void
  onClear: () => void
}

function StarRating({ score, onChange }: { score: number, onChange: (s: number) => void }) {
  const [hover, setHover] = useState(0)
  return (
    <div className="wr-hdr-stars" aria-label={`${score}점 / 5점`}>
      {[1, 2, 3, 4, 5].map(i => (
        <button
	key={i}
	type="button"
	className={`wr-hdr-star${(hover || score) >= i ? ' on' : ''}`}
	onMouseEnter={() => setHover(i)}
	onMouseLeave={() => setHover(0)}
	onClick={() => onChange(i)}
	aria-label={`${i}점`}
        >
          ★
        </button>
      ))}
    </div>
  )
}

function AlbumTile({ album, onSelect }: { album: AlbumSearchResult, onSelect: () => void }) {
  const year = album.release_date?.slice(0, 4) ?? ''
  return (
    <button type="button" className="wr-hdr-tile" onClick={onSelect}>
      <div className="wr-hdr-tile-cover">
        {album.cover_url ?
          <img src={album.cover_url} alt={album.title} /> :
          <span className="wr-cover-fallback">{album.title[0]}</span>}
      </div>
      <div className="wr-hdr-tile-body">
        <span className="wr-hdr-tile-name">{album.title}</span>
        <span className="wr-hdr-tile-by">{album.artist_name}</span>
        <span className="wr-hdr-tile-meta">{year}</span>
      </div>
    </button>
  )
}

export default function SubjectBlock({
  subject,
score,
bestNew,
  onSubjectSelect,
onScoreChange,
onBestNewToggle,
onClear,
}: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AlbumSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

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
        const r = await fetch(
          `${API_BASE}/api/music/search/unified?q=${encodeURIComponent(query)}&limit=20&offset=0`,
        )
        if (!r.ok)
          throw new Error(`HTTP ${r.status}`)
        const data = await r.json()
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

  async function handleSelect(sr: AlbumSearchResult) {
    try {
      const r = await fetch(`${API_BASE}/api/music/albums/${encodeURIComponent(sr.id)}`)
      if (!r.ok)
        throw new Error(`HTTP ${r.status}`)
      const detail = await r.json() as AlbumDetail
      onSubjectSelect(detail)
    }
    catch {
      onSubjectSelect({
        id: sr.id,
        title: sr.title,
        cover_url: sr.cover_url,
        release_date: sr.release_date,
        artists: sr.artist_name ? [{ id: '', name: sr.artist_name }] : [],
      })
    }
    setQuery('')
    setResults([])
  }

  if (subject) {
    const year = subject.release_date?.slice(0, 4) ?? ''
    const artistName = subject.artists.map(a => a.name).join(', ')
    return (
      <div className="wr-hdr-card">
        <div className="wr-hdr-cover">
          {subject.cover_url ?
            <img src={subject.cover_url} alt={subject.title} /> :
            <span className="wr-cover-fallback">{subject.title[0]}</span>}
        </div>

        <div className="wr-hdr-info">
          <span className="wr-hdr-kicker">
{artistName}
{year ? ` · ${year}` : ''}
          </span>
          <span className="wr-hdr-title">{subject.title}</span>
        </div>

        <div className="wr-hdr-rating">
          <StarRating score={score} onChange={onScoreChange} />
          <div className="wr-hdr-num-wrap">
            <input
	type="number"
	className="wr-hdr-num"
	value={score || ''}
	min={0}
	max={5}
	step={0.5}
	placeholder="0.0"
	onChange={(e) => {
                const v = Number.parseFloat(e.target.value)
                if (!Number.isNaN(v) && v >= 0 && v <= 5)
                  onScoreChange(v)
              }}
            />
            <span className="wr-hdr-num-denom">/5</span>
          </div>
        </div>

        <button
	type="button"
	className={`wr-hdr-bnm${bestNew ? ' on' : ''}`}
	onClick={onBestNewToggle}
        >
          BEST NEW
        </button>

        <button type="button" className="wr-hdr-change" onClick={onClear} aria-label="앨범 변경">
          ↻
        </button>
      </div>
    )
  }

  return (
    <div className="wr-hdr-search-block">
      <div className="wr-hdr-search-row">
        <div className="wr-hdr-search">
          <span className="wr-hdr-search-icon">♪</span>
          <input
	type="text"
	className="wr-hdr-search-input"
	placeholder="앨범 검색…"
	value={query}
	onChange={e => setQuery(e.target.value)}
	autoComplete="off"
          />
          {loading && <span style={{ color: 'var(--ink-faint)', fontSize: '12px' }}>…</span>}
          {query && (
            <button
	type="button"
	className="wr-hdr-search-clear"
	onClick={() => {
              setQuery('')
              setResults([])
            }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {results.length > 0 && (
        <div className="wr-hdr-grid">
          {results.map(album => (
            <AlbumTile key={album.id} album={album} onSelect={() => handleSelect(album)} />
          ))}
        </div>
      )}

      {query.length >= 2 && !loading && results.length === 0 && (
        <div className="wr-hdr-results-empty">결과 없음</div>
      )}
    </div>
  )
}
