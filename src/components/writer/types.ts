export interface AlbumSearchResult {
  id: string
  title: string
  cover_url: string | null
  release_date: string | null
  artist_name: string | null
  spotify_id: string | null
  source?: 'db' | 'spotify'
}

export interface AlbumDetail {
  id: string
  title: string
  cover_url: string | null
  release_date: string | null
  artists: Array<{ id: string, name: string }>
}

export type SaveStatus = 'saved' | 'dirty'
export type WriterView = 'edit' | 'preview'

export const SECTIONS = ['Reviews', 'Best New Music', 'Features', 'Tracks'] as const
export const GENRES = [
  'Electronic',
'Rock',
'Indie',
'Pop',
'Hip-Hop',
  'Folk',
'Jazz',
'Experimental',
'R&B',
'K-Pop',
] as const

export interface DraftPersist {
  subject: AlbumDetail | null
  score: number
  bestNew: boolean
  headline: string
  dek: string
  body: string
  tags: string[]
  section: string
  genre: string
  publishDate: string
  author: string
  authorRole: string
  lastSaved: string
}
