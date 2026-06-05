// src/scripts/components/makeCard.ts
import type { CardItem } from '../types/search'

export function makeCard(
	it: CardItem,
	onClick: (it: CardItem) => void | Promise<void>,
): HTMLDivElement {
	const card = document.createElement('div')
	card.className = 'card'
	card.setAttribute('role', 'button')
	card.setAttribute('tabindex', '0')
	card.setAttribute('aria-label', `${it.type}: ${it.title}`)

	const artWrap = document.createElement('div')
	artWrap.className = 'art'

	const img = document.createElement('img')
	img.className = 'thumb'
	// FEAT-music-edge-cache Step 4: covers come from Spotify's CDN (i.scdn.co),
	// already aggressively cached. Set loading/decoding BEFORE src so a dropdown
	// of many thumbs defers off-screen fetches and decodes off the main thread.
	// Intrinsic 1:1 dims are belt-and-suspenders — `.art` already reserves space
	// via aspect-ratio:1/1, so there is no layout shift.
	img.loading = 'lazy'
	img.decoding = 'async'
	img.width = 600
	img.height = 600
	img.src = it.img || 'https://placehold.co/600x600?text=No+Image'
	img.alt = it.title
	artWrap.appendChild(img)

	const meta = document.createElement('div')
	meta.className = 'meta'

	const title = document.createElement('div')
	title.className = 'title'
	title.textContent = it.title
	meta.appendChild(title)

	// 서브 텍스트
	const sub = document.createElement('div')
	sub.className = 'type'

	if (it.type === 'album') {
		// 앨범이면 아티스트 이름 우선
		sub.textContent =
			it.artist_name || (it.source === 'spotify' ? 'Album (Spotify)' : 'Album')
	}
 else if (it.type === 'track') {
		let txt = ''
		if (it.artist_name) {
			txt += it.artist_name
			const feat = it.feat_artist_names ?? []
			if (feat.length)
txt += ` (feat. ${feat.join(', ')})`
		}
		if (it.album_title)
txt += (txt ? ' • ' : '') + it.album_title
		sub.textContent =
			txt || (it.source === 'spotify' ? 'Track (Spotify)' : 'Track')
	}
 else {
		// artist
		sub.textContent = it.source === 'spotify' ? 'Artist (Spotify)' : 'Artist'
	}

	meta.appendChild(sub)

	card.appendChild(artWrap)
	card.appendChild(meta)

	// 클릭 위임
	card.addEventListener('click', () => void onClick(it))
	card.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault()
			void onClick(it)
		}
	})

	return card
}
