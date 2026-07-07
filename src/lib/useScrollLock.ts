// Shared background-scroll lock for open overlays.
//
// Every `.scrim`/full-viewport modal wants the page behind it frozen — a fixed
// scrim only stops interaction visually; the document body still scrolls under
// the wheel/touch. Several modals inlined `document.body.style.overflow` copies
// of this; the profile detail/lyrics overlays had none, so the profile page
// scrolled behind an open modal.
//
// Overlays NEST (the lyrics viewer opens OVER the album-detail modal —
// ARCH-entity-interaction-contract Step 2 / see useDismissable's openStack), so
// a naive per-instance save/restore is unsafe: the inner modal would restore
// `overflow: hidden` (the outer's value) and, when the outer closes, could leave
// the body locked or unlocked out of order. A module-level refcount fixes that —
// the original overflow is captured once on the first lock and restored only when
// the last lock releases.
//
// Usage (mounted-when-open modals): call unconditionally.
//   useScrollLock()
// Toggled overlays: pass the open flag.
//   useScrollLock(open)
import { useEffect } from 'react'

let lockCount = 0
let prevOverflow = ''

function acquire() {
	if (lockCount === 0) {
		prevOverflow = document.body.style.overflow
		document.body.style.overflow = 'hidden'
	}
	lockCount++
}

function release() {
	lockCount = Math.max(0, lockCount - 1)
	if (lockCount === 0)
		document.body.style.overflow = prevOverflow
}

export function useScrollLock(lock: boolean = true) {
	useEffect(() => {
		if (!lock)
			return
		acquire()
		return release
	}, [lock])
}
