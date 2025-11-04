// src/scripts/searchBar.client.ts
type Mode = 'none' | 'artist' | 'album'
type Source = 'db' | 'candidates'

type CardItem = {
	id: string // 로컬 DB의 id 또는 spotify_id (candidates일 때)
	type: 'artist' | 'album'
	title: string
	img: string | null
	source: Source
	spotify_id?: string | null
	release_date?: string | null
}

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

const API_BASE = 'http://127.0.0.1:8000' // 백엔드가 8000 포트에서 동작 중일 때

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

// ---------- fetch helpers ----------
const getJSON = async <T = any>(url: string): Promise<T> => {
	const res = await fetch(url, { method: 'GET' })
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

// ---------- 매핑: 백엔드 응답 → CardItem ----------
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
		id: a.spotify_id, // 후보는 spotify id 사용
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

// ---------- 렌더 ----------
const makeCard = (it: CardItem): HTMLDivElement => {
	const card = document.createElement('div')
	card.className = 'card'
	card.setAttribute('role', 'button')
	card.setAttribute('tabindex', '0')
	card.setAttribute('aria-label', `${it.type}: ${it.title}`)

	const artWrap = document.createElement('div')
	artWrap.className = 'art'
	const img = document.createElement('img')
	img.className = 'thumb'
	img.src = it.img || 'https://placehold.co/600x600?text=No+Image'
	img.alt = it.title
	artWrap.appendChild(img)

	const meta = document.createElement('div')
	meta.className = 'meta'

	const title = document.createElement('div')
	title.className = 'title'
	title.textContent = it.title

	const type = document.createElement('div')
	type.className = 'type'
	type.textContent = it.type + (it.source === 'candidates' ? ' (Spotify)' : '')

	meta.appendChild(title)
	meta.appendChild(type)

	card.appendChild(artWrap)
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
	// ⛔ 더보기 버튼은 정적 HTML(#moreBtn)을 사용하므로 여기서 생성하지 않음
	resultsWrap.hidden = items.length === 0
}

// ---------- 액션 ----------
const runSearch = async () => {
	const mode = getMode()
	const q = input.value.trim()
	if (!q || (mode !== 'artist' && mode !== 'album')) return

	if (mode === 'artist') {
		const data = await getJSON(
			`${API_BASE}/api/search?mode=artist&q=${encodeURIComponent(q)}&limit=20&offset=0`
		)
		const items = mapDBArtists(data)
		render(items)
	} else {
		const data = await getJSON(
			`${API_BASE}/api/search?mode=album&q=${encodeURIComponent(q)}&limit=20&offset=0`
		)
		const items = mapDBAlbums(data)
		render(items)
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
		`${API_BASE}/api/search/candidates?q=${encodeURIComponent(smartQ)}&type=${encodeURIComponent(types)}&market=KR&limit=12`
	)
	const items: CardItem[] = [
		...mapCandArtists(cand),
		...mapCandAlbums(cand),
	].filter((i) => i.type === (mode === 'none' ? i.type : mode))
	render(items)
}

const selectItem = async (it: CardItem) => {
	// Artist(DB) 클릭 → 해당 아티스트의 앨범 나열(로컬)
	if (it.type === 'artist' && it.source === 'db') {
		const data = await getJSON(
			`${API_BASE}/api/artists/${encodeURIComponent(it.id)}/albums?limit=20&offset=0`
		)
		const items = mapDBAlbums(data)
		render(items)
		return
	}

	// Album(DB) 클릭 → 단일 카드로 고정(간단 표시)
	if (it.type === 'album' && it.source === 'db') {
		resultsRow.innerHTML = ''
		resultsRow.appendChild(makeCard(it))
		resultsWrap.hidden = false
		return
	}

	// Album(Spotify 후보) 클릭 → 동기화 후 로컬 상세를 단일 카드로 표시(간단화)
	if (it.type === 'album' && it.source === 'candidates' && it.spotify_id) {
		const detail = await postJSON(`${API_BASE}/api/albums/sync`, {
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
		resultsRow.appendChild(makeCard(card))
		resultsWrap.hidden = false
	}
}

// ---------- 이벤트 연결 ----------
submitBtn.addEventListener('click', runSearch)
input.addEventListener('keydown', (e: KeyboardEvent) => {
	if (e.key === 'Enter') runSearch()
})
if (moreBtn) {
	moreBtn.addEventListener('click', () => {
		// 현재 모드와 입력값을 기준으로 Spotify 후보 검색
		searchCandidates()
	})
}

// init
setMode('none')
