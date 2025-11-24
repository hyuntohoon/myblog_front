import {
	PUBLIC_BACKEND_API_URL,
	PUBLIC_PUBLISH_BASE_URL,
} from 'astro:env/client'

const API_BASE_URL = PUBLIC_BACKEND_API_URL

// ✅ 백엔드 WritePostRequest 기준
export type PostPayload = {
	title: string
	description: string
	body_mdx: string
	posted_date: string // ISO string (YYYY-MM-DD)
	status: 'published' | 'draft'
	category: string | null // 카테고리 "이름"
	album_ids: string[] // 항상 배열
	artist_ids: string[] // 항상 배열
}

export async function fetchCategories() {
	const res = await fetch(`${API_BASE_URL}/api/categories`, {
		cache: 'no-store',
	})
	if (!res.ok) throw new Error('HTTP ' + res.status)
	const json = await res.json()
	return (json?.items || json?.categories || []) as any[]
}

export async function createCategory(name: string) {
	const res = await fetch(`${API_BASE_URL}/api/categories`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name }),
	})
	if (!res.ok) throw new Error('HTTP ' + res.status)
	return res.json()
}

export async function savePost(payload: PostPayload) {
	const token = localStorage.getItem('access_token')
	const headers: Record<string, string> = { 'Content-Type': 'application/json' }
	if (token) headers['Authorization'] = `Bearer ${token}`

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
	categoryName: string | null // 프론트에서 선택한 카테고리 이름
	description: string
	posted_date: string // ISO string
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
		category: categoryName || null, // <- 백엔드 CreatePostReq.category
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
