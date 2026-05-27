// src/scripts/types/search.ts

import type { components } from '../../lib/api.gen'

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

// /api/music/search/candidates response — generated from the FastAPI
// CandidateSearchResult model (myblog_music). Use this in mappers / fetchers
// so a backend rename surfaces as a compile error here, not silent breakage.
export type CandidateSearchResponse = components['schemas']['Music_CandidateSearchResult']
