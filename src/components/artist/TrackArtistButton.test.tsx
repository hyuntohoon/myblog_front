// FIX-user-flow-state-consistency leg 4 — tracking an artist from the artist hub.
//
// The Release Radar could only be filled from inside /releases (preview a
// bucket, or import Spotify follows), so the page where a reader actually
// decides an artist matters had no way to say so. These pin the states that
// make the control honest rather than decorative: a failed read of "am I
// already tracking this?" must not be rendered as "no", and the daily add
// limit is not a generic failure.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TrackArtistButton from './TrackArtistButton'

const auth = vi.hoisted(() => ({ isLoggedIn: vi.fn(), goLogin: vi.fn() }))
const api = vi.hoisted(() => ({
	listTrackedArtists: vi.fn(),
	trackArtist: vi.fn(),
	untrackArtist: vi.fn(),
}))

vi.mock('@lib/auth', () => auth)
vi.mock('@lib/trackedArtists', () => api)

const TRACKED = [{ artist_id: 'artist-1', name: 'Miles Davis', photo_url: null, added_at: '2026-09-01T00:00:00Z' }]

function renderButton() {
	return render(<TrackArtistButton artistId="artist-1" name="Miles Davis" />)
}

beforeEach(() => {
	auth.isLoggedIn.mockReset().mockReturnValue(true)
	auth.goLogin.mockReset()
	api.listTrackedArtists.mockReset().mockResolvedValue([])
	api.trackArtist.mockReset().mockResolvedValue({ ok: true, added: 1, alreadyTracked: 0 })
	api.untrackArtist.mockReset().mockResolvedValue(true)
})

afterEach(() => {
	vi.clearAllMocks()
})

describe('track-artist button', () => {
	it('sends a signed-out reader to login instead of pretending to work', () => {
		auth.isLoggedIn.mockReturnValue(false)
		renderButton()

		fireEvent.click(screen.getByRole('button', { name: '레이더에 추가' }))
		expect(auth.goLogin).toHaveBeenCalled()
		expect(api.trackArtist).not.toHaveBeenCalled()
	})

	it('reflects an artist that is already tracked', async () => {
		api.listTrackedArtists.mockResolvedValue(TRACKED)
		renderButton()

		const btn = await screen.findByRole('button', { name: '추적 중 ✓' })
		expect(btn).toHaveAttribute('aria-pressed', 'true')
	})

	it('tracks an untracked artist and says what happened', async () => {
		renderButton()

		const btn = await screen.findByRole('button', { name: '레이더에 추가' })
		expect(btn).toHaveAttribute('aria-pressed', 'false')
		fireEvent.click(btn)

		await waitFor(() => {
			expect(screen.getByRole('button', { name: '추적 중 ✓' })).toBeTruthy()
		})
		expect(api.trackArtist).toHaveBeenCalledWith('artist-1')
		expect(screen.getByRole('status').textContent).toContain('추적 시작')
	})

	it('untracks a tracked artist', async () => {
		api.listTrackedArtists.mockResolvedValue(TRACKED)
		renderButton()

		fireEvent.click(await screen.findByRole('button', { name: '추적 중 ✓' }))

		await waitFor(() => {
			expect(screen.getByRole('button', { name: '레이더에 추가' })).toBeTruthy()
		})
		expect(api.untrackArtist).toHaveBeenCalledWith('artist-1')
	})

	it('names the daily limit rather than calling it a failure', async () => {
		api.trackArtist.mockResolvedValue({ ok: false, reason: 'limit' })
		renderButton()

		fireEvent.click(await screen.findByRole('button', { name: '레이더에 추가' }))

		await waitFor(() => {
			expect(screen.getByRole('status').textContent).toContain('오늘 추가 한도')
		})
		// the limit did not track the artist, so the control must not claim it did
		expect(screen.getByRole('button', { name: '레이더에 추가' })).toHaveAttribute('aria-pressed', 'false')
	})

	it('does not render a failed state read as "not tracked"', async () => {
		api.listTrackedArtists.mockResolvedValue(null)
		renderButton()

		await waitFor(() => {
			expect(screen.getByRole('status').textContent).toContain('추적 상태를 불러오지 못했습니다')
		})
		expect(screen.getByRole('button', { name: '레이더에 추가' })).toHaveAttribute('aria-pressed', 'false')
	})

	it('keeps the tracked state when untracking fails', async () => {
		api.listTrackedArtists.mockResolvedValue(TRACKED)
		api.untrackArtist.mockResolvedValue(false)
		renderButton()

		fireEvent.click(await screen.findByRole('button', { name: '추적 중 ✓' }))

		await waitFor(() => {
			expect(screen.getByRole('status').textContent).toContain('해제에 실패')
		})
		expect(screen.getByRole('button', { name: '추적 중 ✓' })).toHaveAttribute('aria-pressed', 'true')
	})
})
