// /src/scripts/searchBarDb.client.ts
import type { CardItem } from '../scripts/types/search.ts'
import { makeCard } from './components/makeCard.ts'

import { PUBLIC_API_URL } from 'astro:env/client'

type Mode = 'none' | 'artist' | 'album'
type View = 'db' | 'spotify'
const API_BASE = PUBLIC_API_URL

// --------------------------------------------------
// DOM
// --------------------------------------------------
function byId<T extends HTMLElement>(id: string): T {
	const el = document.getElementById(id)
	if (!el)
throw new Error(`#${id} not found`)
	return el as T
}

const bar = byId<HTMLDivElement>('dbSearchbar')
const artistBtn = byId<HTMLButtonElement>('dbArtistBtn')
const albumBtn = byId<HTMLButtonElement>('dbAlbumBtn')
const input = byId<HTMLInputElement>('dbQ')
const submitBtn = byId<HTMLButtonElement>('dbSubmitBtn')

// ✅ 신규 버튼/상태
const syncBtn = byId<HTMLButtonElement>('dbSyncBtn')
const backBtn = byId<HTMLButtonElement>('dbBackBtn')
const statusEl = byId<HTMLDivElement>('dbStatus')

const resultsWrap = byId<HTMLDivElement>('dbResultsWrap')
const resultsRow = byId<HTMLDivElement>('dbResultsRow')

// optional section (DB artist -> albums)
const artistAlbumsWrap = byId<HTMLDivElement>('dbArtistAlbumsWrap')
const artistAlbumsRow = byId<HTMLDivElement>('dbArtistAlbumsRow')
const artistAlbumsTitle = byId<HTMLDivElement>('dbArtistAlbumsTitle')

// --------------------------------------------------
// State
// --------------------------------------------------
let _view: View = 'db'

// --------------------------------------------------
// Helpers
// --------------------------------------------------
const getMode = (): Mode => (bar.getAttribute('data-mode') as Mode) ?? 'none'

function setStatus(msg: string) {
	statusEl.textContent = msg
}

function setView(v: View) {
	_view = v
	backBtn.hidden = v !== 'spotify'
}

async function getJSON<T = any>(url: string): Promise<T> {
	const res = await fetch(url)
	if (!res.ok)
throw new Error(`HTTP ${res.status}`)
	return res.json()
}

// --------------------------------------------------
// Mappers
// --------------------------------------------------
function mapDBArtists(data: any): CardItem[] {
  return (data.items || []).map((a: any) => ({
		id: a.id,
		type: 'artist',
		title: a.name,
		img: a.cover_url ?? null,
		source: 'db',
		spotify_id: a.spotify_id ?? null,
	}))
}

function mapDBAlbums(data: any): CardItem[] {
  return (data.items || []).map((al: any) => ({
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
}

// ✅ 후보(Spotify) 앨범만 매핑 (write 화면에서 앨범 선택에 집중)
function mapCandAlbums(cand: any): CardItem[] {
  return (cand.albums || []).map((a: any) => ({
		id: a.spotify_id,
		type: 'album',
		title: a.title,
		img: a.cover_url ?? null,
		source: 'spotify',
		spotify_id: a.spotify_id ?? null,
		release_date: a.release_date ?? null,
		artist_name: a.artist_name ?? null,
		artist_spotify_id: a.artist_spotify_id ?? null,
		external_url: a.external_url ?? null,

		// ✅ 백엔드에서 내려주면 사용 (없어도 동작)
		// db_album_id: a.db_album_id ?? null,
	}))
}

// --------------------------------------------------
// UI
// --------------------------------------------------
function setMode(mode: Mode) {
	bar.setAttribute('data-mode', mode)
	bar.classList.remove('theme-none', 'theme-artist', 'theme-album')
	bar.classList.add(
		mode === 'artist' ?
			'theme-artist' :
			mode === 'album' ?
				'theme-album' :
				'theme-none',
	)

	artistBtn.setAttribute('aria-pressed', String(mode === 'artist'))
	albumBtn.setAttribute('aria-pressed', String(mode === 'album'))

	input.placeholder =
		mode === 'artist' ?
			'Search by artist name' :
			mode === 'album' ?
				'Search by album title' :
				'Select Artist or Album first'

	// view는 기본적으로 DB로 복귀
	setView('db')
	setStatus('')

	// reset upper results
	resultsRow.innerHTML = ''
	resultsWrap.hidden = true

	// reset artist album section
	artistAlbumsRow.innerHTML = ''
	artistAlbumsWrap.hidden = true
}

function renderResults(items: CardItem[]) {
	resultsRow.innerHTML = ''
	items.forEach(it => resultsRow.appendChild(makeCard(it, onSelect)))
	resultsWrap.hidden = items.length === 0
}

function renderArtistAlbums(albums: CardItem[], artistName: string) {
	artistAlbumsRow.innerHTML = ''
	albums.forEach(al => artistAlbumsRow.appendChild(makeCard(al, onSelect)))
	artistAlbumsTitle.textContent = `Albums by ${artistName}`
	artistAlbumsWrap.hidden = albums.length === 0
}

// --------------------------------------------------
// Select Action
// --------------------------------------------------
async function fetchAlbumDetailBySpotifyId(spotifyAlbumId: string) {
	// ✅ DB-only 정책: by-spotify 엔드포인트는 "DB에서 spotify_id로 조회" 용도
	const url = `${API_BASE}/api/music/albums/by-spotify/${encodeURIComponent(spotifyAlbumId)}`
	return getJSON(url)
}

async function onSelect(it: CardItem) {
	try {
		// Artist(DB) → show albums
		if (it.type === 'artist' && it.source === 'db') {
			const data = await getJSON(
				`${API_BASE}/api/music/artists/${encodeURIComponent(it.id)}/albums?limit=20&offset=0`,
			)
			const albums = mapDBAlbums(data)
			renderArtistAlbums(albums, it.title)
			return
		}

		// Album(DB) → show detail view (dispatch)
		if (it.type === 'album' && it.source === 'db') {
			const detail = await getJSON(
				`${API_BASE}/api/music/albums/${encodeURIComponent(it.id)}`,
			)

			window.dispatchEvent(new CustomEvent('album:detail', { detail }))

			// cleanup UI
			input.value = ''
			resultsRow.innerHTML = ''
			resultsWrap.hidden = true
			artistAlbumsRow.innerHTML = ''
			artistAlbumsWrap.hidden = true
			setStatus('')
			setView('db')
			return
		}

		// ✅ Album(Spotify 후보) → DB-only 상세 시도
		if (it.type === 'album' && it.source === 'spotify' && it.spotify_id) {
			setStatus(
				'⏳ 동기화 중… DB에 반영되면 상세가 열립니다. 잠시 후 다시 클릭하세요.',
			)

			try {
				const detail = await fetchAlbumDetailBySpotifyId(it.spotify_id)
				window.dispatchEvent(new CustomEvent('album:detail', { detail }))

				// cleanup UI (상세 선택 시 DB view로 돌림)
				setStatus('✅ DB에서 상세를 불러왔습니다.')
				setView('db')
				input.value = ''
				resultsRow.innerHTML = ''
				resultsWrap.hidden = true
				artistAlbumsRow.innerHTML = ''
				artistAlbumsWrap.hidden = true
			}
 catch (err) {
				// 아직 DB에 없으면(404 등) 안내만
				console.error('by-spotify detail failed:', err)
				setStatus(
					'⏳ 아직 DB에 반영되지 않았습니다. 잠시 후 다시 시도하거나, DB로 돌아가 재검색하세요.',
				)
			}
		}
	}
 catch (err) {
		console.error('Select failed:', err)
	}
}

// --------------------------------------------------
// Search Action (DB-only)
// --------------------------------------------------
async function runSearch() {
	const mode = getMode()
	const q = input.value.trim()
	if (!q || (mode !== 'artist' && mode !== 'album'))
return

	// clear secondary section
	artistAlbumsRow.innerHTML = ''
	artistAlbumsWrap.hidden = true

	setView('db')
	setStatus('')

	try {
		if (mode === 'artist') {
			const data = await getJSON(
				`${API_BASE}/api/music/search?mode=artist&q=${encodeURIComponent(q)}&limit=20&offset=0`,
			)
			renderResults(mapDBArtists(data))
		}
 else {
			const data = await getJSON(
				`${API_BASE}/api/music/search?mode=album&q=${encodeURIComponent(q)}&limit=20&offset=0`,
			)
			renderResults(mapDBAlbums(data))
		}
	}
 catch (err) {
		console.error('DB search failed:', err)
		setStatus('❌ DB 검색 실패')
	}
}

// --------------------------------------------------
// Sync Action (Spotify candidates + enqueue)
// --------------------------------------------------
async function runSync() {
	const mode = getMode()
	const q = input.value.trim()
	if (!q || (mode !== 'artist' && mode !== 'album'))
return

	// 최소 연타 방지(3초)
	syncBtn.disabled = true
	setTimeout(() => {
		syncBtn.disabled = false
	}, 3000)

	// clear secondary section
	artistAlbumsRow.innerHTML = ''
	artistAlbumsWrap.hidden = true

	setView('spotify')
	setStatus('🔄 Spotify 후보를 가져오고, 백그라운드로 DB 최신화를 시작합니다…')

	// DB 결과 화면을 후보로 대체하므로 기존 결과는 비우고 다시 렌더
	resultsRow.innerHTML = ''
	resultsWrap.hidden = true

	// smartQ: mode에 따라 Spotify query를 조금 더 정확히
	const smartQ =
		mode === 'artist' ? `artist:"${q}"` : mode === 'album' ? `album:"${q}"` : q

	// write 화면은 앨범 선택이 핵심이라 type=album으로 단순화
	const url =
		`${API_BASE}/api/music/search/candidates` +
		`?q=${encodeURIComponent(smartQ)}` +
		`&type=${encodeURIComponent('album')}` +
		`&market=KR&limit=20&offset=0`

	try {
		const cand = await getJSON(url)
		const items = mapCandAlbums(cand)

		renderResults(items)

		if (!items.length) {
			setStatus('⚠️ 후보가 없습니다. 검색어를 바꿔보세요.')
		}
 else {
			setStatus('✅ Spotify 후보를 표시 중입니다. (상세는 DB 반영 후 가능)')
		}
	}
 catch (err) {
		console.error('Spotify candidates failed:', err)
		setStatus('❌ Spotify 후보 검색 실패')
		setView('db')
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

submitBtn.addEventListener('click', () => void runSearch())

input.addEventListener('keydown', (e: KeyboardEvent) => {
	if (e.key === 'Enter')
void runSearch()
})

// ✅ 동기화 버튼
syncBtn.addEventListener('click', () => void runSync())

// ✅ 후보 화면에서 DB로 돌아가기
backBtn.addEventListener('click', () => {
	setView('db')
	setStatus('')
	void runSearch()
})

// init
setMode('none')
