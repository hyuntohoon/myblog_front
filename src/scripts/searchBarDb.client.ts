// src/scripts/searchBarDb.client.ts
import type { CandidateSearchResponse, CardItem } from '../scripts/types/search.ts'
import type { components } from '../lib/api.gen'
import { makeCard } from './components/makeCard.ts'
import { PUBLIC_API_URL } from 'astro:env/client'
import { getAuthHeader } from '../lib/auth.ts'

type AlbumItem = components['schemas']['Music_AlbumItem']
type ArtistItem = components['schemas']['Music_ArtistItem']
type TrackItem = components['schemas']['Music_TrackItem']
type UnifiedSearchResult = components['schemas']['Music_UnifiedSearchResult']
type ArtistAlbumsResult = components['schemas']['Music_SearchResult']

const API_BASE = PUBLIC_API_URL
type View = 'db' | 'spotify'

// DOM
function byId<T extends HTMLElement>(id: string): T {
	const el = document.getElementById(id)
	if (!el)
throw new Error(`#${id} not found`)
	return el as T
}

const input = byId<HTMLInputElement>('searchBar')
const submitBtn = byId<HTMLButtonElement>('dbSubmitBtn')
const syncBtn = byId<HTMLButtonElement>('dbSyncBtn')
const backBtn = byId<HTMLButtonElement>('dbBackBtn')
const statusEl = byId<HTMLDivElement>('dbStatus')

const resultsWrap = byId<HTMLDivElement>('resultsWrap')
const artistsRow = byId<HTMLDivElement>('artistsRow')
const albumsRow = byId<HTMLDivElement>('albumsRow')
const tracksRow = byId<HTMLDivElement>('tracksRow')

// state
let _view: View = 'db'
function setView(v: View) {
	_view = v
	backBtn.hidden = v !== 'spotify'
}
function setStatus(msg: string) {
	statusEl.textContent = msg
}

// HTTP
async function getJSON<T = any>(url: string): Promise<T> {
	const r = await fetch(url, { method: 'GET' })
	if (!r.ok)
throw new Error(`HTTP ${r.status}`)
	return r.json()
}

// render
function clearResults() {
	artistsRow.innerHTML = ''
	albumsRow.innerHTML = ''
	tracksRow.innerHTML = ''
	resultsWrap.hidden = true
}

function render(artists: CardItem[],	albums: CardItem[],	tracks: CardItem[]) {
	artistsRow.innerHTML = ''
	albumsRow.innerHTML = ''
	tracksRow.innerHTML = ''

	artists.forEach(it => artistsRow.appendChild(makeCard(it, onSelect)))
	albums.forEach(it => albumsRow.appendChild(makeCard(it, onSelect)))
	tracks.forEach(it => tracksRow.appendChild(makeCard(it, onSelect)))

	resultsWrap.hidden = artists.length + albums.length + tracks.length === 0
}

// -----------------------------
// Mappers (DB unified)
// -----------------------------
function mapDBArtistsUnified(arr: ArtistItem[]): CardItem[] {
  return (arr || []).map(a => ({
		id: a.id,
		type: 'artist',
		title: a.name,
		img: a.cover_url ?? null,
		source: 'db',
		spotify_id: a.spotify_id ?? null,
	}))
}

function mapDBAlbumsUnified(arr: AlbumItem[]): CardItem[] {
  return (arr || []).map(al => ({
		id: al.id,
		type: 'album',
		title: al.title,
		img: al.cover_url ?? null,
		source: 'db',
		spotify_id: al.spotify_id ?? null,
		release_date: al.release_date ?? null,
		artist_name: al.artist_name ?? null,
		artist_spotify_id: al.artist_spotify_id ?? null,
		external_url: al.external_url ?? null,
	}))
}

// ✅ DB TrackItem -> CardItem (트랙 클릭 시 앨범 상세로 가야 하므로 db_album_id에 album_id를 담는다)
function mapDBTracksUnified(arr: TrackItem[]): CardItem[] {
  return (arr || []).map(t => ({
		id: t.id, // track db uuid
		type: 'track',
		title: t.title,
		img: t.cover_url ?? null, // album cover
		source: 'db',
		spotify_id: t.spotify_id ?? null,
		release_date: t.release_date ?? null,
		artist_name: t.artist_name ?? null,
		feat_artist_names: t.feat_artist_names ?? [],
		album_title: t.album_title ?? null,
		album_spotify_id: t.album_spotify_id ?? null,
		db_album_id: t.album_id ?? null, // ✅ 핵심: 트랙 클릭 → 이 앨범(DB)로 이동
	}))
}

// -----------------------------
// Mappers (Spotify candidates)
// -----------------------------
function mapCandArtists(cand: CandidateSearchResponse): CardItem[] {
  return (cand.artists || []).map(a => ({
		id: a.spotify_id ?? '',
		type: 'artist',
		title: a.name ?? '',
		img: a.photo_url ?? null,
		source: 'spotify',
		spotify_id: a.spotify_id ?? null,
		external_url: a.external_url ?? null,
		artist_spotify_id: a.spotify_id ?? null,
	}))
}

function mapCandAlbums(cand: CandidateSearchResponse): CardItem[] {
  return (cand.albums || []).map(a => ({
		id: a.spotify_id ?? '',
		type: 'album',
		title: a.title ?? '',
		img: a.cover_url ?? null,
		source: 'spotify',
		spotify_id: a.spotify_id ?? null,
		release_date: a.release_date ?? null,
		artist_name: a.artist_name ?? null,
		artist_spotify_id: a.artist_spotify_id ?? null,
		external_url: a.external_url ?? null,
	}))
}

// CandidateSearchService.track 응답은 { title, spotify_id, album:{spotify_id,title,release_date,cover_url}, artist_name ... }
function mapCandTracks(cand: CandidateSearchResponse): CardItem[] {
  return (cand.tracks || []).map(t => ({
		id: t.spotify_id ?? '',
		type: 'track',
		title: t.title ?? '',
		img: t.album?.cover_url ?? null,
		source: 'spotify',
		spotify_id: t.spotify_id ?? null,
		release_date: t.album?.release_date ?? null,
		artist_name: t.artist_name ?? null,
		album_title: t.album?.title ?? null,
		external_url: t.external_url ?? null,
		album_spotify_id: t.album?.spotify_id ?? null,
	}))
}

// -----------------------------
// Actions
// -----------------------------
async function runDBSearch() {
	const q = input.value.trim()
	if (!q)
return

	setView('db')
	setStatus('')
	clearResults()

	try {
		// ✅ 1번 호출로 3섹션
		const data = await getJSON<UnifiedSearchResult>(
			`${API_BASE}/api/music/search/unified?q=${encodeURIComponent(q)}&limit=20&offset=0`,
		)

		const artists = mapDBArtistsUnified(data.artists ?? [])
		const albums = mapDBAlbumsUnified(data.albums ?? [])
		const tracks = mapDBTracksUnified(data.tracks ?? [])

		render(artists, albums, tracks)

		if (!artists.length && !albums.length && !tracks.length) {
			setStatus('DB에 결과가 없습니다. 최신이 필요하면 Sync를 눌러보세요.')
		}
	}
 catch (e) {
		console.error(e)
		setStatus('❌ DB 검색 실패')
	}
}

async function runSync() {
	const q = input.value.trim()
	if (!q)
return

	// 최소 연타 방지
	syncBtn.disabled = true
	setTimeout(() => (syncBtn.disabled = false), 3000)

	setView('spotify')
	setStatus('🔄 Spotify 후보를 가져오고, 백그라운드로 DB 최신화를 시작합니다…')
	clearResults()

	const url =
		`${API_BASE}/api/music/search/candidates` +
		`?q=${encodeURIComponent(q)}` +
		`&type=${encodeURIComponent('artist,album,track')}` +
		`&market=KR&limit=50&offset=0`

	try {
		const r = await fetch(url, { headers: getAuthHeader() })
		if (!r.ok)
throw new Error(`HTTP ${r.status}`)
		const cand = await r.json() as CandidateSearchResponse
		render(
			mapCandArtists(cand).slice(0, 10),
			mapCandAlbums(cand).slice(0, 20),
			mapCandTracks(cand).slice(0, 20),
		)
		setStatus('✅ Spotify 후보 표시 중 (상세는 DB 반영 후 가능)')
	}
 catch (e) {
		console.error(e)
		setStatus('❌ Spotify 후보 검색 실패')
		setView('db')
	}
}

// -----------------------------
// Select (상세는 DB-only)
// -----------------------------
type AlbumDetail = components['schemas']['Music_AlbumDetail']

async function fetchAlbumDetailByDBId(dbAlbumId: string) {
  return getJSON<AlbumDetail>(
		`${API_BASE}/api/music/albums/${encodeURIComponent(dbAlbumId)}`,
	)
}

async function fetchAlbumDetailBySpotifyId_DBOnly(spotifyAlbumId: string) {
  return getJSON<AlbumDetail>(
		`${API_BASE}/api/music/albums/by-spotify/${encodeURIComponent(spotifyAlbumId)}`,
	)
}

async function onSelect(it: CardItem): Promise<void> {
	try {
		// DB album -> album detail
		if (it.type === 'album' && it.source === 'db') {
			const detail = await fetchAlbumDetailByDBId(it.id)
			window.dispatchEvent(new CustomEvent('album:detail', { detail }))
			setStatus('')
			return
		}

		// ✅ DB track -> album detail (track에 담긴 db_album_id로 이동)
		if (it.type === 'track' && it.source === 'db') {
			const albumId = it.db_album_id
			if (!albumId) {
				setStatus('❌ 트랙에 연결된 앨범 정보가 없습니다.')
				return
			}
			const detail = await fetchAlbumDetailByDBId(albumId)
			window.dispatchEvent(new CustomEvent('album:detail', { detail }))
			setStatus('')
			return
		}

		// Spotify album -> DB-only detail by-spotify (없으면 syncing)
		if (it.type === 'album' && it.source === 'spotify' && it.spotify_id) {
			setStatus(
				'⏳ 동기화 중… DB에 반영되면 상세가 열립니다. 잠시 후 다시 클릭하세요.',
			)
			try {
				const detail = await fetchAlbumDetailBySpotifyId_DBOnly(it.spotify_id)
				window.dispatchEvent(new CustomEvent('album:detail', { detail }))
				setStatus('✅ DB에서 상세를 불러왔습니다.')
			}
 catch (e) {
				console.error(e)
				setStatus('⏳ 아직 DB에 반영되지 않았습니다. 잠시 후 다시 시도하세요.')
			}
			return
		}

		// Spotify track -> album by-spotify (track은 앨범으로 점프)
		if (it.type === 'track' && it.source === 'spotify' && it.album_spotify_id) {
			setStatus(
				'⏳ 동기화 중… DB에 반영되면 상세가 열립니다. 잠시 후 다시 클릭하세요.',
			)
			try {
				const detail = await fetchAlbumDetailBySpotifyId_DBOnly(
					it.album_spotify_id,
				)
				window.dispatchEvent(new CustomEvent('album:detail', { detail }))
				setStatus('✅ DB에서 상세를 불러왔습니다.')
			}
 catch (e) {
				console.error(e)
				setStatus('⏳ 아직 DB에 반영되지 않았습니다. 잠시 후 다시 시도하세요.')
			}
			return
		}

		// DB artist -> show albums only
		if (it.type === 'artist' && it.source === 'db') {
			setStatus(`🎵 ${it.title}의 앨범을 불러오는 중…`)
			const data = await getJSON<ArtistAlbumsResult>(
				`${API_BASE}/api/music/artists/${encodeURIComponent(it.id)}/albums?limit=20&offset=0`,
			)
			const albums = mapDBAlbumsUnified((data.items ?? []) as AlbumItem[])
			render([], albums, [])
			setStatus(`✅ ${it.title}의 앨범 목록`)
			return
		}

		// Spotify artist -> no detail in this phase
		if (it.type === 'artist' && it.source === 'spotify') {
			setStatus(
				'ℹ️ 아티스트 상세는 DB 기반으로만 합니다. 앨범/트랙을 선택해 주세요.',
			)
		}
	}
 catch (e) {
		console.error(e)
		setStatus('❌ 선택 처리 실패')
	}
}

// events
submitBtn.addEventListener('click', () => void runDBSearch())
syncBtn.addEventListener('click', () => void runSync())

input.addEventListener('keydown', (e) => {
	if (e.key === 'Enter') {
		e.preventDefault()
		void runDBSearch()
	}
})

backBtn.addEventListener('click', () => {
	setView('db')
	setStatus('')
	void runDBSearch()
})

// init
setView('db')
setStatus('')
