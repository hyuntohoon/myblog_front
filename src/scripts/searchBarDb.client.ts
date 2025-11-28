// /src/scripts/searchBarDb.client.ts
import type { CardItem } from '../scripts/types/search.ts'
import { makeCard } from './components/makeCard.ts'

type Mode = 'none' | 'artist' | 'album'

import { PUBLIC_API_URL } from 'astro:env/client'

const API_BASE = PUBLIC_API_URL

// --------------------------------------------------
// DOM
// --------------------------------------------------
const byId = <T extends HTMLElement>(id: string): T => {
	const el = document.getElementById(id)
	if (!el) throw new Error(`#${id} not found`)
	return el as T
}

const bar = byId<HTMLDivElement>('dbSearchbar')
const artistBtn = byId<HTMLButtonElement>('dbArtistBtn')
const albumBtn = byId<HTMLButtonElement>('dbAlbumBtn')
const input = byId<HTMLInputElement>('dbQ')
const submitBtn = byId<HTMLButtonElement>('dbSubmitBtn')
const resultsWrap = byId<HTMLDivElement>('dbResultsWrap')
const resultsRow = byId<HTMLDivElement>('dbResultsRow')

// optional section
const artistAlbumsWrap = byId<HTMLDivElement>('dbArtistAlbumsWrap')
const artistAlbumsRow = byId<HTMLDivElement>('dbArtistAlbumsRow')
const artistAlbumsTitle = byId<HTMLDivElement>('dbArtistAlbumsTitle')

// --------------------------------------------------
// Helpers
// --------------------------------------------------
const getMode = (): Mode => (bar.getAttribute('data-mode') as Mode) ?? 'none'

const getJSON = async <T = any>(url: string): Promise<T> => {
	const res = await fetch(url)
	if (!res.ok) throw new Error(`HTTP ${res.status}`)
	return res.json()
}

// --------------------------------------------------
// Mappers (DB → 통합된 CardItem)
// --------------------------------------------------
const mapDBArtists = (data: any): CardItem[] =>
	(data.items || []).map((a: any) => ({
		id: a.id,
		type: 'artist',
		title: a.name,
		img: a.cover_url ?? null,
		source: 'db',
		spotify_id: a.spotify_id ?? null,
	}))

const mapDBAlbums = (data: any): CardItem[] =>
	(data.items || []).map((al: any) => ({
		id: al.id,
		type: 'album',
		title: al.title,
		img: al.cover_url ?? null,
		source: 'db',
		spotify_id: al.spotify_id ?? null,
		release_date: al.release_date ?? null,
		artist_name: al.artist_name ?? null,
		artist_spotify_id: al.artist_spotify_id ?? null,
	}))

// --------------------------------------------------
// UI
// --------------------------------------------------
const setMode = (mode: Mode) => {
	bar.setAttribute('data-mode', mode)
	bar.classList.remove('theme-none', 'theme-artist', 'theme-album')
	bar.classList.add(
		mode === 'artist'
			? 'theme-artist'
			: mode === 'album'
				? 'theme-album'
				: 'theme-none'
	)

	artistBtn.setAttribute('aria-pressed', String(mode === 'artist'))
	albumBtn.setAttribute('aria-pressed', String(mode === 'album'))

	input.placeholder =
		mode === 'artist'
			? 'Search by artist name'
			: mode === 'album'
				? 'Search by album title'
				: 'Select Artist or Album first'

	// reset upper results
	resultsRow.innerHTML = ''
	resultsWrap.hidden = true

	// reset artist album section
	artistAlbumsRow.innerHTML = ''
	artistAlbumsWrap.hidden = true
}

const renderResults = (items: CardItem[]) => {
	resultsRow.innerHTML = ''
	items.forEach((it) => resultsRow.appendChild(makeCard(it, onSelect)))
	resultsWrap.hidden = items.length === 0
}

const renderArtistAlbums = (albums: CardItem[], artistName: string) => {
	artistAlbumsRow.innerHTML = ''
	albums.forEach((al) => artistAlbumsRow.appendChild(makeCard(al, onSelect)))
	artistAlbumsTitle.textContent = `Albums by ${artistName}`
	artistAlbumsWrap.hidden = albums.length === 0
}

// --------------------------------------------------
// Select Action
// --------------------------------------------------
const onSelect = async (it: CardItem) => {
	try {
		// Artist(DB) → show albums
		if (it.type === 'artist' && it.source === 'db') {
			const data = await getJSON(
				`${API_BASE}/api/music/artists/${encodeURIComponent(it.id)}/albums?limit=20&offset=0`
			)
			const albums = mapDBAlbums(data)
			renderArtistAlbums(albums, it.title)
			return
		}

		// Album(DB) → show detail view (dispatch)
		if (it.type === 'album' && it.source === 'db') {
			const detail = await getJSON(
				`${API_BASE}/api/music/albums/${encodeURIComponent(it.id)}`
			)

			window.dispatchEvent(new CustomEvent('album:detail', { detail }))

			// cleanup UI
			input.value = ''
			resultsRow.innerHTML = ''
			resultsWrap.hidden = true
			artistAlbumsRow.innerHTML = ''
			artistAlbumsWrap.hidden = true
			return
		}
	} catch (err) {
		console.error('DB select failed:', err)
	}
}

// --------------------------------------------------
// Search Action
// --------------------------------------------------
const runSearch = async () => {
	const mode = getMode()
	const q = input.value.trim()
	if (!q || (mode !== 'artist' && mode !== 'album')) return

	// clear secondary section
	artistAlbumsRow.innerHTML = ''
	artistAlbumsWrap.hidden = true

	try {
		if (mode === 'artist') {
			const data = await getJSON(
				`${API_BASE}/api/music/search?mode=artist&q=${encodeURIComponent(q)}&limit=20&offset=0`
			)
			renderResults(mapDBArtists(data))
		} else {
			const data = await getJSON(
				`${API_BASE}/api/music/search?mode=album&q=${encodeURIComponent(q)}&limit=20&offset=0`
			)
			renderResults(mapDBAlbums(data))
		}
	} catch (err) {
		console.error('DB search failed:', err)
	}
}

// --------------------------------------------------
// Events
// --------------------------------------------------
artistBtn.addEventListener('click', () => {
	setMode(getMode() === 'artist' ? 'none' : 'artist')
	input.focus()
})

albumBtn.addEventListener('click', () => {
	setMode(getMode() === 'album' ? 'none' : 'album')
	input.focus()
})

submitBtn.addEventListener('click', runSearch)

input.addEventListener('keydown', (e: KeyboardEvent) => {
	if (e.key === 'Enter') runSearch()
})

// init
setMode('none')
