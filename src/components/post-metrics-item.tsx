import { useEffect, useState } from 'react'

type Metrics = { likes: number; comments: number }

export default function PostMetricsItem({ slug }: { slug: string }) {
	const [m, setM] = useState<Metrics>({ likes: 0, comments: 0 })

	useEffect(() => {
		if (!slug) return
		const qs = encodeURIComponent(slug)
		fetch(`/api/metrics.json?slugs=${qs}`, { cache: 'no-store' })
			.then((r) => r.json())
			.then((json) => {
				const v = json?.[slug]
				setM({
					likes: typeof v?.likes === 'number' ? v.likes : 0,
					comments: typeof v?.comments === 'number' ? v.comments : 0,
				})
			})
			.catch(() => setM({ likes: 0, comments: 0 }))
	}, [slug])

	return (
		<span className="inline-flex gap-3 text-faded">
			👍 {m.likes} · 💬 {m.comments}
		</span>
	)
}
