// /src/scripts/searchBarSpotify.client.ts

// ---------- Types ----------
type Source = 'candidates' | 'db'
type Kind = 'artist' | 'album' | 'track'

type CardItem = {
	id: string
	type: Kind
	title: string
	img: string | null
	source: Source
	spotify_id?: string | null
	release_date?: string | null
	// 서브텍스트용
	artist_name?: string | null
	album_title?: string | null
	external_url?: string | null
	// 트랙 → 앨범 동기화용
	album_spotify_id?: string | null
}

const API_BASE = 'http://127.0.0.1:8000'

// ---------- DOM helpers (충돌 방지: $ -> byId) ----------
const byId = <T extends HTMLElement = HTMLElement>(id: string): T => {
	const el = document.getElementById(id)
	if (!el) throw new Error(`#${id} not found`)
	return el as T
}

// ---------- Grab elements ----------
const resWrap = byId<HTMLDivElement>('spResultsWrap')
const artistsRow = byId<HTMLDivElement>('spArtistsRow')
const albumsRow = byId<HTMLDivElement>('spAlbumsRow')
const tracksRow = byId<HTMLDivElement>('spTracksRow')
const inputQ = byId<HTMLInputElement>('spQ')
const btnSubmit = byId<HTMLButtonElement>('spSubmitBtn')

// ---------- Fetch helpers ----------
const getJSON = async <T = any>(url: string): Promise<T> => {
	const r = await fetch(url, { method: 'GET' })
	if (!r.ok) throw new Error(`HTTP ${r.status}`)
	return r.json()
}
const postJSON = async <T = any>(url: string, body: any): Promise<T> => {
	const r = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
	if (!r.ok) throw new Error(`HTTP ${r.status}`)
	return r.json()
}

// ---------- Mapping ----------
const mapCandAlbums = (cand: any): CardItem[] =>
	(cand.albums || []).map((a: any) => ({
		id: a.spotify_id,
		type: 'album',
		title: a.title,
		img: a.cover_url ?? null,
		source: 'candidates',
		spotify_id: a.spotify_id ?? null,
		release_date: a.release_date ?? null,
		artist_name: a.artist_name ?? null,
		external_url: a.external_url ?? null,
	}))

const mapCandArtists = (cand: any): CardItem[] =>
	(cand.artists || []).map((a: any) => ({
		id: a.spotify_id,
		type: 'artist',
		title: a.name,
		img: a.photo_url ?? null,
		source: 'candidates',
		spotify_id: a.spotify_id ?? null,
		external_url: a.external_url ?? null,
	}))

const mapCandTracks = (cand: any): CardItem[] =>
	(cand.tracks || []).map((t: any) => ({
		id: t.spotify_id,
		type: 'track',
		title: t.title,
		img: t.album?.cover_url ?? null,
		source: 'candidates',
		spotify_id: t.spotify_id ?? null,
		release_date: t.album?.release_date ?? null,
		artist_name: t.artist_name ?? null,
		album_title: t.album_title ?? t.album?.title ?? null,
		external_url: t.external_url ?? null,
		album_spotify_id: t.album?.spotify_id ?? null, // ✅ 트랙 → 앨범 sync용
	}))

// ---------- UI: Card ----------
const makeCard = (it: CardItem): HTMLDivElement => {
	const card = document.createElement('div')
	card.className = 'card'
	card.setAttribute('role', 'button')
	card.setAttribute('tabindex', '0')
	card.setAttribute('aria-label', `${it.type}: ${it.title}`)

	const art = document.createElement('div')
	art.className = 'art'
	const img = document.createElement('img')
	img.className = 'thumb'
	img.src = it.img || 'https://placehold.co/600x600?text=No+Image'
	img.alt = it.title
	art.appendChild(img)

	const meta = document.createElement('div')
	meta.className = 'meta'

	const title = document.createElement('div')
	title.className = 'title'
	title.textContent = it.title
	meta.appendChild(title)

	if (it.type === 'album' && it.artist_name) {
		const sub = document.createElement('div')
		sub.className = 'type'
		sub.textContent = `by ${it.artist_name}`
		meta.appendChild(sub)
	} else if (it.type === 'track') {
		const sub = document.createElement('div')
		sub.className = 'type'
		let txt = ''
		if (it.artist_name) txt += it.artist_name
		if (it.album_title) txt += (txt ? ' • ' : '') + it.album_title
		sub.textContent = txt || 'Track'
		meta.appendChild(sub)
	}

	card.appendChild(art)
	card.appendChild(meta)

	card.addEventListener('click', () => onSelect(it))
	card.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault()
			onSelect(it)
		}
	})
	return card
}

// ---------- Render ----------
const render = (
	artists: CardItem[],
	albums: CardItem[],
	tracks: CardItem[]
) => {
	artistsRow.innerHTML = ''
	albumsRow.innerHTML = ''
	tracksRow.innerHTML = ''

	artists.forEach((it) => artistsRow.appendChild(makeCard(it)))
	albums.forEach((it) => albumsRow.appendChild(makeCard(it)))
	tracks.forEach((it) => tracksRow.appendChild(makeCard(it)))

	const total = artists.length + albums.length + tracks.length
	resWrap.hidden = total === 0
}

// ---------- Query ----------
const buildQuery = (raw: string) => raw.trim()

// ---------- Actions ----------
const runSearch = async () => {
	const q = buildQuery(inputQ.value)
	if (!q) return

	const url =
		`${API_BASE}/api/search/candidates` +
		`?q=${encodeURIComponent(q)}` +
		`&type=${encodeURIComponent('artist,album,track')}` +
		`&market=KR&limit=50&offset=0` // 크게 받아서 슬라이스

	try {
		const cand = await getJSON(url)
		const artists = mapCandArtists(cand).slice(0, 3)
		const albums = mapCandAlbums(cand).slice(0, 10)
		const tracks = mapCandTracks(cand).slice(0, 10)
		render(artists, albums, tracks)
	} catch (e) {
		console.error('Search failed:', e)
		resWrap.hidden = false
	}
}

// ---------- Select handlers ----------
const onSelect = async (it: CardItem) => {
	try {
		if (it.type === 'album' && it.spotify_id) {
			console.debug('[sync] album click', it.spotify_id)
			const detail = await postJSON(`${API_BASE}/api/albums/sync`, {
				spotify_album_id: it.spotify_id,
				market: 'KR',
			})
			window.dispatchEvent(new CustomEvent('album:detail', { detail }))
			return
		}

		if (it.type === 'track' && it.album_spotify_id) {
			console.debug('[sync] track click -> album sync', it.album_spotify_id)
			const detail = await postJSON(`${API_BASE}/api/albums/sync`, {
				spotify_album_id: it.album_spotify_id,
				market: 'KR',
			})
			window.dispatchEvent(new CustomEvent('album:detail', { detail }))
			return
		}

		// artist 클릭은 동작 정의 X (원하면 여기서 top tracks/albums 로직 추가 가능)
		console.debug('[sync] no-op for item', it.type, it)
	} catch (e) {
		console.error('Sync failed:', e)
	}
}

// ---------- Events ----------
btnSubmit.addEventListener('click', runSearch)
inputQ.addEventListener('keydown', (e) => {
	if (e.key === 'Enter') runSearch()
})

// ---------- init ----------
;(() => {
	inputQ.placeholder = 'Search'
	resWrap.hidden = true
})()
