// src/pages/api/categories.json.ts
import type { APIRoute } from 'astro'
import { getCollection } from 'astro:content'

export const prerender = true // ✅ 정적으로 산출 (SSR 비활성)

export const GET: APIRoute = async () => {
	const entries = await getCollection('blog')
	const set = new Set<string>()
	for (const e of entries) {
		if (!e.data?.draft && e.data?.category) set.add(String(e.data.category))
	}
	const list = Array.from(set).sort((a, b) => a.localeCompare(b))
	return new Response(JSON.stringify({ categories: list }), {
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			'Cache-Control': 'public, max-age=300',
		},
		status: 200,
	})
}
