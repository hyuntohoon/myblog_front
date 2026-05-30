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
  // FEAT-writer-lowfreq-redesign Step 4: when the user picks an artist (not
  // an album) as the subject, we still flow through AlbumDetail so the writer
  // chrome doesn't fork. WriterApp branches on `kind` when building the post
  // payload — artist subjects send album_ids=[] + artist_ids=[id].
  kind?: 'album' | 'artist'
  // FEAT-writer-lowfreq-redesign Step 6: writer seeds the BEST NEW pill from
  // this on subject pick. SubjectBlock reads it from the album lookup; for
  // artist subjects it stays undefined and the pill stays off.
  best_new?: boolean
}

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
  // FEAT-view-redesign Step 3: set of picked track IDs (no order, no limit).
  recommendedTrackIds: string[]
  lastSaved: string
  // FEAT-writer-lowfreq-redesign Step 6: editor-set BEST NEW MUSIC flag.
  // Optional so older drafts in localStorage deserialize cleanly (undefined → off).
  subjectBestNew?: boolean
}
