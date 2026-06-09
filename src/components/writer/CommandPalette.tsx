import type { KeyboardEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
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
import type { AlbumHit, ArtistHit, TrackHit } from '../../lib/useMusicSearch'
import { useMusicSearch } from '../../lib/useMusicSearch'
import ArtistDetail from './ArtistDetail'

const API_BASE = import.meta.env.PUBLIC_API_URL as string

// Bridge the shared hook's hit shapes back to the writer's SearchResultItem so
// the existing render / pick / drill-in code stays untouched.
function toAlbumSR(h: AlbumHit): AlbumSearchResult {
  return { kind: 'album', id: h.id ?? h.spotifyId ?? '', title: h.title, cover_url: h.cover, release_date: h.year, artist_name: h.artist, spotify_id: h.spotifyId, source: h.source }
}
function toArtistSR(h: ArtistHit): ArtistSearchResult {
  return { kind: 'artist', id: h.id ?? h.spotifyId ?? '', name: h.name, cover_url: h.cover, spotify_id: h.spotifyId, source: h.source }
}
function toTrackSR(h: TrackHit): TrackSearchResult {
  return { kind: 'track', id: h.id ?? h.spotifyId ?? '', title: h.title, album_id: h.albumId, album_spotify_id: h.albumSpotifyId, album_title: h.albumTitle, cover_url: h.cover, artist_name: h.artist, feat_artist_names: h.featArtists, spotify_id: h.spotifyId, source: h.source }
}

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

type BucketKey = 'album' | 'artist' | 'track'

// Sections render in this order (Spotify-style: artists first, then albums, then tracks).
const SECTION_ORDER: { kind: BucketKey, label: string }[] = [
  { kind: 'artist', label: '아티스트' },
  { kind: 'album', label: '앨범' },
  { kind: 'track', label: '트랙' },
]

type SourceMode = 'db' | 'spotify'

// ⌘K command palette. Search engine (DB unified + Spotify candidates + paging +
// race/cooldown guards) lives in the shared `useMusicSearch` hook; this owns the
// writer-only UI (filter, keyboard nav, artist drill-in). Renders as an overlay;
// picking a result calls onPick(detail) and the host closes the palette.
export default function CommandPalette({ currentSubjectId, onPick, onClose }: Props) {
  // Shared search engine — DB unified + Spotify candidates, per-bucket paging,
  // CP-1/CP-4 race guards, Spotify cooldown. recallTypes = all 3 (the writer
  // shows every bucket; this also drives artist→album expansion for free).
  const search = useMusicSearch({ recallTypes: ['album', 'artist', 'track'], pageLimit: 20 })
  const [filter, setFilter] = useState<FilterType>('all')
  // Pick-path errors (album-lookup failures) — kept apart from the hook's search
  // status so a lookup error isn't clobbered by a stale search message.
  const [pickStatus, setPickStatus] = useState('')
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
  // CP-2: drill-in sequence guard — backing out of an artist drill-in while its
  // hero fetch is in flight must not re-open the panel when the fetch resolves.
  const drillSeqRef = useRef(0)
  // CP-3: keyboard navigation index over the visible (filtered) result rows.
  const [activeIndex, setActiveIndex] = useState(-1)
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Bridge the hook's hit buckets → SearchResultItem (order: artists, albums,
  // tracks — matches the former merged-search order).
  const results = useMemo<SearchResultItem[]>(
    () => [...search.artists.map(toArtistSR), ...search.albums.map(toAlbumSR), ...search.tracks.map(toTrackSR)],
    [search.albums, search.artists, search.tracks],
  )

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

  const visibleResults = useMemo(
    () => filter === 'all' ? results : results.filter(r => r.kind === filter),
    [results, filter],
  )

  // CP-3: reset the keyboard-active row whenever the visible result set changes
  // (new search, filter toggle, load-more) so the highlight never points at a
  // stale index.
  useEffect(() => {
    setActiveIndex(-1)
  }, [visibleResults])

  // CP-3: keep the active row scrolled into view as the user arrows through.
  useEffect(() => {
    if (activeIndex < 0)
      return
    rowRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  function runActiveSearch() {
    setPickStatus('')
    if (search.source === 'spotify')
      void search.runSpotifySync()
    else
      void search.runDbSearch()
  }

  function onSearchKeyDown(e: KeyboardEvent) {
    // CP-3: ↓/↑ move the active row (clamped to the visible range).
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (visibleResults.length === 0)
        return
      setActiveIndex(prev => prev >= visibleResults.length - 1 ? 0 : prev + 1)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (visibleResults.length === 0)
        return
      setActiveIndex(prev => prev <= 0 ? visibleResults.length - 1 : prev - 1)
      return
    }
    // Ignore Enter while an IME composition is active (e.g. confirming a Hangul
    // candidate) — that Enter belongs to the composition, not the search.
    if (e.key === 'Enter' && e.nativeEvent.isComposing)
      return
    if (e.key === 'Enter') {
      e.preventDefault()
      // CP-3: if a row is active, Enter picks it (artist rows drill in, same as
      // a click). Otherwise fall back to (re-)running the search.
      const active = activeIndex >= 0 ? visibleResults[activeIndex] : undefined
      if (active)
        void onPickResult(active)
      else
        runActiveSearch()
    }
  }

  // Toggle click: switch source and, if there's a query, immediately re-search
  // through the new source. Empty query → color-only flip, no API call.
  function selectSource(next: SourceMode) {
    if (next === search.source)
      return
    setPickStatus('')
    search.setSource(next)
    if (!search.query.trim())
      return
    if (next === 'spotify')
      void search.runSpotifySync()
    else
      void search.runDbSearch()
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
      setPickStatus(args.source === 'spotify' ?
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
      setPickStatus('앨범 정보 없음')
      return
    }
    // Artist → open the drill-in panel.
    void openArtistDrillIn(sr)
  }

  async function openArtistDrillIn(sr: ArtistSearchResult) {
    cancelArtistPoll()
    const seq = ++drillSeqRef.current
    setViewArtistOrigin(sr)
    setViewArtistSource(sr.source ?? 'db')
    setViewArtistHero(null)
    setViewArtistTracks([])
    setViewArtistAlbums([])
    setViewArtistFailed(false)
    setPickStatus('')

    if (sr.source !== 'spotify' && sr.id) {
      setViewArtistPending(true)
      const r = await fetchArtistHero(sr.id)
      if (seq !== drillSeqRef.current)
        return
      if (r.ok) {
        await loadArtistDetail(r.hero, seq)
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
    await pollArtistBySpotify(sr.spotify_id, 0, seq)
  }

  async function pollArtistBySpotify(spotifyId: string, attempt: number, seq: number) {
    const MAX_ATTEMPTS = 15 // 15 × 2 s = 30 s window
    const r = await fetchArtistHeroBySpotify(spotifyId)
    if (seq !== drillSeqRef.current)
      return
    if (r.ok) {
      await loadArtistDetail(r.hero, seq)
      return
    }
    if (attempt >= MAX_ATTEMPTS) {
      setViewArtistPending(false)
      setViewArtistFailed(true)
      return
    }
    viewArtistPollRef.current = setTimeout(() => {
      void pollArtistBySpotify(spotifyId, attempt + 1, seq)
    }, 2000)
  }

  async function loadArtistDetail(hero: ArtistHero, seq: number) {
    if (seq !== drillSeqRef.current)
      return
    cancelArtistPoll()
    setViewArtistHero(hero)
    setViewArtistPending(false)
    setViewArtistFailed(false)
    if (hero.id) {
      const [tracks, albums] = await Promise.all([
        fetchArtistTopTracks(hero.id, 10),
        fetchArtistAlbums(hero.id, 24),
      ])
      if (seq !== drillSeqRef.current)
        return
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
    // CP-2: invalidate any in-flight hero fetch so it can't re-open the panel.
    drillSeqRef.current++
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
	placeholder={search.source === 'spotify' ? 'Spotify에서 검색…' : '평론할 작품 검색…'}
	value={search.query}
	onChange={e => search.setQuery(e.target.value)}
	onKeyDown={onSearchKeyDown}
	autoComplete="off"
	spellCheck={false}
                />
                <span className="wr-src">
                  <button
	type="button"
	className={search.source === 'db' ? 'on' : ''}
	onClick={() => selectSource('db')}
	disabled={search.loading && search.source !== 'db'}
                  >
                    DB
                  </button>
                  <button
	type="button"
	className={search.source === 'spotify' ? 'on spotify' : ''}
	onClick={() => selectSource('spotify')}
	disabled={(search.loading && search.source !== 'spotify') || (search.source !== 'spotify' && search.spotifyCooldown)}
	title={search.source !== 'spotify' && search.spotifyCooldown ? '잠시 후 다시 시도 (Spotify 쿨다운)' : undefined}
                  >
                    <SpotifyMark size={11} color={search.source === 'spotify' ? '#fff' : '#1DB954'} />
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
                  {search.loading ? '검색 중…' : `${visibleResults.length}건`}
                </span>
              </div>

              <div className="wr-palette-body wr-scroll">
                {(pickStatus || search.status) && <div className="wr-palette-status mono">{pickStatus || search.status}</div>}
                {!search.loading && visibleResults.length === 0 && !(pickStatus || search.status) && (
                  <div className="wr-palette-empty mono">
                    {search.query.trim() ? '결과 없음' : '작품 검색'}
                  </div>
                )}
                {SECTION_ORDER.map(({ kind, label }) => {
                  const items = visibleResults.filter(r => r.kind === kind)
                  if (items.length === 0)
                    return null
                  const showLoadMore = filter === kind && !search.loading && search.hasMore[kind] > 0
                  return (
                    <section key={kind} className="wr-palette-section">
                      <div className="wr-palette-seclabel">
                        <span className="wr-seclabel">{label}</span>
                        <span className="mono">{items.length}</span>
                      </div>
                      {items.map((r) => {
                        const flatIndex = visibleResults.indexOf(r)
                        return (
                          <PaletteRow
	key={`${r.kind}:${r.id || r.spotify_id}`}
	ref={(el) => { rowRefs.current[flatIndex] = el }}
	item={r}
	isCurrent={r.kind === 'album' && currentSubjectId === r.id}
	isActive={flatIndex === activeIndex}
	onPick={() => void onPickResult(r)}
                          />
                        )
                      })}
                      {showLoadMore && (
                        <button
	type="button"
	className="wr-palette-more mono"
	disabled={search.loadingMore !== null}
	onClick={() => void search.loadMore(kind)}
                        >
                          {search.loadingMore === kind ? '불러오는 중…' : '더 보기'}
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
                <span className="wr-palette-foot-src">{search.source === 'spotify' ? 'Spotify 카탈로그' : 'Lowfreq DB'}</span>
              </div>
            </>
          )}
      </div>
    </div>
  )
}

function PaletteRow({ item, isCurrent, isActive, onPick, ref }: {
  item: SearchResultItem
  isCurrent: boolean
  isActive: boolean
  onPick: () => void
  ref?: (el: HTMLButtonElement | null) => void
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
    <button
	ref={ref}
	type="button"
	className={`wr-row${isCurrent ? ' is-current' : ''}${isActive ? ' is-active' : ''}`}
	aria-selected={isActive}
      // CP-3: keyboard-active highlight. Inline (not a CSS class) so the cue is
      // self-contained in this component and matches the hover/current tint.
	style={isActive ? { background: 'color-mix(in srgb, var(--accent) 12%, transparent)' } : undefined}
	onClick={onPick}
    >
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
