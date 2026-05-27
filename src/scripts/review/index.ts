// src/scripts/review/index.ts
import {  publishToGit, savePost } from '../write/api'
import type { PostPayload } from '../write/api'

interface AlbumDetail {
	album: { id: string, title: string, cover_url?: string | null }
	artists?: { id: string, name: string, spotify_id?: string | null }[]
}

function $<T extends Element = HTMLElement>(sel: string) {
  return document.querySelector(sel) as T | null
}

// Elements
const form = $('#review-form') as HTMLFormElement | null
const resultMsg = $('#result-msg') as HTMLElement | null
const submitBtn = $('#submit-btn') as HTMLButtonElement | null

const albumIdsHidden = $('#albumIds') as HTMLInputElement | null
const artistIdsHidden = $('#artistIds') as HTMLInputElement | null
const albumCoverUrlHidden = $('#albumCoverUrl') as HTMLInputElement | null
const albumTitleHidden = $('#albumTitle') as HTMLInputElement | null

const selectedAlbumWrap = $('#selected-album-wrap') as HTMLElement | null
const selectedAlbumEl = $('#selected-album') as HTMLElement | null

const ratingSection = $('#rating-section') as HTMLElement | null
const ratingInput = $('#rating') as HTMLInputElement | null
const ratingStars = $('#rating-stars') as HTMLElement | null

const toggleBodyBtn = $('#toggle-body') as HTMLButtonElement | null
const bodySection = $('#body-section') as HTMLElement | null
const bodyTextarea = $('#body') as HTMLTextAreaElement | null

// State
let selectedAlbum: {
	id: string
	title: string
	artistIds: string[]
	artistNames: string
	coverUrl: string | null
} | null = null

// 별점 렌더링
function renderStars(rating: number) {
	if (!ratingStars)
return
	const full = Math.floor(rating)
	const hasHalf = rating - full >= 0.5
	let html = ''
	for (let i = 0; i < 5; i++) {
		if (i < full) {
			html += '<span>★</span>'
		}
 else if (i === full && hasHalf) {
			html += '<span style="opacity:0.5">★</span>'
		}
 else {
			html += '<span style="color:#e5e7eb">★</span>'
		}
	}
	ratingStars.innerHTML = html
}

// 평점 입력 제어
function wireRatingInput() {
	if (!ratingInput)
return

	ratingInput.addEventListener('input', () => {
		const raw = ratingInput.value.trim().replace(',', '.')
		if (raw === '') {
			renderStars(0)
			return
		}

		let n = Number(raw)
		if (Number.isNaN(n)) {
			ratingInput.value = ''
			renderStars(0)
			return
		}

		n = Math.max(0, Math.min(5, n))
		n = Math.round(n * 2) / 2
		ratingInput.value = n.toString()
		renderStars(n)
	})
}

// 선택된 앨범 렌더링
function renderSelectedAlbum() {
	if (!selectedAlbumWrap || !selectedAlbumEl)
return
	if (
		!albumIdsHidden ||
		!artistIdsHidden ||
		!albumCoverUrlHidden ||
		!albumTitleHidden
	) {
		return
}

	if (!selectedAlbum) {
		selectedAlbumWrap.classList.add('hidden')
		ratingSection?.classList.add('hidden')
		albumIdsHidden.value = '[]'
		artistIdsHidden.value = '[]'
		albumCoverUrlHidden.value = ''
		albumTitleHidden.value = ''
		return
	}

	albumIdsHidden.value = JSON.stringify([selectedAlbum.id])
	artistIdsHidden.value = JSON.stringify(selectedAlbum.artistIds)
	albumCoverUrlHidden.value = selectedAlbum.coverUrl || ''
	albumTitleHidden.value = selectedAlbum.title

	selectedAlbumEl.innerHTML = `
    ${selectedAlbum.coverUrl ? `<img src="${selectedAlbum.coverUrl}" alt="" class="w-12 h-12 rounded object-cover" />` : ''}
    <div class="flex-1 min-w-0">
      <p class="font-medium truncate">${selectedAlbum.title}</p>
      <p class="text-sm text-gray-500 truncate">${selectedAlbum.artistNames}</p>
    </div>
    <button type="button" id="remove-album" class="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
  `

	selectedAlbumWrap.classList.remove('hidden')
	ratingSection?.classList.remove('hidden')

	// 삭제 버튼
	const removeBtn = $('#remove-album')
	removeBtn?.addEventListener('click', () => {
		selectedAlbum = null
		renderSelectedAlbum()
	})
}

// 앨범 선택 이벤트 리스너
function bindAlbumDetailListener() {
	window.addEventListener('album:detail', (e: Event) => {
		const ce = e as CustomEvent<AlbumDetail>
		const detail = ce.detail
		if (!detail?.album)
return

		const artistNames = (detail.artists || []).map(a => a.name).join(', ')
		const artistIds = (detail.artists || []).map(a => a.id).filter(Boolean)

		selectedAlbum = {
			id: detail.album.id,
			title: detail.album.title,
			artistIds,
			artistNames,
			coverUrl: detail.album.cover_url ?? null,
		}

		renderSelectedAlbum()
	})
}

// 본문 토글
function wireBodyToggle() {
	if (!toggleBodyBtn || !bodySection)
return

	toggleBodyBtn.addEventListener('click', () => {
		const isHidden = bodySection.classList.contains('hidden')
		bodySection.classList.toggle('hidden')
		toggleBodyBtn.textContent = isHidden ?
			'- 코멘트 접기' :
			'+ 코멘트 추가 (선택)'
	})
}

// 폼 제출
async function onSubmit(e: SubmitEvent) {
	e.preventDefault()
	if (!form || !resultMsg || !submitBtn)
return

	resultMsg.textContent = ''

	// 검증
	if (!selectedAlbum) {
		resultMsg.textContent = '❌ 앨범을 선택해주세요'
		resultMsg.className = 'text-sm text-red-500'
		return
	}

	const rating = ratingInput ? Number(ratingInput.value) : null
	if (rating === null || Number.isNaN(rating) || rating < 0 || rating > 5) {
		resultMsg.textContent = '❌ 평점은 0~5 사이 숫자를 입력해주세요'
		resultMsg.className = 'text-sm text-red-500'
		return
	}

	const body = bodyTextarea?.value.trim() || ''
	const postedDate = new Date().toISOString().slice(0, 10)

	// 제목 자동 생성: "앨범명 - 평점 리뷰"
	const title = `${selectedAlbum.title} - ${rating}점`

	const payload: PostPayload = {
		title,
		description: '',
		body_mdx: body || '', // 빈 문자열도 OK (평점-only)
		posted_date: postedDate,
		status: 'published',
		category: 'review', // 리뷰 카테고리
		album_ids: [selectedAlbum.id],
		artist_ids: selectedAlbum.artistIds,
		album_cover_url: selectedAlbum.coverUrl,
		rating,
	}

	submitBtn.disabled = true
	submitBtn.textContent = '등록 중...'

	try {
		// 1) DB 저장
		const res = await savePost(payload)
		if (!res.ok) {
			const json = await res.json().catch(() => null)
			const msg = json?.detail || json?.message || ''
			resultMsg.textContent = `❌ 저장 실패 (${res.status}) ${msg}`
			resultMsg.className = 'text-sm text-red-500'
			return
		}

		const saved = await res.json()
		resultMsg.textContent = '✅ 저장 완료. 발행 중...'
		resultMsg.className = 'text-sm text-blue-500'

		// 2) GitHub 발행
		const pubRes = await publishToGit({
			title: payload.title,
			body_mdx: payload.body_mdx ?? '',
			slug: saved.slug,
			categoryName: 'review',
			description: '',
			posted_date: postedDate,
			album_ids: payload.album_ids ?? [],
			artist_ids: payload.artist_ids ?? [],
			post_id: saved.id,
			album_cover_url: payload.album_cover_url ?? null,
			rating: payload.rating ?? null,
		})

		if (!pubRes.ok) {
			resultMsg.textContent = `⚠️ 저장됨, 발행 실패 (${pubRes.status})`
			resultMsg.className = 'text-sm text-yellow-600'
			return
		}

		resultMsg.textContent = '✅ 등록 완료!'
		resultMsg.className = 'text-sm text-green-600'

		// 폼 초기화
		form.reset()
		selectedAlbum = null
		renderSelectedAlbum()
		renderStars(0)
	}
 catch (err) {
		console.error(err)
		resultMsg.textContent = '❌ 네트워크 오류'
		resultMsg.className = 'text-sm text-red-500'
	}
 finally {
		submitBtn.disabled = false
		submitBtn.textContent = '등록'
	}
}

// 초기화
function init() {
	wireRatingInput()
	wireBodyToggle()
	bindAlbumDetailListener()

	form?.addEventListener('submit', onSubmit)
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', init)
}
 else {
	init()
}
