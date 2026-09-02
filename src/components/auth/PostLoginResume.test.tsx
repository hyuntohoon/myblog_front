// FIX-auth-identity-lifecycle Step 2 — the layout-mounted consumer.
//
// The predecessor's two defects are the first two things asserted here: a resume
// that only worked on one route, and a module cache that latched "nothing to
// resume" the first time it mounted logged out.
import { act, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ loggedIn: false }))
vi.mock('@lib/auth', () => ({ isLoggedIn: () => auth.loggedIn }))

// The picker is exercised by its own suite; here only the target it is handed
// matters, and stubbing it keeps the bucket/playback graph out of this test.
vi.mock('@components/member/pocket/AddToBucketMenu', () => ({
	AddToBucketMenu: ({ item }: { item: { itemType?: string, albumId?: string, trackId?: string, title: string } }) => (
		<div data-testid="picker" data-kind={item.itemType ?? 'album'} data-id={item.albumId ?? item.trackId}>{item.title}</div>
	),
}))

const KEY = 'pb:post-login-intent'

function park(intent: unknown, capturedIdentity = 'anon') {
	localStorage.setItem(KEY, JSON.stringify({ ts: Date.now(), capturedIdentity, intent }))
}

function idToken(sub: string): string {
	return `header.${btoa(JSON.stringify({ sub }))}.signature`
}

/**
 * A fresh module graph per test. The consumer caches its drain at module scope
 * (that is what makes it StrictMode-safe), and `authIdentity` holds the live
 * identity, so both have to be the SAME fresh instances the test drives.
 */
async function load() {
	vi.resetModules()
	const identity = await import('@lib/authIdentity')
	const events = await import('@lib/entityEvents')
	const { default: PostLoginResume } = await import('./PostLoginResume')
	return { PostLoginResume, ...identity, ...events }
}

beforeEach(() => {
	localStorage.clear()
	auth.loggedIn = false
})

describe('bucket-add', () => {
	it('resumes on whatever page the callback landed on', async () => {
		park({ kind: 'bucket-add', itemType: 'album', albumId: 'album-1', trackId: null, reviewTargetId: null, title: 'Kid A' })
		auth.loggedIn = true
		const { PostLoginResume } = await load()

		render(<PostLoginResume />)

		const picker = await screen.findByTestId('picker')
		expect(picker).toHaveAttribute('data-id', 'album-1')
		expect(picker).toHaveTextContent('Kid A')
		expect(localStorage.getItem(KEY)).toBeNull()
	})

	it('survives a remount, having already emptied the slot it read from', async () => {
		park({ kind: 'bucket-add', itemType: 'track', albumId: null, trackId: 'track-9', reviewTargetId: null, title: 'Idioteque' })
		auth.loggedIn = true
		const { PostLoginResume } = await load()

		const first = render(<PostLoginResume />)
		expect(await screen.findByTestId('picker')).toHaveAttribute('data-id', 'track-9')
		first.unmount()

		// Storage is empty by now — only the module-scope cache can answer, and
		// without it a remount silently drops a resume that is mid-add.
		render(<PostLoginResume />)
		expect(await screen.findByTestId('picker')).toHaveAttribute('data-id', 'track-9')
	})

	it('is a no-op under StrictMode double rendering', async () => {
		// Kept as a fact about the harness, not a claim about the cache: React
		// discards the second render pass, so this passes either way.
		park({ kind: 'bucket-add', itemType: 'album', albumId: 'album-1', trackId: null, reviewTargetId: null, title: 'Kid A' })
		auth.loggedIn = true
		const { PostLoginResume } = await load()

		render(<StrictMode><PostLoginResume /></StrictMode>)

		expect(await screen.findByTestId('picker')).toHaveAttribute('data-id', 'album-1')
	})
})

describe('rate-album', () => {
	it('reopens the album overlay with its rating editor, and renders nothing itself', async () => {
		park({ kind: 'rate-album', albumId: 'album-1', title: 'Kid A', artist: 'Radiohead', cover: null, year: 2000 })
		auth.loggedIn = true
		const { PostLoginResume, ENT_OPEN_ALBUM } = await load()
		const seen: any[] = []
		window.addEventListener(ENT_OPEN_ALBUM, (e: Event) => seen.push((e as CustomEvent).detail))

		render(<PostLoginResume />)

		await waitFor(() => expect(seen).toHaveLength(1))
		expect(seen[0]).toMatchObject({ albumId: 'album-1', title: 'Kid A', artist: 'Radiohead', year: 2000, openRating: true })
		expect(screen.queryByTestId('picker')).toBeNull()
	})

	it('latches the open so an overlay that hydrates later still gets it', async () => {
		// The overlay is a sibling island; nothing orders its mount effect against
		// this one, so the plain event alone can land before its listener exists.
		park({ kind: 'rate-album', albumId: 'album-1', title: 'Kid A', artist: null, cover: null, year: null })
		auth.loggedIn = true
		const { PostLoginResume, consumeLatchedOpenAlbum } = await load()

		render(<PostLoginResume />)

		await waitFor(() => expect(consumeLatchedOpenAlbum()).toMatchObject({ albumId: 'album-1', openRating: true }))
		// Read + clear: a later remount must not replay it.
		expect(consumeLatchedOpenAlbum()).toBeNull()
	})
})

describe('auth lifecycle', () => {
	it('leaves the intent parked while logged out, and resumes it when the sign-in lands', async () => {
		park({ kind: 'bucket-add', itemType: 'album', albumId: 'album-1', trackId: null, reviewTargetId: null, title: 'Kid A' })
		const { PostLoginResume, syncAuthIdentity } = await load()

		render(<PostLoginResume />)
		expect(screen.queryByTestId('picker')).toBeNull()
		// Not drained — a logged-out mount must not consume it.
		expect(localStorage.getItem(KEY)).not.toBeNull()

		auth.loggedIn = true
		localStorage.setItem('id_token', idToken('sub-A'))
		act(() => {
			syncAuthIdentity()
		})

		expect(await screen.findByTestId('picker')).toHaveAttribute('data-id', 'album-1')
	})

	it('cancels a resume already on screen when the account changes under it', async () => {
		park({ kind: 'bucket-add', itemType: 'album', albumId: 'album-1', trackId: null, reviewTargetId: null, title: 'Kid A' }, 'anon')
		auth.loggedIn = true
		localStorage.setItem('id_token', idToken('sub-A'))
		const { PostLoginResume, syncAuthIdentity } = await load()

		render(<PostLoginResume />)
		expect(await screen.findByTestId('picker')).toBeInTheDocument()

		// A signs out and B signs in: A's parked add must not finish under B.
		localStorage.setItem('id_token', idToken('sub-B'))
		act(() => {
			syncAuthIdentity()
		})

		await waitFor(() => expect(screen.queryByTestId('picker')).toBeNull())
	})
})
