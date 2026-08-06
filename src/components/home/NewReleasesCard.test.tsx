// Locks the FIX-home-module-cls layout-stability contracts: a build-seeded
// 새 앨범 strip renders synchronously (it SSRs), is never removed by a failed
// or empty runtime refresh, and only the unseeded module keeps the legacy
// render-nothing-then-insert behavior. TodayAlbumBuckit's error path must keep
// its skeleton (no mid-read collapse); only a confirmed-empty response hides it.
import type { components } from '@lib/api.gen'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openAlbum } from '@lib/entityLinks'
import NewReleasesCard, { LegacyCardItem, NewReleaseAlbumCardAdapter } from './NewReleasesCard'
import TodayAlbumBuckit from './TodayAlbumBuckit'

vi.mock('@lib/albumDetail', () => ({ prefetchAlbumDetail: vi.fn() }))
vi.mock('@lib/entityLinks', async () => ({
	...await vi.importActual<typeof import('@lib/entityLinks')>('@lib/entityLinks'),
	openAlbum: vi.fn(),
}))

// jsdom has no ResizeObserver; HomeStrip's arrow-state effect needs one.
beforeEach(() => {
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

describe('newReleasesCard (album-card Stage 4)', () => {
	const reviewed = { ...ITEM, reviewed_artist: true } as NewReleaseItem

	it('injects the open-only album capability with the canonical catalog id', () => {
		vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
		render(<NewReleasesCard initial={[ITEM]} />)

		fireEvent.click(screen.getByRole('button', { name: 'Set In Stone — Rick Ross 앨범 보기' }))
		expect(openAlbum).toHaveBeenCalledWith({
			albumId: 'a1',
			title: 'Set In Stone',
			artist: 'Rick Ross',
			cover: null,
			year: 2026,
		})
		expect(screen.queryByLabelText('Set In Stone 재생')).toBeNull()
		expect(screen.queryByLabelText('Set In Stone 담기')).toBeNull()
	})

	it('preserves the legacy card visual content while changing the renderer', () => {
		const legacy = render(<LegacyCardItem it={reviewed} />)
		const canonical = render(<NewReleaseAlbumCardAdapter it={reviewed} />)

		const signature = (container: HTMLElement) => {
			const image = within(container).queryByRole('img', { name: 'Set In Stone' })
			const artist = within(container).getByRole('link', { name: 'Rick Ross' })
			return {
				cover: image ? { src: image.getAttribute('src'), alt: image.getAttribute('alt') } : null,
				fallback: container.querySelector('.cover-ph')?.textContent,
				title: within(container).getByText('Set In Stone').textContent,
				artist: { text: artist.textContent, href: artist.getAttribute('href') },
				date: within(container).getByText('07.17 발매').textContent,
				badge: within(container).getByText('★ 평론').textContent,
			}
		}

		expect(signature(canonical.container)).toEqual(signature(legacy.container))
		expect(canonical.container.querySelector('[data-album-card-layout="grid"]')).toBeInTheDocument()
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
