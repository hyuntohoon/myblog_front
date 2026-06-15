// FEAT-global-search — shared search atoms, ported from the 전역 검색 handoff
// (gsearch-atoms.jsx). Surface-agnostic visuals reused by the global /search
// page + header dropdown, and (later) the writer palette + bucket add-modal.
// The design's demo cover_url:{hue} duotone branch is dropped — real covers are
// image URLs (or null → letter tile). CSS lives in src/styles/search.css.
import type { CSSProperties } from 'react'

/**
 * Initials for the letter-tile fallback: a single Korean syllable, else the
 *  first two ASCII letters (uppercased).
 */
export function gsInitials(name: string): string {
	const s = (name || '?').trim() || '?'
	const first = s.charAt(0)
	// Korean syllable block (AC00–D7A3) → single-char initial; else two ASCII.
	const cc = first.charCodeAt(0)
	if (cc >= 0xAC00 && cc <= 0xD7A3)
		return first
	const w = s.split(/\s+/).filter(Boolean)
	if (w.length >= 2)
		return (w[0].charAt(0) + w[1].charAt(0)).toUpperCase()
	return s.slice(0, 2).toUpperCase()
}

export function GCover({ name, src, size = 44, shape = 'square', radius = 3 }: {
	name: string
	src?: string | null
	size?: number
	shape?: 'square' | 'circle'
	radius?: number
}) {
	const style: CSSProperties = {
		width: size || undefined,
		height: size || undefined,
		borderRadius: shape === 'circle' ? '50%' : radius,
	}
	if (src) {
		return (
			<span className="gs-cover" style={style}>
				<img src={src} alt={name} loading="lazy" />
			</span>
		)
	}
	return (
		<span className="gs-cover gs-cover-ph" style={style}>
			<span className="gs-cover-init serif">{gsInitials(name)}</span>
		</span>
	)
}

/** Green-dot "Spotify" tag for not-yet-in-catalog candidate rows. */
export function SourceTag() {
	return (
		<span className="gs-srctag mono">
			<span className="gs-srcdot" aria-hidden="true" />
			Spotify
		</span>
	)
}

/**
 * Partial-fill stars from a 0–5 rating (never numeric). Reuses the global
 *  `.stars` classes. null → "미평론".
 */
export function GStars({ rating, size = 14 }: { rating: number | null, size?: number }) {
	if (rating == null)
		return <span className="gs-unrated mono">미평론</span>
	const pct = (Math.max(0, Math.min(5, rating)) / 5) * 100
	return (
		<span
			className="stars"
			role="img"
			aria-label={`별점 ${rating.toFixed(1)} / 5`}
			style={{ '--star-size': `${size}px`, '--star-pct': `${pct}%` } as CSSProperties}
		>
			<span className="stars-bg" aria-hidden="true">★★★★★</span>
			<span className="stars-fg" aria-hidden="true">★★★★★</span>
		</span>
	)
}
