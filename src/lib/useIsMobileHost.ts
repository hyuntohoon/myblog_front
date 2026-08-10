// Shared mobile-host breakpoint check. Originally local to AlbumDetail.tsx's
// MemoWindow (dock-vs-float branch); ARCH-buckit-navigation-shell Step 3 reuses
// the same breakpoint for the bucket board's nav drawer branch, so it moved here
// rather than being copy-pasted a second time.
import { useEffect, useState } from 'react'

export function useIsMobileHost(): boolean {
	const [mobile, setMobile] = useState(false)
	useEffect(() => {
		const mq = window.matchMedia('(max-width: 767px)')
		const on = () => setMobile(mq.matches)
		on()
		mq.addEventListener('change', on)
		return () => mq.removeEventListener('change', on)
	}, [])
	return mobile
}
