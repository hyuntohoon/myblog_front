// Regression cover for the entrance audit (2026-08-02): the empty-state links
// that send a user to their own board must keep the "whose profile" param.
// A bare `?tab=bucket` drops it and lands on the member directory.
import { beforeEach, describe, expect, it } from 'vitest'
import { boardTabHref, dashboardTabHref } from './dashboardLinks'

function at(href: string) {
	window.history.replaceState({}, '', href)
}

describe('boardTabHref', () => {
	beforeEach(() => at('/members/?u=user-a4f83dcc'))

	it('keeps ?u= so the profile still resolves', () => {
		expect(boardTabHref()).toBe('/members/?u=user-a4f83dcc&tab=bucket')
	})

	it('never returns a bare relative query (which would drop ?u=)', () => {
		expect(boardTabHref().startsWith('?')).toBe(false)
	})

	it('replaces an existing tab rather than appending a second one', () => {
		at('/members/?u=me&tab=reviews')
		expect(boardTabHref()).toBe('/members/?u=me&tab=bucket')
	})

	it('keeps ?me when that is how the page was addressed', () => {
		at('/members/?me')
		expect(boardTabHref()).toBe('/members/?me=&tab=bucket')
	})

	it('drops the hash so the board is not scrolled to a stale anchor', () => {
		at('/members/?u=me#lyrics')
		expect(boardTabHref()).toBe('/members/?u=me&tab=bucket')
	})
})

describe('dashboardTabHref', () => {
	it('works for other dashboard tabs too', () => {
		at('/members/?u=me')
		expect(dashboardTabHref('integration')).toBe('/members/?u=me&tab=integration')
	})
})
