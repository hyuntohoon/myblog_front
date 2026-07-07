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

// ── Login popover (FEAT-multi-user social-login entry) ──
// The Login button opens a small menu instead of redirecting straight to the
// hosted UI. Each option deep-links to an IdP (data-idp → identity_provider);
// the empty one falls through to the hosted UI (email + enabled IdPs). Login
// always lands back on home via the shared /admin/callback.
const loginMenu = $('#login-menu')

function setLoginMenu(open: boolean) {
	if (!loginMenu || !loginBtn)
		return
	loginMenu.hidden = !open
	loginBtn.setAttribute('aria-expanded', String(open))
}

loginBtn?.addEventListener('click', (e) => {
	e.stopPropagation()
	setLoginMenu(loginMenu?.hidden ?? true)
})

// Clicks on the menu chrome (padding between options) must not dismiss it.
loginMenu?.addEventListener('click', e => e.stopPropagation())

loginMenu?.querySelectorAll<HTMLButtonElement>('.hdr-login-opt').forEach((opt) => {
	opt.addEventListener('click', () => {
		const idp = opt.dataset.idp
		setLoginMenu(false)
		void goLogin(false, idp === 'Google' || idp === 'Kakao' ? idp : undefined)
	})
})

// Dismiss on outside-click and Esc (the menu itself stops propagation above).
document.addEventListener('click', () => setLoginMenu(false))
window.addEventListener('keydown', (e) => {
	if (e.key === 'Escape' && loginMenu && !loginMenu.hidden)
		setLoginMenu(false)
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
let closeDrawer: (() => void) | null = null

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
	closeDrawer = () => setOpen(false)

	btn.addEventListener('click', () => setOpen(!drawer.classList.contains('is-open')))
	veil.addEventListener('click', () => setOpen(false))
	window.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && drawer.classList.contains('is-open'))
			setOpen(false)
	})
}

setupDrawer()

// ── ClientRouter fixups (FEAT-mobile-web-app Step 3) ──
// The header roots are transition:persist-ed, so everything above binds once
// and survives swaps. Two things ARE per-page: the drawer must not stay open
// (nor keep the scroll lock) across a navigation, and the nav active state
// belongs to the new URL.

// Mirror of the server-side isActive() in header.astro: path match, then the
// ?bnm=1 filter must agree so /reviews and Best New Music don't both light up.
function syncActiveNav() {
	const normalize = (p: string) => (p.endsWith('/') ? p : `${p}/`)
	const herePath = normalize(location.pathname)
	const hereBnm = location.search.includes('bnm=1')
	document.querySelectorAll<HTMLAnchorElement>('.hdr-nav-link, .hdr-drawer-link').forEach((a) => {
		const url = new URL(a.href, location.origin)
		const active = normalize(url.pathname) === herePath && url.search.includes('bnm=1') === hereBnm
		a.classList.toggle('active', active)
		// aria-current only on the masthead + drawer navs — the compact-bar nav
		// is aria-hidden and keeps its links out of the a11y tree entirely.
		if (!a.closest('[aria-hidden="true"]')) {
			if (active)
				a.setAttribute('aria-current', 'page')
			else
				a.removeAttribute('aria-current')
		}
	})
}

document.addEventListener('astro:after-swap', () => {
	closeDrawer?.()
	setLoginMenu(false)
})
document.addEventListener('astro:page-load', () => {
	syncAuthUI()
	syncActiveNav()
})
