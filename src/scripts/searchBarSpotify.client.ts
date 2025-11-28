// /src/scripts/searchBarSpotify.client.ts

import type { CardItem, AlbumDetail } from '../scripts/types/search.ts'

import { PUBLIC_API_URL } from 'astro:env/client'

const API_BASE = PUBLIC_API_URL

// ---------- DOM helpers ----------
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

const resultsGrid = byId<HTMLDivElement>('spResultsGrid')
const artistsCol = byId<HTMLDivElement>('spArtistsCol')
const albumsCol = byId<HTMLDivElement>('spAlbumsCol')
const tracksCol = byId<HTMLDivElement>('spTracksCol')

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

// ---------- Mapping: /api/search/candidates 응답 → CardItem ----------
const mapCandAlbums = (cand: any): CardItem[] =>
	(cand.albums || []).map(
		(a: any) =>
			({
				id: a.spotify_id,
				type: 'album',
				title: a.title,
				img: a.cover_url ?? null,
				source: 'spotify',
				spotify_id: a.spotify_id ?? null,
				release_date: a.release_date ?? null,
				artist_name: a.artist_name ?? null,
				external_url: a.external_url ?? null,
			}) satisfies CardItem
	)

const mapCandArtists = (cand: any): CardItem[] =>
	(cand.artists || []).map(
		(a: any) =>
			({
				id: a.spotify_id,
				type: 'artist',
				title: a.name,
				img: a.photo_url ?? null,
				source: 'spotify',
				spotify_id: a.spotify_id ?? null,
				external_url: a.external_url ?? null,
				artist_spotify_id: a.spotify_id ?? null,
			}) satisfies CardItem
	)

const mapCandTracks = (cand: any): CardItem[] =>
	(cand.tracks || []).map(
		(t: any) =>
			({
				id: t.spotify_id,
				type: 'track',
				title: t.title,
				img: t.album?.cover_url ?? null,
				source: 'spotify',
				spotify_id: t.spotify_id ?? null,
				release_date: t.album?.release_date ?? null,
				artist_name: t.artist_name ?? null,
				album_title: t.album_title ?? t.album?.title ?? null,
				external_url: t.external_url ?? null,
				album_spotify_id: t.album?.spotify_id ?? null,
			}) satisfies CardItem
	)

// ⭐ 아티스트 → 앨범 리스트용 (백엔드 /api/artists/spotify/{id}/albums 응답, SearchResult<AlbumItem>)
const mapArtistAlbums = (data: any): CardItem[] =>
	(data.items || []).map(
		(al: any) =>
			({
				id: al.id, // ✅ DB 앨범 UUID
				type: 'album',
				title: al.title,
				img: al.cover_url ?? null,
				source: 'db', // ✅ 이미 로컬 DB 앨범
				spotify_id: al.spotify_id ?? null,
				release_date: al.release_date ?? null,
				artist_name: al.artist_name ?? null,
				external_url: al.external_url ?? null,
			}) satisfies CardItem
	)

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

	const sub = document.createElement('div')
	sub.className = 'type'
	if (it.type === 'album' && it.artist_name) {
		sub.textContent = `by ${it.artist_name}`
	} else if (it.type === 'track') {
		let txt = ''
		if (it.artist_name) txt += it.artist_name
		if (it.album_title) txt += (txt ? ' • ' : '') + it.album_title
		sub.textContent = txt || 'Track'
	} else if (it.type === 'artist') {
		sub.textContent = 'Artist'
	}
	if (sub.textContent) meta.appendChild(sub)

	card.appendChild(art)
	card.appendChild(meta)

	card.addEventListener('click', () => void onSelect(it))
	card.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault()
			void onSelect(it)
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

// Artist 클릭 후 앨범 리스트 덮어쓰기용
const renderArtistAlbums = (albums: CardItem[]) => {
	// 검색어 초기화
	inputQ.value = ''

	// ✅ 컬럼 가시성 제어
	artistsCol.hidden = true
	tracksCol.hidden = true
	albumsCol.hidden = false

	// ✅ 헤딩 텍스트도 직접 OFF (Artists / Tracks)
	const headings =
		resultsGrid.querySelectorAll<HTMLDivElement>('.results-heading')
	headings.forEach((h) => {
		const label = h.textContent?.trim()
		if (label === 'Artists' || label === 'Tracks') {
			h.style.display = 'none'
		}
		if (label === 'Albums') {
			h.style.display = '' // 혹시 숨겨졌으면 다시 보여주기
		}
	})

	// 내용 정리
	artistsRow.innerHTML = ''
	tracksRow.innerHTML = ''
	albumsRow.innerHTML = ''

	albums.forEach((it) => albumsRow.appendChild(makeCard(it)))

	resWrap.hidden = albums.length === 0
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
		`&market=KR&limit=50&offset=0`

	try {
		const cand = await getJSON(url)
		const artists = mapCandArtists(cand).slice(0, 3)
		const albums = mapCandAlbums(cand).slice(0, 10)
		const tracks = mapCandTracks(cand).slice(0, 10)
		render(artists, albums, tracks)
	} catch (e) {
		console.error('Spotify search failed:', e)
		resWrap.hidden = false
	}
}

// Spotify 앨범 상세 호출 (album / track 공용)
const fetchAlbumDetailBySpotifyId = async (
	spotifyAlbumId: string
): Promise<AlbumDetail> => {
	const url = `${API_BASE}/api/albums/by-spotify/${encodeURIComponent(
		spotifyAlbumId
	)}`
	return getJSON<AlbumDetail>(url)
}

// ---------- Select handlers ----------
const onSelect = async (it: CardItem): Promise<void> => {
	try {
		// 1) 아티스트 → 해당 아티스트의 앨범 목록 (Spotify ID 기반, 결과는 DB SearchResult)
		if (it.type === 'artist' && it.spotify_id) {
			const url =
				`${API_BASE}/api/artists/spotify/${encodeURIComponent(
					it.spotify_id
				)}/albums` + `?market=KR&limit=20&offset=0`

			const data = await getJSON(url)
			const albums = mapArtistAlbums(data)
			renderArtistAlbums(albums)
			return
		}

		// 2) 앨범 → Spotify 앨범 기준 상세
		if (it.type === 'album' && it.spotify_id) {
			const detail = await fetchAlbumDetailBySpotifyId(it.spotify_id)
			window.dispatchEvent(
				new CustomEvent<AlbumDetail>('album:detail', { detail })
			)

			// 선택 후 검색창/결과 정리
			inputQ.value = ''
			artistsRow.innerHTML = ''
			albumsRow.innerHTML = ''
			tracksRow.innerHTML = ''
			resWrap.hidden = true
			return
		}

		// 3) 트랙 → 트랙이 속한 앨범 기준 상세
		if (it.type === 'track' && it.album_spotify_id) {
			const detail = await fetchAlbumDetailBySpotifyId(it.album_spotify_id)
			window.dispatchEvent(
				new CustomEvent<AlbumDetail>('album:detail', { detail })
			)

			inputQ.value = ''
			artistsRow.innerHTML = ''
			albumsRow.innerHTML = ''
			tracksRow.innerHTML = ''
			resWrap.hidden = true
			return
		}

		console.debug('[spotify-select] no-op for item', it.type, it)
	} catch (e) {
		console.error('Spotify select failed:', e)
	}
}

// ---------- Events ----------
btnSubmit.addEventListener('click', () => {
	void runSearch()
})

inputQ.addEventListener('keydown', (e) => {
	if (e.key === 'Enter') {
		e.preventDefault()
		void runSearch()
	}
})

// ---------- init ----------
;(() => {
	inputQ.placeholder = 'search Spotify artists, albums, tracks'
	resWrap.hidden = true
})()
