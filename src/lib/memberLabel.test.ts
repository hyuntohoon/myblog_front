import { describe, expect, it } from 'vitest'
import { ANON_MEMBER_LABEL, isPlaceholderIdentity, publicMemberLabel } from './member'

// Audit E-2: /collection/ bylined a public shelf `@user-0468fd3c` — the owner's
// Cognito sub prefix — because the backend seeds `display_name` with the
// sub-derived handle when the IdP supplies no name claim. These pin the shape
// that distinguishes "never set a name" from a real one.
describe('isPlaceholderIdentity', () => {
	it('treats an absent display name as a placeholder', () => {
		expect(isPlaceholderIdentity(null, 'user-0468fd3c')).toBe(true)
		expect(isPlaceholderIdentity(undefined, 'buckit')).toBe(true)
		expect(isPlaceholderIdentity('', 'buckit')).toBe(true)
	})

	it('treats the sub-derived default (name === handle) as a placeholder', () => {
		expect(isPlaceholderIdentity('user-0468fd3c', 'user-0468fd3c')).toBe(true)
	})

	it('keeps a real name, including one that happens to equal a chosen handle', () => {
		expect(isPlaceholderIdentity('현토훈', 'user-0468fd3c')).toBe(false)
		// `buckit` is an email-derived handle, not the `user-<8 hex>` fallback —
		// a member who set both to the same string still has a real name.
		expect(isPlaceholderIdentity('buckit', 'buckit')).toBe(false)
	})

	it('does not mistake a member-chosen handle for the generated fallback', () => {
		expect(isPlaceholderIdentity('user-abc', 'user-abc')).toBe(false)
		expect(isPlaceholderIdentity('user-0468FD3C', 'user-0468FD3C')).toBe(false)
		expect(isPlaceholderIdentity('user-0468fd3c9', 'user-0468fd3c9')).toBe(false)
	})
})

describe('publicMemberLabel', () => {
	it('never emits the sub fragment on an unauthenticated surface', () => {
		expect(publicMemberLabel(null, 'user-0468fd3c')).toBe(ANON_MEMBER_LABEL)
		expect(publicMemberLabel('user-0468fd3c', 'user-0468fd3c')).toBe(ANON_MEMBER_LABEL)
		expect(publicMemberLabel(null, 'user-0468fd3c')).not.toContain('0468fd3c')
	})

	it('renders a real display name unchanged', () => {
		expect(publicMemberLabel('현토훈', 'user-0468fd3c')).toBe('현토훈')
	})
})
