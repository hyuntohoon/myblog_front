import type { CardItem } from '../types/search'

export function makeCard(
	it: CardItem,
	onClick: (it: CardItem) => void | Promise<void>
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
	img.src = it.img || 'https://placehold.co/600x600?text=No+Image'
	img.alt = it.title
	artWrap.appendChild(img)

	const meta = document.createElement('div')
	meta.className = 'meta'

	const title = document.createElement('div')
	title.className = 'title'
	title.textContent = it.title
	meta.appendChild(title)

	// ⭐ 앨범이면 추가 텍스트 표시(DB, Spotify 모두 지원)
	if (it.type === 'album' && it.artist_name) {
		const sub = document.createElement('div')
		sub.className = 'type'
		sub.textContent = it.artist_name
		meta.appendChild(sub)
	} else {
		const type = document.createElement('div')
		type.className = 'type'
		type.textContent =
			it.type + (it.source === 'candidates' ? ' (Spotify)' : '')
		meta.appendChild(type)
	}

	card.appendChild(artWrap)
	card.appendChild(meta)

	// ⭐ onClick 콜백으로 완전히 외부 위임
	card.addEventListener('click', () => onClick(it))
	card.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault()
			onClick(it)
		}
	})

	return card
}
