import type { KeyboardEvent } from 'react'
import { useMemo, useRef, useState } from 'react'
import type { components } from '../../lib/api.gen'
import type {
  AlbumDetail,
  AlbumSearchResult,
  ArtistSearchResult,
  SearchResultItem,
  TrackSearchResult,
} from './types'
import { apiFetch } from '../../lib/api'

type UnifiedSearchResult = components['schemas']['Music_UnifiedSearchResult']
type CandidateSearchResult = components['schemas']['Music_CandidateSearchResult']

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

// Backend search always fetches all 3 types so filter toggles can be applied
// instantly client-side without re-hitting the API.
const BACKEND_TYPES = 'album,artist,track'

function interleave<T>(...arrays: T[][]): T[] {
  const max = Math.max(0, ...arrays.map(a => a.length))
  const out: T[] = []
  for (let i = 0; i < max; i++) {
    for (const arr of arrays) {
      if (i < arr.length)
        out.push(arr[i])
    }
  }
  return out
}

export default function SubjectBlock({ subject, score, bestNew, onSubjectSelect, onScoreChange, onBestNewToggle }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResultItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [hoverStar, setHoverStar] = useState(0)
  const [filter, setFilter] = useState<FilterType>('all')
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
        `${API_BASE}/api/music/search/unified?q=${encodeURIComponent(q)}&type=${BACKEND_TYPES}&limit=20&offset=0`,
      )
      if (!r.ok)
        throw new Error(`HTTP ${r.status}`)
      const data = await r.json() as UnifiedSearchResult
      const albums: AlbumSearchResult[] = (data.albums ?? []).map(a => ({
        kind: 'album' as const,
        id: a.id ?? '',
        title: a.title ?? '',
        cover_url: a.cover_url ?? null,
        release_date: a.release_date ?? null,
        artist_name: a.artist_name ?? null,
        spotify_id: a.spotify_id ?? null,
        source: 'db' as const,
      }))
      const artists: ArtistSearchResult[] = (data.artists ?? []).map(ar => ({
        kind: 'artist' as const,
        id: ar.id ?? '',
        name: ar.name ?? '',
        cover_url: ar.cover_url ?? null,
        spotify_id: ar.spotify_id ?? null,
        source: 'db' as const,
      }))
      const tracks: TrackSearchResult[] = (data.tracks ?? []).map(t => ({
        kind: 'track' as const,
        id: t.id ?? '',
        title: t.title ?? '',
        album_id: t.album_id ?? null,
        album_spotify_id: t.album_spotify_id ?? null,
        album_title: t.album_title ?? null,
        cover_url: t.cover_url ?? null,
        artist_name: t.artist_name ?? null,
        spotify_id: t.spotify_id ?? null,
        source: 'db' as const,
      }))
      setResults(interleave<SearchResultItem>(albums, artists, tracks))
      if (albums.length + artists.length + tracks.length === 0)
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
    try {
      const r = await apiFetch(
        `${API_BASE}/api/music/search/candidates?q=${encodeURIComponent(q)}&type=${BACKEND_TYPES}&limit=20`,
      )
      if (!r || !r.ok)
        throw new Error(`HTTP ${r?.status}`)
      const data = await r.json() as CandidateSearchResult
      const albums: AlbumSearchResult[] = (data.albums ?? []).map(a => ({
        kind: 'album' as const,
        id: a.spotify_id ?? '',
        title: a.title ?? '',
        cover_url: a.cover_url ?? null,
        release_date: a.release_date ?? null,
        artist_name: a.artist_name ?? null,
        spotify_id: a.spotify_id ?? null,
        source: 'spotify' as const,
      }))
      const artists: ArtistSearchResult[] = (data.artists ?? []).map(ar => ({
        kind: 'artist' as const,
        id: ar.spotify_id ?? '',
        name: ar.name ?? '',
        cover_url: ar.photo_url ?? null,
        spotify_id: ar.spotify_id ?? null,
        source: 'spotify' as const,
      }))
      const tracks: TrackSearchResult[] = (data.tracks ?? []).map(t => ({
        kind: 'track' as const,
        id: t.spotify_id ?? '',
        title: t.title ?? '',
        album_id: null,
        album_spotify_id: t.album?.spotify_id ?? null,
        album_title: t.album?.title ?? null,
        cover_url: t.album?.cover_url ?? null,
        artist_name: t.artist_name ?? null,
        spotify_id: t.spotify_id ?? null,
        source: 'spotify' as const,
      }))
      const merged = interleave<SearchResultItem>(albums, artists, tracks)
      setResults(merged)
      setStatus(merged.length === 0 ? 'Spotify에서도 결과가 없습니다.' : 'Spotify 결과 (DB 동기화 백그라운드 진행 중)')
    }
    catch {
      setStatus('Spotify 싱크 실패')
    }
    finally {
      setLoading(false)
    }
  }

  const displayStars = useMemo(() => hoverStar || Math.round(score), [hoverStar, score])

  const visibleResults = useMemo(
    () => filter === 'all' ? results : results.filter(r => r.kind === filter),
    [results, filter],
  )

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

  async function selectAlbumByLookup(args: { lookupUrl: string, source?: 'db' | 'spotify' }) {
    try {
      const r = await fetch(args.lookupUrl)
      if (!r.ok)
        throw new Error(`HTTP ${r.status}`)
      const json = await r.json() as {
        album: { id: string, title: string, cover_url: string | null, release_date: string | null }
        artists: Array<{ id: string, name: string }>
      }
      const detail: AlbumDetail = {
        id: json.album.id,
        title: json.album.title,
        cover_url: json.album.cover_url,
        release_date: json.album.release_date,
        artists: json.artists.map(a => ({ id: a.id, name: a.name })),
      }
      onSubjectSelect(detail)
      setSearching(false)
      setQuery('')
      setResults([])
      setStatus('')
    }
    catch {
      setStatus(args.source === 'spotify' ?
        '앨범 동기화가 아직 완료되지 않았습니다. 잠시 후 다시 선택해주세요.' :
        '앨범 정보 조회 실패. 잠시 후 다시 시도해주세요.')
    }
  }

  async function onPick(sr: SearchResultItem) {
    if (sr.kind === 'album') {
      // Route by available identifier: spotify_id → /by-spotify, else DB UUID → /{id}.
      // /albums/{id} rejects non-UUID input with 500, so spotify_id must use by-spotify.
      const url = sr.spotify_id ?
        `${API_BASE}/api/music/albums/by-spotify/${encodeURIComponent(sr.spotify_id)}` :
        `${API_BASE}/api/music/albums/${encodeURIComponent(sr.id)}`
      await selectAlbumByLookup({ lookupUrl: url, source: sr.source })
      return
    }
    if (sr.kind === 'track') {
      // Track click → select the parent album for review.
      // Spotify candidates carry album.spotify_id (no DB UUID yet); DB tracks carry album_id (UUID).
      if (sr.source === 'spotify' && sr.album_spotify_id) {
        await selectAlbumByLookup({
          lookupUrl: `${API_BASE}/api/music/albums/by-spotify/${encodeURIComponent(sr.album_spotify_id)}`,
          source: 'spotify',
        })
        return
      }
      if (sr.album_id) {
        await selectAlbumByLookup({
          lookupUrl: `${API_BASE}/api/music/albums/${encodeURIComponent(sr.album_id)}`,
          source: sr.source,
        })
        return
      }
      setStatus('이 트랙의 앨범 정보가 없습니다.')
      return
    }
    // Artist: refine the query to that artist's name and re-search as album.
    // Aliases (BUG-4) help non-Latin queries find the canonical name.
    setQuery(sr.name)
    setFilter('album')
    setStatus(`'${sr.name}'의 앨범을 검색하려면 검색 버튼을 누르세요.`)
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
            <span className="hdr-filter-hint">즉시 적용</span>
            {visibleResults.length > 0 && (
              <span className="hdr-count">
{visibleResults.length}
개
              </span>
            )}
          </div>

          {status && <div className="hdr-status">{status}</div>}

          {visibleResults.length > 0 && (
            <div className="hdr-grid">
              {visibleResults.map((r) => {
                const displayTitle = r.kind === 'artist' ? r.name : r.title
                const subtitle = r.kind === 'album' ?
                  r.artist_name :
                  r.kind === 'track' ?
                    (r.album_title ? `${r.artist_name ?? ''} · ${r.album_title}` : r.artist_name) :
                    'Artist'
                const fourthLine = r.kind === 'album' && r.release_date ? r.release_date.slice(0, 4) : null
                const key = `${r.kind}:${r.id || r.spotify_id || displayTitle}`
                const isCurrent = r.kind === 'album' && subject?.id === r.id
                return (
                  <button
	key={key}
	type="button"
	className={`hdr-tile${isCurrent ? ' is-current' : ''}`}
	onClick={() => void onPick(r)}
                  >
                    <div className="hdr-tile-cover">
                      {r.cover_url ?
                        <img src={r.cover_url} alt={displayTitle} /> :
                        <span className="cover-fallback">{(displayTitle || '?')[0]}</span>}
                    </div>
                    <div className="hdr-tile-body">
                      <div className="hdr-tile-name"><em>{displayTitle}</em></div>
                      <div className="hdr-tile-by">{subtitle}</div>
                      <div className="hdr-tile-meta">
                        <span className={`hdr-tile-kind kind-${r.kind}`}>
                          {r.kind === 'album' ? '앨범' : r.kind === 'artist' ? '아티스트' : '트랙'}
                        </span>
                        {fourthLine && <span>{fourthLine}</span>}
                        {r.source && (
                          <span className={`hdr-tile-source${r.source === 'spotify' ? ' spotify' : ''}`}>
                            {r.source === 'spotify' ? 'SPOTIFY' : 'DB'}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
          {loading && (
            <div className="hdr-results-empty">검색 중…</div>
          )}
          {!loading && results.length > 0 && visibleResults.length === 0 && (
            <div className="hdr-results-empty">현재 필터에 해당하는 결과가 없습니다.</div>
          )}
        </div>
      )}
    </div>
  )
}
