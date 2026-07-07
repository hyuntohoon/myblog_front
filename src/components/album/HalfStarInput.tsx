// FEAT-multi-user-accounts Phase 1 — 0.5-step star input for RYM-style ratings
// (backend ck_album_reviews_rating_halfstep: 0.5–5.0 half-steps). Click the left
// half of a star for x.5, the right half for x.0; ←/→ nudge by 0.5. Public-safe
// (no member imports) — used inside the app-wide album overlay.
import { useState } from 'react'

function StarGlyph({ fill, size }: { fill: number, size: number }) {
	return (
		<span style={{ position: 'relative', display: 'inline-block', width: size, height: size, fontSize: size, lineHeight: 1 }} aria-hidden="true">
			<span style={{ color: 'var(--color-border, #d8d2c4)' }}>★</span>
			<span style={{ position: 'absolute', left: 0, top: 0, width: `${fill * 100}%`, overflow: 'hidden', color: 'var(--color-accent, #d8a13a)' }}>★</span>
		</span>
	)
}

export default function HalfStarInput({ value, onChange, size = 30 }: { value: number, onChange: (v: number) => void, size?: number }) {
	const [hover, setHover] = useState<number | null>(null)
	const shown = hover ?? value

	function clamp(v: number) {
		return Math.min(5, Math.max(0.5, Math.round(v * 2) / 2))
	}
	function onKey(e: React.KeyboardEvent) {
		if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
			e.preventDefault()
			onChange(clamp(value - 0.5))
		}
		else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
			e.preventDefault()
			onChange(clamp(value + 0.5))
		}
	}

	return (
		<span
			role="slider"
			aria-valuemin={0.5}
			aria-valuemax={5}
			aria-valuenow={value}
			aria-label={`별점 ${value.toFixed(1)} / 5`}
			tabIndex={0}
			onKeyDown={onKey}
			onMouseLeave={() => setHover(null)}
			style={{ display: 'inline-flex', gap: 2, cursor: 'pointer', outlineOffset: 3 }}
		>
			{[1, 2, 3, 4, 5].map((i) => {
				const fill = shown >= i ? 1 : shown >= i - 0.5 ? 0.5 : 0
				return (
					<span key={i} style={{ position: 'relative', width: size, height: size }}>
						<span
							onMouseEnter={() => setHover(i - 0.5)}
							onClick={() => onChange(i - 0.5)}
							style={{ position: 'absolute', left: 0, top: 0, width: '50%', height: '100%', zIndex: 2 }}
						/>
						<span
							onMouseEnter={() => setHover(i)}
							onClick={() => onChange(i)}
							style={{ position: 'absolute', right: 0, top: 0, width: '50%', height: '100%', zIndex: 2 }}
						/>
						<StarGlyph fill={fill} size={size} />
					</span>
				)
			})}
		</span>
	)
}
