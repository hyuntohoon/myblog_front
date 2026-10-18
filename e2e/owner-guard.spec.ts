import { meMember, meOwner } from './data'
import { expect, test } from './fixtures'

// /write is gated client-side by src/scripts/ownerOnly.guard.ts. The preview
// runs on 127.0.0.1, which src/lib/auth.ts treats as a signed-in local session,
// so the branch under test is the signed-in one: `/api/me` decides. The guard
// fails closed — any answer other than the owner's handle must redirect.

test('the owner stays on /write', async ({ page, api }) => {
	api.on('GET', '/api/me', { json: meOwner })
	await page.goto('/write/')
	await expect.poll(() => api.callsTo('/api/me').length).toBeGreaterThan(0)
	// Give a wrong redirect the same window the negative cases below need.
	await page.waitForTimeout(1500)
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
