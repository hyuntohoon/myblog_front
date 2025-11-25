// src/scripts/write/index.ts
import { publishToGit, savePost, type PostPayload } from './api'
import { initEditor, getContent, resetContent } from './editor'
import {
	showToast,
	redirectOnSuccess,
	loadCategoriesToSelect,
	wireCategoryAddButton,
	wireReviewToggle,
	wireAlbumPreview,
} from './ui'

type AlbumDetail = {
	album: { id: string; title: string; cover_url?: string | null }
	artists?: { id: string; name: string; spotify_id?: string | null }[]
}

const $ = <T extends Element = HTMLElement>(sel: string) =>
	document.querySelector(sel) as T | null

const form = $('#write-form') as HTMLFormElement | null
const resultEl = $('#write-result') as HTMLElement | null
const submitBtn = $('#submit-btn') as HTMLButtonElement | null

const categorySel = $('#category') as HTMLSelectElement | null
const catHelp = $('#catHelp') as HTMLElement | null
const addBtn = $('#add-category') as HTMLButtonElement | null

// 지금은 UI에서 안 쓰지만, 기존 코드와 호환 위해 남겨둠 (null이면 그냥 스킵됨)
const enableReview = $('#enableReview') as HTMLInputElement | null
const reviewSection = $('#musicReview') as HTMLElement | null
const albumSelect = $('#albumId') as HTMLSelectElement | null
const albumPreview = $('#albumPreview') as HTMLElement | null
const albumImage = albumPreview?.querySelector('img') as HTMLImageElement | null

const albumIdsHidden = $('#albumIds') as HTMLInputElement | null
const artistIdsHidden = $('#artistIds') as HTMLInputElement | null
const selectedAlbumsWrap = $('#selected-albums-wrap') as HTMLElement | null
const selectedAlbumsRow = $('#selectedAlbums') as HTMLElement | null

// 🔥 평점 입력 요소
const ratingInput = $('#rating') as HTMLInputElement | null
const ratingSection = $('#rating-section') as HTMLElement | null

type SimpleSelectedAlbum = {
	id: string
	title: string
	artists: string
	artistIds: string[]
	coverUrl?: string | null
}

let selectedAlbum: SimpleSelectedAlbum | null = null
let albumDetailListenerBound = false

// ✅ Enter 키로 폼 제출 막기 (검색창 제외)
document.addEventListener('keydown', (e) => {
	const target = e.target as HTMLElement
	if (e.key === 'Enter' && target.id !== 'searchBar') e.preventDefault()
})

function renderSelectedAlbum() {
	// hidden input은 필수, UI 컨테이너는 옵션
	if (!albumIdsHidden || !artistIdsHidden) return

	// UI 영역 있으면만 정리
	if (selectedAlbumsRow) {
		selectedAlbumsRow.innerHTML = ''
	}

	if (!selectedAlbum) {
		albumIdsHidden.value = '[]'
		artistIdsHidden.value = '[]'
		selectedAlbumsWrap?.classList.add('hidden')

		// 앨범 없으면 평점 UI 숨기고 초기화
		if (ratingSection) ratingSection.classList.add('hidden')
		if (ratingInput) ratingInput.value = ''

		return
	}

	// 선택된 앨범 chip은 selectedAlbumsRow가 있을 때만 그림
	if (selectedAlbumsRow) {
		const chip = document.createElement('div')
		chip.className =
			'inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 text-sm'

		if (selectedAlbum.coverUrl) {
			const img = document.createElement('img')
			img.src = selectedAlbum.coverUrl
			img.alt = selectedAlbum.title
			img.className = 'w-8 h-8 rounded object-cover'
			chip.appendChild(img)
		}

		const textWrap = document.createElement('div')
		const titleSpan = document.createElement('span')
		titleSpan.textContent = selectedAlbum.title
		const artistSpan = document.createElement('span')
		artistSpan.className = 'text-xs text-slate-500'
		artistSpan.textContent = selectedAlbum.artists

		textWrap.appendChild(titleSpan)
		textWrap.appendChild(artistSpan)
		chip.appendChild(textWrap)

		const removeBtn = document.createElement('button')
		removeBtn.type = 'button'
		removeBtn.textContent = '×'
		removeBtn.className = 'ml-2 text-xs text-slate-500 hover:text-slate-900'
		removeBtn.addEventListener('click', () => {
			selectedAlbum = null
			renderSelectedAlbum()
		})
		chip.appendChild(removeBtn)

		selectedAlbumsRow.appendChild(chip)
		selectedAlbumsWrap?.classList.remove('hidden')
	}

	// 🔥 핵심: UI 유무와 상관없이 항상 hidden 값은 세팅
	albumIdsHidden.value = JSON.stringify([selectedAlbum.id])
	artistIdsHidden.value = JSON.stringify(selectedAlbum.artistIds)

	// 앨범이 생겼을 때 평점 입력 UI 노출
	if (ratingSection) {
		ratingSection.classList.remove('hidden')
	}
}

function bindAlbumDetailListenerOnce() {
	if (albumDetailListenerBound) return
	albumDetailListenerBound = true

	window.addEventListener('album:detail', (e: Event) => {
		const ce = e as CustomEvent<AlbumDetail>
		const detail = ce.detail
		if (!detail?.album) return

		const artists = (detail.artists || []).map((a) => a.name).join(', ')
		const artistIds = (detail.artists || [])
			.map((a) => a.id)
			.filter((x): x is string => !!x)

		selectedAlbum = {
			id: detail.album.id,
			title: detail.album.title,
			artists,
			artistIds,
			coverUrl: detail.album.cover_url ?? null,
		}

		renderSelectedAlbum()
	})
}

// 🔢 평점 입력 제어: 숫자만, 0~10, 0.5 step
function wireRatingInput() {
	if (!ratingInput) return

	ratingInput.addEventListener('input', () => {
		let raw = ratingInput.value.trim()
		if (raw === '') return

		raw = raw.replace(',', '.')
		let n = Number(raw)

		if (Number.isNaN(n)) {
			ratingInput.value = ''
			return
		}

		if (n < 0) n = 0
		if (n > 10) n = 10

		n = Math.round(n * 2) / 2 // 0.5 step
		ratingInput.value = n.toString()
	})
}

async function onFormSubmit(e: SubmitEvent) {
	if (!form || !resultEl || !submitBtn || !categorySel) return
	e.preventDefault()
	resultEl.textContent = ''

	const formData = new FormData(form)
	const data = Object.fromEntries(formData) as Record<string, string>
	data.content = await getContent()

	const postedDate = data.posted_date || new Date().toISOString().slice(0, 10)

	let album_ids: string[] = []
	let artist_ids: string[] = []
	if (albumIdsHidden?.value) {
		try {
			album_ids = JSON.parse(albumIdsHidden.value)
		} catch {}
	}
	if (artistIdsHidden?.value) {
		try {
			artist_ids = JSON.parse(artistIdsHidden.value)
		} catch {}
	}

	// 🔥 평점 읽기 + 최종 검증
	let ratingValue: number | null = null
	if (ratingInput && ratingInput.value.trim() !== '') {
		const parsed = Number(ratingInput.value.replace(',', '.'))
		if (Number.isNaN(parsed) || parsed < 0 || parsed > 10) {
			return showToast('평점은 0~10 사이 숫자만 가능합니다.')
		}
		ratingValue = Math.round(parsed * 2) / 2
	}

	// 카테고리 이름 추출
	let categoryName: string | null = null
	if (categorySel.value) {
		const opt = categorySel.options[categorySel.selectedIndex]
		if (opt && !opt.disabled) {
			categoryName = opt.textContent?.trim() || null
		}
	}

	// ✅ 백엔드 + PostPayload 에 딱 맞게 payload 재정의
	const payload: PostPayload = {
		title: (data.title || '').trim(),
		description: '',
		body_mdx: data.content || '',
		posted_date: postedDate,
		status: 'published',
		category: categoryName,
		album_ids,
		artist_ids,
		album_cover_url: selectedAlbum?.coverUrl ?? null,
		rating: ratingValue,
	}

	if (!payload.title) return showToast('제목을 입력하세요.')
	if (payload.body_mdx.trim().length < 5)
		return showToast('본문이 너무 짧아요.')

	submitBtn.disabled = true
	const originalText = submitBtn.textContent
	submitBtn.textContent = 'Saving...'

	try {
		// 1) DB 저장
		const res = await savePost(payload)
		if (!res.ok) {
			const json = await res.json().catch(() => null)
			const msg =
				json?.detail || json?.message || (await res.text()).slice(0, 500)
			resultEl.textContent = `❌ Failed to save (${res.status}) ${msg || ''}`
			showToast(`저장 실패 (${res.status})`, 'error')
			return
		}

		const saved = await res.json()
		resultEl.textContent = '✅ Saved to DB. Publishing to GitHub...'

		// 다시 한 번 카테고리 이름
		let categoryNameText = ''
		if (categorySel.value) {
			const opt = categorySel.options[categorySel.selectedIndex]
			if (opt && !opt.disabled) categoryNameText = opt.textContent || ''
		}

		// 2) GitHub MDX 발행
		const pubRes = await publishToGit({
			title: payload.title,
			body_mdx: payload.body_mdx,
			slug: saved.slug,
			categoryName: categoryNameText,
			description: payload.description,
			posted_date: postedDate,
			album_ids,
			artist_ids,
			post_id: saved.id,
			album_cover_url: selectedAlbum?.coverUrl ?? null,
			rating: ratingValue,
		})

		if (!pubRes.ok) {
			const t = await pubRes.text()
			resultEl.textContent = `⚠️ Saved, but publish failed (${pubRes.status}). ${t.slice(
				0,
				400
			)}`
			showToast(`발행 실패 (${pubRes.status})`, 'error')
			return
		}

		const pubJson = await pubRes.json()
		resultEl.textContent = `✅ Saved & Published! (slug: ${
			pubJson?.slug || saved?.slug || '-'
		})`

		redirectOnSuccess(pubJson?.slug || saved?.slug)

		// 폼 초기화
		form.reset()
		resetContent()
		selectedAlbum = null
		renderSelectedAlbum()
		if (ratingInput) ratingInput.value = ''
		enableReview && (enableReview.checked = false)
		reviewSection?.classList.add('hidden')
	} catch (err) {
		console.error(err)
		resultEl.textContent = '❌ Network error'
		showToast('네트워크 오류', 'error')
	} finally {
		submitBtn.disabled = false
		submitBtn.textContent = originalText
	}
}

function wireSubmit() {
	if (!form || !submitBtn) return
	form.removeEventListener('submit', onFormSubmit)
	form.addEventListener('submit', onFormSubmit)
	if (import.meta.hot)
		import.meta.hot.dispose(() =>
			form?.removeEventListener('submit', onFormSubmit)
		)
	;(form as any).dataset.bound = '1'
}

function initOnce() {
	initEditor()
	if (addBtn && categorySel)
		wireCategoryAddButton(addBtn, categorySel, catHelp || undefined)
	if (enableReview && reviewSection)
		wireReviewToggle(enableReview, reviewSection)
	if (albumSelect && albumPreview)
		wireAlbumPreview(albumSelect, albumPreview, albumImage || null)
	if (categorySel) loadCategoriesToSelect(categorySel, catHelp || undefined)
	wireSubmit()
	bindAlbumDetailListenerOnce()
	wireRatingInput()
}

function init() {
	initOnce()
	if (document.readyState === 'loading')
		document.addEventListener('DOMContentLoaded', () => initOnce(), {
			once: true,
		})
	document.addEventListener('astro:page-load', () => {
		if (!(form as any)?.dataset.bound) wireSubmit()
		initOnce()
	})
	document.addEventListener('astro:after-swap', () => {
		if (!(form as any)?.dataset.bound) wireSubmit()
		initOnce()
	})
}

init()
