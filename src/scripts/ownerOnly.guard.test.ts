// FEAT-album-review-authoring Step 4 / audit E-5 — the owner gate on /write and
// /drafts.
//
// The defect these cover is not "a logged-out visitor gets in" (that half always
// worked); it is that a signed-in MEMBER did, because the check was `isLoggedIn()`
// and post multi-user every federated account passes it. So the load-bearing case
// is `logged in, not the owner` — a mutant that drops the owner check keeps the
// logged-out tests green.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
	isLoggedIn: vi.fn(),
	goLogin: vi.fn(() => Promise.resolve()),
}))
const owner = vi.hoisted(() => ({ isOwnerUser: vi.fn() }))

vi.mock('../lib/auth', () => auth)
vi.mock('../lib/owner', () => owner)

/** Import the guard fresh, on `path`, and let its top-level run settle. */
async function arriveAt(path: string) {
	const replace = vi.fn()
	vi.stubGlobal('location', { ...window.location, pathname: path, replace })
	vi.resetModules()
	await import('./ownerOnly.guard')
	// The guard awaits isOwnerUser(); flush that microtask chain.
	await Promise.resolve()
	await Promise.resolve()
	await Promise.resolve()
	return { replace }
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.unstubAllGlobals()
})

describe('the owner-only page guard', () => {
	it.each(['/write', '/drafts'])('sends a logged-out arrival at %s to login', async (path) => {
		auth.isLoggedIn.mockReturnValue(false)
		owner.isOwnerUser.mockResolvedValue(false)
		const { replace } = await arriveAt(path)
		expect(auth.goLogin).toHaveBeenCalledTimes(1)
		// Login, not a bounce home: they have no session to judge yet.
		expect(replace).not.toHaveBeenCalled()
	})

	it.each(['/write', '/drafts'])('bounces a signed-in NON-OWNER off %s', async (path) => {
		auth.isLoggedIn.mockReturnValue(true)
		owner.isOwnerUser.mockResolvedValue(false)
		const { replace } = await arriveAt(path)
		expect(replace).toHaveBeenCalledWith('/')
		// Not the login form — they ARE signed in; sending them to Cognito would
		// loop them back here with the same answer.
		expect(auth.goLogin).not.toHaveBeenCalled()
	})

	it.each(['/write', '/drafts'])('lets the owner stay on %s', async (path) => {
		auth.isLoggedIn.mockReturnValue(true)
		owner.isOwnerUser.mockResolvedValue(true)
		const { replace } = await arriveAt(path)
		expect(replace).not.toHaveBeenCalled()
		expect(auth.goLogin).not.toHaveBeenCalled()
	})

	it('fails closed when the owner probe rejects', async () => {
		auth.isLoggedIn.mockReturnValue(true)
		// isOwnerUser catches internally and yields false; this asserts the guard
		// treats "no answer" as "not the owner" rather than letting it through.
		owner.isOwnerUser.mockResolvedValue(false)
		const { replace } = await arriveAt('/write')
		expect(replace).toHaveBeenCalledWith('/')
	})

	it('leaves an unrelated page alone even for a logged-out visitor', async () => {
		auth.isLoggedIn.mockReturnValue(false)
		owner.isOwnerUser.mockResolvedValue(false)
		const { replace } = await arriveAt('/canon')
		expect(auth.goLogin).not.toHaveBeenCalled()
		expect(replace).not.toHaveBeenCalled()
		// The owner is never even asked on a page the gate does not cover.
		expect(owner.isOwnerUser).not.toHaveBeenCalled()
	})

	// One page, three spellings that all resolve in production: `trailingSlash:
	// 'always'` makes /write/ canonical, /write also resolves, and the built
	// artifact is /write/index.html. The lookup is an exact match on purpose (a
	// prefix would catch /drafts-something), so each spelling has to normalize.
	it.each(['/write/', '/write/index.html', '/drafts/index.html'])('gates %s too', async (path) => {
		auth.isLoggedIn.mockReturnValue(true)
		owner.isOwnerUser.mockResolvedValue(false)
		const { replace } = await arriveAt(path)
		expect(replace).toHaveBeenCalledWith('/')
	})

	it('does NOT gate a different page that merely starts the same', async () => {
		auth.isLoggedIn.mockReturnValue(true)
		owner.isOwnerUser.mockResolvedValue(false)
		const { replace } = await arriveAt('/drafts-archive')
		expect(replace).not.toHaveBeenCalled()
		expect(owner.isOwnerUser).not.toHaveBeenCalled()
	})

	it('re-arms on a client-side arrival, because the script only runs once', async () => {
		// The whole reason this module listens rather than just running: Astro's
		// ClientRouter skips an already-executed `src` script, so a second arrival
		// at /write would otherwise be ungated.
		auth.isLoggedIn.mockReturnValue(false)
		owner.isOwnerUser.mockResolvedValue(false)
		await arriveAt('/canon')
		expect(auth.goLogin).not.toHaveBeenCalled()

		auth.isLoggedIn.mockReturnValue(true)
		owner.isOwnerUser.mockResolvedValue(false)
		const replace = vi.fn()
		vi.stubGlobal('location', { ...window.location, pathname: '/write', replace })
		document.dispatchEvent(new Event('astro:page-load'))
		await Promise.resolve()
		await Promise.resolve()
		await Promise.resolve()
		expect(replace).toHaveBeenCalledWith('/')
	})
})
