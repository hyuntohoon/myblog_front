// FIX-user-flow-state-consistency leg 3 — the header dropdown's non-result states.
//
// The dropdown branched on `total === 0` alone. That single condition covered
// three different situations and told the reader the same thing about all of
// them: "‘q’ 검색 결과 없음 — 철자를 확인하거나 다른 키워드로 시도해 보세요".
// So every search showed a false negative for the length of its round trip, and
// a dead search backend was indistinguishable from a typo. `s.loading` and
// `s.searchFailed` were both available on the hook and neither was read.
import type { UseMusicSearch } from '@lib/useMusicSearch'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HeaderSearch from './HeaderSearch'

const idx = vi.hoisted(() => ({ loadReviews: vi.fn(), filterReviews: vi.fn() }))

vi.mock('@lib/reviewIndex', () => ({
	loadReviews: idx.loadReviews,
	filterReviews: idx.filterReviews,
}))

let searchState: UseMusicSearch

vi.mock('@lib/useMusicSearch', async importOriginal => ({
	...await importOriginal<typeof import('@lib/useMusicSearch')>(),
	useMusicSearch: () => searchState,
}))

function baseState(over: Partial<UseMusicSearch> = {}): UseMusicSearch {
	return {
		query: '',
		setQuery: vi.fn(),
		albums: [],
		artists: [],
		tracks: [],
		loading: false,
		loadingMore: null,
		status: '',
		searchFailed: false,
		moreFailed: null,
		syncRequested: false,
		source: 'db',
		setSource: vi.fn(),
		spotifyCooldown: false,
		hasMore: { album: 0, artist: 0, track: 0 },
		runDbSearch: vi.fn().mockResolvedValue(undefined),
		runSpotifySync: vi.fn().mockResolvedValue(undefined),
		loadMore: vi.fn().mockResolvedValue(undefined),
		reset: vi.fn(),
		...over,
	}
}

/** Type into the header field, which is also what opens the dropdown. */
function typeQuery(value = 'blue') {
	fireEvent.change(screen.getByLabelText('검색'), { target: { value } })
}

beforeEach(() => {
	// the dropdown is deliberately suppressed on /search itself (the page has its
	// own field), so these cases run from an ordinary page
	window.history.replaceState(null, '', '/')
	idx.loadReviews.mockReset().mockResolvedValue([])
	idx.filterReviews.mockReset().mockReturnValue([])
	searchState = baseState()
})

afterEach(() => {
	vi.useRealTimers()
})

describe('header search dropdown non-result states', () => {
	it('says it is searching rather than reporting no results mid-flight', () => {
		searchState = baseState({ loading: true })
		render(<HeaderSearch />)
		typeQuery()

		screen.getByText('검색 중…')
		expect(screen.queryByText(/검색 결과 없음/)).toBeNull()
		expect(screen.queryByText(/철자를 확인하거나/)).toBeNull()
	})

	it('says the request failed rather than reporting no results', () => {
		searchState = baseState({ searchFailed: true })
		render(<HeaderSearch />)
		typeQuery()

		screen.getByText('검색을 불러오지 못했습니다')
		screen.getByText(/서버 또는 네트워크 문제입니다/)
		expect(screen.queryByText(/검색 결과 없음/)).toBeNull()
	})

	it('still reports a genuine empty answer as no results', () => {
		render(<HeaderSearch />)
		typeQuery()

		screen.getByText(/검색 결과 없음/)
		screen.getByText(/철자를 확인하거나/)
	})
})
