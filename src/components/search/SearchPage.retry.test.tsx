// FIX-user-flow-state-consistency leg 3 — the retry path, against the REAL
// search core.
//
// This file deliberately does not mock `useMusicSearch`. The sibling
// SearchPage.states test does, which is right for pinning what each state
// renders — but it cannot see this defect, and did not: a mocked hook made
// `expect(runDbSearch).toHaveBeenCalled()` pass while the retry produced
// nothing on screen. The first cut of retryAll() called runDbSearch() directly
// *and* bumped the tick that re-runs the effect calling the core's setQuery;
// setQuery invalidates the search sequence and aborts the in-flight request, so
// the retry cancelled itself and settled on 일치하는 결과 없음. Only a real core
// with a real (stubbed) wire shows that, which is how the browser found it.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SearchPage from './SearchPage'

const idx = vi.hoisted(() => ({ loadReviews: vi.fn(), filterReviews: vi.fn() }))

vi.mock('@lib/reviewIndex', () => ({
	loadReviews: idx.loadReviews,
	filterReviews: idx.filterReviews,
}))

const ARTISTS = [{ id: 'artist-1', name: 'Miles Davis', cover_url: null, spotify_id: null }]

function unifiedOk() {
	return {
		ok: true,
		status: 200,
		json: async () => ({ albums: [], artists: ARTISTS, tracks: [] }),
	} as unknown as Response
}

beforeEach(() => {
	window.history.replaceState(null, '', '/search?q=miles')
	idx.loadReviews.mockReset().mockResolvedValue([])
	idx.filterReviews.mockReset().mockReturnValue([])
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.clearAllMocks()
})

describe('/search retry against the real search core', () => {
	it('recovers real results after a failed search', async () => {
		const f = vi.fn()
			.mockResolvedValueOnce({ ok: false, status: 503 } as unknown as Response)
			.mockResolvedValue(unifiedOk())
		vi.stubGlobal('fetch', f)

		render(<SearchPage />)

		await screen.findByText('검색 결과를 불러오지 못했습니다.')
		fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))

		// the assertion that matters: results, not merely "a search was started"
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Miles Davis' })).toBeTruthy()
		})
		expect(screen.queryByText('검색 결과를 불러오지 못했습니다.')).toBeNull()
		expect(screen.queryByText('일치하는 결과가 없습니다.')).toBeNull()
	})

	it('reconnects the 평론 index on retry rather than replaying its failure', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(unifiedOk()))
		idx.loadReviews
			.mockRejectedValueOnce(new Error('HTTP 503'))
			.mockResolvedValue([])

		render(<SearchPage />)

		await waitFor(() => {
			expect(document.querySelector('.gs-idxwarn')).not.toBeNull()
		})
		fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))

		await waitFor(() => {
			expect(document.querySelector('.gs-idxwarn')).toBeNull()
		})
		expect(idx.loadReviews).toHaveBeenCalledTimes(2)
	})
})
