// src/scripts/write.guard.ts — the /write login gate.
//
// FEAT-member-player Step 5b made /write a ClientRouter page, which changed when
// this module runs. Astro's `deselectScripts` marks a script already-executed by
// src, so a module script runs on the document load that first pulled it in and is
// SKIPPED on every later swap. Left alone, the gate would hold on a fresh load and
// then let a second client-side arrival at /write straight through.
//
// `data-astro-rerun` is the documented opt-out and is the wrong tool here: ANY
// attribute makes Astro treat the script as `is:inline`, dropping bundling — and
// this module imports `@lib/auth`, so it would ship as a raw `.ts` src and 404.
//
// So the module re-arms itself. `astro:page-load` fires on the initial load and
// after every swap; the path check keeps the gate scoped to /write even though the
// listener outlives the page.
import { goLogin, isLoggedIn } from '../lib/auth'

let redirecting = false

async function guard(): Promise<void> {
	if (redirecting)
		return
	// The listener survives navigation AWAY from /write — without this check,
	// a logged-out visitor leaving the editor would be bounced from an
	// unrelated page.
	if (location.pathname.replace(/\/+$/, '') !== '/write')
		return
	if (isLoggedIn())
		return
	redirecting = true
	// 로그인 후에는 항상 홈으로 이동한다(콜백 처리에서 결정).
	await goLogin(true)
}

void guard()
document.addEventListener('astro:page-load', () => {
	void guard()
})
