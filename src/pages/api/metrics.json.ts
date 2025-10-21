import type { APIRoute } from 'astro'

export const prerender = false // 요청 시 실행

type Metrics = { likes: number; comments: number }
const ZERO: Metrics = { likes: 0, comments: 0 }

// 예: http://localhost:8000  (FastAPI 준비되면 .env에 넣기)
const FASTAPI_BASE = import.meta.env.FASTAPI_BASE_URL ?? ''

export const GET: APIRoute = async ({ url }) => {
	const slugsParam = url.searchParams.get('slugs') ?? ''
	const slugs = slugsParam
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)

	// 슬러그 없으면 빈 객체(200)
	if (slugs.length === 0) {
		return new Response(JSON.stringify({}), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		})
	}

	const timeoutMs = 2500
	const ctrl = new AbortController()
	const id = setTimeout(() => ctrl.abort(), timeoutMs)

	try {
		if (!FASTAPI_BASE) throw new Error('FASTAPI_BASE_URL missing')
		const endpoint = `${FASTAPI_BASE.replace(/\/+$/, '')}/metrics?slugs=${encodeURIComponent(slugs.join(','))}`
		const r = await fetch(endpoint, { signal: ctrl.signal })
		clearTimeout(id)

		if (!r.ok) throw new Error(`upstream ${r.status}`)
		const json = await r
			.json()
			.catch(() => ({}) as Record<string, Partial<Metrics>>)

		// 안전 보정: 숫자 아니면 0
		const out = Object.fromEntries(
			slugs.map((s) => {
				const v = (json as any)?.[s]
				const likes =
					typeof v?.likes === 'number' && isFinite(v.likes) ? v.likes : 0
				const comments =
					typeof v?.comments === 'number' && isFinite(v.comments)
						? v.comments
						: 0
				return [s, { likes, comments }]
			})
		)

		return new Response(JSON.stringify(out), {
			status: 200,
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'no-store',
			},
		})
	} catch {
		clearTimeout(id)
		// 실패 시 전부 0으로
		const zeros = Object.fromEntries(slugs.map((s) => [s, ZERO]))
		return new Response(JSON.stringify(zeros), {
			status: 200,
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'no-store',
			},
		})
	}
}
