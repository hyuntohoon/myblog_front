// src/components/post-metrics.tsx
import { useEffect, useState } from 'react'
import { fetchMetrics, type Metrics } from 'src/lib/api'

export default function PostMetricsItem({ slug }: { slug: string }) {
	const [data, setData] = useState<Metrics | null>(null)
	useEffect(() => {
		let off = false
		;(async () => {
			const map = await fetchMetrics([slug])
			if (!off) setData(map[slug] ?? { likes: 0, comments: 0 })
		})()
		return () => {
			off = true
		}
	}, [slug])
	return (
		<span aria-label="post-metrics">
			👍 {data?.likes ?? 0} · 💬 {data?.comments ?? 0}
		</span>
	)
}
