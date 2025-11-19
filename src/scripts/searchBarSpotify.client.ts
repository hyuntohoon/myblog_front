// /src/scripts/searchBarSpotify.client.ts
// Spotify 후보 검색 전용 (Artist / Album / Track)

// ---------- Types ----------
type Source = 'candidates'
type Kind = 'artist' | 'album' | 'track'

type CardItem = {
	id: string
	type: Kind
	title: string
	img: string | null
	source: Source
	spotify_id?: string | null
	release_date?: string | null
	artist_name?: string | null
	album_title?: string | null
	external_url?: string | null
	album_spotify_id?: string | null
	artist_spotify_id?: string | null
}

const API_BASE = 'http://127.0.0.1:8000'

// ---------- DOM ----------
const byId = <T extends HTMLElement = HTMLElement>(id: string): T => {
	const el = document.getElementById(id)
	if (!el) throw new Error(`#${id} not found`)
	return el as T
}

const resWrap = byId<HTMLDivElement>('spResultsWrap')
const artistsRow = byId<HTMLDivElement>('spArtistsRow')
const albumsRow = byId<HTMLDivElement>('spAlbumsRow')
const tracksRow = byId<HTMLDivElement>('spTracksRow')
const inputQ = byId<HTMLInputElement>('spQ')
const btnSubmit = byId<HTMLButtonElement>('spSubmitBtn')

// ---------- Fetch ----------
const getJSON = async <T>(url: string): Promise<T> => {
	const r = await fetch(url)
	if (!r.ok) throw new Error(`HTTP ${r.status}`)
	return r.json()
}

// ---------- Mapping ----------
const mapCandArtists = (cand: any): CardItem[] =>
	(cand.artists || []).map((a: any) => ({
		id: a.spotify_id,
		type: 'artist',
		title: a.name,
		img: a.photo_url ?? null,
		source: 'candidates',
		spotify_id: a.spotify_id,
		external_url: a.external_url ?? null,
	}))

const mapCandAlbums = (cand: any): CardItem[] =>
	(cand.albums || []).map((a: any) => ({
		id: a.spotify_id,
		type: 'album',
		title: a.title,
		img: a.cover_url ?? null,
		source: 'candidates',
		spotify_id: a.spotify_id,
		release_date: a.release_date ?? null,
		artist_name: a.artist_name ?? null,
		external_url: a.external_url ?? null,
	}))

const mapCandTracks = (cand: any): CardItem[] =>
	(cand.tracks || []).map((t: any) => ({
		id: t.spotify_id,
		type: 'track',
		title: t.title,
		img: t.album?.cover_url ?? null,
		source: 'candidates',
		spotify_id: t.spotify_id,
		release_date: t.album?.release_date ?? null,
		artist_name: t.artist_name ?? null,
		album_title: t.album_title ?? t.album?.title ?? null,
		external_url: t.external_url ?? null,
		album_spotify_id: t.album?.spotify_id ?? null,
		artist_spotify_id: t.artist_spotify_id ?? null,
	}))

// ---------- UI ----------
const makeCard = (it: CardItem): HTMLDivElement => {
	const card = document.createElement('div')
	card.className = 'card'
	card.tabIndex = 0
	card.setAttribute('role', 'button')

	card.onclick = () => onSelect(it)
	card.onkeydown = (e: KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault()
			onSelect(it)
		}
	}

	card.innerHTML = `
		<div class="art">
			<img class="thumb" src="${it.img || 'https://placehold.co/600x600?text=No+Image'}" alt="${it.title}">
		</div>
		<div class="meta">
			<div class="title">${it.title}</div>
			<div class="type">
				${
					it.type === 'album'
						? (it.artist_name ?? '')
						: it.type === 'track'
							? `${it.artist_name ?? ''}${it.album_title ? ' • ' + it.album_title : ''}`
							: ''
				}
			</div>
		</div>
	`
	return card
}

const render = (
	artists: CardItem[],
	albums: CardItem[],
	tracks: CardItem[]
) => {
	artistsRow.innerHTML = ''
	albumsRow.innerHTML = ''
	tracksRow.innerHTML = ''

	artists.forEach((i) => artistsRow.appendChild(makeCard(i)))
	albums.forEach((i) => albumsRow.appendChild(makeCard(i)))
	tracks.forEach((i) => tracksRow.appendChild(makeCard(i)))

	resWrap.hidden = artists.length + albums.length + tracks.length === 0
}

// ---------- Search ----------
const runSearch = async () => {
	const q = inputQ.value.trim()
	if (!q) return

	const url =
		`${API_BASE}/api/search/candidates` +
		`?q=${encodeURIComponent(q)}` +
		`&type=artist,album,track&market=KR&limit=50`

	try {
		const cand = await getJSON(url)
		render(
			mapCandArtists(cand).slice(0, 3),
			mapCandAlbums(cand).slice(0, 10),
			mapCandTracks(cand).slice(0, 10)
		)
	} catch (e) {
		console.error('Search failed:', e)
		resWrap.hidden = false
	}
}

// ---------- Select ----------
const onSelect = async (it: CardItem) => {
	try {
		// Artist → 그 아티스트의 Spotify 앨범 검색
		if (it.type === 'artist' && it.spotify_id) {
			const albums = await getJSON(
				`${API_BASE}/api/search/artist/${encodeURIComponent(it.spotify_id)}/albums`
			)
			render([], mapCandAlbums({ albums }), [])
			return
		}

		// Album → 앨범 상세 조회
		if (it.type === 'album' && it.spotify_id) {
			const detail = await getJSON(
				`${API_BASE}/api/search/album/${encodeURIComponent(it.spotify_id)}`
			)
			window.dispatchEvent(new CustomEvent('album:detail', { detail }))
			return
		}

		// Track → track.album_spotify_id 로 앨범 상세 조회
		if (it.type === 'track' && it.album_spotify_id) {
			const detail = await getJSON(
				`${API_BASE}/api/search/album/${encodeURIComponent(it.album_spotify_id)}`
			)
			window.dispatchEvent(new CustomEvent('album:detail', { detail }))
			return
		}

		console.warn('Unhandled select item:', it)
	} catch (e) {
		console.error('Select failed:', e)
	}
}

// ---------- Events ----------
btnSubmit.addEventListener('click', runSearch)
inputQ.addEventListener('keydown', (e) => {
	if (e.key === 'Enter') runSearch()
})

// ---------- Init ----------
resWrap.hidden = true
