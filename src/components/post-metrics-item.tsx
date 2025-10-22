import { useEffect, useState } from 'react'

const API_BASE = 'http://127.0.0.1:8000+1'

type Metrics = { likes: number; comments: number }

export default function PostMetricsItem({ slug }: { slug: string }) {
	const [data, setData] = useState<Metrics | null>(null)

	useEffect(() => {
		let aborted = false
		const run = async () => {
			try {
				const res = await fetch(`${API_BASE}/api/metrics/batch`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ slugs: [slug] }),
				})
				if (!res.ok) return
				const json = (await res.json()) as { data?: Record<string, Metrics> }
				if (!aborted) setData(json?.data?.[slug] ?? { likes: 0, comments: 0 })
			} catch {
				if (!aborted) setData({ likes: 0, comments: 0 })
			}
		}
		run()
		return () => {
			aborted = true
		}
	}, [slug])

	const likes = data?.likes ?? 0
	const comments = data?.comments ?? 0
	return (
		<span aria-label="post-metrics">
			👍 {likes} · 💬 {comments}
		</span>
	)
}
