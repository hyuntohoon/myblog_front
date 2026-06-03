/**
 * Member dashboard — SAMPLE data (Step 1, frontend shell).
 *
 * Every export here is placeholder data for surfaces the backend can't supply
 * yet (now-playing, listening history, library, genre/artist distribution,
 * seed buckets). Each is surfaced in the UI behind a "샘플" badge. Later RFC
 * steps replace the adapter's getters (lib/member.ts) with real `apiFetch`
 * calls; this file then goes away. Scores are on the canonical 0–5 scale.
 */

export interface SampleAlbum {
	id: string
	album: string
	artist: string
	year: number | null
	genre: string
	rating: number | null
	when?: string
	status?: LibraryStatus
}

export interface SampleTrack {
	id: string
	track: string
	artist: string
	album: string
	len: string
	when: string
}

export type LibraryStatus = '듣는 중' | '들음' | '평론함' | '위시리스트'

export interface NowPlaying {
	track: string
	album: string
	artist: string
	elapsed: number
	duration: number
	device: string
}

export interface DistItem { name: string, value: number }

export interface BucketNode {
	id: string
	name: string
	albums: SampleAlbum[]
	children: BucketNode[]
}

let _uid = 0
const uid = (p = 'a') => `${p}${++_uid}`

export const NOW_PLAYING: NowPlaying = {
	track: 'Deep Current',
	album: 'Subsonic Cathedral',
	artist: 'Vault Engine',
	elapsed: 142,
	duration: 327,
	device: 'STUDIO MONITORS',
}

export const RECENT_ALBUMS: SampleAlbum[] = [
	{ id: uid('ra'), album: 'Low Tide Frequencies', artist: 'Sala', year: 2024, genre: 'Hip-Hop', rating: 4.1, when: '오늘' },
	{ id: uid('ra'), album: 'Glass Architecture', artist: 'Mira Voss', year: 2025, genre: 'Classical', rating: 4.5, when: '오늘' },
	{ id: uid('ra'), album: 'Midnight Cartography', artist: 'Sala', year: 2025, genre: 'Hip-Hop', rating: null, when: '어제' },
	{ id: uid('ra'), album: 'Static Garden', artist: 'Mira Voss', year: 2024, genre: 'Classical', rating: null, when: '어제' },
	{ id: uid('ra'), album: 'Brass Horizon', artist: 'The Quiet Tenants', year: 2023, genre: 'Jazz', rating: null, when: '2일 전' },
	{ id: uid('ra'), album: 'Hollow Bells', artist: 'Vault Engine', year: 2021, genre: 'Ambient', rating: 3.6, when: '3일 전' },
]

export const RECENT_TRACKS: SampleTrack[] = [
	{ id: uid('rt'), track: 'Deep Current', artist: 'Vault Engine', album: 'Subsonic Cathedral', len: '5:27', when: '12분 전' },
	{ id: uid('rt'), track: 'Low Tide', artist: 'Sala', album: 'Low Tide Frequencies', len: '3:41', when: '48분 전' },
	{ id: uid('rt'), track: 'Glasshouse', artist: 'Mira Voss', album: 'Glass Architecture', len: '6:02', when: '1시간 전' },
	{ id: uid('rt'), track: 'Neon Pavement', artist: 'Hara Müller', album: 'Neon Pavement', len: '4:18', when: '2시간 전' },
	{ id: uid('rt'), track: 'Brush & Wire', artist: 'The Quiet Tenants', album: 'Paper Moon Sessions', len: '5:09', when: '오늘' },
	{ id: uid('rt'), track: 'Hollow Bells II', artist: 'Vault Engine', album: 'Hollow Bells', len: '7:33', when: '오늘' },
]

export const LIBRARY: SampleAlbum[] = [
	{ id: uid('lb'), album: 'Subsonic Cathedral', artist: 'Vault Engine', year: 2025, genre: 'Ambient', rating: 4.6, status: '평론함' },
	{ id: uid('lb'), album: 'Neon Pavement', artist: 'Hara Müller', year: 2024, genre: 'Electronic', rating: 4.2, status: '평론함' },
	{ id: uid('lb'), album: 'Paper Moon Sessions', artist: 'The Quiet Tenants', year: 2023, genre: 'Jazz', rating: 3.9, status: '평론함' },
	{ id: uid('lb'), album: 'Glass Architecture', artist: 'Mira Voss', year: 2025, genre: 'Classical', rating: 4.5, status: '평론함' },
	{ id: uid('lb'), album: 'Rust & Velvet', artist: 'Cooper Lane', year: 2022, genre: 'Rock', rating: 3.5, status: '평론함' },
	{ id: uid('lb'), album: 'Low Tide Frequencies', artist: 'Sala', year: 2024, genre: 'Hip-Hop', rating: 4.1, status: '평론함' },
	{ id: uid('lb'), album: 'Hollow Bells', artist: 'Vault Engine', year: 2021, genre: 'Ambient', rating: 3.6, status: '평론함' },
	{ id: uid('lb'), album: 'Folklore Machines', artist: 'Inga Pell', year: 2023, genre: 'Folk', rating: 4.3, status: '평론함' },
	{ id: uid('lb'), album: 'Midnight Cartography', artist: 'Sala', year: 2025, genre: 'Hip-Hop', rating: null, status: '들음' },
	{ id: uid('lb'), album: 'Static Garden', artist: 'Mira Voss', year: 2024, genre: 'Classical', rating: null, status: '들음' },
	{ id: uid('lb'), album: 'Brass Horizon', artist: 'The Quiet Tenants', year: 2023, genre: 'Jazz', rating: null, status: '들음' },
	{ id: uid('lb'), album: 'Velvet Circuitry', artist: 'Hara Müller', year: 2025, genre: 'Electronic', rating: null, status: '들음' },
	{ id: uid('lb'), album: 'Driftwood', artist: 'Inga Pell', year: 2022, genre: 'Folk', rating: null, status: '위시리스트' },
	{ id: uid('lb'), album: 'Tessellate', artist: 'Vault Engine', year: 2026, genre: 'Ambient', rating: null, status: '위시리스트' },
]

export const GENRES: DistItem[] = [
	{ name: 'Ambient', value: 286 },
	{ name: 'Electronic', value: 241 },
	{ name: 'Jazz', value: 162 },
	{ name: 'Rock', value: 148 },
	{ name: 'Hip-Hop', value: 121 },
	{ name: 'Classical', value: 109 },
	{ name: 'Folk', value: 92 },
	{ name: 'Experimental', value: 79 },
]

export const ARTISTS: DistItem[] = [
	{ name: 'Vault Engine', value: 412 },
	{ name: 'Mira Voss', value: 318 },
	{ name: 'Sala', value: 274 },
	{ name: 'Hara Müller', value: 241 },
	{ name: 'The Quiet Tenants', value: 198 },
	{ name: 'Inga Pell', value: 156 },
	{ name: 'Cooper Lane', value: 121 },
]

export const ACTIVITY: number[] = [8, 11, 6, 14, 9, 17, 12, 19, 7, 13, 21, 16]

function A(album: string, artist: string, year: number, genre: string, rating: number | null = null): SampleAlbum {
  return { id: uid('al'), album, artist, year, genre, rating }
}

export function bucketsInit(): BucketNode[] {
	return [
		{ id: uid('bk'), name: '들은 앨범', children: [], albums: [
			A('Subsonic Cathedral', 'Vault Engine', 2025, 'Ambient', 4.6),
			A('Glass Architecture', 'Mira Voss', 2025, 'Classical', 4.5),
			A('Low Tide Frequencies', 'Sala', 2024, 'Hip-Hop', 4.1),
			A('Hollow Bells', 'Vault Engine', 2021, 'Ambient', 3.6),
		] },
		{ id: uid('bk'), name: '평론할 앨범', albums: [
			A('Midnight Cartography', 'Sala', 2025, 'Hip-Hop'),
			A('Static Garden', 'Mira Voss', 2024, 'Classical'),
			A('Brass Horizon', 'The Quiet Tenants', 2023, 'Jazz'),
		], children: [
			{ id: uid('bk'), name: '급한 마감', children: [], albums: [
				A('Velvet Circuitry', 'Hara Müller', 2025, 'Electronic'),
			] },
		] },
		{ id: uid('bk'), name: '들을 앨범', children: [], albums: [
			A('Driftwood', 'Inga Pell', 2022, 'Folk'),
			A('Tessellate', 'Vault Engine', 2026, 'Ambient'),
			A('Paper Moon Sessions', 'The Quiet Tenants', 2023, 'Jazz'),
		] },
	]
}

/** Albums the add-popover can drop into a bucket (sample). */
export const ADD_POOL: SampleAlbum[] = [
	A('Aurora Falls', 'Mira Voss', 2026, 'Classical'),
	A('Pressure Lines', 'Sala', 2025, 'Hip-Hop'),
	A('Halftone City', 'Hara Müller', 2026, 'Electronic'),
	A('Sleeper Cells', 'Vault Engine', 2024, 'Ambient'),
	A('Marrow', 'Inga Pell', 2025, 'Folk'),
]

/** Deterministic fake tracklist + tags for the album-detail slide-over. */
const TRACK_WORDS = ['Drift', 'Current', 'Hollow', 'Glass', 'Static', 'Pulse', 'Velvet', 'Tide', 'Signal', 'Ash', 'Marrow', 'Lantern', 'Cinder', 'Vapor', 'Quartz', 'Sleeper', 'Halo', 'Lowland', 'Echo', 'Murmur', 'Spindle', 'Gloam', 'Ridge', 'Saturn']
function hashStr(s: string): number {
	let h = 0
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
	return h
}
export function albumDetail(a: { album: string, artist?: string, year?: number | null, genre?: string, track?: string }) {
	const h = hashStr(a.album + (a.artist || ''))
	const n = 6 + (h % 5)
	const tracks: { no: number, title: string, len: string }[] = []
	for (let i = 0; i < n; i++) {
		const w1 = TRACK_WORDS[(h + i * 7) % TRACK_WORDS.length]
		const w2 = TRACK_WORDS[(h + i * 13 + 3) % TRACK_WORDS.length]
		const title = i % 3 === 0 ? `${w1} ${w2}` : w1
		const sec = 150 + ((h + i * 41) % 240)
		tracks.push({ no: i + 1, title: i === 0 && a.track ? a.track : title, len: `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` })
	}
	const tagPool = ['LP', `${a.year || ''}`, a.genre || '', h % 2 ? '추천' : '재생목록', h % 3 ? '180g' : '리이슈'].filter(Boolean)
	return {
		tracks,
		tags: [...new Set(tagPool)],
		label: `${['Subfloor', 'Paper Moon', 'North Pole', 'Glasshouse', 'Tidal'][h % 5]} Records`,
		length: `${tracks.length}곡 · 약 ${Math.round(tracks.length * 4.2)}분`,
	}
}
