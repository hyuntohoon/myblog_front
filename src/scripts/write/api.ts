import { PUBLIC_BACKEND_API_URL } from 'astro:env/client'
import type { components } from '../../lib/backend-api.gen'
import { apiFetch } from '../../lib/api'

const API_BASE_URL = PUBLIC_BACKEND_API_URL

// Derived from backend WritePostRequest (auto-generated — run `pnpm generate:types` to refresh).
// album_cover_url is a frontend-only field forwarded to the publish service; the backend ignores it.
export type PostPayload = components['schemas']['WritePostRequest'] & {
	album_cover_url?: string | null
}

export async function fetchCategories() {
	const res = await fetch(`${API_BASE_URL}/api/categories`, {
		cache: 'no-store',
	})
	if (!res.ok)
throw new Error(`HTTP ${res.status}`)
	const json = await res.json()
	return (json?.items || json?.categories || []) as any[]
}

export async function createCategory(name: string) {
	const res = await fetch(`${API_BASE_URL}/api/categories`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name }),
	})
	if (!res.ok)
throw new Error(`HTTP ${res.status}`)
	return res.json()
}

export async function savePost(payload: PostPayload) {
	const token = localStorage.getItem('access_token')
	const headers: Record<string, string> = { 'Content-Type': 'application/json' }
	if (token)
headers.Authorization = `Bearer ${token}`

	const res = await fetch(`${API_BASE_URL}/api/posts`, {
		method: 'POST',
		headers,
		body: JSON.stringify(payload),
	})
	return res
}

// ✅ 백엔드 CreatePostReq 기준
export async function publishToGit(params: {
	title: string
	body_mdx: string
	slug: string
	categoryName: string | null // 프론트에서 선택한 카테고리 이름
	description: string
	posted_date: string // ISO string
	album_ids: string[]
	artist_ids: string[]
	post_id: string
	album_cover_url: string | null
	rating: number | null
	rating_scale?: number
}) {
	const {
		title,
		body_mdx,
		slug,
		categoryName,
		description,
		posted_date,
		album_ids,
		artist_ids,
		post_id,
		album_cover_url,
		rating,
		rating_scale,
	} = params

	const payload = {
		title,
		body_mdx,
		slug,
		category: categoryName || null,
		description: description || '',
		posted_date,
		album_ids,
		artist_ids,
		post_id,
		album_cover_url,
		rating,
		rating_scale,
	}

	const res = await apiFetch(`${API_BASE_URL}/api/publish`, {
		method: 'POST',
		body: JSON.stringify(payload),
	})
	return res ?? new Response(null, { status: 503 })
}
