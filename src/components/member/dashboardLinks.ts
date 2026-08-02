// Links that point back into the signed-in user's own dashboard tab.
//
// The dashboard tabs are URL-driven (?tab=<id>, see MemberProfile.initialTab),
// but the tab param alone is NOT a complete address: /members/ only mounts a
// profile when it also knows WHOSE profile (?u=<handle> or ?me). A bare
// `href="?tab=bucket"` is a relative-query href, so the browser replaces the
// entire query string — dropping ?u= and landing on the member DIRECTORY
// instead of the board. That is not theoretical: both of Step 2's empty-state
// links shipped that way and dead-ended in prod (entrance audit 2026-08-02),
// which meant every in-product path from "you have nothing yet" to "here is
// your pile" was broken for exactly the user the copy was written for.
//
// So: preserve the current query and only set `tab`. The fallback is the
// literal self address used elsewhere (/buckets → buckets.astro, PocketTray),
// never the bare relative form.
const SELF_BOARD_HREF = '/members/?me&tab=bucket'

export function dashboardTabHref(tab: string): string {
	try {
		const url = new URL(window.location.href)
		url.searchParams.set('tab', tab)
		url.hash = ''
		return `${url.pathname}${url.search}`
	}
	catch {
		return `/members/?me&tab=${encodeURIComponent(tab)}`
	}
}

/** The 버킷 board tab of whichever profile is currently open (self by construction). */
export function boardTabHref(): string {
	try {
		return dashboardTabHref('bucket')
	}
	catch {
		return SELF_BOARD_HREF
	}
}
