// Front UI/UX audit 2026-10-16 S2 — the one cover primitive. Every album/track
// cover renders an image, a two-letter placeholder when there is no image, or
// a skeleton while loading; before this, each surface carried its own copy of
// that branch. Surfaces keep their own wrapper class and sizing and pass
// overlays (badges, action buttons) as children.
import type { CSSProperties, ReactNode } from 'react'

export type CoverState = 'loading' | 'image' | 'fallback'

export interface CoverImageProps {
	src: string | null | undefined
	/** Accessible name of the image; also the source of the placeholder letters. */
	label: string
	/** Loading is distinct from a loaded entity that has no cover. */
	loading?: boolean
	/** Surface wrapper class(es), rendered before the global `cover` class. */
	className?: string
	style?: CSSProperties
	placeholderStyle?: CSSProperties
	/** Skeleton element class while `loading`. */
	skeletonClassName?: string
	/** Overlays drawn inside the cover box (badges, action buttons). */
	children?: ReactNode
}

export function coverState(src: string | null | undefined, loading = false): CoverState {
	if (loading)
		return 'loading'
	return src ? 'image' : 'fallback'
}

export function coverInitials(label: string): string {
	return (label || '?').slice(0, 2).toUpperCase()
}

export function CoverImage({ src, label, loading = false, className, style, placeholderStyle, skeletonClassName, children }: CoverImageProps) {
	const state = coverState(src, loading)
	return (
		<div className={className ? `${className} cover` : 'cover'} style={style} data-cover-state={state}>
			{state === 'loading' ?
				<span className={skeletonClassName} aria-hidden="true" /> :
				state === 'image' ?
					<img src={src!} alt={label} loading="lazy" decoding="async" /> :
					<span className="cover-ph" style={placeholderStyle} aria-hidden="true">{coverInitials(label)}</span>}
			{children}
		</div>
	)
}
