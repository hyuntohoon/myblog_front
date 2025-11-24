import {
	PUBLIC_BACKEND_API_URL,
	PUBLIC_PUBLISH_BASE_URL,
} from 'astro:env/client'

const API_BASE_URL = PUBLIC_BACKEND_API_URL

export type PostPayload = {
	title: string
	description: string
	body_mdx: string
	body_text: string
	posted_date: string
	status: 'published' | 'draft'
	category_id: number | null
	search_index: boolean
	extra: Record<string, unknown>
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

export async function publishToGit(params: {
	title: string
	body_mdx: string
	categoryName: string
	description: string
	posted_date: string
}) {
	const res = await fetch(`${PUBLIC_PUBLISH_BASE_URL}/api/publish`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(params),
	})
	return res
}
