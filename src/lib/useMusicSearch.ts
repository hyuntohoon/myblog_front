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

// Minimal structural shapes the mappers read. Both the DB (unified) and Spotify
// (candidate) result element types satisfy these, so one mapper handles both.
interface RawAlbum {
  id?: string | null
  title?: string | null
  artist_name?: string | null
  cover_url?: string | null
  release_date?: string | null
  spotify_id?: string | null
}
interface RawArtist {
  id?: string | null
  name?: string | null
  cover_url?: string | null
  spotify_id?: string | null
}
interface RawTrack {
  id?: string | null
  title?: string | null
  artist_name?: string | null
  album_id?: string | null
  album_title?: string | null
  cover_url?: string | null
  spotify_id?: string | null
}

const MUSIC = import.meta.env.PUBLIC_API_URL as string

// Spotify candidates enqueues SQS absorb jobs; rapid re-firing wastes quota and
// crowds the queue. 3 s cooldown matches the writer's BUG-19-era guard.
const SPOTIFY_COOLDOWN_MS = 3000

export type SearchKind = 'album' | 'artist' | 'track'
export type HitSource = 'db' | 'spotify'

export interface AlbumHit {
  kind: 'album'
  id: string | null
  title: string
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
  albumId: string | null
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
    cover: ar.cover_url ?? null,
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
    albumId: t.album_id ?? null,
    albumTitle: t.album_title ?? null,
    cover: t.cover_url ?? null,
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
  source: HitSource
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
  const [query, setQuery] = useState('')
  const [buckets, setBuckets] = useState<Buckets>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState<SearchKind | null>(null)
  const [status, setStatus] = useState('')
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

  const typeParam = recallTypes.join(',')

  const reset = useCallback(() => {
    setQuery('')
    setBuckets(EMPTY)
    setStatus('')
    setOffsets(ZERO)
    setLastReturned(ZERO)
  }, [])

  const runDbSearch = useCallback(async () => {
    const q = query.trim()
    if (!q)
      return
    const seq = ++seqRef.current
    setSource('db')
    setLoading(true)
    setStatus('')
    setBuckets(EMPTY)
    setOffsets(ZERO)
    setLastReturned(ZERO)
    try {
      const r = await fetch(
        `${MUSIC}/api/music/search/unified?q=${encodeURIComponent(q)}&type=${typeParam}&limit=${pageLimit}&offset=0`,
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
      if (seq === seqRef.current)
        setStatus('검색 실패')
    }
    finally {
      if (seq === seqRef.current)
        setLoading(false)
    }
  }, [query, typeParam, pageLimit])

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
    setSource('spotify')
    setLoading(true)
    setStatus('Spotify 싱크 중…')
    setBuckets(EMPTY)
    // Spotify candidates don't support per-bucket offset paging — no "더 보기".
    setOffsets(ZERO)
    setLastReturned(ZERO)
    try {
      const r = await apiFetch(
        `${MUSIC}/api/music/search/candidates?q=${encodeURIComponent(q)}&type=${typeParam}&limit=20`,
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
      const total = album.length + artist.length + track.length
      setStatus(total === 0 ? 'Spotify에도 결과 없음' : 'Spotify 결과')
    }
    catch {
      if (seq === seqRef.current)
        setStatus('Spotify 싱크 실패')
    }
    finally {
      if (seq === seqRef.current)
        setLoading(false)
    }
  }, [query, typeParam])

  const loadMore = useCallback(async (kind: SearchKind) => {
    const q = query.trim()
    // Paging only applies to DB results; Spotify view has no offset paging.
    if (!q || loadingMore || source !== 'db')
      return
    // CP-4: pin the seq + query this load-more was started against; if either
    // changes before the response resolves, appending would corrupt the list.
    const seq = seqRef.current
    setLoadingMore(kind)
    try {
      const params = new URLSearchParams({
        q,
        type: typeParam,
        limit: String(pageLimit),
        offset: '0',
        [`${kind}_offset`]: String(offsets[kind]),
      })
      const r = await fetch(`${MUSIC}/api/music/search/unified?${params.toString()}`)
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
      let didAppend = false
      setBuckets((prev) => {
        const existing = new Set(prev[kind].map((row: { id: string | null, spotifyId: string | null }) => row.id ?? row.spotifyId))
        const fresh = appended.filter(row => !existing.has(row.id ?? row.spotifyId))
        if (fresh.length === 0)
          return prev
        didAppend = true
        return { ...prev, [kind]: [...prev[kind], ...fresh] }
      })
      if (!didAppend && returned > 0) {
        setLastReturned(prev => ({ ...prev, [kind]: 0 }))
        return
      }
      setOffsets(prev => ({ ...prev, [kind]: prev[kind] + returned }))
      setLastReturned(prev => ({ ...prev, [kind]: returned }))
    }
    catch {
      if (seq === seqRef.current && query.trim() === q)
        setStatus('추가 로드 실패')
    }
    finally {
      setLoadingMore(null)
    }
  }, [query, typeParam, pageLimit, offsets, loadingMore, source])

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
    source,
    spotifyCooldown,
    hasMore,
    runDbSearch,
    runSpotifySync,
    loadMore,
    reset,
  }
}
