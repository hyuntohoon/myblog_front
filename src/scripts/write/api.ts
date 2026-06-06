import { PUBLIC_BACKEND_API_URL } from 'astro:env/client'
import type { components } from '../../lib/api.gen'
import { apiFetch } from '../../lib/api'

const API_BASE_URL = PUBLIC_BACKEND_API_URL

// Derived from backend WritePostRequest (auto-generated — run `pnpm generate:types` to refresh).
// album_cover_url is a frontend-only field forwarded to the publish service; the backend ignores it.
export type PostPayload = components['schemas']['Backend_WritePostRequest'] & {
	album_cover_url?: string | null
}

export type PostDetail = components['schemas']['Backend_PostDetailResponse']

// Use apiFetch so 401 → refresh_token → retry once → goLogin only on real failure.
// `apiFetch` returns null when the refresh fails (user redirected to login),
// or when a transport error occurs; callers should treat null as failure.

// Read FastAPI's `{detail: "..."}` body from a non-2xx response so the UI can
// surface the backend message verbatim. Clones the response so the caller can
// still read the body afterward if needed.
export async function readErrorDetail(res: Response, fallback: string): Promise<string> {
	try {
		const err = await res.clone().json()
		return typeof err?.detail === 'string' ? err.detail : fallback
	}
	catch {
		return fallback
	}
}

export async function savePost(payload: PostPayload) {
	const res = await apiFetch(`${API_BASE_URL}/api/posts`, {
		method: 'POST',
		body: JSON.stringify(payload),
	})
	return res ?? new Response(null, { status: 503 })
}

export async function updatePost(id: string, payload: Partial<PostPayload>) {
	const res = await apiFetch(`${API_BASE_URL}/api/posts/${encodeURIComponent(id)}`, {
		method: 'PUT',
		body: JSON.stringify(payload),
	})
	return res ?? new Response(null, { status: 503 })
}

export async function fetchPostById(id: string): Promise<PostDetail | null> {
	const res = await apiFetch(`${API_BASE_URL}/api/posts/${encodeURIComponent(id)}`)
	if (!res || !res.ok)
		return null
	return res.json() as Promise<PostDetail>
}

// Soft archive — backend flips status to 'archived'; row stays in DB and is
// restorable. The default DELETE on a post does this.
export async function archivePost(id: string) {
	const res = await apiFetch(`${API_BASE_URL}/api/posts/${encodeURIComponent(id)}`, {
		method: 'DELETE',
	})
	return res ?? new Response(null, { status: 503 })
}

// Hard delete — CASCADE removes M:M rows. Irreversible. Routes use ?hard=true.
export async function hardDeletePost(id: string) {
	const res = await apiFetch(`${API_BASE_URL}/api/posts/${encodeURIComponent(id)}?hard=true`, {
		method: 'DELETE',
	})
	return res ?? new Response(null, { status: 503 })
}

// Restore an archived row back to 'published'.
export async function restorePost(id: string) {
	const res = await apiFetch(`${API_BASE_URL}/api/posts/${encodeURIComponent(id)}/restore`, {
		method: 'PATCH',
	})
	return res ?? new Response(null, { status: 503 })
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
	recommended_track_ids: string[]
	tags: string[] // STAB-5: review tags → MDX frontmatter (public /reviews)
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
		recommended_track_ids,
		tags,
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
		recommended_track_ids,
		tags,
	}

	const res = await apiFetch(`${API_BASE_URL}/api/publish`, {
		method: 'POST',
		body: JSON.stringify(payload),
	})
	return res ?? new Response(null, { status: 503 })
}
