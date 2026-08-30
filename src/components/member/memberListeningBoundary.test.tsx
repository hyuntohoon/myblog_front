// SEC-member-listening-data-boundary Step 1 — the front half of the read boundary.
//
// `SelfDashboard` mounts for ANY signed-in member on their own profile, and the
// widgets below read `GET /api/library/*` routes over tables with no user column
// (`spotify_now_playing` is a CHECK-enforced singleton; the rest have no
// per-member source). So a second member's dashboard was rendering the OWNER's
// now-playing, recently-played albums, cumulative listen counts and 좋아요 library.
//
// The backend's `require_owner` is the real boundary — `tests/api/
// test_library_owner_boundary.py` in myblog_backend pins that a non-owner gets
// 403 and the service is never called. What these tests pin is the other half:
// a member's browser must not make the request at all, must not paint the panel,
// and must not resurrect the data from state it saved while the read was open.
//
// Each assertion is written as "the api function was never called", not merely
// "the heading is absent". A hidden-but-mounted widget still fetches, and a
// fetch is the thing that leaves the browser.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as analysisApi from './analysis.api'
import { OverviewDash } from './OverviewDash'
import * as spotifyApi from './spotify.api'
import { StatsTab } from './StatsTab'

vi.mock('./spotify.api', () => ({
	listRecentlyListened: vi.fn().mockResolvedValue({ items: [], lastSyncedAt: null }),
	listRecentTracks: vi.fn().mockResolvedValue({ items: [], lastSyncedAt: null }),
	listListenedAlbums: vi.fn().mockResolvedValue([]),
	refreshRecent: vi.fn().mockResolvedValue(undefined),
}))

// NowPlaying owns the `nowplaying` card's own read; stubbing the component keeps
// this file about the gate rather than about NowPlaying's internals, and lets the
// test assert on a marker that only appears when the card actually mounted.
vi.mock('./NowPlaying', () => ({
	NowPlaying: () => <div data-testid="nowplaying-card" />,
}))
vi.mock('./LastfmNowPlaying', () => ({
	LastfmNowPlaying: () => <div data-testid="lastfm-card" />,
}))

// The 좋아요 workbench and the member-scoped 임포트 panel, stubbed to their identity
// so StatsTab's branch is observable without dragging in either subtree's fetches.
vi.mock('./LikedBoard', () => ({
	LikedBoard: () => <div data-testid="liked-board" />,
}))
vi.mock('./ImportAnalysis', () => ({
	ImportAnalysis: () => <div data-testid="import-analysis" />,
}))

vi.mock('./analysis.api', async importOriginal => ({
	...(await importOriginal<typeof import('./analysis.api')>()),
	getSavedGenreDistribution: vi.fn().mockResolvedValue({ items: [], unclassified_count: 0, total: 0 }),
	getSavedArtistDistribution: vi.fn().mockResolvedValue({ items: [], unclassified_count: 0, total: 0 }),
}))

const OWNER_ONLY_TITLES = ['지금 듣는 음악', '최근 들은 앨범', '최근 재생 트랙', '들은 앨범 (누적)']

function overview(isOwner: boolean) {
	return render(
		<OverviewDash
			isOwner={isOwner}
			npStyle="banner"
			setNpStyle={vi.fn()}
			onOpen={vi.fn()}
			goBucket={vi.fn()}
			reviews={[]}
		/>,
	)
}

beforeEach(() => {
	localStorage.clear()
	vi.clearAllMocks()
})

describe('overviewDash owner-global listening cards', () => {
	it('renders none of them for a member, and issues none of their reads', async () => {
		overview(false)

		for (const title of OWNER_ONLY_TITLES)
			expect(screen.queryByText(title)).toBeNull()
		expect(screen.queryByTestId('nowplaying-card')).toBeNull()

		// Give any effect a tick to fire before asserting it did not.
		await waitFor(() => expect(screen.getByText('개요')).toBeTruthy())
		expect(spotifyApi.listRecentlyListened).not.toHaveBeenCalled()
		expect(spotifyApi.listRecentTracks).not.toHaveBeenCalled()
		expect(spotifyApi.listListenedAlbums).not.toHaveBeenCalled()
	})

	it('renders them for the owner — the gate must not cost the owner the dashboard', async () => {
		overview(true)

		for (const title of OWNER_ONLY_TITLES)
			expect(screen.getByText(title)).toBeTruthy()
		expect(screen.getByTestId('nowplaying-card')).toBeTruthy()
		await waitFor(() => expect(spotifyApi.listRecentlyListened).toHaveBeenCalled())
		expect(spotifyApi.listRecentTracks).toHaveBeenCalled()
		expect(spotifyApi.listListenedAlbums).toHaveBeenCalled()
	})

	it('does not resurrect them from a layout saved before the gate existed', async () => {
		// The subtle path: this member used the dashboard while the read was open,
		// so their browser holds a layout naming all four cards. Filtering only the
		// DEFAULT layout would let that saved one paint the owner's data again.
		localStorage.setItem(
			'lf_ov_rows',
			JSON.stringify([['nowplaying'], ['recent-albums', 'recent-tracks'], ['listened-albums'], ['bucket']]),
		)
		overview(false)

		for (const title of OWNER_ONLY_TITLES)
			expect(screen.queryByText(title)).toBeNull()
		expect(screen.getByText('My Buckit')).toBeTruthy() // the rest of their layout survives
		await waitFor(() => expect(screen.getByText('개요')).toBeTruthy())
		expect(spotifyApi.listRecentlyListened).not.toHaveBeenCalled()
	})

	it('does not offer them in ＋ 컴포넌트 추가 for a member', () => {
		localStorage.setItem('lf_ov_rows', JSON.stringify([['bucket']]))
		overview(false)

		fireEvent.click(screen.getByRole('button', { name: /컴포넌트 추가/ }))
		for (const title of OWNER_ONLY_TITLES)
			expect(screen.queryByRole('menuitem', { name: new RegExp(title) })).toBeNull()
	})
})

describe('statsTab 분석 버킷', () => {
	it('gives a member the member-scoped 임포트 panel and never the 좋아요 workbench', async () => {
		render(<StatsTab isOwner={false} onOpen={vi.fn()} />)

		// The tab is NOT hidden: stream-history is genuinely this member's data.
		expect(screen.getByTestId('import-analysis')).toBeTruthy()
		expect(screen.queryByTestId('liked-board')).toBeNull()
		// The 좋아요 lens is gone entirely — not an option, and not requested.
		expect(screen.queryByText('좋아요')).toBeNull()
		await waitFor(() => expect(screen.getByTestId('import-analysis')).toBeTruthy())
		expect(analysisApi.getSavedGenreDistribution).not.toHaveBeenCalled()
		expect(analysisApi.getSavedArtistDistribution).not.toHaveBeenCalled()
	})

	it('gives the owner the 좋아요 workbench unchanged', () => {
		render(<StatsTab isOwner onOpen={vi.fn()} />)
		expect(screen.getByTestId('liked-board')).toBeTruthy()
		expect(screen.queryByTestId('import-analysis')).toBeNull()
	})
})
