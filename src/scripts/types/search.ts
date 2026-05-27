// src/scripts/types/search.ts

export type Source = 'db' | 'spotify'
export type Kind = 'artist' | 'album' | 'track'

export interface CardItem {
	id: string
	type: Kind
	title: string
	img: string | null
	source: Source

	spotify_id?: string | null
	release_date?: string | null
	external_url?: string | null

	artist_name?: string | null
	artist_spotify_id?: string | null
	album_title?: string | null
	album_spotify_id?: string | null

	// ✅ DB track -> album detail 이동용 (album DB uuid)
	db_album_id?: string | null
}

export interface Artist {
	id: string
	name: string
	spotify_id?: string | null
}

export interface Track {
	id: string
	title: string
	track_no: number | null
	duration_sec: number | null
	spotify_id?: string | null
}

export interface Album {
	id: string
	title: string
	release_date?: string | null
	cover_url?: string | null
	album_type?: string | null
	spotify_id?: string | null
	total_tracks?: number | null
	label?: string | null
	popularity?: number | null
}

export interface AlbumDetail {
	album: Album
	artists: Artist[]
	tracks: Track[]
	meta?: Record<string, any>
}

// TODO(PR-12): replace with components['schemas']['Music_CandidateSearchResult'].
// The /api/music/search/candidates response schema is currently `{}` in the
// merged OpenAPI contract; this captures only the fields the mappers consume.
export interface CandidateArtist {
	spotify_id?: string | null
	name: string
	photo_url?: string | null
	external_url?: string | null
}

export interface CandidateAlbum {
	spotify_id?: string | null
	title: string
	cover_url?: string | null
	release_date?: string | null
	artist_name?: string | null
	artist_spotify_id?: string | null
	external_url?: string | null
}

export interface CandidateTrack {
	spotify_id?: string | null
	title: string
	artist_name?: string | null
	album_title?: string | null
	external_url?: string | null
	album?: {
		spotify_id?: string | null
		title?: string | null
		release_date?: string | null
		cover_url?: string | null
	} | null
}

export interface CandidateSearchResponse {
	artists?: CandidateArtist[]
	albums?: CandidateAlbum[]
	tracks?: CandidateTrack[]
}
