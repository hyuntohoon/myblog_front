// src/scripts/write.client.ts

import {
	PUBLIC_PUBLISH_BASE_URL,
	PUBLIC_BACKEND_API_URL,
} from 'astro:env/client'

const BACKEND_API_BASE_URL = PUBLIC_BACKEND_API_URL

// ✅ EasyMDE 추가 (CSS 포함)
import EasyMDE from 'easymde'
import 'easymde/dist/easymde.min.css'

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

// ✅ hidden input (선택된 앨범/아티스트 ID 저장용)
const albumIdsHidden = document.getElementById(
	'albumIds'
) as HTMLInputElement | null
const artistIdsHidden = document.getElementById(
	'artistIds'
) as HTMLInputElement | null

// ✅ 전역 에디터 (HMR/SPA에서도 재사용)
let mde: EasyMDE | null = null

// ─────────────────────────────────────────────────────────────
// UX: 간단 토스트
function showToast(
	message: string,
	variant: 'success' | 'error' = 'error',
	ms = 2600
) {
	let host = document.getElementById('toast-host')
	if (!host) {
		host = document.createElement('div')
		host.id = 'toast-host'
		host.style.position = 'fixed'
		host.style.left = '50%'
		host.style.bottom = '24px'
		host.style.transform = 'translateX(-50%)'
		host.style.zIndex = '9999'
		host.style.display = 'flex'
		host.style.flexDirection = 'column'
		host.style.gap = '10px'
		document.body.appendChild(host)
	}
	const el = document.createElement('div')
	el.textContent = message
	el.style.padding = '12px 14px'
	el.style.borderRadius = '10px'
	el.style.fontSize = '14px'
	el.style.color = variant === 'success' ? '#073b16' : '#5a0b0b'
	el.style.background = variant === 'success' ? '#c9f7d9' : '#ffd8d6'
	el.style.boxShadow = '0 6px 24px rgba(0,0,0,.12)'
	el.style.minWidth = '240px'
	el.style.textAlign = 'center'
	host.appendChild(el)
	setTimeout(() => {
		el.style.transition = 'opacity .25s ease'
		el.style.opacity = '0'
		setTimeout(() => el.remove(), 260)
	}, ms)
}

function redirectOnSuccess(slug?: string) {
	const refOk =
		document.referrer &&
		(() => {
			try {
				const u = new URL(document.referrer)
				return u.origin === location.origin
			} catch {
				return false
			}
		})()
	if (refOk) {
		showToast('✅ 저장 & 발행 완료! 이전 페이지로 이동합니다.', 'success', 1400)
		setTimeout(() => history.back(), 1200)
		return
	}
	const target = slug ? `/posts/${slug}/` : '/'
	showToast('✅ 저장 & 발행 완료!', 'success', 1200)
	setTimeout(() => location.assign(target), 900)
}
// ─────────────────────────────────────────────────────────────

const albumImages: Record<string, string> = {
	1: 'https://i.scdn.co/image/ab67616d0000b273f3f8ed949a4f79f5ad5caa7c',
	2: 'https://i.scdn.co/image/ab67616d0000b273a9a5fd746f62bcee3e6a9db7',
	3: 'https://i.scdn.co/image/ab67616d0000b273620e42f6a19cfb459dbf5566',
}

async function loadCategories() {
	if (!categorySel || !catHelp) return
	try {
		const res = await fetch(`${BACKEND_API_BASE_URL}/api/categories`, {
			cache: 'no-store',
		})
		if (!res.ok) throw new Error('HTTP ' + res.status)
		const json = await res.json()
		const items = json?.items || json?.categories || []

		categorySel.innerHTML = ''
		if (!items.length) {
			catHelp.classList.remove('hidden')
			categorySel.innerHTML = '<option value="">(no categories)</option>'
			categorySel.value = ''
			return
		}

		catHelp.classList.add('hidden')
		const frag = document.createDocumentFragment()
		const placeholder = document.createElement('option')
		placeholder.value = ''
		placeholder.textContent = 'Select category'
		placeholder.disabled = true
		placeholder.selected = true
		frag.appendChild(placeholder)

		for (const c of items) {
			const opt = document.createElement('option')
			opt.value = String(c.id ?? c.value ?? c)
			opt.textContent = c.name ?? c.label ?? String(c)
			frag.appendChild(opt)
		}
		categorySel.appendChild(frag)
	} catch {
		categorySel.innerHTML =
			'<option value="">(failed to load categories)</option>'
		categorySel.value = ''
		catHelp.classList.remove('hidden')
	}
}

async function addCategory(name: string) {
	try {
		const r = await fetch(`${BACKEND_API_BASE_URL}/api/categories`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name }),
		})
		if (r.ok) {
			const json = await r.json()
			return { id: json?.id ?? null, name: json?.name ?? name }
		}
	} catch {}
	return { id: null, name }
}

function wireUI() {
	if (addBtn && categorySel && catHelp) {
		const onClick = async () => {
			const name = prompt('새 카테고리 이름을 입력하세요:')
			if (!name) return
			const trimmed = name.trim()
			if (!trimmed) return

			const saved = await addCategory(trimmed)

			const opt = document.createElement('option')
			opt.value = saved.id ? String(saved.id) : trimmed
			opt.textContent = saved.name
			categorySel.appendChild(opt)
			categorySel.value = opt.value

			catHelp.classList.add('hidden')
		}
		addBtn.removeEventListener('click', onClick)
		addBtn.addEventListener('click', onClick)
	}

	if (enableReview && reviewSection) {
		const onChange = () => {
			reviewSection.classList.toggle('hidden', !enableReview.checked)
		}
		enableReview.removeEventListener('change', onChange)
		enableReview.addEventListener('change', onChange)
	}

	if (albumSelect && albumPreview && albumImage) {
		const onAlbumChange = () => {
			const id = albumSelect.value
			if (id && albumImages[id]) {
				albumPreview.classList.remove('hidden')
				albumImage.src = albumImages[id]
			} else {
				albumPreview.classList.add('hidden')
			}
		}
		albumSelect.removeEventListener('change', onAlbumChange)
		albumSelect.addEventListener('change', onAlbumChange)
	}
}

// ✅ EasyMDE 초기화(타입 오류/중복 초기화 방지)
function initMDE() {
	const textarea = document.querySelector(
		'textarea[name="content"]'
	) as HTMLTextAreaElement | null
	if (!textarea) return

	// 이미 에디터가 붙어 있으면 재생성하지 않음
	if (mde || (textarea as any)._mdeBound) return

	mde = new EasyMDE({
		element: textarea,
		spellChecker: false,
		autosave: {
			enabled: true,
			uniqueId: 'write-page-draft',
			delay: 1000,
		},
		placeholder: '# Heading\n\nWrite here...',
		status: ['lines', 'words'],
		toolbar: [
			'bold',
			'italic',
			'heading',
			'|',
			'quote',
			'unordered-list',
			'ordered-list',
			'|',
			'link',
			'image',
			'table',
			'|',
			'preview',
			'side-by-side',
			'fullscreen',
			'|',
			'guide',
		],
	})
	;(textarea as any)._mdeBound = true
}

// ✅ hidden input에서 앨범/아티스트 id 읽기
function getSelectedIds(): { album_ids: string[]; artist_ids: string[] } {
	const parse = (raw: string | null | undefined): string[] => {
		if (!raw) return []
		try {
			const v = JSON.parse(raw)
			if (Array.isArray(v)) {
				return v.filter((x) => typeof x === 'string')
			}
		} catch {
			// JSON 아니면 무시
		}
		return []
	}

	const album_ids = parse(albumIdsHidden?.value)
	const artist_ids = parse(artistIdsHidden?.value)
	return { album_ids, artist_ids }
}

async function publishToGit(params: {
	title: string
	body_mdx: string
	categoryName: string
	description: string
	posted_date: string
	album_ids: string[]
	artist_ids: string[]
}) {
	const {
		title,
		body_mdx,
		categoryName,
		description,
		posted_date,
		album_ids,
		artist_ids,
	} = params

	const payload = {
		title,
		body_mdx,
		category: categoryName || null,
		description: description || '',
		posted_date,
		album_ids,
		artist_ids,
	}

	const res = await fetch(`${PUBLIC_PUBLISH_BASE_URL}/api/publish`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
	})

	return res
}

// 이름 있는 submit 핸들러
async function onFormSubmit(e: SubmitEvent) {
	if (!form || !resultEl || !submitBtn || !categorySel) return
	e.preventDefault()
	resultEl.textContent = ''

	const formData = new FormData(form)
	const data = Object.fromEntries(formData as any) as Record<string, string>

	// ✅ EasyMDE 값으로 폼 데이터 덮어쓰기
	if (mde) data.content = mde.value()

	const postedDate = data.posted_date || new Date().toISOString().slice(0, 10)

	const { album_ids, artist_ids } = getSelectedIds()

	const payload = {
		title: String(data.title || '').trim(),
		description: '',
		body_mdx: String(data.content || ''),
		body_text: '',
		posted_date: postedDate,
		status: 'published',
		// ✅ 백엔드에는 category "이름"으로 보냄
		category: categorySel?.value || 'default',
		search_index: true,
		extra: {} as Record<string, unknown>,
		album_ids,
		artist_ids,
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
		const token = localStorage.getItem('access_token')
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		}
		if (token) headers['Authorization'] = `Bearer ${token}`

		const res = await fetch(`${BACKEND_API_BASE_URL}/api/posts`, {
			method: 'POST',
			headers,
			body: JSON.stringify(payload),
		})

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

		const saved = await res.json()
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
			album_ids,
			artist_ids,
		})

		if (!pubRes.ok) {
			const t = await pubRes.text().catch(() => '')
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
		if (enableReview && reviewSection) {
			enableReview.checked = false
			reviewSection.classList.add('hidden')
		}
		albumPreview?.classList.add('hidden')
		if (mde) mde.value('')
		if (albumIdsHidden) albumIdsHidden.value = '[]'
		if (artistIdsHidden) artistIdsHidden.value = '[]'
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

function init() {
	wireUI()
	initMDE()
	wireSubmit()

	if (document.readyState === 'loading') {
		document.addEventListener(
			'DOMContentLoaded',
			() => {
				loadCategories()
				initMDE()
			},
			{ once: true }
		)
	} else {
		loadCategories()
		initMDE()
	}

	// Astro SPA 네비게이션 대응
	document.addEventListener('astro:page-load', () => {
		if (!(form as any)?.dataset.bound) wireSubmit()
		loadCategories()
		initMDE()
	})
	document.addEventListener('astro:after-swap', () => {
		if (!(form as any)?.dataset.bound) wireSubmit()
		loadCategories()
		initMDE()
	})
}

init()
