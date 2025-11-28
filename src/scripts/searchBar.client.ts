// src/scripts/searchBar.client.ts
import type { CardItem } from '../scripts/types/search.ts'
import { makeCard } from '../scripts/components/makeCard.ts'

type Mode = 'none' | 'artist' | 'album'

const $ = (id: string): HTMLElement => {
	const el = document.getElementById(id)
	if (!el) throw new Error(`#${id} not found`)
	return el
}

const bar = $('searchbar')
const artistBtn = $('artistBtn') as HTMLButtonElement
const albumBtn = $('albumBtn') as HTMLButtonElement
const input = $('q') as HTMLInputElement
const submitBtn = $('submitBtn') as HTMLButtonElement
const resultsWrap = $('resultsWrap') as HTMLDivElement
const resultsRow = $('resultsRow') as HTMLDivElement
const moreBtn = document.getElementById('moreBtn') as HTMLButtonElement | null

import { PUBLIC_API_URL } from 'astro:env/client'
const API_BASE = PUBLIC_API_URL

// --------------------------------------------------
// Mode
// --------------------------------------------------
const getMode = (): Mode => (bar.getAttribute('data-mode') as Mode) ?? 'none'

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

	resultsRow.innerHTML = ''
	resultsWrap.hidden = true
}

artistBtn.addEventListener('click', () => {
	setMode(getMode() === 'artist' ? 'none' : 'artist')
	input.focus()
})
albumBtn.addEventListener('click', () => {
	setMode(getMode() === 'album' ? 'none' : 'album')
	input.focus()
})

// --------------------------------------------------
// HTTP
// --------------------------------------------------
const getJSON = async <T = any>(url: string): Promise<T> => {
	const res = await fetch(url)
	return res.json()
}

const postJSON = async <T = any>(url: string, body: any): Promise<T> => {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
	return res.json()
}

// --------------------------------------------------
// Mappers
// --------------------------------------------------
const mapDBArtists = (data: any): CardItem[] =>
	(data.items || []).map((a: any) => ({
		id: a.id,
		type: 'artist',
		title: a.name,
		img: null,
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
	}))

const mapCandAlbums = (cand: any): CardItem[] =>
	(cand.albums || []).map((a: any) => ({
		id: a.spotify_id,
		type: 'album',
		title: a.title,
		img: a.cover_url ?? null,
		source: 'candidates',
		spotify_id: a.spotify_id ?? null,
		release_date: a.release_date ?? null,
	}))

const mapCandArtists = (cand: any): CardItem[] =>
	(cand.artists || []).map((a: any) => ({
		id: a.spotify_id,
		type: 'artist',
		title: a.name,
		img: a.photo_url ?? null,
		source: 'candidates',
		spotify_id: a.spotify_id ?? null,
	}))

// --------------------------------------------------
// Render
// --------------------------------------------------
const render = (items: CardItem[]) => {
	resultsRow.innerHTML = ''
	for (const it of items) resultsRow.appendChild(makeCard(it, selectItem))
	resultsWrap.hidden = items.length === 0
}

// --------------------------------------------------
// selectItem
// --------------------------------------------------
const selectItem = async (it: CardItem): Promise<void> => {
	// Artist(DB)
	if (it.type === 'artist' && it.source === 'db') {
		const data = await getJSON(
			`${API_BASE}/api/music/artists/${encodeURIComponent(it.id)}/albums?limit=20&offset=0`
		)
		render(mapDBAlbums(data))
		return
	}

	// Album(DB)
	if (it.type === 'album' && it.source === 'db') {
		resultsRow.innerHTML = ''
		resultsRow.appendChild(makeCard(it, selectItem))
		resultsWrap.hidden = false
		return
	}

	// Album(Spotify candidates)
	if (it.type === 'album' && it.source === 'candidates' && it.spotify_id) {
		const detail = await postJSON(`${API_BASE}/api/music/albums/sync`, {
			spotify_album_id: it.spotify_id,
			market: 'KR',
		})

		const card: CardItem = {
			id: detail.album.id,
			type: 'album',
			title: detail.album.title,
			img: detail.album.cover_url ?? null,
			source: 'db',
			spotify_id: detail.album.spotify_id ?? null,
			release_date: detail.album.release_date ?? null,
		}

		resultsRow.innerHTML = ''
		resultsRow.appendChild(makeCard(card, selectItem))
		resultsWrap.hidden = false
	}
}

// --------------------------------------------------
// Search
// --------------------------------------------------
const runSearch = async () => {
	const mode = getMode()
	const q = input.value.trim()
	if (!q || (mode !== 'artist' && mode !== 'album')) return

	if (mode === 'artist') {
		const data = await getJSON(
			`${API_BASE}/api/music/search?mode=artist&q=${encodeURIComponent(q)}&limit=20&offset=0`
		)
		render(mapDBArtists(data))
	} else {
		const data = await getJSON(
			`${API_BASE}/api/music/search?mode=album&q=${encodeURIComponent(q)}&limit=20&offset=0`
		)
		render(mapDBAlbums(data))
	}
}

const searchCandidates = async () => {
	const mode = getMode()
	const q = input.value.trim()

	const types =
		mode === 'artist' ? 'artist' : mode === 'album' ? 'album' : 'album,artist'

	const smartQ =
		mode === 'artist' ? `artist:"${q}"` : mode === 'album' ? `album:"${q}"` : q

	const cand = await getJSON(
		`${API_BASE}/api/music/search/candidates?q=${encodeURIComponent(
			smartQ
		)}&type=${encodeURIComponent(types)}&market=KR&limit=12`
	)

	const items: CardItem[] = [
		...mapCandArtists(cand),
		...mapCandAlbums(cand),
	].filter((i) => i.type === (mode === 'none' ? i.type : mode))

	render(items)
}

// --------------------------------------------------
// Events
// --------------------------------------------------
submitBtn.addEventListener('click', runSearch)
input.addEventListener('keydown', (e: KeyboardEvent) => {
	if (e.key === 'Enter') runSearch()
})

if (moreBtn) {
	moreBtn.addEventListener('click', searchCandidates)
}

setMode('none')
