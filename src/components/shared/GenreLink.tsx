import { useEffect, useState } from 'react'
import { genreMapHref, resolveGenreSlug } from '@lib/genres'

export function GenreLink({ label, className }: { label: string, className?: string }) {
	const [resolved, setResolved] = useState<{ label: string, slug: string | null } | null>(null)

	useEffect(() => {
		let alive = true
		void resolveGenreSlug(label).then((slug) => {
			if (alive)
				setResolved({ label, slug })
		})
		return () => {
			alive = false
		}
	}, [label])

	const slug = resolved?.label === label ? resolved.slug : null
	if (!slug)
		return <span className={className}>{label}</span>

	return (
		<a
			className={className}
			href={genreMapHref(slug)}
			style={{ color: 'inherit', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'var(--color-faded)', textUnderlineOffset: 3 }}
		>
			{label}
		</a>
	)
}
