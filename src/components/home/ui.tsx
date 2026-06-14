/**
 * Shared React building blocks for the editorial home modules
 * (FEAT-home-redesign). Mirrors the Claude Design `components.jsx`
 * (Cover / Stars / SectionTitle) using the `ds`-ported helper classes
 * in global.css. The numeric rating is NEVER rendered — stars only
 * (owner decision 2026-06-14; matches partial-stars.astro).
 */
import type { CSSProperties, ReactNode } from 'react'

export function Cover({ label, src, size = 56, radius = 3, square = false }: {
	label: string
	src?: string | null
	size?: number
	radius?: number
	square?: boolean
}) {
	const dim: CSSProperties = square ?
		{ width: '100%', aspectRatio: '1 / 1' } :
		{ width: size, height: size }
	const fs = square ? 'clamp(20px, 4vw, 40px)' : Math.max(12, size * 0.34)
	return (
		<div className="cover" style={{ ...dim, borderRadius: radius }}>
			{src ?
				<img src={src} alt={label} loading="lazy" /> :
				<span className="cover-ph" style={{ fontSize: fs }}>{(label || '?').slice(0, 2).toUpperCase()}</span>}
		</div>
	)
}

/** Partial-fill stars from a 0–5 rating. The number is never shown. */
export function Stars({ rating, size = 16 }: { rating: number | null, size?: number }) {
	if (rating == null)
		return <span className="unrated">미평가</span>
	const clamped = Math.max(0, Math.min(5, rating))
	const pct = (clamped / 5) * 100
	return (
		<span
			className="stars"
			role="img"
			aria-label={`별점 ${clamped.toFixed(1)} / 5`}
			style={{ '--star-size': `${size}px`, '--star-pct': `${pct}%` } as CSSProperties}
		>
			<span className="stars-bg" aria-hidden="true">★★★★★</span>
			<span className="stars-fg" aria-hidden="true">★★★★★</span>
		</span>
	)
}

/** Masthead-style section header (serif title + mono kicker + optional right slot). */
export function SectionTitle({ kicker, title, right, size = 26 }: {
	kicker?: string
	title: string
	right?: ReactNode
	size?: number
}) {
	return (
		<div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', borderBottom: '1px solid var(--color-text)', paddingBottom: 12, marginBottom: 22 }}>
			<div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', flexShrink: 0 }}>
				<h2 className="serif" style={{ fontSize: size, fontWeight: 500, letterSpacing: '-.01em', color: 'var(--color-text)', whiteSpace: 'nowrap', margin: 0 }}>{title}</h2>
				{kicker && <span className="meta">{kicker}</span>}
			</div>
			{right}
		</div>
	)
}
