import { meMember, meOwner } from './data'
import { expect, test } from './fixtures'

// /write is gated client-side by src/scripts/ownerOnly.guard.ts. The preview
// runs on 127.0.0.1, which src/lib/auth.ts treats as a signed-in local session,
// so the branch under test is the signed-in one: `/api/me` decides. The guard
// fails closed — any answer other than the owner's handle must redirect.

test('the owner stays on /write', async ({ page, api }) => {
	api.on('GET', '/api/me', { json: meOwner })
	const me = page.waitForResponse(r => new URL(r.url()).pathname === '/api/me' && r.request().method() === 'GET')
	await page.goto('/write/')
	await me
	// The guard decides within microtasks of this response (json → compare →
	// location.replace). Absence of a redirect cannot be polled for, so wait out
	// the same 5 s window the negative cases below get to redirect in.
	await page.waitForTimeout(5000)
	await expect(page).toHaveURL(/\/write\/$/)
})

for (const [label, me] of [
	['a signed-in member who is not the owner', { json: meMember }],
	['/api/me failing', { status: 503, json: { detail: 'down' } }],
] as const) {
	test(`/write fails closed for ${label}`, async ({ page, api }) => {
		api.on('GET', '/api/me', me)
		await page.goto('/write/')
		await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/)
	})
}
