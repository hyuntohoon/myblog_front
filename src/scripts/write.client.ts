// 브라우저 전용 모듈 (Vite가 번들함)
import { PUBLIC_API_URL } from 'astro:env/client'
const API_BASE_URL = PUBLIC_API_URL

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

// 더미 이미지 데이터
const albumImages: Record<string, string> = {
	1: 'https://i.scdn.co/image/ab67616d0000b273f3f8ed949a4f79f5ad5caa7c',
	2: 'https://i.scdn.co/image/ab67616d0000b273a9a5fd746f62bcee3e6a9db7',
	3: 'https://i.scdn.co/image/ab67616d0000b273620e42f6a19cfb459dbf5566',
}

async function loadCategories() {
	if (!categorySel || !catHelp) return
	try {
		const res = await fetch(`${API_BASE_URL}/api/categories`, {
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
		placeholder.textContent = 'Select category...'
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
		const r = await fetch(`${API_BASE_URL}/api/categories`, {
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
		addBtn.addEventListener('click', async () => {
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
		})
	}

	if (enableReview && reviewSection) {
		enableReview.addEventListener('change', () => {
			reviewSection.classList.toggle('hidden', !enableReview.checked)
		})
	}

	if (albumSelect && albumPreview && albumImage) {
		albumSelect.addEventListener('change', () => {
			const id = albumSelect.value
			if (id && albumImages[id]) {
				albumPreview.classList.remove('hidden')
				albumImage.src = albumImages[id]
			} else {
				albumPreview.classList.add('hidden')
			}
		})
	}
}

async function publishToGit(params: {
	title: string
	body_mdx: string
	categoryName: string
	description: string
	posted_date: string
}) {
	const { title, body_mdx, categoryName, description, posted_date } = params
	const payload = {
		title,
		body_mdx,
		category: categoryName || null,
		description: description || '',
		posted_date,
	}
	const res = await fetch(`${API_BASE_URL}/api/publish`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
	})
	return res
}

function wireSubmit() {
	if (!form || !resultEl || !submitBtn || !categorySel) return

	form.addEventListener('submit', async (e) => {
		e.preventDefault()
		resultEl.textContent = ''

		const formData = new FormData(form)
		const data = Object.fromEntries(formData as any) as Record<string, string>

		const postedDate = data.posted_date || new Date().toISOString().slice(0, 10)

		const payload = {
			title: String(data.title || '').trim(),
			description: '',
			body_mdx: String(data.content || ''),
			body_text: '',
			posted_date: postedDate,
			status: 'published',
			category_id: data.category ? Number(data.category) : null,
			search_index: true,
			extra: {} as Record<string, unknown>,
		}

		if (!payload.title) {
			alert('제목을 입력하세요')
			return
		}
		if (!payload.body_mdx || payload.body_mdx.trim().length < 5) {
			alert('본문이 너무 짧아요')
			return
		}

		submitBtn.disabled = true
		const originalText = submitBtn.textContent
		submitBtn.textContent = 'Saving...'

		try {
			// 1) DB 저장
			const res = await fetch(`${API_BASE_URL}/api/posts`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			})

			if (!res.ok) {
				const json = await res.json().catch(() => null as any)
				const msg =
					json?.detail ||
					json?.message ||
					(await res.text().catch(() => '')).slice(0, 500)
				resultEl.textContent = `❌ Failed to save (${res.status}) ${msg || ''}`
				return
			}

			const saved = await res.json() // { id, slug } 등
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
				return
			}

			const pubJson = await pubRes.json()
			resultEl.textContent = `✅ Saved & Published! (slug: ${pubJson?.slug || saved?.slug || '-'})`

			// 폼 초기화
			form.reset()
			if (enableReview && reviewSection) {
				enableReview.checked = false
				reviewSection.classList.add('hidden')
			}
			albumPreview?.classList.add('hidden')
		} catch (err) {
			console.error(err)
			resultEl.textContent = '❌ Network error'
		} finally {
			submitBtn.disabled = false
			submitBtn.textContent = originalText
		}
	})
}

function init() {
	wireUI()
	wireSubmit()
	document.addEventListener('DOMContentLoaded', loadCategories)
}

init()
