import type { APIRoute } from 'astro'
import { getCollection } from 'astro:content'

/**
 * 카테고리 목록 가져오기
 * - 현재는 로컬 content에서 수집
 * - 나중엔 FastAPI로 전환 (아래 주석 참고)
 */
export const GET: APIRoute = async () => {
	try {
		// --- [나중에 교체] 외부 FastAPI 먼저 시도 ---
		// const base = import.meta.env.PUBLIC_API_BASE
		// if (base) {
		//   const r = await fetch(`${base}/categories`, { cache: 'no-store' })
		//   if (r.ok) {
		//     const json = await r.json()
		//     return new Response(JSON.stringify({ categories: json.categories ?? [] }), {
		//       headers: { 'Content-Type': 'application/json; charset=utf-8' }, status: 200
		//     })
		//   }
		// }

		// --- 로컬 content에서 추출 (fallback / 현재 기본경로) ---
		const entries = await getCollection('blog')
		const set = new Set<string>()
		for (const e of entries) {
			if (!e.data?.draft && e.data?.category) set.add(String(e.data.category))
		}
		const list = Array.from(set).sort((a, b) => a.localeCompare(b))

		return new Response(JSON.stringify({ categories: list }), {
			headers: {
				'Content-Type': 'application/json; charset=utf-8',
				'Cache-Control': 'no-store',
			},
			status: 200,
		})
	} catch {
		return new Response(JSON.stringify({ categories: [] }), {
			headers: { 'Content-Type': 'application/json; charset=utf-8' },
			status: 200,
		})
	}
}
