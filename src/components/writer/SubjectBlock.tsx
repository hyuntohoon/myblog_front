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
import type { AlbumListItem, ArtistHero, TopTrackItem } from '../../scripts/write/artistApi'
import {
  fetchArtistAlbums,
  fetchArtistHero,
  fetchArtistHeroBySpotify,
  fetchArtistTopTracks,
} from '../../scripts/write/artistApi'
import { apiFetch } from '../../lib/api'
import ArtistDetail from './ArtistDetail'

type UnifiedSearchResult = components['schemas']['Music_UnifiedSearchResult']
type CandidateSearchResult = components['schemas']['Music_CandidateSearchResult']

const API_BASE = import.meta.env.PUBLIC_API_URL as string

interface Props {
  subject: AlbumDetail | null
  score: number
  onSubjectSelect: (album: AlbumDetail) => void
  onScoreChange: (score: number) => void
  // FEAT-writer-lowfreq-redesign Step 6: BEST NEW toggle in the filled card.
  // Hidden when no subject is selected (the flag has no meaning without an
  // album target).
  subjectBestNew: boolean
  onSubjectBestNewChange: (next: boolean) => void
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

type BucketKey = 'album' | 'artist' | 'track'
type BucketOffsets = Record<BucketKey, number>
type BucketLastReturned = Record<BucketKey, number>

const ZERO_OFFSETS: BucketOffsets = { album: 0, artist: 0, track: 0 }
const ZERO_RETURNED: BucketLastReturned = { album: 0, artist: 0, track: 0 }
const PAGE_LIMIT = 20

type SourceMode = 'db' | 'spotify'

// Spotify candidates endpoint enqueues SQS absorb jobs; rapid re-firing wastes
// quota and crowds the queue. 3 s cooldown matches BUG-19 era guard.
const SPOTIFY_COOLDOWN_MS = 3000

export default function SubjectBlock({
  subject,
score,
onSubjectSelect,
onScoreChange,
  subjectBestNew,
onSubjectBestNewChange,
}: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResultItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState<BucketKey | null>(null)
  const [searching, setSearching] = useState(false)
  const [hoverStar, setHoverStar] = useState(0)
  const [filter, setFilter] = useState<FilterType>('all')
  const [status, setStatus] = useState('')
  const [source, setSource] = useState<SourceMode>('db')
  const [spotifyCooldown, setSpotifyCooldown] = useState(false)
  const spotifyCooldownRef = useRef(false)
  // FEAT-writer-lowfreq-redesign Step 4: artist drill-in state. When set, the
  // search grid is hidden and ArtistDetail renders instead. `viewArtistSource`
  // remembers which source the click came from so the panel can label itself
  // and the artist-as-subject pick preserves provenance.
  const [viewArtistSource, setViewArtistSource] = useState<SourceMode>('db')
  const [viewArtistHero, setViewArtistHero] = useState<ArtistHero | null>(null)
  const [viewArtistTracks, setViewArtistTracks] = useState<TopTrackItem[]>([])
  const [viewArtistAlbums, setViewArtistAlbums] = useState<AlbumListItem[]>([])
  const [viewArtistPending, setViewArtistPending] = useState(false)
  const [viewArtistFailed, setViewArtistFailed] = useState(false)
  const [viewArtistOrigin, setViewArtistOrigin] = useState<ArtistSearchResult | null>(null)
  const viewArtistPollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // BUG-19: per-bucket pagination — `offsets[kind]` is the next offset to ask
  // for; `lastReturned[kind]` controls "더 보기" visibility (hide once a
  // round returns zero rows for that bucket).
  const [offsets, setOffsets] = useState<BucketOffsets>(ZERO_OFFSETS)
  const [lastReturned, setLastReturned] = useState<BucketLastReturned>(ZERO_RETURNED)

  const showSearch = !subject || searching

  function mapAlbums(arr: UnifiedSearchResult['albums']): AlbumSearchResult[] {
    return (arr ?? []).map(a => ({
      kind: 'album' as const,
      id: a.id ?? '',
      title: a.title ?? '',
      cover_url: a.cover_url ?? null,
      release_date: a.release_date ?? null,
      artist_name: a.artist_name ?? null,
      spotify_id: a.spotify_id ?? null,
      source: 'db' as const,
    }))
  }

  function mapArtists(arr: UnifiedSearchResult['artists']): ArtistSearchResult[] {
    return (arr ?? []).map(ar => ({
      kind: 'artist' as const,
      id: ar.id ?? '',
      name: ar.name ?? '',
      cover_url: ar.cover_url ?? null,
      spotify_id: ar.spotify_id ?? null,
      source: 'db' as const,
    }))
  }

  function mapTracks(arr: UnifiedSearchResult['tracks']): TrackSearchResult[] {
    return (arr ?? []).map(t => ({
      kind: 'track' as const,
      id: t.id ?? '',
      title: t.title ?? '',
      album_id: t.album_id ?? null,
      album_spotify_id: t.album_spotify_id ?? null,
      album_title: t.album_title ?? null,
      cover_url: t.cover_url ?? null,
      artist_name: t.artist_name ?? null,
      feat_artist_names: t.feat_artist_names ?? [],
      spotify_id: t.spotify_id ?? null,
      source: 'db' as const,
    }))
  }

  async function runDBSearch() {
    const q = query.trim()
    if (!q)
      return
    setLoading(true)
    setStatus('')
    setResults([])
    setOffsets(ZERO_OFFSETS)
    setLastReturned(ZERO_RETURNED)
    try {
      const r = await fetch(
        `${API_BASE}/api/music/search/unified?q=${encodeURIComponent(q)}&type=${BACKEND_TYPES}&limit=${PAGE_LIMIT}&offset=0`,
      )
      if (!r.ok)
        throw new Error(`HTTP ${r.status}`)
      const data = await r.json() as UnifiedSearchResult
      const albums = mapAlbums(data.albums)
      const artists = mapArtists(data.artists)
      const tracks = mapTracks(data.tracks)
      setResults(interleave<SearchResultItem>(albums, artists, tracks))
      setOffsets({ album: albums.length, artist: artists.length, track: tracks.length })
      setLastReturned({ album: albums.length, artist: artists.length, track: tracks.length })
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

  // BUG-19 Q3 (a): per-bucket "load more" using `<kind>_offset` overrides.
  // Only fires when a single bucket is selected so the user sees deterministic
  // append semantics for that kind (no interleaving surprise).
  async function loadMore(kind: BucketKey) {
    const q = query.trim()
    if (!q || loadingMore)
      return
    setLoadingMore(kind)
    try {
      const params = new URLSearchParams({
        q,
        type: BACKEND_TYPES,
        limit: String(PAGE_LIMIT),
        offset: '0',
        [`${kind}_offset`]: String(offsets[kind]),
      })
      const r = await fetch(`${API_BASE}/api/music/search/unified?${params.toString()}`)
      if (!r.ok)
        throw new Error(`HTTP ${r.status}`)
      const data = await r.json() as UnifiedSearchResult
      let appended: SearchResultItem[] = []
      let returned = 0
      if (kind === 'album') {
        appended = mapAlbums(data.albums)
        returned = appended.length
      }
      else if (kind === 'artist') {
        appended = mapArtists(data.artists)
        returned = appended.length
      }
      else {
        appended = mapTracks(data.tracks)
        returned = appended.length
      }
      // De-dupe by id when appending (unified expansion can re-surface the same row).
      const existingIds = new Set(results.filter(r => r.kind === kind).map(r => r.id))
      const fresh = appended.filter(r => !existingIds.has(r.id))
      if (fresh.length === 0 && returned > 0) {
        // backend returned rows but all were duplicates — treat as "exhausted"
        setLastReturned(prev => ({ ...prev, [kind]: 0 }))
        return
      }
      setResults(prev => [...prev, ...fresh])
      setOffsets(prev => ({ ...prev, [kind]: prev[kind] + returned }))
      setLastReturned(prev => ({ ...prev, [kind]: returned }))
    }
    catch {
      setStatus('추가 로드 실패')
    }
    finally {
      setLoadingMore(null)
    }
  }

  async function runSpotifySync() {
    const q = query.trim()
    if (!q || spotifyCooldownRef.current)
      return
    spotifyCooldownRef.current = true
    setSpotifyCooldown(true)
    setTimeout(() => {
      spotifyCooldownRef.current = false
      setSpotifyCooldown(false)
    }, SPOTIFY_COOLDOWN_MS)
    setLoading(true)
    setStatus('Spotify에서 검색하고 DB 동기화를 시작합니다…')
    setResults([])
    // BUG-19: Spotify candidates don't support per-bucket offset paging,
    // so hide "더 보기" while in Spotify view.
    setOffsets(ZERO_OFFSETS)
    setLastReturned(ZERO_RETURNED)
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
        feat_artist_names: [],
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
    setOffsets(ZERO_OFFSETS)
    setLastReturned(ZERO_RETURNED)
  }

  function runActiveSearch() {
    if (source === 'spotify')
      void runSpotifySync()
    else
      void runDBSearch()
  }

  function onSearchKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      runActiveSearch()
    }
  }

  // Toggle click: switch source and, if there's a query, immediately re-search
  // through the new source. Empty query → color-only flip, no API call (DB
  // search has no "browse all" endpoint and Spotify candidates with empty q
  // would enqueue a junk absorb job).
  function selectSource(next: SourceMode) {
    if (next === source)
      return
    setSource(next)
    if (!query.trim())
      return
    if (next === 'spotify')
      void runSpotifySync()
    else
      void runDBSearch()
  }

  async function selectAlbumByLookup(args: { lookupUrl: string, source?: 'db' | 'spotify' }) {
    try {
      const r = await fetch(args.lookupUrl)
      if (!r.ok)
        throw new Error(`HTTP ${r.status}`)
      const json = await r.json() as {
        album: { id: string, title: string, cover_url: string | null, release_date: string | null, best_new?: boolean }
        artists: Array<{ id: string, name: string }>
        tracks?: Array<{ id: string, title: string, track_no: number | null }>
      }
      const detail: AlbumDetail = {
        id: json.album.id,
        title: json.album.title,
        cover_url: json.album.cover_url,
        release_date: json.album.release_date,
        artists: json.artists.map(a => ({ id: a.id, name: a.name })),
        tracks: (json.tracks ?? []).map(t => ({ id: t.id, title: t.title, track_no: t.track_no })),
        best_new: json.album.best_new ?? false,
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
    // Artist: open the drill-in panel. Replaces the previous query-refine
    // behavior. For DB artists we look up by internal UUID; for Spotify-only
    // tiles (no UUID yet) we go via spotify_id and poll on 404 until the
    // worker absorbs the candidate.
    void openArtistDrillIn(sr)
  }

  async function openArtistDrillIn(sr: ArtistSearchResult) {
    cancelArtistPoll()
    setViewArtistOrigin(sr)
    setViewArtistSource(sr.source ?? 'db')
    setViewArtistHero(null)
    setViewArtistTracks([])
    setViewArtistAlbums([])
    setViewArtistFailed(false)
    setStatus('')

    if (sr.source !== 'spotify' && sr.id) {
      // DB artist → direct lookup
      setViewArtistPending(true)
      const r = await fetchArtistHero(sr.id)
      if (r.ok) {
        await loadArtistDetail(r.hero)
      }
      else {
        setViewArtistPending(false)
        setViewArtistFailed(true)
      }
      return
    }

    // Spotify-only tile — by-spotify lookup, possibly pending while the worker
    // absorbs the candidate that the prior candidates search enqueued.
    if (!sr.spotify_id) {
      setViewArtistFailed(true)
      return
    }
    setViewArtistPending(true)
    await pollArtistBySpotify(sr.spotify_id, /* attempt */ 0)
  }

  async function pollArtistBySpotify(spotifyId: string, attempt: number) {
    const MAX_ATTEMPTS = 15  // 15 × 2 s = 30 s window
    const r = await fetchArtistHeroBySpotify(spotifyId)
    if (r.ok) {
      await loadArtistDetail(r.hero)
      return
    }
    if (attempt >= MAX_ATTEMPTS) {
      setViewArtistPending(false)
      setViewArtistFailed(true)
      return
    }
    viewArtistPollRef.current = setTimeout(() => {
      void pollArtistBySpotify(spotifyId, attempt + 1)
    }, 2000)
  }

  async function loadArtistDetail(hero: ArtistHero) {
    cancelArtistPoll()
    setViewArtistHero(hero)
    setViewArtistPending(false)
    setViewArtistFailed(false)
    if (hero.id) {
      const [tracks, albums] = await Promise.all([
        fetchArtistTopTracks(hero.id, 10),
        fetchArtistAlbums(hero.id, 24),
      ])
      setViewArtistTracks(tracks)
      setViewArtistAlbums(albums)
    }
  }

  function cancelArtistPoll() {
    if (viewArtistPollRef.current) {
      clearTimeout(viewArtistPollRef.current)
      viewArtistPollRef.current = null
    }
  }

  function closeArtistDrillIn() {
    cancelArtistPoll()
    setViewArtistOrigin(null)
    setViewArtistHero(null)
    setViewArtistTracks([])
    setViewArtistAlbums([])
    setViewArtistPending(false)
    setViewArtistFailed(false)
  }

  async function onPickAlbumFromDrillIn(album: AlbumListItem) {
    // ArtistDetail's discography items are AlbumItem rows from the DB albums
    // endpoint — every entry already has an internal id, no by-spotify hop.
    if (!album.id)
      return
    await selectAlbumByLookup({
      lookupUrl: `${API_BASE}/api/music/albums/${encodeURIComponent(album.id)}`,
      source: viewArtistSource,
    })
    closeArtistDrillIn()
  }

  async function onPickTrackFromDrillIn(track: TopTrackItem) {
    // TrackItem carries album_id (DB UUID, always set in top-tracks payload).
    if (!track.album_id)
      return
    await selectAlbumByLookup({
      lookupUrl: `${API_BASE}/api/music/albums/${encodeURIComponent(track.album_id)}`,
      source: viewArtistSource,
    })
    closeArtistDrillIn()
  }

  function onPickArtistAsSubject(hero: ArtistHero) {
    // Artist-as-subject: WriterApp branches on kind='artist' when building the
    // payload (album_ids=[] + artist_ids=[id]). Cover falls back to photo_url.
    if (!hero.id)
      return
    const detail: AlbumDetail = {
      id: hero.id,
      title: hero.name,
      cover_url: hero.photo_url ?? null,
      release_date: null,
      artists: [{ id: hero.id, name: hero.name }],
      tracks: [],
      kind: 'artist',
    }
    onSubjectSelect(detail)
    setSearching(false)
    setQuery('')
    setResults([])
    setStatus('')
    closeArtistDrillIn()
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
          {/* Step 6: BEST NEW pill — hidden for artist subjects (no album to flag) */}
          {subject.kind !== 'artist' && (
            <button
	type="button"
	className={`hdr-bnm${subjectBestNew ? ' on' : ''}`}
	onClick={() => onSubjectBestNewChange(!subjectBestNew)}
	title={subjectBestNew ? '베스트 신보 해제' : '베스트 신보로 표시'}
            >
              BEST NEW
            </button>
          )}
        </div>
      )}

      {showSearch && (viewArtistHero || viewArtistPending || viewArtistFailed) && (
        <ArtistDetail
	hero={viewArtistHero}
	topTracks={viewArtistTracks}
	albums={viewArtistAlbums}
	isPending={viewArtistPending}
	loadFailed={viewArtistFailed}
	source={viewArtistSource}
	onBack={closeArtistDrillIn}
	onPickTrack={track => void onPickTrackFromDrillIn(track)}
	onPickAlbum={album => void onPickAlbumFromDrillIn(album)}
	onPickArtist={onPickArtistAsSubject}
	onRetry={() => {
            // Re-fire the original artist click — re-attempts the same DB or
            // by-spotify lookup with a fresh poll budget.
            if (viewArtistOrigin)
              void openArtistDrillIn(viewArtistOrigin)
          }}
        />
      )}

      {showSearch && !viewArtistHero && !viewArtistPending && !viewArtistFailed && (
        <div className="hdr-search-block">
          <div className="hdr-source-row">
            <button
	type="button"
	className={`hdr-source-btn${source === 'db' ? ' on' : ''}`}
	onClick={() => selectSource('db')}
	disabled={loading && source !== 'db'}
            >
              <span className="hdr-source-icon">▣</span>
              <span className="hdr-source-label">
                <strong>내부 DB</strong>
                <span>Lowfreq 카탈로그</span>
              </span>
            </button>
            <button
	type="button"
	className={`hdr-source-btn hdr-source-spotify${source === 'spotify' ? ' on' : ''}`}
	onClick={() => selectSource('spotify')}
	disabled={(loading && source !== 'spotify') || (source !== 'spotify' && spotifyCooldown)}
	title={source !== 'spotify' && spotifyCooldown ? '잠시 후 다시 시도 (Spotify 쿨다운)' : undefined}
            >
              <span className="hdr-source-icon hdr-spotify-mark" aria-hidden="true">
                <SpotifyMark size={16} />
              </span>
              <span className="hdr-source-label">
                <strong>Spotify</strong>
                <span>{source === 'spotify' && loading ? '검색 중…' : '전 세계 카탈로그'}</span>
              </span>
              {source === 'spotify' && loading && (
                <span className="hdr-spinner" aria-hidden="true"></span>
              )}
            </button>
          </div>
          <div className="hdr-search-row">
            <div className="hdr-search">
              <span className="hdr-search-icon">⌕</span>
              <input
	className="hdr-search-input"
	placeholder={source === 'spotify' ? 'Spotify에서 검색…' : (subject ? '다른 앨범 검색…' : '어떤 앨범을 리뷰할까요?')}
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
                let subtitle: string | null = null
                if (r.kind === 'album') {
                  subtitle = r.artist_name
                }
                else if (r.kind === 'track') {
                  const feat = r.feat_artist_names ?? []
                  const artistPart = r.artist_name ?? ''
                  const withFeat = feat.length ? `${artistPart} (feat. ${feat.join(', ')})` : artistPart
                  subtitle = r.album_title ? `${withFeat} · ${r.album_title}` : (withFeat || r.artist_name)
                }
                else {
                  subtitle = 'Artist'
                }
                const fourthLine = r.kind === 'album' && r.release_date ? r.release_date.slice(0, 4) : null
                const key = `${r.kind}:${r.id || r.spotify_id || displayTitle}`
                const isCurrent = r.kind === 'album' && subject?.id === r.id
                const isSpotify = r.source === 'spotify'
                return (
                  <button
	key={key}
	type="button"
	className={`hdr-tile${isCurrent ? ' is-current' : ''}${isSpotify ? ' is-spotify' : ''}`}
	onClick={() => void onPick(r)}
                  >
                    <div className="hdr-tile-cover">
                      {r.cover_url ?
                        <img src={r.cover_url} alt={displayTitle} /> :
                        <span className="cover-fallback">{(displayTitle || '?')[0]}</span>}
                      {isSpotify && (
                        <span className="hdr-tile-badge" title="Spotify">
                          <SpotifyMark size={14} />
                        </span>
                      )}
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
          {(() => {
            const k = filter as BucketKey
            const showLoadMore = !loading && filter !== 'all' && results.length > 0 && lastReturned[k] > 0
            if (!showLoadMore)
              return null
            return (
            <div className="hdr-load-more-row">
              <button
	type="button"
	className="hdr-load-more-btn"
	disabled={loadingMore !== null}
	onClick={() => void loadMore(filter as BucketKey)}
              >
                {loadingMore === filter ? '불러오는 중…' : '더 보기'}
              </button>
            </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

function SpotifyMark({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size}>
      <circle cx="12" cy="12" r="12" fill="#1DB954" />
      <path
	d="M6.5 9.2c3-.9 7.7-.8 10.6.9.4.3.5.8.3 1.2-.3.4-.8.5-1.2.3-2.5-1.5-6.7-1.6-9.3-.8-.5.2-1-.1-1.1-.6-.1-.4.2-.9.7-1zm.4 2.7c2.6-.8 6.4-.7 8.9.8.4.2.5.7.3 1-.2.4-.7.5-1 .3-2.1-1.3-5.5-1.4-7.6-.7-.4.1-.8-.1-.9-.4-.2-.4 0-.8.3-1zm.5 2.6c2.1-.6 4.7-.5 6.8.8.3.2.4.5.2.8-.2.3-.5.4-.8.2-1.8-1.1-4.1-1.2-5.9-.6-.3.1-.7-.1-.7-.4-.1-.3.1-.7.4-.8z"
	fill="#fff"
      />
    </svg>
  )
}
