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

// DOM 헬퍼
const $ = <T extends Element = HTMLElement>(sel: string) =>
	document.querySelector(sel) as T | null

const form = $('#write-form') as HTMLFormElement | null
const resultEl = $('#write-result') as HTMLElement | null
const submitBtn = $('#submit-btn') as HTMLButtonElement | null

const categorySel = $('#category') as HTMLSelectElement | null
const catHelp = $('#catHelp') as HTMLElement | null
const addBtn = $('#add-category') as HTMLButtonElement | null

const enableReview = $('#enableReview') as HTMLInputElement | null
const reviewSection = $('#musicReview') as HTMLElement | null
const albumSelect = $('#albumId') as HTMLSelectElement | null
const albumPreview = $('#albumPreview') as HTMLElement | null
const albumImage = albumPreview?.querySelector('img') as HTMLImageElement | null

async function onFormSubmit(e: SubmitEvent) {
	if (!form || !resultEl || !submitBtn || !categorySel) return
	e.preventDefault()
	resultEl.textContent = ''

	const formData = new FormData(form)
	const data = Object.fromEntries(formData as any) as Record<string, string>

	// 에디터 값으로 본문 대체
	data.content = getContent()

	const postedDate = data.posted_date || new Date().toISOString().slice(0, 10)

	const payload: PostPayload = {
		title: String(data.title || '').trim(),
		description: '',
		body_mdx: String(data.content || ''),
		body_text: '',
		posted_date: postedDate,
		status: 'published',
		category_id: data.category ? Number(data.category) : null,
		search_index: true,
		extra: {},
	}

	if (!payload.title) {
		showToast('제목을 입력하세요.')
		return
	}
	if (!payload.body_mdx || payload.body_mdx.trim().length < 5) {
		showToast('본문이 너무 짧아요.')
		return
	}

	submitBtn.disabled = true
	const originalText = submitBtn.textContent
	submitBtn.textContent = 'Saving...'

	try {
		// 1) DB 저장
		const res = await savePost(payload)
		if (!res.ok) {
			const json = await res.json().catch(() => null as any)
			const msg =
				json?.detail ||
				json?.message ||
				(await res.text().catch(() => '')).slice(0, 500)
			resultEl.textContent = `❌ Failed to save (${res.status}) ${msg || ''}`
			showToast(`저장 실패 (${res.status})`, 'error')
			return
		}
		const saved = await res.json() // { id, slug }

		resultEl.textContent = '✅ Saved to DB. Publishing to GitHub...'

		// 2) GitHub 퍼블리시 (카테고리 "이름" 필요)
		let categoryName = ''
		if (categorySel && categorySel.value) {
			const opt = categorySel.options[categorySel.selectedIndex]
			if (opt && !opt.disabled) categoryName = opt.textContent || ''
		}

		const pubRes = await publishToGit({
			title: payload.title,
			body_mdx: payload.body_mdx,
			categoryName,
			description: payload.description,
			posted_date: postedDate,
		})

		if (!pubRes.ok) {
			const t = await pubRes.text().catch(() => '')
			resultEl.textContent = `⚠️ Saved, but publish failed (${pubRes.status}). ${t.slice(0, 400)}`
			showToast(`발행 실패 (${pubRes.status})`, 'error')
			return
		}

		const pubJson = await pubRes.json()
		resultEl.textContent = `✅ Saved & Published! (slug: ${pubJson?.slug || saved?.slug || '-'})`

		redirectOnSuccess(pubJson?.slug || saved?.slug)

		// 폼/에디터 초기화
		form.reset()
		resetContent()
		if (enableReview && reviewSection) {
			enableReview.checked = false
			reviewSection.classList.add('hidden')
		}
		albumPreview?.classList.add('hidden')
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
	if (!form || !resultEl || !submitBtn || !categorySel) return
	form.removeEventListener('submit', onFormSubmit)
	form.addEventListener('submit', onFormSubmit)
	if (import.meta.hot) {
		import.meta.hot.dispose(() =>
			form?.removeEventListener('submit', onFormSubmit)
		)
	}
	;(form as any).dataset.bound = '1'
}

function initOnce() {
	// Editor
	initEditor()

	// UI wiring
	if (addBtn && categorySel)
		wireCategoryAddButton(addBtn, categorySel, catHelp || undefined)
	if (enableReview && reviewSection)
		wireReviewToggle(enableReview, reviewSection)
	if (albumSelect && albumPreview)
		wireAlbumPreview(albumSelect, albumPreview, albumImage || null)

	// Categories
	if (categorySel) loadCategoriesToSelect(categorySel, catHelp || undefined)

	// Submit
	wireSubmit()
}

// 초기화 (DOM/SPA/HMR 대응)
function init() {
	initOnce()

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', () => initOnce(), {
			once: true,
		})
	}

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
