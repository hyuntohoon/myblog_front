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

window.addEventListener('popstate', syncAuthUI)

// ── Magazine masthead collapse (FEAT-header-magazine-masthead) ──
// The header is ALWAYS visible (no hide-on-scroll). Past ENTER it collapses the
// centered masthead into the compact one-line bar; it only expands again once
// scrolled back near the top (EXIT) — a hysteresis band so a small nudge mid-page
// doesn't flip the masthead open/closed. Replaces the old 3-mode preference system.
const ENTER = 48
const EXIT = 16

function setupHeaderScroll() {
	const header = $('#site-header')
	if (!header)
		return

	let ticking = false
	const apply = () => {
		ticking = false
		const y = Math.max(0, window.scrollY)
		if (y > ENTER)
			header.classList.add('is-scrolled')
		else if (y < EXIT)
			header.classList.remove('is-scrolled')
	}

	const onScroll = () => {
		if (ticking)
			return
		ticking = true
		requestAnimationFrame(apply)
	}

	window.addEventListener('scroll', onScroll, { passive: true })

	// Prime the initial state without animating, so a page that loads already
	// scrolled (reload / #hash deep-link) snaps to the right state without a flash.
	header.classList.add('is-priming')
	apply()
	requestAnimationFrame(() => header.classList.remove('is-priming'))
}

setupHeaderScroll()
