import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'

// SEC-system-hardening Step 5 follow-up 5 — golden E2E journeys.
//
// These run against the API-free static build (`pnpm build` with both API URLs
// pointed at a refused local port, exactly as the `check` job builds it), served
// by `astro preview`. Every request that leaves the preview origin is answered
// by e2e/fixtures.ts — `/api/*` from per-test mocks, everything else aborted —
// so a run never touches a real backend, music service, Spotify or font CDN.
//
// No retries, on purpose. The check stays non-required until repeated PR runs
// show it is stable, and a retry would turn exactly that evidence (a test that
// fails once in N) into a green row. A flake must show up as a red run.
const PORT = 4391
const CI = !!process.env.CI

export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: CI,
	retries: 0,
	workers: CI ? 2 : undefined,
	reporter: CI ? [['list'], ['github'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: `http://127.0.0.1:${PORT}`,
		// The PWA service worker would take fetches out of page.route's reach.
		serviceWorkers: 'block',
		locale: 'ko-KR',
		timezoneId: 'Asia/Seoul',
		trace: 'retain-on-failure',
	},
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
	],
	webServer: {
		command: `pnpm exec astro preview --host 127.0.0.1 --port ${PORT}`,
		url: `http://127.0.0.1:${PORT}/`,
		// Never reuse: another worktree's preview on this port would serve its
		// own branch's dist and the run would test the wrong build.
		reuseExistingServer: false,
		timeout: 60_000,
	},
})
