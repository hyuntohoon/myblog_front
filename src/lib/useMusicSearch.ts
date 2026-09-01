// FEAT-music-search-bucket-recall — shared headless music-search core.
//
// Extracted so the album-only "평론 버킷" (AddAlbumModal) and, later, the
// writer's CommandPalette can share one search core instead of hand-rolling
// near-identical fetch + race-guard + cooldown logic twice.
//
// The key recall fix lives in `recallTypes`: the DB unified endpoint only runs
// artist-name/alias matching (and the artist→album expansion at
// search_service.py:198) when "artist" is among the requested `type`s. An
// album-only consumer that wants those albums must still REQUEST artist (for
// recall) while only RENDERING albums. Pass recallTypes=['album','artist'] and
// read `albums` — searching "방탄소년단" then surfaces their discography, which
// type=album alone returns as zero rows.
import { useCallback, useRef, useState } from 'react'
import type { components } from './api.gen'
import { apiFetch } from './api'

type UnifiedSearchResult = components['schemas']['Music_UnifiedSearchResult']
type CandidateSearchResult = components['schemas']['Music_CandidateSearchResult']
type AlbumSyncRequest = components['schemas']['Music_AlbumSyncRequest']
type AlbumSyncAccepted = components['schemas']['Music_AlbumSyncAccepted']

// Minimal structural shapes the mappers read. Both the DB (unified) and Spotify
// (candidate) result element types satisfy these, so one mapper handles both.
interface RawAlbum {
  id?: string | null
  title?: string | null
  artist_id?: string | null
  artist_name?: string | null
  cover_url?: string | null
  release_date?: string | null
  spotify_id?: string | null
}
interface RawArtist {
  id?: string | null
  name?: string | null
  cover_url?: string | null
  // Spotify candidates carry the image as `photo_url` instead of `cover_url`.
  photo_url?: string | null
  spotify_id?: string | null
}
interface RawTrack {
  id?: string | null
  title?: string | null
  artist_name?: string | null
  feat_artist_names?: string[] | null
  album_id?: string | null
  album_spotify_id?: string | null
  album_title?: string | null
  cover_url?: string | null
  spotify_id?: string | null
  // Spotify candidate tracks nest the album fields under `album` instead of flat.
  album?: { spotify_id?: string | null, title?: string | null, cover_url?: string | null } | null
}

const MUSIC = import.meta.env.PUBLIC_API_URL as string

// A Spotify sync is a read-only candidate GET followed by an explicit enqueue
// POST. Rapid re-firing still wastes provider quota and crowds the queue.
const SPOTIFY_COOLDOWN_MS = 3000

export type SearchKind = 'album' | 'artist' | 'track'
export type HitSource = 'db' | 'spotify'

export interface AlbumHit {
  kind: 'album'
  id: string | null
  title: string
  artistId: string | null
  artist: string | null
  cover: string | null
  year: string | null
  spotifyId: string | null
  source: HitSource
}

export interface ArtistHit {
  kind: 'artist'
  id: string | null
  name: string
  cover: string | null
  spotifyId: string | null
  source: HitSource
}

export interface TrackHit {
  kind: 'track'
  id: string | null
  title: string
  artist: string | null
  featArtists: string[]
  albumId: string | null
  albumSpotifyId: string | null
  albumTitle: string | null
  cover: string | null
  spotifyId: string | null
  source: HitSource
}

interface Buckets { album: AlbumHit[], artist: ArtistHit[], track: TrackHit[] }
type Counts = Record<SearchKind, number>

const EMPTY: Buckets = { album: [], artist: [], track: [] }
const ZERO: Counts = { album: 0, artist: 0, track: 0 }

function mapAlbums(arr: RawAlbum[] | null | undefined, source: HitSource): AlbumHit[] {
  return (arr ?? []).map(a => ({
    kind: 'album' as const,
    // Spotify-only hits have no DB id yet — resolve via /albums/by-spotify on pick.
    id: source === 'spotify' ? null : (a.id ?? null),
    title: a.title ?? '',
    artistId: a.artist_id ?? null,
    artist: a.artist_name ?? null,
    cover: a.cover_url ?? null,
    year: a.release_date ? a.release_date.slice(0, 4) : null,
    spotifyId: a.spotify_id ?? null,
    source,
  }))
}

function mapArtists(arr: RawArtist[] | null | undefined, source: HitSource): ArtistHit[] {
  return (arr ?? []).map(ar => ({
    kind: 'artist' as const,
    id: source === 'spotify' ? null : (ar.id ?? null),
    name: ar.name ?? '',
    cover: ar.cover_url ?? ar.photo_url ?? null,
    spotifyId: ar.spotify_id ?? null,
    source,
  }))
}

function mapTracks(arr: RawTrack[] | null | undefined, source: HitSource): TrackHit[] {
  return (arr ?? []).map(t => ({
    kind: 'track' as const,
    id: source === 'spotify' ? null : (t.id ?? null),
    title: t.title ?? '',
    artist: t.artist_name ?? null,
    featArtists: t.feat_artist_names ?? [],
    albumId: t.album_id ?? null,
    // unified track carries album_spotify_id flat; candidate nests under album.
    albumSpotifyId: t.album_spotify_id ?? t.album?.spotify_id ?? null,
    albumTitle: t.album_title ?? t.album?.title ?? null,
    cover: t.cover_url ?? t.album?.cover_url ?? null,
    spotifyId: t.spotify_id ?? null,
    source,
  }))
}

function dedupeBySpotify<T extends { id: string | null, spotifyId: string | null }>(rows: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const r of rows) {
    const key = r.id ?? r.spotifyId
    if (key && seen.has(key))
      continue
    if (key)
      seen.add(key)
    out.push(r)
  }
  return out
}

export interface UseMusicSearch {
  query: string
  setQuery: (q: string) => void
  albums: AlbumHit[]
  artists: ArtistHit[]
  tracks: TrackHit[]
  loading: boolean
  loadingMore: SearchKind | null
  status: string
  /**
   * FIX-user-flow-state-consistency leg 3 — the last primary search failed on
   * the wire or with a non-2xx. `status` already carried a Korean sentence for
   * this, but it is a display string that also carries "DB에 결과 없음" and the
   * Spotify messages, so a consumer could not tell a dead backend from a real
   * zero-result answer without matching on prose. This is the machine-readable
   * half; surfaces render an explicit error state off it instead of the
   * no-results copy.
   */
  searchFailed: boolean
  /** Same, for a "더 보기" page that failed — scoped to the bucket that asked. */
  moreFailed: SearchKind | null
  /**
   * FIX-user-flow-state-consistency leg 4 — a Spotify sync request has been
   * accepted for the current query and the worker has not been heard from
   * since. There is no job-status contract to wait on (that design is tracked
   * separately and deliberately not smuggled in here), so this does not claim
   * the sync finished. It exists so a surface can offer the catalog re-read
   * the reader currently has to improvise by pressing 검색 again — without it,
   * an accepted sync leaves them holding Spotify rows they cannot add and no
   * indication that trying again is the move.
   */
  syncRequested: boolean
  source: HitSource
  /** Flip the source label without running a search (e.g. empty-query toggle). */
  setSource: (s: HitSource) => void
  spotifyCooldown: boolean
  hasMore: Counts
  runDbSearch: () => Promise<void>
  runSpotifySync: () => Promise<void>
  loadMore: (kind: SearchKind) => Promise<void>
  reset: () => void
}

export interface UseMusicSearchOptions {
  /**
   * Types sent to the API for RECALL. Include 'artist' so artist→album
   *  expansion fires even when you only render albums.
   */
  recallTypes: SearchKind[]
  /** Page size per bucket. */
  pageLimit?: number
}

export function useMusicSearch({ recallTypes, pageLimit = 20 }: UseMusicSearchOptions): UseMusicSearch {
  const [query, setQueryState] = useState('')
  const [buckets, setBuckets] = useState<Buckets>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState<SearchKind | null>(null)
  const [status, setStatus] = useState('')
  const [searchFailed, setSearchFailed] = useState(false)
  const [moreFailed, setMoreFailed] = useState<SearchKind | null>(null)
  const [syncRequested, setSyncRequested] = useState(false)
  const [source, setSource] = useState<HitSource>('db')
  const [spotifyCooldown, setSpotifyCooldown] = useState(false)
  // next offset to ask for, per bucket
  const [offsets, setOffsets] = useState<Counts>(ZERO)
  // last round's returned count per bucket — drives "더 보기" visibility
  const [lastReturned, setLastReturned] = useState<Counts>(ZERO)

  const cooldownRef = useRef(false)
  // CP-1: monotonic search-sequence guard — a slow earlier response must never
  // overwrite a newer query's results.
  const seqRef = useRef(0)
  // REFACTOR Step 2: cancel the in-flight request when a newer one starts, so a
  // superseded search-as-you-type fetch is aborted on the wire — not just dropped
  // after it arrives (the seqRef guard). One ref covers all three network ops.
  const abortRef = useRef<AbortController | null>(null)
  const invalidateRequests = useCallback(() => {
    seqRef.current += 1
    abortRef.current?.abort()
  }, [])
  const setQuery = useCallback((next: string) => {
    invalidateRequests()
    setQueryState(next)
    setLoading(false)
    setLoadingMore(null)
    setStatus('')
    setSearchFailed(false)
    setMoreFailed(null)
    setSyncRequested(false)
  }, [invalidateRequests])
  const nextSignal = useCallback(() => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    return ac.signal
  }, [])

  const typeParam = recallTypes.join(',')

  const reset = useCallback(() => {
    invalidateRequests()
    setQueryState('')
    setLoading(false)
    setLoadingMore(null)
    setBuckets(EMPTY)
    setStatus('')
    setSearchFailed(false)
    setMoreFailed(null)
    setSyncRequested(false)
    setOffsets(ZERO)
    setLastReturned(ZERO)
  }, [invalidateRequests])

  const runDbSearch = useCallback(async () => {
    const q = query.trim()
    if (!q)
      return
    const seq = ++seqRef.current
    const signal = nextSignal()
    setSource('db')
    setLoading(true)
    setStatus('')
    setSearchFailed(false)
    setMoreFailed(null)
    // a DB re-read IS the refresh, so it retires the offer rather than leaving
    // it on screen next to results that already reflect the sync
    setSyncRequested(false)
    setBuckets(EMPTY)
    setOffsets(ZERO)
    setLastReturned(ZERO)
    try {
      const r = await fetch(
        `${MUSIC}/api/music/search/unified?q=${encodeURIComponent(q)}&type=${typeParam}&limit=${pageLimit}&offset=0`,
        { signal },
      )
      if (!r.ok)
        throw new Error(`HTTP ${r.status}`)
      const data = await r.json() as UnifiedSearchResult
      // CP-1: a newer search superseded this one — drop its results.
      if (seq !== seqRef.current)
        return
      const album = dedupeBySpotify(mapAlbums(data.albums, 'db'))
      const artist = dedupeBySpotify(mapArtists(data.artists, 'db'))
      const track = dedupeBySpotify(mapTracks(data.tracks, 'db'))
      setBuckets({ album, artist, track })
      setOffsets({ album: album.length, artist: artist.length, track: track.length })
      setLastReturned({ album: album.length, artist: artist.length, track: track.length })
      if (album.length + artist.length + track.length === 0)
        setStatus('DB에 결과 없음')
    }
    catch {
      // An abort (superseded by a newer search) is not a failure — the seqRef
      // guard already suppresses stale results; don't flash 검색 실패.
      if (seq === seqRef.current && !signal.aborted) {
        setStatus('검색 실패')
        setSearchFailed(true)
      }
    }
    finally {
      if (seq === seqRef.current)
        setLoading(false)
    }
  }, [query, typeParam, pageLimit, nextSignal])

  const runSpotifySync = useCallback(async () => {
    const q = query.trim()
    if (!q || cooldownRef.current)
      return
    cooldownRef.current = true
    setSpotifyCooldown(true)
    setTimeout(() => {
      cooldownRef.current = false
      setSpotifyCooldown(false)
    }, SPOTIFY_COOLDOWN_MS)
    const seq = ++seqRef.current
    const signal = nextSignal()
    setSource('spotify')
    setLoading(true)
    setStatus('Spotify 검색 중…')
    setBuckets(EMPTY)
    // Spotify candidates don't support per-bucket offset paging — no "더 보기".
    setOffsets(ZERO)
    setLastReturned(ZERO)
    let candidateSearchSucceeded = false
    try {
      const r = await apiFetch(
        `${MUSIC}/api/music/search/candidates?q=${encodeURIComponent(q)}&type=${typeParam}&limit=20`,
        { signal },
      )
      if (!r || !r.ok)
        throw new Error(`HTTP ${r?.status}`)
      const data = await r.json() as CandidateSearchResult
      if (seq !== seqRef.current)
        return
      const album = dedupeBySpotify(mapAlbums(data.albums, 'spotify'))
      const artist = dedupeBySpotify(mapArtists(data.artists, 'spotify'))
      const track = dedupeBySpotify(mapTracks(data.tracks, 'spotify'))
      setBuckets({ album, artist, track })
      candidateSearchSucceeded = true
      const total = album.length + artist.length + track.length
      const albumIds = [...new Set([
        ...(data.albums ?? []).map(item => item.spotify_id),
        ...(data.tracks ?? []).map(item => item.album?.spotify_id),
      ].filter((id): id is string => Boolean(id)))]
      if (albumIds.length === 0) {
        setStatus(total === 0 ? 'Spotify에도 결과 없음' : 'Spotify 결과 · 동기화할 앨범 없음')
        return
      }

      setStatus('Spotify 결과 · 동기화 요청 중…')
      const payload: AlbumSyncRequest = { album_ids: albumIds, market: 'KR' }
      const accepted = await apiFetch(`${MUSIC}/api/music/sync-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      })
      if (!accepted || accepted.status !== 202)
        throw new Error(`HTTP ${accepted?.status}`)
      const acceptedBody = await accepted.json() as AlbumSyncAccepted
      if (acceptedBody.status !== 'accepted')
        throw new Error('sync request was not accepted')
      if (seq !== seqRef.current)
        return
      setStatus('Spotify 결과 · 동기화 요청됨')
      setSyncRequested(true)
    }
    catch {
      // apiFetch swallows an abort into a null return (→ HTTP undefined throw
      // above); guard on the signal so a superseded sync doesn't flash a failure.
      if (seq === seqRef.current && !signal.aborted) {
        setStatus(candidateSearchSucceeded ?
          'Spotify 결과 · 동기화 요청 실패' :
          'Spotify 검색 실패')
      }
    }
    finally {
      if (seq === seqRef.current)
        setLoading(false)
    }
  }, [query, typeParam, nextSignal])

  const loadMore = useCallback(async (kind: SearchKind) => {
    const q = query.trim()
    // Paging only applies to DB results; Spotify view has no offset paging.
    if (!q || loadingMore || source !== 'db')
      return
    // CP-4: pin the seq + query this load-more was started against; if either
    // changes before the response resolves, appending would corrupt the list.
    const seq = seqRef.current
    const signal = nextSignal()
    setLoadingMore(kind)
    setMoreFailed(null)
    try {
      const params = new URLSearchParams({
        q,
        type: typeParam,
        limit: String(pageLimit),
        offset: '0',
        [`${kind}_offset`]: String(offsets[kind]),
      })
      const r = await fetch(`${MUSIC}/api/music/search/unified?${params.toString()}`, { signal })
      if (!r.ok)
        throw new Error(`HTTP ${r.status}`)
      const data = await r.json() as UnifiedSearchResult
      if (seq !== seqRef.current || query.trim() !== q)
        return
      const appended: (AlbumHit | ArtistHit | TrackHit)[] =
        kind === 'album' ?
mapAlbums(data.albums, 'db') :
          kind === 'artist' ?
mapArtists(data.artists, 'db') :
            mapTracks(data.tracks, 'db')
      const returned = appended.length
      // FIX-user-flow-state-consistency leg 4 — dedupe against the CURRENT
      // buckets, not from inside the setBuckets updater.
      //
      // This used to set a `didAppend` flag inside that updater and read it on
      // the next line. React runs an updater during render, not at the call
      // site; the one case where it evaluates one eagerly needs the fiber to
      // have no pending lanes, and `setLoadingMore(kind)` a few lines up
      // guarantees it does. So the flag was always false, every successful page
      // took the "the API repeated itself" branch below, and 더 보기 zeroed
      // itself out while `offsets` never advanced — one page was all you could
      // load. Reading `buckets` directly is honest and synchronous; the
      // callback already re-creates on every result via its `offsets` dep.
      const existing = new Set(
        buckets[kind].map((row: { id: string | null, spotifyId: string | null }) => row.id ?? row.spotifyId),
      )
      const fresh = appended.filter(row => !existing.has(row.id ?? row.spotifyId))
      if (fresh.length > 0)
        setBuckets(prev => ({ ...prev, [kind]: [...prev[kind], ...fresh] }))
      if (fresh.length === 0 && returned > 0) {
        setLastReturned(prev => ({ ...prev, [kind]: 0 }))
        return
      }
      setOffsets(prev => ({ ...prev, [kind]: prev[kind] + returned }))
      setLastReturned(prev => ({ ...prev, [kind]: returned }))
    }
    catch {
      if (seq === seqRef.current && query.trim() === q && !signal.aborted) {
        setStatus('추가 로드 실패')
        setMoreFailed(kind)
      }
    }
    finally {
      setLoadingMore(null)
    }
  }, [query, typeParam, pageLimit, offsets, buckets, loadingMore, source, nextSignal])

  const hasMore: Counts = {
    album: source === 'db' && lastReturned.album >= pageLimit ? 1 : 0,
    artist: source === 'db' && lastReturned.artist >= pageLimit ? 1 : 0,
    track: source === 'db' && lastReturned.track >= pageLimit ? 1 : 0,
  }

  return {
    query,
    setQuery,
    albums: buckets.album,
    artists: buckets.artist,
    tracks: buckets.track,
    loading,
    loadingMore,
    status,
    searchFailed,
    moreFailed,
    syncRequested,
    source,
    setSource,
    spotifyCooldown,
    hasMore,
    runDbSearch,
    runSpotifySync,
    loadMore,
    reset,
  }
}
