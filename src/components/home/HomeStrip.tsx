/**
 * Shared strip container for the home cover strips
 * (FEAT-home-strip-ranking Step 2) — owns overflow, arrows, edge fades, and
 * the thin scrollbar; cards stay per-strip.
 */
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

// Page step leaves the previously-peeking card fully visible.
const PEEK_PX = 64
// Snap rest position sits on the 2px track padding — treat ±4px as "at the edge".
const EDGE_PX = 4

const HSTRIP_CSS = `
.hstrip{position:relative}
.hstrip .hstrip-track{display:flex;gap:clamp(14px,2vw,20px);overflow-x:auto;scroll-snap-type:x proximity;padding:2px 2px 14px;margin:0 -2px;scrollbar-width:thin;scrollbar-color:var(--color-border-soft) transparent;mask-image:linear-gradient(to right,transparent,#000 var(--fade-l),#000 calc(100% - var(--fade-r)),transparent);-webkit-mask-image:linear-gradient(to right,transparent,#000 var(--fade-l),#000 calc(100% - var(--fade-r)),transparent)}
.hstrip .hstrip-track::-webkit-scrollbar{height:6px}
.hstrip .hstrip-track::-webkit-scrollbar-track{background:transparent}
.hstrip .hstrip-track::-webkit-scrollbar-thumb{background:var(--color-border-soft);border-radius:3px}
.hstrip .hstrip-btn{position:absolute;top:calc(2px + clamp(128px,32vw,150px)/2);transform:translateY(-50%);z-index:2;background:color-mix(in srgb,var(--color-bg) 88%,transparent);backdrop-filter:blur(3px);border:1px solid var(--color-border-soft);border-radius:999px;box-shadow:0 1px 3px rgba(0,0,0,.18);color:var(--color-text);width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;opacity:0;pointer-events:none;transition:opacity .15s}
.hstrip .hstrip-prev{left:2px}
.hstrip .hstrip-next{right:2px}
.hstrip:hover .hstrip-btn[data-on],.hstrip .hstrip-btn[data-on]:focus-visible{opacity:1;pointer-events:auto}
.hstrip .hstrip-btn:hover{color:var(--color-accent)}
.hstrip .hstrip-btn:focus-visible{outline:2px solid var(--color-accent);outline-offset:2px}
@media (hover:none),(pointer:coarse){.hstrip .hstrip-btn{display:none}}
@media (prefers-reduced-motion:reduce){.hstrip .hstrip-btn{transition:none}}
`

export default function HomeStrip({ children }: { children: ReactNode }) {
	const trackRef = useRef<HTMLDivElement>(null)
	const [canLeft, setCanLeft] = useState(false)
	const [canRight, setCanRight] = useState(false)

	const update = useCallback(() => {
		const track = trackRef.current
		if (!track)
			return
		setCanLeft(track.scrollLeft > EDGE_PX)
		setCanRight(track.scrollLeft < track.scrollWidth - track.clientWidth - EDGE_PX)
	}, [])

	useEffect(() => {
		const track = trackRef.current
		if (!track)
			return
		update()
		const observer = new ResizeObserver(update)
		observer.observe(track)
		return () => observer.disconnect()
	}, [update])

	function page(dir: -1 | 1) {
		const track = trackRef.current
		if (!track)
			return
		const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
		track.scrollBy({
			left: dir * (track.clientWidth - PEEK_PX),
			behavior: reduceMotion ? 'auto' : 'smooth',
		})
	}

	return (
		<div className="hstrip">
			<style>{HSTRIP_CSS}</style>
			<div
				className="hstrip-track"
				ref={trackRef}
				style={{ ['--fade-l' as any]: canLeft ? '28px' : '0px', ['--fade-r' as any]: canRight ? '28px' : '0px' }}
				onScroll={update}
			>
				{children}
			</div>
			<button type="button" className="hstrip-btn hstrip-prev" aria-label="이전으로 스크롤" data-on={canLeft || undefined} disabled={!canLeft} onClick={() => page(-1)}>
				<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
					<path d="M10 3.5 5.5 8 10 12.5" />
				</svg>
			</button>
			<button type="button" className="hstrip-btn hstrip-next" aria-label="다음으로 스크롤" data-on={canRight || undefined} disabled={!canRight} onClick={() => page(1)}>
				<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
					<path d="M6 3.5 10.5 8 6 12.5" />
				</svg>
			</button>
		</div>
	)
}
