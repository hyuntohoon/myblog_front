export interface AlbumSearchResult {
  kind: 'album'
  id: string
  title: string
  cover_url: string | null
  release_date: string | null
  artist_name: string | null
  spotify_id: string | null
  source?: 'db' | 'spotify'
}

export interface ArtistSearchResult {
  kind: 'artist'
  id: string
  name: string
  cover_url: string | null
  spotify_id: string | null
  source?: 'db' | 'spotify'
}

export interface TrackSearchResult {
  kind: 'track'
  id: string
  title: string
  album_id: string | null
  album_spotify_id: string | null
  album_title: string | null
  cover_url: string | null
  artist_name: string | null
  feat_artist_names: string[]
  spotify_id: string | null
  source?: 'db' | 'spotify'
}

export type SearchResultItem = AlbumSearchResult | ArtistSearchResult | TrackSearchResult

export interface TrackInfo {
  id: string
  title: string
  track_no: number | null
}

export interface AlbumDetail {
  id: string
  title: string
  cover_url: string | null
  release_date: string | null
  artists: Array<{ id: string, name: string }>
  tracks: TrackInfo[]
}

export interface RecommendedTrack {
  album_id: string
  track_id: string
  position: number
  note?: string
}

export const RECOMMENDED_TRACK_LIMIT = 5

export type SaveStatus = 'saved' | 'dirty'
export type WriterView = 'edit' | 'preview'

export const SECTIONS = ['Reviews', 'Best New Music', 'Features', 'Tracks'] as const

export interface DraftPersist {
  subject: AlbumDetail | null
  score: number
  headline: string
  dek: string
  body: string
  section: string
  publishDate: string
  recommendedTracks: RecommendedTrack[]
  lastSaved: string
}
