import type { CSSProperties } from 'react'

interface Props {
  value: number
  max?: number
  size?: number
  className?: string
  ariaLabel?: string
}

// React mirror of partial-stars.astro for use inside writer islands.
// CSS lives in writer.css under .hdr-pstars / .hpd-bg / .hpd-fg so the
// stars track the writer's --accent / --ink-faint tokens (writer chrome
// uses different token names than the public read pages).
export default function PartialStars({ value, max = 5, size = 22, className, ariaLabel }: Props) {
  const clamped = Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0))
  const pct = (clamped / max) * 100
  const style: CSSProperties = {
    fontSize: `${size}px`,
    ['--hpd-pct' as string]: `${pct}%`,
  }
  return (
    <span
	className={`hdr-pstars${className ? ` ${className}` : ''}`}
	role="img"
	aria-label={ariaLabel ?? `${clamped} / ${max}`}
	style={style}
    >
      <span className="hpd-bg" aria-hidden>★★★★★</span>
      <span className="hpd-fg" aria-hidden>★★★★★</span>
    </span>
  )
}
