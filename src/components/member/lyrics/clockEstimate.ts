export interface ClockAnchor { ms: number, wallMs: number }

export function estimatedMs(a: ClockAnchor, now: number = performance.now()): number {
	return a.ms + (now - a.wallMs)
}
