// /src/scripts/searchBarDb.client.ts

type Mode = 'none' | 'artist' | 'album'
type CardItem = {
	id: string
	type: 'artist' | 'album'
	title: string
	img: string | null
	source: 'db'
	spotify_id?: string | null
	release_date?: string | null
	artist_name?: string | null // 앨범 카드 하위 텍스트용
	artist_spotify_id?: string | null
}

const API_BASE = 'http://127.0.0.1:8000'

// ---------- DOM helpers (충돌 방지: $ -> byId) ----------
const byId = <T extends HTMLElement = HTMLElement>(id: string): T => {
	const el = document.getElementById(id)
	if (!el) throw new Error(`#${id} not found`)
	return el as T
}

// ---------- Elements (DB 전용 id만 사용) ----------
const bar = byId<HTMLDivElement>('dbSearchbar')
const artistBtn = byId<HTMLButtonElement>('dbArtistBtn')
const albumBtn = byId<HTMLButtonElement>('dbAlbumBtn')
const input = byId<HTMLInputElement>('dbQ')
const submitBtn = byId<HTMLButtonElement>('dbSubmitBtn')
const resultsWrap = byId<HTMLDivElement>('dbResultsWrap')
const resultsRow = byId<HTMLDivElement>('dbResultsRow')

// (옵셔널 섹션: 선택 아티스트의 앨범 리스트)
const artistAlbumsWrap = document.getElementById(
	'dbArtistAlbumsWrap'
) as HTMLDivElement | null
const artistAlbumsRow = document.getElementById(
	'dbArtistAlbumsRow'
) as HTMLDivElement | null
const artistAlbumsTitle = document.getElementById(
	'dbArtistAlbumsTitle'
) as HTMLDivElement | null

// ---------- State ----------
const getMode = (): Mode => (bar.getAttribute('data-mode') as Mode) ?? 'none'

// ---------- Networking ----------
const getJSON = async <T = any>(url: string): Promise<T> => {
	const res = await fetch(url, { method: 'GET' })
	if (!res.ok) throw new Error(`HTTP ${res.status}`)
	return res.json()
}

// ---------- Mappers (DB -> CardItem) ----------
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

// ---------- UI ----------
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

	// 상단 결과 초기화
	resultsRow.innerHTML = ''
	resultsWrap.hidden = true

	// 하단 섹션 초기화(존재할 때만)
	if (artistAlbumsRow) artistAlbumsRow.innerHTML = ''
	if (artistAlbumsWrap) artistAlbumsWrap.hidden = true
}

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

	// 앨범이면 하위에 아티스트명
	if (it.type === 'album') {
		const sub = document.createElement('div')
		sub.className = 'type'
		sub.textContent = it.artist_name || ''
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

const render = (items: CardItem[]) => {
	resultsRow.innerHTML = ''
	items.forEach((i) => resultsRow.appendChild(makeCard(i)))
	resultsWrap.hidden = items.length === 0
}

const renderArtistAlbums = (albums: CardItem[], artistName: string) => {
	if (!artistAlbumsRow || !artistAlbumsWrap || !artistAlbumsTitle) return
	artistAlbumsRow.innerHTML = ''
	albums.forEach((i) => artistAlbumsRow.appendChild(makeCard(i)))
	artistAlbumsTitle.textContent = `Albums by ${artistName}`
	artistAlbumsWrap.hidden = albums.length === 0
}

// ---------- Actions ----------
const onSelect = async (it: CardItem) => {
	try {
		if (it.type === 'artist') {
			const data = await getJSON(
				`${API_BASE}/api/artists/${encodeURIComponent(it.id)}/albums?limit=20&offset=0`
			)
			renderArtistAlbums(mapDBAlbums(data), it.title)
			return
		}
		if (it.type === 'album') {
			const detail = await getJSON(
				`${API_BASE}/api/albums/${encodeURIComponent(it.id)}`
			)
			window.dispatchEvent(new CustomEvent('album:detail', { detail }))
		}
	} catch (err) {
		console.error('DB select failed:', err)
	}
}

const runSearch = async () => {
	const mode = getMode()
	const q = input.value.trim()
	if (!q || (mode !== 'artist' && mode !== 'album')) return

	if (artistAlbumsRow) artistAlbumsRow.innerHTML = ''
	if (artistAlbumsWrap) artistAlbumsWrap.hidden = true

	try {
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
	} catch (err) {
		console.error('DB search failed:', err)
		resultsWrap.hidden = false
	}
}

// ---------- Events ----------
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
