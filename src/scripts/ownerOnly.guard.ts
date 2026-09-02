// src/scripts/ownerOnly.guard.ts — the client gate on the owner-only authoring
// pages (/write, /drafts).
//
// FEAT-album-review-authoring Step 4 / audit E-5. Both pages used to check only
// `isLoggedIn()`. That was true of `/write` before multi-user, and false after
// it: post FEAT-multi-user-accounts any federated member is "logged in", so the
// login check admitted every member to the editor. The write is not exposed —
// `POST/PUT/DELETE/PATCH /api/posts*` are `require_owner` (draft creation is
// `require_owner_or_draft_agent`) and fail closed — but the CLIENT SURFACE was,
// and C1's "쓸 수 없는 항목을 보여주지 않는다" cannot hold while a member can reach
// the editor by typing the URL. The header has hidden its 글쓰기 entry behind
// `isOwnerUser()` since the 2026-07-14 surface audit; these two pages are what
// that audit did not reach.
//
// ONE module for BOTH pages on purpose. This is the duplicated-guard shape
// CLAUDE.md names as a recurring bug class: `/drafts` grew its own copy of the
// login check and did not grow the owner check when `/write`'s siblings did.
// A second file would have re-created the divergence it is here to remove.
//
// Fail closed, matching `isOwnerUser()` and the server: an unresolved or failed
// `/api/me` reads as "not the owner" and redirects. The cost is that a network
// blip bounces the owner out of the editor; the alternative is a guard that
// opens on error, which is the thing this file exists to stop.
//
// -- carried from the predecessor (write.guard.ts), still load-bearing --
// FEAT-member-player Step 5b made /write a ClientRouter page, which changed when
// this module runs. Astro's `deselectScripts` marks a script already-executed by
// src, so a module script runs on the document load that first pulled it in and is
// SKIPPED on every later swap. Left alone, the gate would hold on a fresh load and
// then let a second client-side arrival straight through.
//
// `data-astro-rerun` is the documented opt-out and is the wrong tool here: ANY
// attribute makes Astro treat the script as `is:inline`, dropping bundling — and
// this module imports `@lib/auth`, so it would ship as a raw `.ts` src and 404.
//
// So the module re-arms itself. `astro:page-load` fires on the initial load and
// after every swap; the path check keeps the gate scoped even though the
// listener outlives the page. Because BOTH pages ship the same `src`, whichever
// one is reached first loads it and the listener then covers the other.
import { goLogin, isLoggedIn } from '../lib/auth'
import { isOwnerUser } from '../lib/owner'

/**
 * The owner-only pages, and whether a logged-out arrival forces a fresh Cognito
 * form (`prompt=login`).
 *
 * The two values differ because the two pages already differed, and this module
 * is a consolidation rather than a behaviour change: `/write` has forced the
 * form since its guard was written, `/drafts` has not. Either is defensible —
 * `goLogin` captures the current path as `returnTo` in both cases (the
 * predecessor's "로그인 후에는 항상 홈으로" comment predates that and was already
 * wrong when this file inherited it).
 */
const OWNER_ONLY: Record<string, { forceLoginForm: boolean }> = {
	'/write': { forceLoginForm: true },
	'/drafts': { forceLoginForm: false },
}

/** Where a signed-in non-owner goes. Not the login form — they ARE signed in. */
const NOT_OWNER_FALLBACK = '/'

let redirecting = false

function currentRule(): { forceLoginForm: boolean } | null {
	// One page, several spellings. `trailingSlash: 'always'` + `build.format:
	// 'directory'` makes `/write/` canonical, but `/write` also resolves in
	// production and the built artifact is `/write/index.html` — an exact-match
	// lookup on the raw pathname would no-op on two of the three. The lookup is
	// exact BY DESIGN (a prefix match would gate `/drafts-something`), so the
	// normalization happens here instead.
	const path = location.pathname
		.replace(/\/index\.html?$/i, '')
		.replace(/\/+$/, '') || '/'
	return OWNER_ONLY[path] ?? null
}

async function guard(): Promise<void> {
	if (redirecting)
		return
	// The listener survives navigation AWAY from these pages — without this
	// check, a visitor leaving the editor would be bounced from an unrelated one.
	const rule = currentRule()
	if (!rule)
		return

	if (!isLoggedIn()) {
		redirecting = true
		await goLogin(rule.forceLoginForm)
		return
	}

	// Signed in — but any member is. `isOwnerUser()` is the same cached
	// getMe()→OWNER_HANDLE signal the header gates its 글쓰기 entry on, so a
	// member arriving here by SPA navigation already has the answer and never
	// sees the page. A cold direct load pays one /api/me round trip, during
	// which the editor island is already painting; the redirect below is what
	// ends that, and the server is the boundary either way.
	const owner = await isOwnerUser()
	if (owner)
		return
	// Re-check: the await above is a network round trip, and the visitor may
	// have navigated away inside it.
	if (currentRule() == null || redirecting)
		return
	redirecting = true
	location.replace(NOT_OWNER_FALLBACK)
}

void guard()
document.addEventListener('astro:page-load', () => {
	void guard()
})
