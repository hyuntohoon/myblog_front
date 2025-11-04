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
	// 🔽 추가: 앨범의 대표 아티스트 표시용
	artist_name?: string | null
	artist_spotify_id?: string | null
}

const API_BASE = 'http://127.0.0.1:8000'

// ---------- DOM helpers ----------
const $ = (id: string): HTMLElement => {
	const el = document.getElementById(id)
	if (!el) throw new Error(`#${id} not found`)
	return el
}

// ---------- Elements ----------
const bar = $('dbSearchbar')
const artistBtn = $('dbArtistBtn') as HTMLButtonElement
const albumBtn = $('dbAlbumBtn') as HTMLButtonElement
const input = $('dbQ') as HTMLInputElement
const submitBtn = $('dbSubmitBtn') as HTMLButtonElement
const resultsWrap = $('dbResultsWrap') as HTMLDivElement
const resultsRow = $('dbResultsRow') as HTMLDivElement

// ⬇ 별도 섹션: 선택한 "아티스트"의 앨범 목록 표시용 (페이지에 요소가 없는 경우를 대비해 optional)
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
	return res.json()
}

// ---------- Mappers (DB -> CardItem) ----------
const mapDBArtists = (data: any): CardItem[] =>
	(data.items || []).map((a: any) => ({
		id: a.id,
		type: 'artist',
		title: a.name,
		img: a.cover_url ?? null, // 백엔드에 없다면 null
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
		// 🔽 백엔드 응답에서 매핑
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

	// 상단 검색 결과 초기화
	resultsRow.innerHTML = ''
	resultsWrap.hidden = true

	// 하단 "아티스트의 앨범" 섹션 초기화(존재할 때만)
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

	// 🔽 앨범이면 artist_name을 서브텍스트로 노출
	if (it.type === 'album') {
		const sub = document.createElement('div')
		sub.className = 'type'
		sub.textContent = it.artist_name || '' // 없으면 빈 문자열
		meta.appendChild(sub)
	}
	// 아티스트는 서브텍스트 생략 (디자인 요구사항대로)

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

// ⬇ 아티스트의 앨범들을 “별도 섹션”에만 렌더 (해당 섹션이 있을 때만)
const renderArtistAlbums = (albums: CardItem[], artistName: string) => {
	if (!artistAlbumsRow || !artistAlbumsWrap || !artistAlbumsTitle) return
	artistAlbumsRow.innerHTML = ''
	albums.forEach((i) => artistAlbumsRow.appendChild(makeCard(i)))
	artistAlbumsTitle.textContent = `Albums by ${artistName}`
	artistAlbumsWrap.hidden = albums.length === 0
}

// ---------- Actions ----------
const onSelect = async (it: CardItem) => {
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
}

const runSearch = async () => {
	const mode = getMode()
	const q = input.value.trim()
	if (!q || (mode !== 'artist' && mode !== 'album')) return

	// 새 검색 시, 하단 섹션 초기화(있을 때만)
	if (artistAlbumsRow) artistAlbumsRow.innerHTML = ''
	if (artistAlbumsWrap) artistAlbumsWrap.hidden = true

	if (mode === 'artist') {
		const data = await getJSON(
			`${API_BASE}/api/search?mode=artist&q=${encodeURIComponent(q)}&limit=20&offset=0`
		)
		render(mapDBArtists(data)) // 아티스트 리스트만 상단에 표시
	} else {
		const data = await getJSON(
			`${API_BASE}/api/search?mode=album&q=${encodeURIComponent(q)}&limit=20&offset=0`
		)
		render(mapDBAlbums(data)) // 앨범 카드에 artist_name 표시됨
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
