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
//
// `lockScroll` (ARCH-overlay-modal-isolation Step 1) composes in `useScrollLock`
// so a scrim-backed dialog gets both ESC/trap and background-scroll lock from one
// call. Defaults to false: several `useDismissable` callers are anchored, non-scrim
// popups (e.g. OverviewDash's "add widget" menu) that must not freeze the page.
//
// `inertBackground` (A11Y-modal-background-inert Step 1) defaults to whatever
// `lockScroll` resolves to, because this codebase already encodes "is this overlay
// modal?" as "does it lock background scroll?". See the controller below.
import { useEffect, useRef } from 'react'
import { useScrollLock } from './useScrollLock'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

interface StackEntry {
	ref: { current: HTMLElement | null }
	inertBackground: boolean
}

// Stack of currently-open dismissables. Overlays can nest (the lyrics viewer
// opens OVER the album-detail modal — ARCH-entity-interaction-contract Step 2),
// and every instance registers its own document-level capture listener, so
// `stopPropagation` alone cannot keep one ESC from firing all of them (same
// node → all listeners still run). Only the TOP entry may act: ESC closes one
// layer at a time (top first) and Tab stays trapped in the top layer instead
// of being stolen by a lower trap's wrap-around.
const openStack: StackEntry[] = []

function visibleFocusables(root: HTMLElement): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement)
}

// ── Background inert (A11Y-modal-background-inert Step 1) ────────────────────
//
// The Tab trap above does nothing for a screen-reader virtual cursor: VoiceOver's
// arrows and NVDA's browse mode don't move DOM focus, so the reader walks straight
// through the scrim into the header, the article and the footer and reads content
// the sighted user cannot see or reach. `role="dialog" aria-modal="true"` is already
// set on these dialogs and does not fix it — `aria-modal` is advisory and unevenly
// honoured. `inert` is the primitive that actually removes a subtree from the
// accessibility tree, from hit-testing and from focus.
//
// The mark has to be computed per open dialog, not from a fixed selector, because
// overlays reach the top two different ways: portalled to <body> (ActionSheet,
// BucketPickerSheet) or rendered in place inside whichever island already owns them
// (CommandPalette and DraftsInbox live under `.site-shell`). Inerting `.site-shell`
// unconditionally would inert the writer's own command palette.
//
// Refcounted at module level for the same reason `useScrollLock` is: these overlays
// nest, so a per-instance save/restore would release out of order.
const inertApplied = new Set<HTMLElement>()

// Walk up to the <body> child that contains `el`. Returns null when `el` is detached
// or lives outside <body>; the caller then leaves the background alone rather than
// risk inerting the dialog's own container.
function bodyChildAncestor(el: HTMLElement | null): HTMLElement | null {
	let node: HTMLElement | null = el
	while (node && node.parentElement && node.parentElement !== document.body)
		node = node.parentElement
	return node && node.parentElement === document.body ? node : null
}

function syncInert(): void {
	if (typeof document === 'undefined' || !document.body)
		return

	// The topmost entry that ASKED for it decides whether the background is inert at
	// all. Entries above it stay reachable, so an anchored popup opened over a modal
	// (it opts out of scroll lock, hence out of inert) is not deactivated by the modal
	// underneath it.
	let from = -1
	for (let i = openStack.length - 1; i >= 0; i--) {
		if (openStack[i].inertBackground) {
			from = i
			break
		}
	}
	const keep = new Set<HTMLElement>()
	if (from >= 0) {
		for (let i = from; i < openStack.length; i++) {
			const ancestor = bodyChildAncestor(openStack[i].ref.current)
			if (ancestor)
				keep.add(ancestor)
		}
	}

	// A modal whose element we cannot place fails OPEN — nothing is inerted. Inerting
	// every <body> child would deactivate the dialog itself, which is worse than the
	// defect this exists to fix.
	const want = new Set<HTMLElement>()
	if (from >= 0 && keep.size > 0) {
		for (const child of [...document.body.children] as HTMLElement[]) {
			if (!keep.has(child))
				want.add(child)
		}
	}

	for (const el of [...inertApplied]) {
		if (!want.has(el)) {
			el.removeAttribute('inert')
			inertApplied.delete(el)
		}
	}
	for (const el of want) {
		// Never touch an element that was already inert when we got here — that is
		// someone else's state, and restoring it would not be ours to do.
		if (inertApplied.has(el) || el.hasAttribute('inert'))
			continue
		el.setAttribute('inert', '')
		inertApplied.add(el)
	}
}

// `ClientRouter` keeps this module alive across navigations while the DOM under it is
// replaced (the `capabilityTier` regression in ARCH-global-playback-experience Step 1).
// A React island inside `.site-shell` is destroyed by the swap without ever unmounting,
// so its effect cleanup never runs and its stack entry would strand — leaving the
// persisted islands, which DO survive the swap, inert forever. Drop entries whose
// element left the document, forget elements that left with it, then recompute.
if (typeof document !== 'undefined') {
	document.addEventListener('astro:after-swap', () => {
		for (let i = openStack.length - 1; i >= 0; i--) {
			const el = openStack[i].ref.current
			if (!el || !el.isConnected)
				openStack.splice(i, 1)
		}
		for (const el of [...inertApplied]) {
			if (!el.isConnected)
				inertApplied.delete(el)
		}
		syncInert()
	})
}

export function useDismissable(
	open: boolean,
	onClose: () => void,
	ref: { current: HTMLElement | null },
	opts: { trapFocus?: boolean, autoFocus?: boolean, lockScroll?: boolean, inertBackground?: boolean } = {},
) {
	const { trapFocus = true, autoFocus = true, lockScroll = false, inertBackground = lockScroll } = opts

	useScrollLock(open && lockScroll)

	// Hold the latest onClose without making it an effect dependency. Callers
	// routinely pass an inline `onClose={() => setX(null)}`, which is a fresh
	// identity on every parent render. If the focus effect depended on it, any
	// parent re-render WHILE the overlay is open (e.g. a bucket board re-rendering
	// after an album is added) would tear down + re-run the effect — firing the
	// focus-restore cleanup, which yanks focus (and scroll) back to the trigger
	// mid-interaction. Keying the focus effect on `open` alone fixes that.
	const onCloseRef = useRef(onClose)
	onCloseRef.current = onClose

	// Stable per-instance stack entry; its identity is what the top-of-stack checks
	// compare, its fields are what the inert controller reads.
	const stackEntry = useRef<StackEntry | null>(null)
	if (stackEntry.current === null)
		stackEntry.current = { ref, inertBackground }

	// The element focus returns to on close. Captured by the registration effect
	// below rather than by the focus effect, because applying `inert` to the
	// background blurs whatever was focused there — by the time the focus effect
	// ran, `document.activeElement` would already be <body>.
	const restoreTo = useRef<HTMLElement | null>(null)

	// Stack registration + background inert. Declared BEFORE the focus effect on
	// purpose: React runs cleanups in declaration order, so this one releases the
	// background before the focus effect restores focus into it. The other order
	// would silently drop the restore — focusing into an inert subtree is a no-op.
	useEffect(() => {
		if (!open)
			return
		const entry = stackEntry.current!
		entry.ref = ref
		entry.inertBackground = inertBackground
		restoreTo.current = document.activeElement as HTMLElement | null
		openStack.push(entry)
		syncInert()
		return () => {
			const i = openStack.indexOf(entry)
			if (i >= 0)
				openStack.splice(i, 1)
			syncInert()
		}
	}, [open, ref, inertBackground])

	// Focus lifecycle: autofocus on open; restore focus only on a real close /
	// unmount (open flips false). Deps are all stable across a parent re-render
	// (open stays true, ref is a useRef, autoFocus is a primitive).
	useEffect(() => {
		if (!open)
			return
		const root = ref.current

		if (autoFocus && root) {
			const f = visibleFocusables(root)
			;(f[0] ?? root).focus?.()
		}

		return () => {
			// Restore focus to the trigger so keyboard users aren't dumped at <body>.
			const target = restoreTo.current
			if (target && typeof target.focus === 'function')
				target.focus()
		}
	}, [open, ref, autoFocus])

	// Key handling: ESC closes, Tab is trapped within the overlay. Separate from
	// the focus lifecycle so re-subscribing the listener never restores focus, and
	// separate from the registration effect so a `trapFocus` change re-subscribes
	// the listener without shuffling this overlay to the top of the stack.
	useEffect(() => {
		if (!open)
			return
		const entry = stackEntry.current!
		const root = ref.current
		const onKey = (e: KeyboardEvent) => {
			// A lower layer under a nested overlay stays inert until it's top again.
			if (openStack[openStack.length - 1] !== entry)
				return
			if (e.key === 'Escape') {
				e.stopPropagation()
				onCloseRef.current()
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
		}
	}, [open, ref, trapFocus])
}
