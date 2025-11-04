type Mode = 'none' | 'artist' | 'album'
type Source = 'db' | 'candidates'
type CardItem = {
	id: string
	type: 'artist' | 'album'
	title: string
	img: string | null
	source: Source
	spotify_id?: string | null
	release_date?: string | null
}

const API_BASE = 'http://127.0.0.1:8000'

const $ = (id: string): HTMLElement => {
	const el = document.getElementById(id)
	if (!el) throw new Error(`#${id} not found`)
	return el
}

const bar = $('dbSearchbar')
const artistBtn = $('dbArtistBtn') as HTMLButtonElement
const albumBtn = $('dbAlbumBtn') as HTMLButtonElement
const input = $('dbQ') as HTMLInputElement
const submitBtn = $('dbSubmitBtn') as HTMLButtonElement
const resultsWrap = $('dbResultsWrap') as HTMLDivElement
const resultsRow = $('dbResultsRow') as HTMLDivElement

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

const getJSON = async <T = any>(url: string): Promise<T> =>
	(await fetch(url)).json()
const postJSON = async <T = any>(url: string, body: any): Promise<T> =>
	(
		await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		})
	).json()

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

const makeCard = (it: CardItem): HTMLDivElement => {
	const card = document.createElement('div')
	card.className = 'card'
	card.tabIndex = 0
	card.role = 'button'
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
	const type = document.createElement('div')
	type.className = 'type'
	type.textContent = it.type
	meta.appendChild(title)
	meta.appendChild(type)
	card.appendChild(art)
	card.appendChild(meta)

	card.addEventListener('click', () => selectItem(it))
	card.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault()
			selectItem(it)
		}
	})
	return card
}

const render = (items: CardItem[]) => {
	resultsRow.innerHTML = ''
	for (const it of items) resultsRow.appendChild(makeCard(it))
	resultsWrap.hidden = items.length === 0
}

const runSearch = async () => {
	const mode = getMode()
	const q = input.value.trim()
	if (!q || (mode !== 'artist' && mode !== 'album')) return

	if (mode === 'artist') {
		const data = await getJSON(
			`${API_BASE}/api/search?mode=artist&q=${encodeURIComponent(q)}&limit=20&offset=0`
		)
		render(mapDBArtists(data))
	} else {
		const data = await getJSON(
			`${API_BASE}/api/search?mode=album&q=${encodeURIComponent(q)}&limit=20&offset=0`
		)
		render(mapDBAlbums(data))
	}
}

const selectItem = async (it: CardItem) => {
	if (it.type === 'artist' && it.source === 'db') {
		const data = await getJSON(
			`${API_BASE}/api/artists/${encodeURIComponent(it.id)}/albums?limit=20&offset=0`
		)
		render(mapDBAlbums(data))
		return
	}
	if (it.type === 'album' && it.source === 'db') {
		resultsRow.innerHTML = ''
		resultsRow.appendChild(makeCard(it))
		resultsWrap.hidden = false
		return
	}
}

submitBtn.addEventListener('click', runSearch)
input.addEventListener('keydown', (e: KeyboardEvent) => {
	if (e.key === 'Enter') runSearch()
})
setMode('none')
