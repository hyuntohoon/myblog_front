import type { KeyboardEvent } from 'react'
import { useMemo, useRef, useState } from 'react'
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

const FILTERS = [
  { v: 'all', l: '전체' },
  { v: 'album', l: '앨범' },
  { v: 'track', l: '트랙' },
  { v: 'artist', l: '아티스트' },
] as const

type FilterType = typeof FILTERS[number]['v']

function filterToType(f: FilterType): string {
  return f === 'all' ? 'album,artist,track' : f
}

export default function SubjectBlock({ subject, score, bestNew, onSubjectSelect, onScoreChange, onBestNewToggle }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AlbumSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [hoverStar, setHoverStar] = useState(0)
  const [filter, setFilter] = useState<FilterType>('album')
  const [status, setStatus] = useState('')
  const [syncDisabled, setSyncDisabled] = useState(false)
  const syncCooldownRef = useRef(false)

  const showSearch = !subject || searching

  async function runDBSearch() {
    const q = query.trim()
    if (!q)
      return
    setLoading(true)
    setStatus('')
    setResults([])
    try {
      const r = await fetch(
        `${API_BASE}/api/music/search/unified?q=${encodeURIComponent(q)}&limit=20&offset=0`,
      )
      if (!r.ok)
        throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      const albums: AlbumSearchResult[] = (data.albums || []).map((a: any) => ({
        id: a.id ?? '',
        title: a.title ?? '',
        cover_url: a.cover_url ?? null,
        release_date: a.release_date ?? null,
        artist_name: a.artist_name ?? null,
        spotify_id: a.spotify_id ?? null,
        source: 'db' as const,
      }))
      setResults(albums)
      if (albums.length === 0)
        setStatus('DB에 결과가 없습니다. Spotify 싱크를 눌러보세요.')
    }
    catch {
      setStatus('검색 실패')
    }
    finally {
      setLoading(false)
    }
  }

  async function runSpotifySync() {
    const q = query.trim()
    if (!q || syncCooldownRef.current)
      return
    syncCooldownRef.current = true
    setSyncDisabled(true)
    setTimeout(() => {
      syncCooldownRef.current = false
      setSyncDisabled(false)
    }, 3000)
    setLoading(true)
    setStatus('Spotify에서 검색하고 DB 동기화를 시작합니다…')
    setResults([])
    const typeParam = filterToType(filter)
    try {
      const r = await apiFetch(
        `${API_BASE}/api/music/search/candidates?q=${encodeURIComponent(q)}&type=${typeParam}&limit=20`,
      )
      if (!r || !r.ok)
        throw new Error(`HTTP ${r?.status}`)
      const data = await r.json()
      const albums: AlbumSearchResult[] = (data.albums || []).map((a: any) => ({
        id: a.spotify_id ?? '',
        title: a.title ?? '',
        cover_url: a.cover_url ?? null,
        release_date: a.release_date ?? null,
        artist_name: a.artist_name ?? null,
        spotify_id: a.spotify_id ?? null,
        source: 'spotify' as const,
      }))
      setResults(albums)
      setStatus(albums.length === 0 ? 'Spotify에서도 결과가 없습니다.' : 'Spotify 결과 (DB 동기화 백그라운드 진행 중)')
    }
    catch {
      setStatus('Spotify 싱크 실패')
    }
    finally {
      setLoading(false)
    }
  }

  const displayStars = useMemo(() => hoverStar || Math.round(score), [hoverStar, score])

  function clearSearch() {
    setQuery('')
    setResults([])
    setStatus('')
  }

  function onSearchKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void runDBSearch()
    }
  }

  async function onPick(sr: AlbumSearchResult) {
    const lookupId = sr.spotify_id || sr.id
    try {
      const r = await fetch(`${API_BASE}/api/music/albums/${encodeURIComponent(lookupId)}`)
      if (!r.ok)
        throw new Error(`HTTP ${r.status}`)
      const detail = await r.json() as AlbumDetail
      onSubjectSelect(detail)
      setSearching(false)
      setQuery('')
      setResults([])
      setStatus('')
    }
    catch {
      if (sr.source === 'db') {
        // DB result: sr.id is always the DB UUID — safe to use as fallback
        onSubjectSelect({
          id: sr.id,
          title: sr.title,
          cover_url: sr.cover_url,
          release_date: sr.release_date,
          artists: sr.artist_name ? [{ id: '', name: sr.artist_name }] : [],
        })
        setSearching(false)
        setQuery('')
        setResults([])
        setStatus('')
      }
      else {
        // Spotify result: album may not be in DB yet (sync is async)
        setStatus('앨범 동기화가 아직 완료되지 않았습니다. 잠시 후 다시 선택해주세요.')
      }
    }
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
	placeholder={subject ? '다른 앨범 검색…' : '어떤 앨범을 리뷰할까요?'}
	value={query}
	onChange={e => setQuery(e.target.value)}
	onKeyDown={onSearchKeyDown}
	autoComplete="off"
              />
              {query && (
                <button
	type="button"
	className="hdr-search-clear"
	onClick={clearSearch}
                >
                  ✕
                </button>
              )}
            </div>
            <button
	type="button"
	className="hdr-search-btn"
	onClick={() => void runDBSearch()}
	disabled={loading || !query.trim()}
            >
              검색
            </button>
            <button
	type="button"
	className="hdr-sync-btn"
	onClick={() => void runSpotifySync()}
	disabled={loading || syncDisabled || !query.trim()}
            >
              Spotify 싱크
            </button>
            {subject && (
              <button
	type="button"
	className="hdr-cancel"
	onClick={() => {
                  setSearching(false)
                  setQuery('')
                  setResults([])
                  setStatus('')
                }}
              >
                취소
              </button>
            )}
          </div>

          <div className="hdr-filter-row">
            {FILTERS.map(f => (
              <button
	key={f.v}
	type="button"
	className={`hdr-filter-btn${filter === f.v ? ' on' : ''}`}
	onClick={() => setFilter(f.v)}
              >
                {f.l}
              </button>
            ))}
            <span className="hdr-filter-hint">싱크 시 적용</span>
            {results.length > 0 && (
              <span className="hdr-count">
{results.length}
개
              </span>
            )}
          </div>

          {status && <div className="hdr-status">{status}</div>}

          {results.length > 0 && (
            <div className="hdr-grid">
              {results.map(r => (
                <button
	key={r.id || r.spotify_id}
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
                      {r.source && (
                        <span className={`hdr-tile-source${r.source === 'spotify' ? ' spotify' : ''}`}>
                          {r.source === 'spotify' ? 'SPOTIFY' : 'DB'}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
          {loading && (
            <div className="hdr-results-empty">검색 중…</div>
          )}
        </div>
      )}
    </div>
  )
}
