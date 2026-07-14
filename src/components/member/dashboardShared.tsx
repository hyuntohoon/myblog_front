// Shared pieces for the member self-dashboard. Kept tiny and dependency-free
// so importing it never drags the heavy tab implementations into another chunk.
import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'

/* ── persisted view preferences (localStorage keys shared across hosts) ────── */

export const NP_STYLE_KEY = 'lf_np_style'
export const NP_STYLE_OPTS = ['banner', 'full', 'list'] as const

export type Density = 'compact' | 'regular' | 'comfy'
export const DENSITY_KEY = 'lf_density'
export const DENSITY_OPTS: { v: Density, label: string }[] = [
	{ v: 'compact', label: '콤팩트' },
	{ v: 'regular', label: '보통' },
	{ v: 'comfy', label: '넓게' },
]

/** Read a persisted enum pref, falling back when storage/value is unusable. */
export function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
	if (typeof localStorage === 'undefined')
		return fallback
	try {
		const v = localStorage.getItem(key)
		if (v && (allowed as readonly string[]).includes(v))
			return v as T
	}
	catch { /* ignore */ }
	return fallback
}

/**
 * One tab's content. Mounted on first visit and then KEPT MOUNTED — inactive
 * tabs are hidden with display:none rather than unmounted, so revisiting a tab
 * never refetches data or resets its in-tab state (scroll, filters, open sheets).
 * The lf-rise entrance plays once, on the panel's first appearance; later
 * re-shows skip it (toggling display would otherwise replay the animation).
 */
export function TabPanel({ active, children }: { active: boolean, children: ReactNode }) {
	const seenRef = useRef(false)
	const firstShow = active && !seenRef.current
	useEffect(() => {
		if (active)
			seenRef.current = true
	}, [active])
	return (
		<div className={firstShow ? 'lf-rise' : undefined} style={{ display: active ? undefined : 'none' }}>
			{children}
		</div>
	)
}
