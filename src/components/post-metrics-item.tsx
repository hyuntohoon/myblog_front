import { useEffect, useState } from 'react'
import { API_URL } from 'astro:env/client'

const API_BASE = API_URL

type Metrics = { likes: number; comments: number }

export default function PostMetricsItem({ slug }: { slug: string }) {
	const [data, setData] = useState<Metrics | null>(null)

	useEffect(() => {
		// API_BASE가 없으면(로컬/프리뷰 등) 그냥 0으로 표시하고 네트워크 스킵
		if (!API_BASE) {
			setData({ likes: 0, comments: 0 })
			return
		}

		const ac = new AbortController()

		;(async () => {
			try {
				// 기존 백엔드가 배치 POST만 지원한다면 그대로 사용
				const res = await fetch(`${API_BASE}/api/metrics/batch`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ slugs: [slug] }),
					signal: ac.signal,
					// 캐시 정책은 백엔드에 맞춰 조절 (없으면 생략)
					// cache: 'no-store',
				})

				if (!res.ok) throw new Error('metrics fetch failed')

				const json = (await res.json()) as { data?: Record<string, Metrics> }
				setData(json?.data?.[slug] ?? { likes: 0, comments: 0 })
			} catch {
				if (!ac.signal.aborted) setData({ likes: 0, comments: 0 })
			}
		})()

		return () => ac.abort()
	}, [slug])

	const likes = data?.likes ?? 0
	const comments = data?.comments ?? 0

	// API 미설정이거나 아직 로딩 중이어도 깔끔하게 0으로 표시
	return (
		<span aria-label="post-metrics">
			👍 {likes} · 💬 {comments}
		</span>
	)
}
