// src/scripts/header.client.ts
import { goLogin, isLoggedIn, logout } from '../lib/auth.ts'

const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null
const loginBtn = $('#login-btn')
const logoutBtn = $('#logout-btn')
const writeLink = $('#write-link')
const profileLink = $('#profile-link')

function syncAuthUI() {
	const logged = isLoggedIn()
	if (logged) {
		loginBtn?.classList.add('hidden')
		logoutBtn?.classList.remove('hidden')
		writeLink?.classList.remove('hidden')
		profileLink?.classList.remove('hidden')
	}
 else {
		loginBtn?.classList.remove('hidden')
		logoutBtn?.classList.add('hidden')
		writeLink?.classList.add('hidden')
		profileLink?.classList.add('hidden')
	}
}

// 초기 동기화
syncAuthUI()

// 이벤트 바인딩
loginBtn?.addEventListener('click', () => {
	// 로그인 후 현재 페이지로 복귀
	goLogin(false, location.pathname + location.search + location.hash)
})
logoutBtn?.addEventListener('click', () => logout())

// (선택) 히스토리 이동 시에도 상태 반영하고 싶다면:
window.addEventListener('popstate', syncAuthUI)

// ── Header scroll behavior (FEAT-header-scroll-prefs) ──
// Three reader-selectable modes, persisted at `atmb-header-scroll`:
//   hide-down (default) — hide on scroll-down, reveal on scroll-up
//   compact             — shrink the masthead past a threshold, always visible
//   threshold           — auto-hide past a threshold, reveal on deliberate scroll-up
type ScrollMode = 'hide-down' | 'compact' | 'threshold'

const SCROLL_KEY = 'atmb-header-scroll'
const SCROLL_THRESHOLD = 80
const REVEAL_DELTA = 20

function parseScrollMode(v: unknown): ScrollMode {
	return v === 'compact' || v === 'threshold' ? v : 'hide-down'
}

function loadScrollMode(): ScrollMode {
	return parseScrollMode(typeof localStorage !== 'undefined' && localStorage.getItem(SCROLL_KEY))
}

function setupHeaderScroll() {
	const header = $('#site-header')
	if (!header)
		return

	let mode = loadScrollMode()
	let lastY = window.scrollY
	let upAccum = 0
	let focusWithin = false
	let ticking = false

	const reveal = () => header.classList.remove('is-hidden')
	const hide = () => header.classList.add('is-hidden')

	const apply = () => {
		ticking = false
		const y = Math.max(0, window.scrollY)
		const goingDown = y > lastY

		if (mode === 'compact') {
			header.classList.remove('is-hidden')
			header.classList.toggle('is-compact', y > SCROLL_THRESHOLD)
			lastY = y
			return
		}

		header.classList.remove('is-compact')

		// Keyboard focus inside the header, or sitting near the top, always shows it.
		if (focusWithin || y <= SCROLL_THRESHOLD) {
			reveal()
			upAccum = 0
		}
		else if (mode === 'hide-down') {
			if (goingDown)
				hide()
			else
				reveal()
		}
		else {
			// threshold: hide once past the threshold; only a deliberate upward
			// scroll (>= REVEAL_DELTA accumulated) brings it back.
			if (goingDown) {
				hide()
				upAccum = 0
			}
			else {
				upAccum += lastY - y
				if (upAccum >= REVEAL_DELTA)
					reveal()
			}
		}

		lastY = y
	}

	const onScroll = () => {
		if (ticking)
			return
		ticking = true
		requestAnimationFrame(apply)
	}

	const setMode = (next: ScrollMode) => {
		mode = next
		header.classList.remove('is-hidden', 'is-compact')
		lastY = window.scrollY
		upAccum = 0
		apply()
	}

	window.addEventListener('scroll', onScroll, { passive: true })

	// a11y: reveal the header whenever keyboard focus enters it, regardless of mode.
	header.addEventListener('focusin', () => {
		focusWithin = true
		reveal()
	})
	header.addEventListener('focusout', (e) => {
		focusWithin = header.contains((e as FocusEvent).relatedTarget as Node | null)
	})

	// Live updates from the footer preference picker — no reload needed.
	window.addEventListener('atmb:header-scroll-change', (e) => {
		setMode(parseScrollMode((e as CustomEvent).detail))
	})

	// Prime the initial state without animating, so a page that loads already
	// scrolled (reload / #hash deep-link) doesn't flash the header in then out.
	header.classList.add('is-priming')
	apply()
	requestAnimationFrame(() => header.classList.remove('is-priming'))
}

setupHeaderScroll()
