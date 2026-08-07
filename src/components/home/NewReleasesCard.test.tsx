// Locks the FIX-home-module-cls layout-stability contracts: a build-seeded
// 새 앨범 strip renders synchronously (it SSRs), is never removed by a failed
// or empty runtime refresh, and only the unseeded module keeps the legacy
// render-nothing-then-insert behavior. TodayAlbumBuckit's error path must keep
// its skeleton (no mid-read collapse); only a confirmed-empty response hides it.
import type { components } from '@lib/api.gen'
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openAlbum } from '@lib/entityLinks'
import { PB_DND_START_EVENT } from '@lib/pocketBuckit/events'
import NewReleasesCard, { NewReleaseAlbumCardAdapter } from './NewReleasesCard'
import TodayAlbumBuckit from './TodayAlbumBuckit'

const pocket = vi.hoisted(() => ({ open: vi.fn() }))

vi.mock('@lib/albumDetail', () => ({ prefetchAlbumDetail: vi.fn() }))
vi.mock('@lib/entityLinks', async () => ({
	...await vi.importActual<typeof import('@lib/entityLinks')>('@lib/entityLinks'),
	openAlbum: vi.fn(),
}))
vi.mock('@components/member/pocket/AddToBucketMenu', () => ({
	AddToBucketMenu: ({ item, render }: { item: unknown, render: (props: { open: () => void, busy: boolean }) => ReactNode }) =>
		render({ open: () => pocket.open(item), busy: false }),
}))

// jsdom has no ResizeObserver; HomeStrip's arrow-state effect needs one.
beforeEach(() => {
	pocket.open.mockReset()
	vi.stubGlobal('ResizeObserver', class {
		observe() {}
		unobserve() {}
		disconnect() {}
	})
})

type NewReleaseItem = components['schemas']['Music_NewReleaseItem']

const ITEM = {
	album_id: 'a1',
	title: 'Set In Stone',
	cover_url: null,
	release_date: '2026-07-17',
	reviewed_artist: false,
	artists: [{ id: 'r1', name: 'Rick Ross' }],
} as unknown as NewReleaseItem

const okJson = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })

describe('newReleasesCard (FIX-home-module-cls)', () => {
	it('renders the seeded strip synchronously, before any fetch resolves', () => {
		vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))) // hangs
		render(<NewReleasesCard initial={[ITEM]} />)
		expect(screen.getByText('새 앨범')).toBeInTheDocument()
		expect(screen.getByText('Set In Stone')).toBeInTheDocument()
	})

	it('keeps the seeded strip when the runtime refresh fails', async () => {
		const fetchMock = vi.fn(() => Promise.reject(new Error('down')))
		vi.stubGlobal('fetch', fetchMock)
		render(<NewReleasesCard initial={[ITEM]} />)
		await waitFor(() => expect(fetchMock).toHaveBeenCalled())
		expect(screen.getByText('Set In Stone')).toBeInTheDocument()
	})

	it('keeps the seeded strip when the runtime refresh comes back empty', async () => {
		const fetchMock = vi.fn(() => okJson({ items: [] }))
		vi.stubGlobal('fetch', fetchMock)
		render(<NewReleasesCard initial={[ITEM]} />)
		await waitFor(() => expect(fetchMock).toHaveBeenCalled())
		expect(screen.getByText('Set In Stone')).toBeInTheDocument()
	})

	it('unseeded + empty runtime response renders nothing (legacy degradation)', async () => {
		const fetchMock = vi.fn(() => okJson({ items: [] }))
		vi.stubGlobal('fetch', fetchMock)
		const { container } = render(<NewReleasesCard />)
		await waitFor(() => expect(fetchMock).toHaveBeenCalled())
		expect(container).toBeEmptyDOMElement()
	})

	it('unseeded + successful runtime response inserts the strip (legacy path)', async () => {
		vi.stubGlobal('fetch', vi.fn(() => okJson({ items: [ITEM] })))
		render(<NewReleasesCard />)
		expect(await screen.findByText('Set In Stone')).toBeInTheDocument()
	})
})

describe('newReleasesCard album adapter', () => {
	const reviewed = { ...ITEM, reviewed_artist: true } as NewReleaseItem

	it('preserves open and grants copy-drag plus the AddToBucketMenu fallback', () => {
		vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
		const start = vi.fn()
		window.addEventListener(PB_DND_START_EVENT, start)
		const { container } = render(<NewReleasesCard initial={[ITEM]} />)

		fireEvent.click(screen.getByRole('button', { name: 'Set In Stone — Rick Ross 앨범 보기' }))
		expect(openAlbum).toHaveBeenCalledWith({
			albumId: 'a1',
			title: 'Set In Stone',
			artist: 'Rick Ross',
			cover: null,
			year: 2026,
		})
		expect(screen.queryByLabelText('Set In Stone 재생')).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: 'Set In Stone 버킷에 담기' }))
		expect(pocket.open).toHaveBeenCalledWith({ itemType: 'album', albumId: 'a1', title: 'Set In Stone' })

		const card = container.querySelector('article[draggable="true"]')!
		const dataTransfer = { effectAllowed: 'uninitialized' }
		fireEvent.dragStart(card, { dataTransfer })
		expect(dataTransfer.effectAllowed).toBe('copy')
		expect((start.mock.calls[0][0] as CustomEvent).detail).toEqual({
			ref: { entity: 'album', albumId: 'a1', title: 'Set In Stone' },
			origin: { kind: 'external', copies: true },
		})
		window.removeEventListener(PB_DND_START_EVENT, start)
	})

	it('preserves the frozen card presentation after removing the legacy fixture', () => {
		const { container } = render(<NewReleaseAlbumCardAdapter it={reviewed} />)

		expect(container.querySelector('[data-album-card-layout="grid"]')).toBeInTheDocument()
		expect(container.querySelector('[data-cover-state="fallback"]')).toHaveTextContent('SE')
		expect(screen.getByText('Set In Stone')).toBeInTheDocument()
		expect(screen.getByRole('link', { name: 'Rick Ross' })).toHaveAttribute('href', '/artist/r1/')
		expect(screen.getByText('07.17 발매')).toBeInTheDocument()
		expect(screen.getByText('★ 평론')).toBeInTheDocument()
	})
})

describe('todayAlbumBuckit (FIX-home-module-cls)', () => {
	it('keeps the skeleton on a fetch error instead of unmounting the section', async () => {
		const fetchMock = vi.fn(() => Promise.reject(new Error('down')))
		vi.stubGlobal('fetch', fetchMock)
		const { container } = render(<TodayAlbumBuckit />)
		await waitFor(() => expect(fetchMock).toHaveBeenCalled())
		expect(screen.getByText('오늘, 이 앨범들')).toBeInTheDocument()
		expect(container.querySelector('.otd-skel')).not.toBeNull()
	})

	it('hides the section only on a confirmed-empty response', async () => {
		const fetchMock = vi.fn(() => okJson({ items: [], month: 7, day: 28, total: 0 }))
		vi.stubGlobal('fetch', fetchMock)
		const { container } = render(<TodayAlbumBuckit />)
		await waitFor(() => expect(container).toBeEmptyDOMElement())
	})
})
