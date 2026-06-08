import type { KeyboardEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
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
  currentSubjectId: string | null
  onPick: (album: AlbumDetail) => void
  onClose: () => void
}

const FILTERS = [
  { v: 'all', l: '전체' },
  { v: 'album', l: '앨범' },
  { v: 'artist', l: '아티스트' },
  { v: 'track', l: '트랙' },
] as const

type FilterType = typeof FILTERS[number]['v']

// Backend search always fetches all 3 types so filter toggles can be applied
// instantly client-side without re-hitting the API.
const BACKEND_TYPES = 'album,artist,track'

type BucketKey = 'album' | 'artist' | 'track'

// Sections render in this order (Spotify-style: artists first, then albums, then tracks).
const SECTION_ORDER: { kind: BucketKey, label: string }[] = [
  { kind: 'artist', label: '아티스트' },
  { kind: 'album', label: '앨범' },
  { kind: 'track', label: '트랙' },
]
type BucketOffsets = Record<BucketKey, number>
type BucketLastReturned = Record<BucketKey, number>

const ZERO_OFFSETS: BucketOffsets = { album: 0, artist: 0, track: 0 }
const ZERO_RETURNED: BucketLastReturned = { album: 0, artist: 0, track: 0 }
const PAGE_LIMIT = 20

type SourceMode = 'db' | 'spotify'

// Spotify candidates endpoint enqueues SQS absorb jobs; rapid re-firing wastes
// quota and crowds the queue. 3 s cooldown matches BUG-19 era guard.
const SPOTIFY_COOLDOWN_MS = 3000

// ⌘K command palette. Owns all search state (DB unified search, Spotify
// candidates + SQS absorb, per-bucket pagination, artist drill-in) — lifted
// from the former inline SubjectBlock. Renders as an overlay; picking a result
// calls onPick(detail) and the host closes the palette.
export default function CommandPalette({ currentSubjectId, onPick, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResultItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState<BucketKey | null>(null)
  const [filter, setFilter] = useState<FilterType>('all')
  const [status, setStatus] = useState('')
  const [source, setSource] = useState<SourceMode>('db')
  const [spotifyCooldown, setSpotifyCooldown] = useState(false)
  const spotifyCooldownRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Artist drill-in state. When set, the result list is hidden and ArtistDetail
  // renders instead. `viewArtistSource` remembers which source the click came
  // from so the panel labels itself and the artist-as-subject pick keeps
  // provenance.
  const [viewArtistSource, setViewArtistSource] = useState<SourceMode>('db')
  const [viewArtistHero, setViewArtistHero] = useState<ArtistHero | null>(null)
  const [viewArtistTracks, setViewArtistTracks] = useState<TopTrackItem[]>([])
  const [viewArtistAlbums, setViewArtistAlbums] = useState<AlbumListItem[]>([])
  const [viewArtistPending, setViewArtistPending] = useState(false)
  const [viewArtistFailed, setViewArtistFailed] = useState(false)
  const [viewArtistOrigin, setViewArtistOrigin] = useState<ArtistSearchResult | null>(null)
  const viewArtistPollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // BUG-19: per-bucket pagination — `offsets[kind]` is the next offset to ask
  // for; `lastReturned[kind]` controls "더 보기" visibility (hide once a round
  // returns zero rows for that bucket).
  const [offsets, setOffsets] = useState<BucketOffsets>(ZERO_OFFSETS)
  const [lastReturned, setLastReturned] = useState<BucketLastReturned>(ZERO_RETURNED)

  const inDrillIn = viewArtistHero !== null || viewArtistPending || viewArtistFailed

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // esc closes the palette (unless drilled into an artist — there esc backs out).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape')
        return
      if (inDrillIn)
        closeArtistDrillIn()
      else
        onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inDrillIn, onClose])

  useEffect(() => () => cancelArtistPoll(), [])

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
      setResults([...artists, ...albums, ...tracks])
      setOffsets({ album: albums.length, artist: artists.length, track: tracks.length })
      setLastReturned({ album: albums.length, artist: artists.length, track: tracks.length })
      if (albums.length + artists.length + tracks.length === 0)
        setStatus('DB에 결과 없음')
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
    setStatus('Spotify 싱크 중…')
    setResults([])
    // Spotify candidates don't support per-bucket offset paging, so hide
    // "더 보기" while in Spotify view.
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
      const merged: SearchResultItem[] = [...artists, ...albums, ...tracks]
      setResults(merged)
      setStatus(merged.length === 0 ? 'Spotify에도 결과 없음' : 'Spotify 결과')
    }
    catch {
      setStatus('Spotify 싱크 실패')
    }
    finally {
      setLoading(false)
    }
  }

  const visibleResults = useMemo(
    () => filter === 'all' ? results : results.filter(r => r.kind === filter),
    [results, filter],
  )

  function runActiveSearch() {
    if (source === 'spotify')
      void runSpotifySync()
    else
      void runDBSearch()
  }

  function onSearchKeyDown(e: KeyboardEvent) {
    // Ignore Enter while an IME composition is active (e.g. confirming a Hangul
    // candidate) — that Enter belongs to the composition, not the search.
    if (e.key === 'Enter' && e.nativeEvent.isComposing)
      return
    if (e.key === 'Enter') {
      e.preventDefault()
      runActiveSearch()
    }
  }

  // Toggle click: switch source and, if there's a query, immediately re-search
  // through the new source. Empty query → color-only flip, no API call.
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
      onPick(detail)
      onClose()
    }
    catch {
      setStatus(args.source === 'spotify' ?
        '앨범을 다시 선택해주세요' :
        '앨범 정보 조회 실패')
    }
  }

  async function onPickResult(sr: SearchResultItem) {
    if (sr.kind === 'album') {
      // Route by identifier: spotify_id → /by-spotify, else DB UUID → /{id}.
      const url = sr.spotify_id ?
        `${API_BASE}/api/music/albums/by-spotify/${encodeURIComponent(sr.spotify_id)}` :
        `${API_BASE}/api/music/albums/${encodeURIComponent(sr.id)}`
      await selectAlbumByLookup({ lookupUrl: url, source: sr.source })
      return
    }
    if (sr.kind === 'track') {
      // Track click → select the parent album for review.
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
      setStatus('앨범 정보 없음')
      return
    }
    // Artist → open the drill-in panel.
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
    await pollArtistBySpotify(sr.spotify_id, 0)
  }

  async function pollArtistBySpotify(spotifyId: string, attempt: number) {
    const MAX_ATTEMPTS = 15 // 15 × 2 s = 30 s window
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
    if (!album.id)
      return
    await selectAlbumByLookup({
      lookupUrl: `${API_BASE}/api/music/albums/${encodeURIComponent(album.id)}`,
      source: viewArtistSource,
    })
  }

  async function onPickTrackFromDrillIn(track: TopTrackItem) {
    if (!track.album_id)
      return
    await selectAlbumByLookup({
      lookupUrl: `${API_BASE}/api/music/albums/${encodeURIComponent(track.album_id)}`,
      source: viewArtistSource,
    })
  }

  function onPickArtistAsSubject(hero: ArtistHero) {
    // Artist-as-subject: WriterApp branches on kind='artist' when building the
    // payload (album_ids=[] + artist_ids=[id]). Cover falls back to photo_url.
    if (!hero.id)
      return
    onPick({
      id: hero.id,
      title: hero.name,
      cover_url: hero.photo_url ?? null,
      release_date: null,
      artists: [{ id: hero.id, name: hero.name }],
      tracks: [],
      kind: 'artist',
    })
    onClose()
  }

  return (
    <div className="wr-palette-scrim" onClick={onClose}>
      <div className="wr-palette" onClick={e => e.stopPropagation()} role="dialog" aria-label="작품 검색">
        {inDrillIn ?
          (
            <div className="wr-palette-drillin">
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
                  if (viewArtistOrigin)
                    void openArtistDrillIn(viewArtistOrigin)
                }}
              />
            </div>
          ) :
          (
            <>
              <div className="wr-palette-head">
                <span className="wr-palette-ico" aria-hidden>⌕</span>
                <input
	ref={inputRef}
	className="wr-palette-input"
	placeholder={source === 'spotify' ? 'Spotify에서 검색…' : '평론할 작품 검색…'}
	value={query}
	onChange={e => setQuery(e.target.value)}
	onKeyDown={onSearchKeyDown}
	autoComplete="off"
	spellCheck={false}
                />
                <span className="wr-src">
                  <button
	type="button"
	className={source === 'db' ? 'on' : ''}
	onClick={() => selectSource('db')}
	disabled={loading && source !== 'db'}
                  >
                    DB
                  </button>
                  <button
	type="button"
	className={source === 'spotify' ? 'on spotify' : ''}
	onClick={() => selectSource('spotify')}
	disabled={(loading && source !== 'spotify') || (source !== 'spotify' && spotifyCooldown)}
	title={source !== 'spotify' && spotifyCooldown ? '잠시 후 다시 시도 (Spotify 쿨다운)' : undefined}
                  >
                    <SpotifyMark size={11} color={source === 'spotify' ? '#fff' : '#1DB954'} />
                    Spotify
                  </button>
                </span>
              </div>

              <div className="wr-palette-filters">
                {FILTERS.map(f => (
                  <button
	key={f.v}
	type="button"
	className={`wr-fpill${filter === f.v ? ' on' : ''}`}
	onClick={() => setFilter(f.v)}
                  >
                    {f.l}
                  </button>
                ))}
                <span className="wr-palette-count mono">
                  {loading ? '검색 중…' : `${visibleResults.length}건`}
                </span>
              </div>

              <div className="wr-palette-body wr-scroll">
                {status && <div className="wr-palette-status mono">{status}</div>}
                {!loading && visibleResults.length === 0 && !status && (
                  <div className="wr-palette-empty mono">
                    {query.trim() ? '결과 없음' : '작품 검색'}
                  </div>
                )}
                {SECTION_ORDER.map(({ kind, label }) => {
                  const items = visibleResults.filter(r => r.kind === kind)
                  if (items.length === 0)
                    return null
                  const showLoadMore = filter === kind && !loading && lastReturned[kind] > 0
                  return (
                    <section key={kind} className="wr-palette-section">
                      <div className="wr-palette-seclabel">
                        <span className="wr-seclabel">{label}</span>
                        <span className="mono">{items.length}</span>
                      </div>
                      {items.map(r => (
                        <PaletteRow
	key={`${r.kind}:${r.id || r.spotify_id}`}
	item={r}
	isCurrent={r.kind === 'album' && currentSubjectId === r.id}
	onPick={() => void onPickResult(r)}
                        />
                      ))}
                      {showLoadMore && (
                        <button
	type="button"
	className="wr-palette-more mono"
	disabled={loadingMore !== null}
	onClick={() => void loadMore(kind)}
                        >
                          {loadingMore === kind ? '불러오는 중…' : '더 보기'}
                        </button>
                      )}
                    </section>
                  )
                })}
              </div>

              <div className="wr-palette-foot mono">
                <span>
<b>↵</b>
{' '}
선택
                </span>
                <span>
<b>esc</b>
{' '}
닫기
                </span>
                <span className="wr-palette-foot-src">{source === 'spotify' ? 'Spotify 카탈로그' : 'Lowfreq DB'}</span>
              </div>
            </>
          )}
      </div>
    </div>
  )
}

function PaletteRow({ item, isCurrent, onPick }: {
  item: SearchResultItem
  isCurrent: boolean
  onPick: () => void
}) {
  const isArtist = item.kind === 'artist'
  const displayTitle = isArtist ? item.name : item.title
  let subtitle = ''
  if (item.kind === 'album') {
    subtitle = [item.artist_name, item.release_date?.slice(0, 4)].filter(Boolean).join(' · ')
}
  else if (item.kind === 'track') {
    const feat = item.feat_artist_names ?? []
    const artistPart = feat.length ? `${item.artist_name} (feat. ${feat.join(', ')})` : (item.artist_name ?? '')
    subtitle = item.album_title ? `${artistPart} · ${item.album_title}` : artistPart
  }
  else {
    subtitle = '아티스트'
}
  const kindLabel = item.kind === 'album' ? '앨범' : item.kind === 'track' ? '트랙' : '아티스트'
  const isSpotify = item.source === 'spotify'
  return (
    <button type="button" className={`wr-row${isCurrent ? ' is-current' : ''}`} onClick={onPick}>
      <span className={`wr-row-cover${isArtist ? ' is-artist' : ''}`}>
        {item.cover_url ?
          <img src={item.cover_url} alt="" loading="lazy" /> :
          <span className="wr-row-fallback">{(displayTitle || '?')[0]}</span>}
      </span>
      <span className="wr-row-text">
        <span className="wr-row-name">{displayTitle}</span>
        <span className="wr-row-sub">
          <span className="wr-row-kind">{kindLabel}</span>
          {subtitle}
        </span>
      </span>
      {isSpotify && <SpotifyMark size={13} />}
    </button>
  )
}

function SpotifyMark({ size, color = '#1DB954' }: { size: number, color?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="12" fill={color} />
      <path
	d="M6.5 9.2c3-.9 7.7-.8 10.6.9.4.3.5.8.3 1.2-.3.4-.8.5-1.2.3-2.5-1.5-6.7-1.6-9.3-.8-.5.2-1-.1-1.1-.6-.1-.4.2-.9.7-1zm.4 2.7c2.6-.8 6.4-.7 8.9.8.4.2.5.7.3 1-.2.4-.7.5-1 .3-2.1-1.3-5.5-1.4-7.6-.7-.4.1-.8-.1-.9-.4-.2-.4 0-.8.3-1zm.5 2.6c2.1-.6 4.7-.5 6.8.8.3.2.4.5.2.8-.2.3-.5.4-.8.2-1.8-1.1-4.1-1.2-5.9-.6-.3.1-.7-.1-.7-.4-.1-.3.1-.7.4-.8z"
	fill={color === '#fff' ? '#1DB954' : '#fff'}
      />
    </svg>
  )
}
