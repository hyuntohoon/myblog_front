import type { Page, Request } from '@playwright/test'
import { test as base, expect } from '@playwright/test'

// The mocked boundary every golden journey runs behind.
//
// The page under test is the real static build; the network around it is not.
// Requests to the preview origin pass through. Requests anywhere else are
// answered here:
//   · `/api/*` on any host — whatever the test registered with `api.on(...)`,
//     otherwise 503. A route the test did not mock behaves like a service that
//     is down, which every surface already has to survive; it does not fail the
//     test, so a new background call added to a page does not break a journey
//     that is not about it.
//   · anything else (fonts, cover images, Spotify, analytics) — aborted.
//     (`<link rel=preconnect>` still opens a bare DNS/TLS connection to the
//     font host, which page.route cannot see; no HTTP request is sent on it.)
//
// An uncaught exception in the page fails the test at teardown. It is the one
// check every journey gets for free, and it is the regression class unit tests
// in jsdom cannot see.

export interface MockResponse {
	status?: number
	json?: unknown
}

type Responder = MockResponse | ((req: Request, url: URL) => MockResponse)

export class ApiMock {
	private readonly routes = new Map<string, Responder>()
	readonly calls: { method: string, path: string, search: URLSearchParams }[] = []

	/** Register a response for `METHOD /api/path` (exact path, query ignored). */
	on(method: string, path: string, responder: Responder): this {
		this.routes.set(`${method.toUpperCase()} ${path}`, responder)
		return this
	}

	/** Every call this test made to `path`, in order. */
	callsTo(path: string) {
		return this.calls.filter(c => c.path === path)
	}

	async install(page: Page, previewOrigin: string): Promise<void> {
		await page.route('**/*', async (route) => {
			const req = route.request()
			const url = new URL(req.url())
			if (url.origin === previewOrigin) {
				// Production (CloudFront in front of S3) answers `/search?q=…` with
				// the `/search/` page in place — 200, URL unchanged. `astro preview`
				// answers it 404 (trailingSlash: 'always'), and the header search
				// navigates to exactly that URL, so serve the directory index here
				// the way the production host does.
				if (req.isNavigationRequest() && !url.pathname.endsWith('/') && !/\.[a-z0-9]+$/i.test(url.pathname)) {
					const res = await route.fetch({ url: `${url.origin}${url.pathname}/${url.search}` })
					return route.fulfill({ response: res })
				}
				return route.continue()
			}
			if (!url.pathname.startsWith('/api/'))
				return route.abort()

			// CORS preflight — the build points the API at another origin. Not
			// recorded: `callsTo()` counts the requests the app made, not the
			// browser's preflights for them.
			if (req.method() === 'OPTIONS')
				return route.fulfill({ status: 204, headers: corsHeaders() })
			this.calls.push({ method: req.method(), path: url.pathname, search: url.searchParams })

			const responder = this.routes.get(`${req.method()} ${url.pathname}`)
			const res = typeof responder === 'function' ? responder(req, url) : responder
			return route.fulfill({
				status: res ? (res.status ?? 200) : 503,
				headers: { ...corsHeaders(), 'content-type': 'application/json' },
				body: JSON.stringify(res ? (res.json ?? {}) : { detail: 'not mocked in e2e' }),
			})
		})
	}
}

function corsHeaders(): Record<string, string> {
	return {
		'access-control-allow-origin': '*',
		'access-control-allow-headers': '*',
		'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
	}
}

export const test = base.extend<{ api: ApiMock, pageErrors: string[] }>({
	pageErrors: async ({ page }, use) => {
		const errors: string[] = []
		page.on('pageerror', e => errors.push(String(e)))
		await use(errors)
		expect(errors, 'uncaught exceptions in the page').toEqual([])
	},
	api: async ({ page, baseURL, pageErrors }, use) => {
		void pageErrors
		const api = new ApiMock()
		await api.install(page, new URL(baseURL!).origin)
		await use(api)
	},
})

export { expect }
