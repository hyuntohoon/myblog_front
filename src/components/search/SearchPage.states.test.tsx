// FIX-user-flow-state-consistency leg 3 — /search state rendering.
//
// Four defects are pinned here, all of them invisible to lint, astro check and
// the existing unit suite because each one is a *rendered* consequence of state
// the page was computing and then dropping:
//   · a failed unified search rendered as 일치하는 결과가 없습니다 + 철자를
//     확인하세요, blaming the reader's spelling for a request that never landed;
//   · a failed 평론 index blanked that facet with no explanation;
//   · `hasMore` / `loadMore` were exposed by the hook and never wired, so every
//     bucket silently stopped at one page;
//   · the result summary carried no live-region semantics, so a screen-reader
//     user got silence on every search — /search never navigates and the heading
//     is just the query they typed back at them.
import type { ArtistHit, UseMusicSearch } from '@lib/useMusicSearch'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SearchPage from './SearchPage'

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

const ARTIST: ArtistHit = {
	kind: 'artist',
	id: 'artist-1',
	name: 'Miles Davis',
	cover: null,
	spotifyId: null,
	source: 'db',
}

function baseState(over: Partial<UseMusicSearch> = {}): UseMusicSearch {
	return {
		query: 'blue',
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

beforeEach(() => {
	window.history.replaceState(null, '', '/search?q=blue')
	idx.loadReviews.mockReset().mockResolvedValue([])
	idx.filterReviews.mockReset().mockReturnValue([])
	searchState = baseState()
})

afterEach(() => {
	vi.useRealTimers()
})

describe('/search remote-failure states', () => {
	it('says the request failed instead of blaming the query', async () => {
		searchState = baseState({ searchFailed: true })
		render(<SearchPage />)

		await screen.findByText('검색 결과를 불러오지 못했습니다.')
		expect(screen.queryByText(/철자를 확인하거나 더 짧은 키워드/)).toBeNull()
		expect(screen.getByRole('status').textContent).toContain('검색을 불러오지 못했습니다')
	})

	it('retries the search from the failure state', async () => {
		searchState = baseState({ searchFailed: true })
		render(<SearchPage />)

		fireEvent.click(await screen.findByRole('button', { name: '다시 시도' }))
		expect(searchState.runDbSearch).toHaveBeenCalled()
	})

	it('keeps a real zero-result answer on the no-results copy', async () => {
		render(<SearchPage />)

		await screen.findByText('일치하는 결과가 없습니다.')
		expect(screen.queryByText('검색 결과를 불러오지 못했습니다.')).toBeNull()
	})

	it('degrades the 평론 facet with a reason when its index fails', async () => {
		idx.loadReviews.mockRejectedValue(new Error('HTTP 503'))
		searchState = baseState({ artists: [ARTIST] })
		render(<SearchPage />)

		await waitFor(() => {
			expect(document.querySelector('.gs-idxwarn')?.textContent).toContain('평론 검색 목록을 불러오지 못해')
		})
		// the DB half of the page is untouched — this degrades, it does not blank
		screen.getByRole('heading', { name: 'Miles Davis' })
	})
})

describe('/search pagination', () => {
	it('offers 더 보기 for a bucket with another page and asks for that bucket', async () => {
		searchState = baseState({ artists: [ARTIST], hasMore: { album: 0, artist: 1, track: 0 } })
		render(<SearchPage />)

		fireEvent.click(await screen.findByRole('button', { name: '아티스트 더 보기' }))
		expect(searchState.loadMore).toHaveBeenCalledWith('artist')
	})

	it('shows no 더 보기 when the bucket is exhausted', async () => {
		searchState = baseState({ artists: [ARTIST] })
		render(<SearchPage />)

		await screen.findByRole('heading', { name: 'Miles Davis' })
		expect(screen.queryByRole('button', { name: '아티스트 더 보기' })).toBeNull()
	})

	it('keeps the rows already on screen when a page fails, and offers a retry', async () => {
		searchState = baseState({
			artists: [ARTIST],
			hasMore: { album: 0, artist: 1, track: 0 },
			moreFailed: 'artist',
		})
		render(<SearchPage />)

		await screen.findByText('더 불러오지 못했습니다.')
		screen.getByRole('heading', { name: 'Miles Davis' })
		expect(screen.queryByRole('button', { name: '아티스트 더 보기' })).toBeNull()

		fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
		expect(searchState.loadMore).toHaveBeenCalledWith('artist')
	})
})

describe('/search result announcement', () => {
	it('announces the result summary from a region that predates the results', async () => {
		window.history.replaceState(null, '', '/search')
		searchState = baseState({ query: '' })
		const { rerender } = render(<SearchPage />)

		const region = screen.getByRole('status')
		expect(region).toHaveAttribute('aria-live', 'polite')
		expect(region.textContent).toContain('한 곳에서')

		// arrive at a query the way a back/forward navigation does, so the test
		// does not depend on the type-debounce
		window.history.replaceState(null, '', '/search?q=blue')
		act(() => {
			window.dispatchEvent(new PopStateEvent('popstate'))
		})
		searchState = baseState({ artists: [ARTIST] })
		rerender(<SearchPage />)
		// settle the review-index promise the new query kicked off, so the
		// assertion runs against a flushed tree rather than racing it
		await act(async () => {})

		// Same node, new text. Both halves matter: the region must already have
		// been mounted while the page was still empty (a region inserted together
		// with its content announces nothing), and the update has to land as a
		// text change inside it rather than as a replacement element.
		expect(screen.getByRole('status')).toBe(region)
		expect(region.textContent).toContain('총 1건')
	})
})

describe('/search filter pills', () => {
	it('exposes toggles rather than a tablist it does not implement', async () => {
		searchState = baseState({ artists: [ARTIST] })
		render(<SearchPage />)

		await screen.findByRole('heading', { name: 'Miles Davis' })
		expect(screen.queryAllByRole('tab')).toHaveLength(0)
		expect(document.querySelector('[role="tablist"]')).toBeNull()

		const all = screen.getByRole('button', { name: /전체/ })
		expect(all).toHaveAttribute('aria-pressed', 'true')
		fireEvent.click(screen.getByRole('button', { name: /아티스트/ }))
		expect(screen.getByRole('button', { name: /아티스트/ })).toHaveAttribute('aria-pressed', 'true')
		expect(screen.getByRole('button', { name: /전체/ })).toHaveAttribute('aria-pressed', 'false')
	})
})

describe('/search query history', () => {
	it('preserves the query you arrived with and refines the rest in place', async () => {
		vi.useFakeTimers()
		window.history.replaceState(null, '', '/search')
		searchState = baseState({ query: '' })
		const push = vi.spyOn(window.history, 'pushState')
		const replace = vi.spyOn(window.history, 'replaceState')
		render(<SearchPage />)

		const input = screen.getByLabelText('검색')
		const type = async (value: string) => {
			fireEvent.change(input, { target: { value } })
			act(() => {
				vi.advanceTimersByTime(200)
			})
			await act(async () => {})
		}

		// first edit after arriving: a NEW entry, so Back still reaches the empty
		// /search the reader came from
		await type('blue')
		expect(push).toHaveBeenCalledTimes(1)
		expect(push).toHaveBeenLastCalledWith(null, '', '/search?q=blue')

		// refinements of the same burst stay on that one entry
		await type('blues')
		await type('blues note')
		expect(push).toHaveBeenCalledTimes(1)
		expect(replace).toHaveBeenLastCalledWith(null, '', '/search?q=blues%20note')

		// an explicit submit does not duplicate the entry it is already on…
		fireEvent.keyDown(input, { key: 'Enter' })
		await act(async () => {})
		expect(push).toHaveBeenCalledTimes(1)

		// …but it does make that entry an arrival, so the next edit opens a new one
		await type('coltrane')
		expect(push).toHaveBeenCalledTimes(2)
		expect(push).toHaveBeenLastCalledWith(null, '', '/search?q=coltrane')

		push.mockRestore()
		replace.mockRestore()
	})

	it('treats a back/forward landing as an arrival too', async () => {
		vi.useFakeTimers()
		window.history.replaceState(null, '', '/search?q=miles')
		searchState = baseState()
		render(<SearchPage />)

		const input = screen.getByLabelText('검색')
		fireEvent.change(input, { target: { value: 'miles davis' } })
		act(() => {
			vi.advanceTimersByTime(200)
		})
		await act(async () => {})

		const push = vi.spyOn(window.history, 'pushState')
		// land on an earlier entry the way Back does
		window.history.replaceState(null, '', '/search?q=miles')
		act(() => {
			window.dispatchEvent(new PopStateEvent('popstate'))
		})
		await act(async () => {})

		// editing from there must not overwrite the entry we just came back to
		fireEvent.change(input, { target: { value: 'monk' } })
		act(() => {
			vi.advanceTimersByTime(200)
		})
		await act(async () => {})
		expect(push).toHaveBeenCalledWith(null, '', '/search?q=monk')

		push.mockRestore()
	})
})
