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
	// 로그인 후에는 항상 홈으로 이동한다(콜백 처리에서 결정).
	goLogin(false)
})
logoutBtn?.addEventListener('click', () => logout())

window.addEventListener('popstate', syncAuthUI)

// Cross-tab sync: a login/logout in another tab mutates the shared localStorage;
// reflect it in this tab's header instead of showing a stale auth state.
window.addEventListener('storage', (e) => {
	if (e.key === 'access_token' || e.key === 'id_token' || e.key === null)
		syncAuthUI()
})

// ── Magazine masthead collapse (FEAT-header-magazine-masthead, restructured) ──
// The grand masthead is in normal flow and scrolls away on its own; a fixed,
// constant-height compact bar fades in once it's gone. We drive that off an
// IntersectionObserver on the masthead — NOT a scrollY threshold. The bar's
// appearance is opacity/background only (no height change), so it never moves
// scroll position; tying the toggle to the masthead's own visibility means the
// decision can't be perturbed by the toggle (which killed the old jitter loop).
function setupHeaderCollapse() {
	const masthead = $('.hdr-masthead')
	const bar = $('#hdr-bar')
	if (!masthead || !bar)
		return

	// Suppress the fade for the first applied state so a pre-scrolled load
	// (reload / #hash deep-link) snaps to the right state without animating.
	bar.classList.add('is-priming')
	let primed = false

	const io = new IntersectionObserver(([entry]) => {
		bar.classList.toggle('is-scrolled', !entry.isIntersecting)
		if (!primed) {
			primed = true
			requestAnimationFrame(() => bar.classList.remove('is-priming'))
		}
	}, { threshold: 0 })

	io.observe(masthead)
}

setupHeaderCollapse()

// ── Mobile nav drawer (FEAT-mobile-web-app Step 1, pattern B) ──
// Closed-state focusability is handled by the drawer's visibility:hidden, so
// this only drives the open/close classes + scroll lock.
function setupDrawer() {
	const btn = $('#hdr-menu-btn')
	const drawer = $('#hdr-drawer')
	const veil = $('#hdr-drawer-veil')
	if (!btn || !drawer || !veil)
		return

	const setOpen = (open: boolean) => {
		drawer.classList.toggle('is-open', open)
		veil.classList.toggle('is-open', open)
		btn.setAttribute('aria-expanded', String(open))
		btn.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기')
		// Lock background scroll while the drawer is open.
		document.documentElement.style.overflow = open ? 'hidden' : ''
	}

	btn.addEventListener('click', () => setOpen(!drawer.classList.contains('is-open')))
	veil.addEventListener('click', () => setOpen(false))
	window.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && drawer.classList.contains('is-open'))
			setOpen(false)
	})
}

setupDrawer()
