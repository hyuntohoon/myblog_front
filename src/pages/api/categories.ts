import type { APIRoute } from 'astro'

/**
 * 카테고리 추가
 * - 지금은 FastAPI가 있으면 프록시 시도
 * - 없으면 200 OK로 응답(프론트는 즉시 UI 갱신)하지만, 영구 저장은 안 됨
 *   -> 나중에 FastAPI 연결되면 이 파일은 그대로 두고 프록시만 진짜로 성공하게 됨
 */
export const POST: APIRoute = async ({ request }) => {
	try {
		const { name } = await request.json()
		const trimmed = String(name ?? '').trim()
		if (!trimmed)
			return new Response(JSON.stringify({ ok: false, error: 'empty' }), {
				status: 400,
			})

		const base = import.meta.env.PUBLIC_API_BASE
		if (base) {
			// 실제 FastAPI에 전달
			try {
				const r = await fetch(`${base}/categories`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ name: trimmed }),
				})
				if (r.ok) {
					// FastAPI가 {"ok":true, "name":"..."} 형태라고 가정
					const json = await r.json()
					return new Response(
						JSON.stringify({
							ok: true,
							name: json.name ?? trimmed,
							persisted: true,
						}),
						{
							headers: { 'Content-Type': 'application/json; charset=utf-8' },
							status: 200,
						}
					)
				}
			} catch {
				// 프록시 실패 시 아래로 fallback
			}
		}

		// 스텁: 지금은 성공처럼 응답(프론트 UI만 갱신), 영구 저장은 아님
		return new Response(
			JSON.stringify({ ok: true, name: trimmed, persisted: false }),
			{
				headers: { 'Content-Type': 'application/json; charset=utf-8' },
				status: 200,
			}
		)
	} catch {
		return new Response(JSON.stringify({ ok: false, error: 'invalid body' }), {
			status: 400,
		})
	}
}
