// Shared overlay a11y: ESC-to-close + focus trap + focus restore.
//
// Front interaction QA (2026-06-09) found that modals / slide-overs / menus
// across the app close on backdrop-click but ignore the keyboard: no ESC, no
// focus trap (Tab escapes to the page behind the scrim), and focus is never
// restored to the trigger on close. This hook centralises the fix so every
// overlay behaves consistently (matching the ⌘K palette, which already did).
//
// Usage:
//   const ref = useRef<HTMLElement>(null)
//   useDismissable(open, onClose, ref)
//   return <div ref={ref} role="dialog" aria-modal="true">…</div>
//
// `open` gates everything — when false the hook is inert. Pass the element that
// wraps the overlay's focusable content as `ref`.
import { useEffect } from 'react'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

function visibleFocusables(root: HTMLElement): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement)
}

export function useDismissable(
	open: boolean,
	onClose: () => void,
	ref: { current: HTMLElement | null },
	opts: { trapFocus?: boolean, autoFocus?: boolean } = {},
) {
	const { trapFocus = true, autoFocus = true } = opts
	useEffect(() => {
		if (!open)
			return
		const root = ref.current
		const restoreTo = document.activeElement as HTMLElement | null

		if (autoFocus && root) {
			const f = visibleFocusables(root)
			;(f[0] ?? root).focus?.()
		}

		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.stopPropagation()
				onClose()
				return
			}
			if (e.key === 'Tab' && trapFocus && root) {
				const f = visibleFocusables(root)
				if (!f.length)
					return
				const i = f.indexOf(document.activeElement as HTMLElement)
				if (e.shiftKey && i <= 0) {
					e.preventDefault()
					f[f.length - 1].focus()
				}
				else if (!e.shiftKey && i === f.length - 1) {
					e.preventDefault()
					f[0].focus()
				}
			}
		}
		document.addEventListener('keydown', onKey, true)
		return () => {
			document.removeEventListener('keydown', onKey, true)
			// Restore focus to the trigger so keyboard users aren't dumped at <body>.
			if (restoreTo && typeof restoreTo.focus === 'function')
				restoreTo.focus()
		}
	}, [open, onClose, ref, trapFocus, autoFocus])
}
