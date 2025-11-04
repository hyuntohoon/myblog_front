// src/scripts/searchBarSpotify.client.ts
type Source = 'db' | 'candidates'
type CardItem = {
	id: string
	type: 'artist' | 'album' | 'track'
	title: string
	img: string | null
	source: Source
	spotify_id?: string | null
	release_date?: string | null
	duration_ms?: number | null
}

const API_BASE = 'http://127.0.0.1:8000'

// ---------- helpers ----------
const $ = (id: string): HTMLElement => {
	const el = document.getElementById(id)
	if (!el) throw new Error(`#${id} not found`)
	return el
}

// ---------- DOM ----------
const bar = $('spSearchbar')
const artistBtn = $('spArtistBtn') as HTMLButtonElement
const albumBtn = $('spAlbumBtn') as HTMLButtonElement
const trackBtn = $('spTrackBtn') as HTMLButtonElement
const input = $('spQ') as HTMLInputElement
const submitBtn = $('spSubmitBtn') as HTMLButtonElement
const marketEl = $('spMarket') as HTMLInputElement
const limitEl = $('spLimit') as HTMLInputElement
const offsetEl = $('spOffset') as HTMLInputElement
const externalEl = $('spExternal') as HTMLSelectElement
const resultsWrap = $('spResultsWrap') as HTMLDivElement
const resultsRow = $('spResultsRow') as HTMLDivElement

// ---------- 단일 선택 상태 ----------
type SpType = 'artist' | 'album' | 'track'
let activeType: SpType = 'album' // 기본값: album 하나만 선택

const setThemeByType = (t: SpType) => {
	bar.classList.remove(
		'theme-none',
		'theme-artist',
		'theme-album',
		'theme-track'
	)
	if (t === 'artist') bar.classList.add('theme-artist')
	else if (t === 'album') bar.classList.add('theme-album')
	else bar.classList.add('theme-track')
}

const refreshTypeButtons = () => {
	artistBtn.setAttribute('aria-pressed', String(activeType === 'artist'))
	albumBtn.setAttribute('aria-pressed', String(activeType === 'album'))
	trackBtn.setAttribute('aria-pressed', String(activeType === 'track'))
	setThemeByType(activeType)
}

const chooseType = (t: SpType) => {
	activeType = t
	refreshTypeButtons()
}

artistBtn.addEventListener('click', () => chooseType('artist'))
albumBtn.addEventListener('click', () => chooseType('album'))
trackBtn.addEventListener('click', () => chooseType('track'))

refreshTypeButtons()

// ---------- fetch ----------
const getJSON = async <T = any>(url: string): Promise<T> =>
	(await fetch(url)).json()

// ---------- 매핑 ----------
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

const mapCandTracks = (cand: any): CardItem[] =>
	(cand.tracks || []).map((t: any) => ({
		id: t.spotify_id,
		type: 'track',
		title: t.title,
		img: t.album?.cover_url ?? null,
		source: 'candidates',
		spotify_id: t.spotify_id ?? null,
		duration_ms: t.duration_ms ?? null,
	}))

// ---------- 렌더 ----------
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
	type.textContent = `${it.type} (Spotify)`
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

// ---------- 액션 ----------
const runSpotifySearch = async () => {
	const q = input.value.trim()
	const mkt = marketEl.value.trim() || 'KR'
	const limit = Number(limitEl.value || 12)
	const offset = Number(offsetEl.value || 0)
	const include_external = externalEl.value.trim() || ''

	const url = new URL(`${API_BASE}/api/search/candidates`)
	url.searchParams.set('q', q) // 필터식 그대로 사용
	url.searchParams.set('type', activeType) // 단일 타입만 전달
	url.searchParams.set('market', mkt)
	url.searchParams.set('limit', String(limit))
	url.searchParams.set('offset', String(offset))
	if (include_external)
		url.searchParams.set('include_external', include_external)

	const cand = await getJSON(url.toString())
	let items: CardItem[] = []
	if (activeType === 'artist') items = mapCandArtists(cand)
	else if (activeType === 'album') items = mapCandAlbums(cand)
	else items = mapCandTracks(cand)
	render(items)
}

const selectItem = async (it: CardItem) => {
	// 후보 '앨범'만 동기화 타깃
	if (it.type === 'album' && it.spotify_id) {
		const res = await fetch(`${API_BASE}/api/albums/sync`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ spotify_album_id: it.spotify_id, market: 'KR' }),
		})
		const detail = await res.json()
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

submitBtn.addEventListener('click', runSpotifySearch)
input.addEventListener('keydown', (e: KeyboardEvent) => {
	if (e.key === 'Enter') runSpotifySearch()
})
