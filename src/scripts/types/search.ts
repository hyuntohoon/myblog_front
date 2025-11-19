export type Source = 'db' | 'spotify'

export type Kind = 'artist' | 'album' | 'track'

export type CardItem = {
	id: string
	type: Kind
	title: string
	img: string | null
	source: Source

	// Common optional
	spotify_id?: string | null
	external_url?: string | null

	// Album
	release_date?: string | null
	album_type?: string | null
	artist_name?: string | null
	album_title?: string | null
	total_tracks?: number | null

	// Track
	album_spotify_id?: string | null
	artist_spotify_id?: string | null
}
