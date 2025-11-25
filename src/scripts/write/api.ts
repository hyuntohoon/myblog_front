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
	album_cover_url: string | null // 앨범 커버 URL (단일)
	rating: number | null // 평점 0~10, 없으면 null
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
	slug: string
	categoryName: string | null // 프론트에서 선택한 카테고리 이름
	description: string
	posted_date: string // ISO string
	album_ids: string[]
	artist_ids: string[]
	post_id: string
	album_cover_url: string | null
	rating: number | null
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
	} = params

	const payload = {
		title,
		body_mdx,
		slug,
		category: categoryName || null, // <- 백엔드 CreatePostReq.category
		description: description || '',
		posted_date,
		album_ids,
		artist_ids,
		post_id,
		album_cover_url,
		rating,
	}

	const res = await fetch(`${PUBLIC_PUBLISH_BASE_URL}/api/publish`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
	})
	return res
}
