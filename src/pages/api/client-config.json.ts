// src/pages/api/client-config.json.ts
import type { APIRoute } from 'astro'

// .env 어느 쪽이든 이름을 맞춰 하나라도 잡히도록
const apiBase =
	process.env.PUBLIC_API_BASE || process.env.API_URL || 'http://127.0.0.1:8000'

export const GET: APIRoute = async () => {
	return new Response(JSON.stringify({ apiBase }), {
		headers: { 'content-type': 'application/json' },
	})
}
