// 나를 위한 새 앨범 — a confirmed release the catalog hasn't absorbed yet must
// open on click (sync-request → DB-only by-spotify poll), a catalog-backed one
// opens directly, and one with no Spotify id stays a static card.
import type { components } from '@lib/api.gen'
import type { ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '@lib/api'
import { openAlbum } from '@lib/entityLinks'
import { ForYouReleaseAlbumCardAdapter } from './ForYouReleasesCard'

vi.mock('@lib/albumDetail', () => ({ prefetchAlbumDetail: vi.fn() }))
vi.mock('@lib/api', () => ({ apiFetch: vi.fn() }))
vi.mock('@lib/entityLinks', async () => ({
	...await vi.importActual<typeof import('@lib/entityLinks')>('@lib/entityLinks'),
	openAlbum: vi.fn(),
}))
vi.mock('@components/member/pocket/AddToBucketMenu', () => ({
	AddToBucketMenu: ({ render }: { render: (props: { open: () => void, busy: boolean }) => ReactNode }) =>
		render({ open: () => {}, busy: false }),
}))

type ReleaseFeedItem = components['schemas']['Backend_ReleaseFeedItem']

const BASE_ITEM = {
	artist_id: 'ar1',
	artist_name: '스카이민혁',
	title: '2MC',
	release_date: '2026-10-16',
	release_type: 'album',
	status: 'released',
	trust: '확정',
	album_id: null,
	cover_url: null,
	spotify_album_id: null,
} as unknown as ReleaseFeedItem

const item = (over: Partial<ReleaseFeedItem>) => ({ ...BASE_ITEM, ...over }) as ReleaseFeedItem
const notFound = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
const found = (id: string) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ album: { id } }) })

beforeEach(() => {
	vi.mocked(openAlbum).mockReset()
	vi.mocked(apiFetch).mockReset()
	vi.useRealTimers()
})

describe('forYouReleaseAlbumCardAdapter', () => {
	it('opens a catalog-backed release directly', () => {
		vi.stubGlobal('fetch', vi.fn())
		render(<ForYouReleaseAlbumCardAdapter it={item({ album_id: 'cat-1', spotify_album_id: 'sp-1' })} />)
		fireEvent.click(screen.getByRole('button', { name: /2MC — 스카이민혁 앨범 보기/ }))
		expect(openAlbum).toHaveBeenCalledWith(expect.objectContaining({ albumId: 'cat-1' }))
		expect(fetch).not.toHaveBeenCalled()
	})

	it('renders no open control for a release with no Spotify id', () => {
		render(<ForYouReleaseAlbumCardAdapter it={item({ spotify_album_id: null })} />)
		expect(screen.queryByRole('button', { name: /앨범/ })).toBeNull()
	})

	it('absorbs an unresolved Spotify release on click, then opens it', async () => {
		let reads = 0
		const fetchMock = vi.fn((_url: string) => (++reads >= 3 ? found('cat-new') : notFound()))
		vi.stubGlobal('fetch', fetchMock)
		vi.mocked(apiFetch).mockResolvedValue({ status: 202 } as Response)
		vi.useFakeTimers({ shouldAdvanceTime: true })
		render(<ForYouReleaseAlbumCardAdapter it={item({ spotify_album_id: 'sp-absorb' })} />)

		fireEvent.click(screen.getByRole('button', { name: /불러와서 보기/ }))
		expect(await screen.findByText('앨범 불러오는 중…')).toBeInTheDocument()
		await act(() => vi.advanceTimersByTimeAsync(5000))

		await waitFor(() => expect(openAlbum).toHaveBeenCalledWith(expect.objectContaining({ albumId: 'cat-new' })))
		const [url, init] = vi.mocked(apiFetch).mock.calls[0]
		expect(url).toMatch(/\/api\/music\/sync-requests$/)
		expect(JSON.parse(String(init?.body))).toEqual({ album_ids: ['sp-absorb'], market: 'KR' })
		expect(fetchMock.mock.calls.every(([u]) => String(u).includes('/api/music/albums/by-spotify/sp-absorb'))).toBe(true)
		// Upgraded to the catalog identity: the next click opens without a round trip.
		expect(screen.queryByText('앨범 불러오는 중…')).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: /2MC — 스카이민혁 앨범 보기/ }))
		expect(openAlbum).toHaveBeenCalledTimes(2)
	})

	it('opens without enqueueing when the album landed since the page loaded', async () => {
		vi.stubGlobal('fetch', vi.fn(() => found('cat-late')))
		render(<ForYouReleaseAlbumCardAdapter it={item({ spotify_album_id: 'sp-late' })} />)
		fireEvent.click(screen.getByRole('button', { name: /불러와서 보기/ }))
		await waitFor(() => expect(openAlbum).toHaveBeenCalledWith(expect.objectContaining({ albumId: 'cat-late' })))
		expect(apiFetch).not.toHaveBeenCalled()
	})

	it('says so and stays put when the sync request is refused', async () => {
		vi.stubGlobal('fetch', vi.fn(() => notFound()))
		vi.mocked(apiFetch).mockResolvedValue({ status: 503 } as Response)
		render(<ForYouReleaseAlbumCardAdapter it={item({ spotify_album_id: 'sp-refused' })} />)
		fireEvent.click(screen.getByRole('button', { name: /불러와서 보기/ }))
		expect(await screen.findByText(/아직 준비 중/)).toBeInTheDocument()
		expect(openAlbum).not.toHaveBeenCalled()
	})
})
