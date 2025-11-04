// /src/scripts/searchBarSpotify.client.ts

type Mode = 'artist' | 'album' | 'track'
type Source = 'candidates' | 'db'

type CardItem = {
	id: string
	type: 'artist' | 'album' | 'track'
	title: string
	img: string | null
	source: Source
	spotify_id?: string | null
	release_date?: string | null
}

const API_BASE = 'http://127.0.0.1:8000'

// ---------- DOM helpers ----------
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
	const el = document.getElementById(id)
	if (!el) throw new Error(`#${id} not found`)
	return el as T
}

// ---------- Grab elements ----------
const wrap = $<HTMLDivElement>('spSearchbar')
const resWrap = $<HTMLDivElement>('spResultsWrap')
const resRow = $<HTMLDivElement>('spResultsRow')

const btnArtist = $<HTMLButtonElement>('spArtistBtn')
const btnAlbum = $<HTMLButtonElement>('spAlbumBtn')
const btnTrack = $<HTMLButtonElement>('spTrackBtn')

const inputQ = $<HTMLInputElement>('spQ')
const btnSubmit = $<HTMLButtonElement>('spSubmitBtn')

const selMarket = $<HTMLSelectElement>('spMarket')
const inpLimit = $<HTMLInputElement>('spLimit')
const inpOffset = $<HTMLInputElement>('spOffset')
const selExt = $<HTMLSelectElement>('spExternal')

// ---------- Mode handling ----------
const getMode = (): Mode => (wrap.getAttribute('data-type') as Mode) || 'album'

const setMode = (m: Mode) => {
	wrap.setAttribute('data-type', m)
	wrap.classList.remove('theme-artist', 'theme-album', 'theme-track')
	wrap.classList.add(
		m === 'artist'
			? 'theme-artist'
			: m === 'track'
				? 'theme-track'
				: 'theme-album'
	)

	// toggle aria-pressed 정확히 하나만 true
	btnArtist.setAttribute('aria-pressed', String(m === 'artist'))
	btnAlbum.setAttribute('aria-pressed', String(m === 'album'))
	btnTrack.setAttribute('aria-pressed', String(m === 'track'))

	// placeholder도 모드에 맞춰 힌트 제공
	inputQ.placeholder =
		m === 'artist'
			? 'artist:"BTS" genre:k-pop'
			: m === 'track'
				? 'track:"Spring Day" isrc:KRA321701234'
				: 'album:"Proof" year:2022'

	// 결과 초기화
	resRow.innerHTML = ''
	resWrap.hidden = true
}

btnArtist.onclick = () => setMode('artist')
btnAlbum.onclick = () => setMode('album')
btnTrack.onclick = () => setMode('track')

// ---------- Fetch helpers ----------
const getJSON = async <T = any>(url: string): Promise<T> => {
	const r = await fetch(url, { method: 'GET' })
	return r.json()
}
const postJSON = async <T = any>(url: string, body: any): Promise<T> => {
	const r = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
	return r.json()
}

// ---------- Mapping (backend /api/search/candidates 응답 매핑) ----------
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
		img: t.album && t.album.cover_url ? t.album.cover_url : null,
		source: 'candidates',
		spotify_id: t.spotify_id ?? null,
		release_date: t.album?.release_date ?? null,
	}))

// ---------- Render ----------
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
	const ty = document.createElement('div')
	ty.className = 'type'
	ty.textContent = `${it.type}${it.source === 'candidates' ? ' (Spotify)' : ''}`

	meta.appendChild(title)
	meta.appendChild(ty)

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
	resRow.innerHTML = ''
	items.forEach((it) => resRow.appendChild(makeCard(it)))
	resWrap.hidden = items.length === 0
}

// ---------- Build query ----------
const buildSmartQuery = (mode: Mode, raw: string): string => {
	const q = raw.trim()
	if (!q) return ''
	if (mode === 'artist') return `artist:"${q}"`
	if (mode === 'track') return `track:"${q}"`
	return `album:"${q}"`
}

const buildTypesParam = (mode: Mode): string => {
	if (mode === 'artist') return 'artist'
	if (mode === 'track') return 'track'
	return 'album'
}

// ---------- Actions ----------
const runSearch = async () => {
	const mode = getMode()
	const smartQ = buildSmartQuery(mode, inputQ.value)
	if (!smartQ) return

	const url =
		`${API_BASE}/api/search/candidates` +
		`?q=${encodeURIComponent(smartQ)}` +
		`&type=${encodeURIComponent(buildTypesParam(mode))}` +
		`&market=${encodeURIComponent(selMarket.value)}` +
		`&limit=${encodeURIComponent(inpLimit.value)}` +
		`&offset=${encodeURIComponent(inpOffset.value)}` +
		(selExt.value
			? `&include_external=${encodeURIComponent(selExt.value)}`
			: '')

	const cand = await getJSON(url)

	// 현재 모드에 맞는 결과만 표시
	let items: CardItem[] = []
	if (mode === 'artist') items = mapCandArtists(cand)
	else if (mode === 'track') items = mapCandTracks(cand)
	else items = mapCandAlbums(cand)

	render(items)
}

btnSubmit.onclick = runSearch
inputQ.addEventListener('keydown', (e) => {
	if (e.key === 'Enter') runSearch()
})

// ---------- Select handlers ----------
const onSelect = async (it: CardItem) => {
	// Spotify 후보에서 앨범을 고르면 동기화 → 페이지에 album:detail 이벤트로 알림
	if (it.type === 'album' && it.source === 'candidates' && it.spotify_id) {
		const detail = await postJSON(`${API_BASE}/api/albums/sync`, {
			spotify_album_id: it.spotify_id,
			market: selMarket.value || 'KR',
		})
		window.dispatchEvent(new CustomEvent('album:detail', { detail }))
	}
}

// ---------- init ----------
setMode(getMode())
