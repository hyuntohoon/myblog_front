type Mode = 'none' | 'artist' | 'album'

type Item = {
	id: string
	type: 'artist' | 'album'
	title: string
	img: string
}

// Dummy data
const DUMMY: Item[] = [
	{
		id: 'a1',
		type: 'artist',
		title: 'The Lumens',
		img: 'https://picsum.photos/seed/lumens/300/300',
	},
	{
		id: 'a2',
		type: 'artist',
		title: 'Nova Echo',
		img: 'https://picsum.photos/seed/nova/300/300',
	},
	{
		id: 'a3',
		type: 'artist',
		title: 'Blue Harbor',
		img: 'https://picsum.photos/seed/harbor/300/300',
	},
	{
		id: 'b1',
		type: 'album',
		title: 'Midnight Lines',
		img: 'https://picsum.photos/seed/midnight/300/300',
	},
	{
		id: 'b2',
		type: 'album',
		title: 'Glass Gardens',
		img: 'https://picsum.photos/seed/glass/300/300',
	},
	{
		id: 'b3',
		type: 'album',
		title: 'Echoes by the Lake',
		img: 'https://picsum.photos/seed/lake/300/300',
	},
	{
		id: 'b4',
		type: 'album',
		title: 'Retro Skyline',
		img: 'https://picsum.photos/seed/skyline/300/300',
	},
	{
		id: 'a1',
		type: 'artist',
		title: 'The Lumens',
		img: 'https://picsum.photos/seed/lumens/300/300',
	},
	{
		id: 'a2',
		type: 'artist',
		title: 'Nova Echo',
		img: 'https://picsum.photos/seed/nova/300/300',
	},
	{
		id: 'a3',
		type: 'artist',
		title: 'Blue Harbor',
		img: 'https://picsum.photos/seed/harbor/300/300',
	},
	{
		id: 'b1',
		type: 'album',
		title: 'Midnight Lines',
		img: 'https://picsum.photos/seed/midnight/300/300',
	},
	{
		id: 'b2',
		type: 'album',
		title: 'Glass Gardens',
		img: 'https://picsum.photos/seed/glass/300/300',
	},
	{
		id: 'b3',
		type: 'album',
		title: 'Echoes by the Lake',
		img: 'https://picsum.photos/seed/lake/300/300',
	},
	{
		id: 'b4',
		type: 'album',
		title: 'Retro Skyline',
		img: 'https://picsum.photos/seed/skyline/300/300',
	},
	{
		id: 'a1',
		type: 'artist',
		title: 'The Lumens',
		img: 'https://picsum.photos/seed/lumens/300/300',
	},
	{
		id: 'a2',
		type: 'artist',
		title: 'Nova Echo',
		img: 'https://picsum.photos/seed/nova/300/300',
	},
	{
		id: 'a3',
		type: 'artist',
		title: 'Blue Harbor',
		img: 'https://picsum.photos/seed/harbor/300/300',
	},
	{
		id: 'b1',
		type: 'album',
		title: 'Midnight Lines',
		img: 'https://picsum.photos/seed/midnight/300/300',
	},
	{
		id: 'b2',
		type: 'album',
		title: 'Glass Gardens',
		img: 'https://picsum.photos/seed/glass/300/300',
	},
	{
		id: 'b3',
		type: 'album',
		title: 'Echoes by the Lake',
		img: 'https://picsum.photos/seed/lake/300/300',
	},
	{
		id: 'b4',
		type: 'album',
		title: 'Retro Skyline',
		img: 'https://picsum.photos/seed/skyline/300/300',
	},
	{
		id: 'a1',
		type: 'artist',
		title: 'The Lumens',
		img: 'https://picsum.photos/seed/lumens/300/300',
	},
	{
		id: 'a2',
		type: 'artist',
		title: 'Nova Echo',
		img: 'https://picsum.photos/seed/nova/300/300',
	},
	{
		id: 'a3',
		type: 'artist',
		title: 'Blue Harbor',
		img: 'https://picsum.photos/seed/harbor/300/300',
	},
	{
		id: 'b1',
		type: 'album',
		title: 'Midnight Lines',
		img: 'https://picsum.photos/seed/midnight/300/300',
	},
	{
		id: 'b2',
		type: 'album',
		title: 'Glass Gardens',
		img: 'https://picsum.photos/seed/glass/300/300',
	},
	{
		id: 'b3',
		type: 'album',
		title: 'Echoes by the Lake',
		img: 'https://picsum.photos/seed/lake/300/300',
	},
	{
		id: 'b4',
		type: 'album',
		title: 'Retro Skyline',
		img: 'https://picsum.photos/seed/skyline/300/300',
	},
]

function $(id: string): HTMLElement {
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

const filterData = (q: string, mode: Mode): Item[] => {
	const term = q.trim().toLowerCase()
	if (mode !== 'artist' && mode !== 'album') return []
	return DUMMY.filter(
		(it) =>
			it.type === mode && (term === '' || it.title.toLowerCase().includes(term))
	)
}

const makeCard = (it: Item): HTMLDivElement => {
	const card = document.createElement('div')
	card.className = 'card'
	card.setAttribute('role', 'button')
	card.setAttribute('tabindex', '0')
	card.setAttribute('aria-label', `${it.type}: ${it.title}`)

	const img = document.createElement('img')
	img.className = 'thumb'
	img.src = it.img
	img.alt = it.title

	// ✅ CSS 변수에서 실제 표시 크기 읽어서 인라인 강제 적용 (스코프 문제 방지)
	const size =
		getComputedStyle(resultsRow).getPropertyValue('--card-size').trim() ||
		'80px'
	// img.style.width = size
	// img.style.height = size
	// img.style.objectFit = 'cover'
	// img.style.borderRadius = '6px'

	const metaTitle = document.createElement('div')
	metaTitle.className = 'meta'
	metaTitle.textContent = it.title

	const metaType = document.createElement('div')
	metaType.className = 'type'
	metaType.textContent = it.type

	card.appendChild(img)
	card.appendChild(metaTitle)
	card.appendChild(metaType)

	card.addEventListener('click', () => selectItem(it))
	card.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault()
			selectItem(it)
		}
	})

	return card
}

const renderResults = (items: Item[]) => {
	resultsRow.innerHTML = ''
	items.forEach((it) => resultsRow.appendChild(makeCard(it)))
	resultsWrap.hidden = items.length === 0
}

const runSearch = () => {
	const items = filterData(input.value, getMode())
	renderResults(items)
}

submitBtn.addEventListener('click', runSearch)
input.addEventListener('keydown', (e: KeyboardEvent) => {
	if (e.key === 'Enter') runSearch()
})

const selectItem = (it: Item) => {
	input.value = ''
	resultsRow.innerHTML = ''
	resultsRow.appendChild(makeCard(it))
	resultsWrap.hidden = false
}

setMode('none')
