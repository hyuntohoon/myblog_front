// src/scripts/types/music.ts

// Spotify 쪽 카드가 어디 출신인지
export type Source = 'spotify'

// 카드 종류
export type Kind = 'artist' | 'album' | 'track'

// 검색 결과 카드 하나
export interface CardItem {
	id: string // spotify_id 그대로 쓰는 쪽
	type: Kind
	title: string
	img: string | null
	source: Source

	// 공통 메타
	spotify_id?: string | null
	release_date?: string | null
	external_url?: string | null

	// 아티스트 / 앨범 / 트랙별 서브텍스트용
	artist_name?: string | null
	artist_spotify_id?: string | null
	album_title?: string | null

	// 트랙 → 앨범 상세 조회용
	album_spotify_id?: string | null
}

// ---- 앨범 상세 (albumDetail.client.ts 에서 쓰는 구조와 호환) ----
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
