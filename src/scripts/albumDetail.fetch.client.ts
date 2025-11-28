// src/scripts/albumDetail.fetch.client.ts

const section = document.getElementById('music-section') as HTMLElement | null
if (!section) {
	console.warn('[albumDetail.fetch] #music-section not found')
} else {
	const albumIdsRaw = section.dataset.albumIds || '[]'
	const artistIdsRaw = section.dataset.artistIds || '[]'

	let albumIds: string[] = []
	let artistIds: string[] = []

	try {
		albumIds = JSON.parse(albumIdsRaw)
	} catch (e) {
		console.error('[albumDetail.fetch] invalid albumIds json:', albumIdsRaw, e)
	}

	try {
		artistIds = JSON.parse(artistIdsRaw)
	} catch (e) {
		console.error(
			'[albumDetail.fetch] invalid artistIds json:',
			artistIdsRaw,
			e
		)
	}

	// ✅ API base: 환경변수 우선, 없으면 same-origin 사용
	const API_BASE = (import.meta as any).env?.PUBLIC_API_URL ?? ''
	const base = API_BASE.replace(/\/+$/, '') // 끝 슬래시 정리

	// ─────────────────────────────
	// 1) 앨범 정보 (현재 첫 번째 앨범만 사용)
	// ─────────────────────────────
	if (albumIds.length > 0) {
		const albumId = albumIds[0]
		const albumUrl = `${base}/api/music/albums/${albumId}`

		fetch(albumUrl)
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`)
				return r.json()
			})
			.then((data) => {
				// 글 보기 화면에서는 항상 selectable: false
				window.dispatchEvent(
					new CustomEvent('album:detail', {
						detail: { ...data, selectable: false },
					})
				)
			})
			.catch((err) => {
				console.error('[albumDetail.fetch] Album fetch failed:', err)
			})
	}

	// ─────────────────────────────
	// 2) 아티스트 정보 (지금은 로깅만, 나중 확장용)
	// ─────────────────────────────
	if (artistIds.length > 0) {
		const artistUrls = artistIds.map((id) => `${base}/api/music/artists/${id}`)

		Promise.all(
			artistUrls.map((u) =>
				fetch(u).then((r) => {
					if (!r.ok) throw new Error(`HTTP ${r.status}`)
					return r.json()
				})
			)
		)
			.then((artists) => {
				console.log('🎤 Artists loaded:', artists)
				// TODO: 나중에 필요하면 여기서
				// window.dispatchEvent(new CustomEvent('artist:detail', { detail: artists }))
				// 이런 식으로 확장
			})
			.catch((err) => {
				console.error('[albumDetail.fetch] Artist fetch failed:', err)
			})
	}
}
