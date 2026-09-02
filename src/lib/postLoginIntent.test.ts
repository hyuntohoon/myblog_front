// FIX-auth-identity-lifecycle Step 2 — the three gates on a parked intent (TTL,
// account, tag), single-drain, and the one-deploy legacy read.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetAuthIdentity } from '@lib/authIdentity'
import {
	drainPostLoginIntent,
	LEGACY_POCKET_INTENT_KEY,
	POST_LOGIN_INTENT_KEY,
	writePostLoginIntent,
} from './postLoginIntent'

/** A minimally well-formed id_token: only the `sub` claim is ever read. */
function idToken(sub: string): string {
	return `header.${btoa(JSON.stringify({ sub }))}.signature`
}

function signIn(sub: string) {
	localStorage.setItem('id_token', idToken(sub))
	localStorage.setItem('access_token', 'access')
	__resetAuthIdentity()
}

function signOut() {
	localStorage.removeItem('id_token')
	localStorage.removeItem('access_token')
	__resetAuthIdentity()
}

/** Plant a stored intent directly, so capture identity and age are controllable. */
function plant(stored: unknown, key = POST_LOGIN_INTENT_KEY) {
	localStorage.setItem(key, JSON.stringify(stored))
}

const BUCKET_ADD = {
	kind: 'bucket-add',
	itemType: 'album',
	albumId: 'album-1',
	trackId: null,
	reviewTargetId: null,
	title: 'Kid A',
}

beforeEach(() => {
	localStorage.clear()
	// The owning-tab id lives here; clearing it makes each test its own tab.
	sessionStorage.clear()
	signOut()
	vi.useRealTimers()
})

/** Read the id this "tab" stamped onto the record it just parked. */
function parkedTabId(): string | null {
	const raw = localStorage.getItem(POST_LOGIN_INTENT_KEY)
	return raw ? (JSON.parse(raw) as { tabId: string | null }).tabId : null
}

describe('round trip', () => {
	it('parks and resumes a bucket add, emptying the slot as it reads', () => {
		writePostLoginIntent({ kind: 'bucket-add', itemType: 'album', albumId: 'album-1', title: 'Kid A' })
		expect(localStorage.getItem(POST_LOGIN_INTENT_KEY)).not.toBeNull()

		expect(drainPostLoginIntent()).toEqual(BUCKET_ADD)
		expect(localStorage.getItem(POST_LOGIN_INTENT_KEY)).toBeNull()
		// Single-drain: a remount, a reload or a second visit gets nothing.
		expect(drainPostLoginIntent()).toBeNull()
	})

	it('keeps each bucket-add kind on its own target id', () => {
		writePostLoginIntent({ kind: 'bucket-add', itemType: 'track', trackId: 'track-9', title: 'Idioteque' })
		expect(drainPostLoginIntent()).toMatchObject({ itemType: 'track', trackId: 'track-9', albumId: null, reviewTargetId: null })

		writePostLoginIntent({ kind: 'bucket-add', itemType: 'review', reviewTargetId: 'post-3', title: '평론' })
		expect(drainPostLoginIntent()).toMatchObject({ itemType: 'review', reviewTargetId: 'post-3', albumId: null, trackId: null })
	})

	it('parks a rate-album with its display identity, defaulting the optional half to null', () => {
		writePostLoginIntent({ kind: 'rate-album', albumId: 'album-1', title: 'Kid A', artist: 'Radiohead', year: 2000 })
		expect(drainPostLoginIntent()).toEqual({
			kind: 'rate-album',
			albumId: 'album-1',
			title: 'Kid A',
			artist: 'Radiohead',
			cover: null,
			year: 2000,
		})
	})
})

describe('tTL gate', () => {
	it('drops an intent older than 30 minutes and clears the slot', () => {
		plant({ ts: Date.now() - 31 * 60 * 1000, capturedIdentity: 'anon', intent: BUCKET_ADD })
		expect(drainPostLoginIntent()).toBeNull()
		expect(localStorage.getItem(POST_LOGIN_INTENT_KEY)).toBeNull()
	})

	it('resumes one that is still inside it', () => {
		plant({ ts: Date.now() - 29 * 60 * 1000, capturedIdentity: 'anon', intent: BUCKET_ADD })
		expect(drainPostLoginIntent()).toEqual(BUCKET_ADD)
	})
})

describe('account gate', () => {
	it('lets any sign-in resume an anonymous capture', () => {
		plant({ ts: Date.now(), capturedIdentity: 'anon', intent: BUCKET_ADD })
		signIn('sub-B')
		expect(drainPostLoginIntent()).toEqual(BUCKET_ADD)
	})

	it('resumes a capture made under A when A is the one who signed in', () => {
		signIn('sub-A')
		writePostLoginIntent({ kind: 'bucket-add', itemType: 'album', albumId: 'album-1', title: 'Kid A' })
		expect(drainPostLoginIntent()).toEqual(BUCKET_ADD)
	})

	it('drops a capture made under A once B is the one signed in', () => {
		// An expired access token with A's id_token still in storage is exactly
		// how a capture ends up naming a real account (isLoggedIn() is false
		// while getAuthIdentity() still says A).
		signIn('sub-A')
		localStorage.removeItem('access_token')
		writePostLoginIntent({ kind: 'bucket-add', itemType: 'album', albumId: 'album-1', title: 'Kid A' })

		signIn('sub-B')
		expect(drainPostLoginIntent()).toBeNull()
		expect(localStorage.getItem(POST_LOGIN_INTENT_KEY)).toBeNull()
	})
})

describe('tag and shape gates', () => {
	it('drops an unknown kind instead of guessing at it', () => {
		// Deliberately bucket-add-SHAPED. A fixture missing `itemType` proves
		// nothing: the shape checks would reject it whether or not the tag is
		// read at all, and this assertion is about the tag. RFC Step 2 says an
		// unsupported intent drops without replay — a future kind that happens to
		// carry a target id must not be filed into a bucket by accident.
		plant({ ts: Date.now(), capturedIdentity: 'anon', intent: { kind: 'spotify-sync', itemType: 'album', albumId: 'album-1', title: 'Kid A' } })
		expect(drainPostLoginIntent()).toBeNull()
	})

	it('drops a bucket-add whose target id is missing', () => {
		plant({ ts: Date.now(), capturedIdentity: 'anon', intent: { ...BUCKET_ADD, albumId: null } })
		expect(drainPostLoginIntent()).toBeNull()
	})

	it('drops a rate-album with no album id', () => {
		plant({ ts: Date.now(), capturedIdentity: 'anon', intent: { kind: 'rate-album', title: 'Kid A' } })
		expect(drainPostLoginIntent()).toBeNull()
	})

	it('drops a corrupt blob and clears it, so it cannot wedge the slot', () => {
		localStorage.setItem(POST_LOGIN_INTENT_KEY, '{not json')
		expect(drainPostLoginIntent()).toBeNull()
		expect(localStorage.getItem(POST_LOGIN_INTENT_KEY)).toBeNull()
	})
})

describe('legacy pb:resume blob', () => {
	it('resumes one parked by the previous bundle, and clears both keys', () => {
		plant({ ts: Date.now(), itemType: 'track', albumId: null, trackId: 'track-9', reviewTargetId: null, title: 'Idioteque' }, LEGACY_POCKET_INTENT_KEY)
		expect(drainPostLoginIntent()).toMatchObject({ kind: 'bucket-add', itemType: 'track', trackId: 'track-9' })
		expect(localStorage.getItem(LEGACY_POCKET_INTENT_KEY)).toBeNull()
		expect(localStorage.getItem(POST_LOGIN_INTENT_KEY)).toBeNull()
	})

	it('ignores the bucketId it carried rather than choking on it', () => {
		// Legacy blobs still have the field. Nothing ever read it, and the new
		// shape drops it — an old blob must still resume, not fail to parse.
		plant({ ts: Date.now(), itemType: 'album', albumId: 'album-1', title: 'Kid A', bucketId: 'b-1' }, LEGACY_POCKET_INTENT_KEY)
		expect(drainPostLoginIntent()).toEqual({
			kind: 'bucket-add',
			itemType: 'album',
			albumId: 'album-1',
			trackId: null,
			reviewTargetId: null,
			title: 'Kid A',
		})
	})

	it('treats a pre-Step-6 blob with no itemType as the album add it was', () => {
		plant({ ts: Date.now(), albumId: 'album-1', title: 'Kid A' }, LEGACY_POCKET_INTENT_KEY)
		expect(drainPostLoginIntent()).toMatchObject({ kind: 'bucket-add', itemType: 'album', albumId: 'album-1' })
	})

	it('honours its TTL rather than replaying an ancient one', () => {
		plant({ ts: Date.now() - 31 * 60 * 1000, albumId: 'album-1', title: 'Kid A' }, LEGACY_POCKET_INTENT_KEY)
		expect(drainPostLoginIntent()).toBeNull()
	})

	it('loses to a current-format intent, and is cleared in the same drain', () => {
		plant({ ts: Date.now(), capturedIdentity: 'anon', intent: BUCKET_ADD })
		plant({ ts: Date.now(), albumId: 'stale-album', title: 'stale' }, LEGACY_POCKET_INTENT_KEY)
		expect(drainPostLoginIntent()).toEqual(BUCKET_ADD)
		expect(localStorage.getItem(LEGACY_POCKET_INTENT_KEY)).toBeNull()
	})
})

// FIX-auth-identity-lifecycle Step 3 — found in production, not in a unit test.
// The consumer is mounted in the layout, so it runs in every open tab, and the
// intent lives in localStorage, which every tab shares. Signing in raced: the
// already-hydrated tab drained the intent before the tab returning from Cognito
// had parsed its new document, so the picker opened on a page the visitor was
// not looking at and the page they WERE looking at showed nothing.
describe('owning tab', () => {
	it('stamps the parking tab onto the record', () => {
		writePostLoginIntent({ kind: 'bucket-add', itemType: 'album', albumId: 'album-1', title: 'Kid A' })
		expect(parkedTabId()).toEqual(expect.any(String))
	})

	it('leaves another tab\'s live intent parked instead of consuming it', () => {
		plant({ ts: Date.now(), capturedIdentity: 'anon', tabId: 'some-other-tab', intent: BUCKET_ADD })
		expect(drainPostLoginIntent()).toBeNull()
		// The point of the whole gate: the owner must still find it.
		expect(localStorage.getItem(POST_LOGIN_INTENT_KEY)).not.toBeNull()
	})

	it('hands it back to the tab that parked it', () => {
		writePostLoginIntent({ kind: 'bucket-add', itemType: 'album', albumId: 'album-1', title: 'Kid A' })
		const mine = parkedTabId()
		expect(mine).not.toBeNull()
		// A sibling tab looks first and must not take it.
		const sibling = sessionStorage.getItem('pb:intent-tab')
		sessionStorage.setItem('pb:intent-tab', 'sibling-tab')
		expect(drainPostLoginIntent()).toBeNull()
		// Back in the owning tab, the round trip completes.
		sessionStorage.setItem('pb:intent-tab', sibling!)
		expect(drainPostLoginIntent()).toEqual(BUCKET_ADD)
		expect(localStorage.getItem(POST_LOGIN_INTENT_KEY)).toBeNull()
	})

	it('clears another tab\'s record once it is past the TTL, so it cannot linger', () => {
		plant({ ts: Date.now() - 31 * 60 * 1000, capturedIdentity: 'anon', tabId: 'some-other-tab', intent: BUCKET_ADD })
		expect(drainPostLoginIntent()).toBeNull()
		expect(localStorage.getItem(POST_LOGIN_INTENT_KEY)).toBeNull()
	})

	it('still resumes a record that names no tab, in any tab', () => {
		// Both the legacy blob and a capture made with sessionStorage unavailable
		// land here. Degrading to the previous behaviour beats dropping the resume.
		plant({ ts: Date.now(), capturedIdentity: 'anon', tabId: null, intent: BUCKET_ADD })
		sessionStorage.setItem('pb:intent-tab', 'a-tab-that-did-not-park-it')
		expect(drainPostLoginIntent()).toEqual(BUCKET_ADD)
	})

	it('leaves the legacy blob alone while another tab\'s live record is waiting', () => {
		plant({ ts: Date.now(), capturedIdentity: 'anon', tabId: 'some-other-tab', intent: BUCKET_ADD })
		plant({ ts: Date.now(), albumId: 'album-1', title: 'Kid A' }, LEGACY_POCKET_INTENT_KEY)
		expect(drainPostLoginIntent()).toBeNull()
		expect(localStorage.getItem(LEGACY_POCKET_INTENT_KEY)).not.toBeNull()
	})
})
