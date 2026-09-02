// src/scripts/header.client.ts
import { goLogin, isLoggedIn, logout } from '../lib/auth.ts'
import { openWrite } from '../lib/entityEvents.ts'

const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null

// Every lookup below is LAZY, and the click handling is delegated. Both are the
// same fix for one defect (found in a real browser during Step 4, present in
// production before it).
//
// The header roots carry transition:persist, so a Layout→Layout swap keeps the
// same DOM nodes and a cached reference stays valid — which is what the comment
// in layout.astro says and why this file used to cache them at module scope.
// But `/write` and `/drafts` use write-layout.astro, which mounts NO header. A
// ClientRouter swap into one of those documents therefore does not persist
// `#hdr-bar`; it drops it. Coming back builds FRESH header nodes, while this
// module — which only runs once per document — still held the detached ones.
//
// The result was not subtle: after one SPA round trip through the editor, a
// signed-in visitor's header reverted to **Login**, with the write entry, the
// logout button and the avatar all left carrying their server-rendered
// `hidden`, and no click handler on any of them. It never recovered, because
// every later swap re-ran syncAuthUI() against the same dead references.
//
// Verified by driving the round trip in a browser, not by reading:
//   fresh load             write visible · logout visible · avatar visible
//   after /write/ + Back   write hidden  · logout hidden  · avatar hidden · Login shown

function authEls() {
	return {
		loginBtn: $('#login-btn'),
		logoutBtn: $('#logout-btn'),
		writeLink: $('#write-link'),
		profileLink: $('#profile-link'),
		loginMenu: $('#login-menu'),
	}
}

function syncAuthUI() {
	const { loginBtn, logoutBtn, writeLink, profileLink } = authEls()
	const logged = isLoggedIn()
	if (logged) {
		loginBtn?.classList.add('hidden')
		logoutBtn?.classList.remove('hidden')
		profileLink?.classList.remove('hidden')
		profileLink?.setAttribute('href', '/members/?me')
		// FEAT-album-review-authoring Step 4 (C1): the write entry is now shown to
		// EVERY signed-in account, because every account may write a 평가. It used
		// to be owner-gated here (audit 2026-07-14) for the right reason at the
		// time — it went straight to /write, which is 평론, which members cannot
		// write. That reason moved rather than disappeared: the owner signal now
		// lives INSIDE the sheet (which offers 평론 only to the owner) and on
		// /write and /drafts themselves (scripts/ownerOnly.guard.ts, audit E-5).
		// Hiding it here as well would leave a member with no write entry at all.
		writeLink?.classList.remove('hidden')
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
// returns to the pre-login page via the shared /admin/callback (goLogin
// captures returnTo; no capture → home).
function setLoginMenu(open: boolean) {
	const { loginBtn, loginMenu } = authEls()
	if (!loginMenu || !loginBtn)
		return
	loginMenu.hidden = !open
	loginBtn.setAttribute('aria-expanded', String(open))
}

// ONE delegated handler for the whole utilities cluster. Delegation is what
// makes it survive the header being rebuilt; it also folds in the old
// outside-click dismissal, which previously relied on each element listener
// calling stopPropagation to keep the menu open — a trick that does not work
// once the listeners live on `document` themselves.
document.addEventListener('click', (e) => {
	const target = e.target instanceof Element ? e.target : null
	if (!target) {
		setLoginMenu(false)
		return
	}
	if (target.closest('#write-link')) {
		e.preventDefault()
		setLoginMenu(false)
		// The trigger and the sheet are different worlds (an Astro page script vs.
		// a React island in layout.astro), so this dispatches rather than calls.
		openWrite()
		return
	}
	if (target.closest('#logout-btn')) {
		setLoginMenu(false)
		logout()
		return
	}
	if (target.closest('#login-btn')) {
		setLoginMenu($('#login-menu')?.hidden ?? true)
		return
	}
	const opt = target.closest<HTMLElement>('.hdr-login-opt')
	if (opt) {
		const idp = opt.dataset.idp
		setLoginMenu(false)
		void goLogin(false, idp === 'Google' || idp === 'Kakao' ? idp : undefined)
		return
	}
	// A click on the menu's own chrome (the padding between options) keeps it
	// open; anything else outside dismisses it.
	if (!target.closest('#login-menu'))
		setLoginMenu(false)
})

window.addEventListener('keydown', (e) => {
	const menu = $('#login-menu') as HTMLElement & { hidden: boolean } | null
	if (e.key === 'Escape' && menu && !menu.hidden)
		setLoginMenu(false)
})

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

/**
 * Bind the element-holding setups, once per header INSTANCE.
 *
 * Same defect as the auth cluster above, different shape: these two capture
 * their elements in a closure, so after `/write` drops the header they observe
 * and listen on detached nodes. Keyed on `#hdr-bar` identity rather than run
 * unconditionally — on a normal Layout→Layout swap the node is persisted and
 * unchanged, and re-running would stack a second IntersectionObserver and a
 * second set of drawer listeners on every navigation.
 */
let boundBar: Element | null = null
function bindHeaderInstance() {
	const bar = document.querySelector('#hdr-bar')
	if (!bar || bar === boundBar)
		return
	boundBar = bar
	setupHeaderCollapse()
	setupDrawer()
}

bindHeaderInstance()

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
	// bindHeaderInstance FIRST: syncAuthUI is lazy now, but the collapse/drawer
	// setups are not, and a header rebuilt by the previous swap has to be
	// adopted before anything else reads it.
	bindHeaderInstance()
	syncAuthUI()
	syncActiveNav()
})
