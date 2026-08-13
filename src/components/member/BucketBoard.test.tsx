import type { AddItemOutcome, BoardAlbum, BoardBucket } from '@lib/buckets'
import type { ComponentProps } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@lib/buckets'
import { bucketStore } from '@lib/pocketBuckit/bucketStore'
import { PB_BOARD_DND_END_EVENT, PB_BOARD_DND_START_EVENT, PB_DND_END_EVENT, PB_DND_START_EVENT } from '@lib/pocketBuckit/events'
import * as spotifyApi from './spotify.api'
import { BucketAlbumCardAdapter, BucketBoard } from './BucketBoard'

vi.mock('@lib/buckets', async importOriginal => ({
	...(await importOriginal<typeof import('@lib/buckets')>()),
	listBuckets: vi.fn(),
	addBucketItem: vi.fn(),
	reorderItems: vi.fn(),
}))

vi.mock('../album/reviews.api', () => ({
	fetchMyAlbumStates: vi.fn().mockResolvedValue([]),
	putMyAlbumState: vi.fn(),
}))

vi.mock('./spotify.api', () => ({
	listRecentlyListened: vi.fn(),
}))

vi.mock('./useSpotifyLibrary', () => ({
	useSpotifyLibrary: () => ({
		libState: null,
		libAlbumMap: new Map(),
		listenedAlbumIds: new Set(),
		syncing: false,
		runLibrarySync: vi.fn(),
	}),
}))

vi.mock('@lib/research', async importOriginal => ({
	...(await importOriginal<typeof import('@lib/research')>()),
	useResearchStatusMap: () => ({}),
}))

// BucketBoard's received-state timer reads window.matchMedia; jsdom does not
// implement it (same gap noted in AlbumDetail.dragTrack.test.tsx).
window.matchMedia = window.matchMedia || ((query: string) => ({
	matches: false,
	media: query,
	onchange: null,
	addListener: () => {},
	removeListener: () => {},
	addEventListener: () => {},
	removeEventListener: () => {},
	dispatchEvent: () => false,
}) as MediaQueryList)

const ALBUM_ID = 'album-race-1'
const ALBUM_TITLE = 'Deferred Copy'
const ALBUM_ARTIST = 'Race Condition'
const TILE_TITLE = `${ALBUM_TITLE} — ${ALBUM_ARTIST}`

function bucket(id: string, name: string): BoardBucket {
	return {
		id,
		name,
		color: null,
		isDone: false,
		kind: 'review',
		type: 'general',
		isPublic: false,
		researchMode: 'off',
		albums: [],
		children: [],
	}
}

function album(itemId: string): BoardAlbum {
	return {
		itemId,
		itemType: 'album',
		albumId: ALBUM_ID,
		trackId: null,
		reviewTargetId: null,
		artistId: null,
		title: ALBUM_TITLE,
		artist: ALBUM_ARTIST,
		cover: null,
		year: 2026,
		alreadyReviewed: false,
		postId: null,
		researchSelected: false,
	}
}

function storedBucket(id: string): BoardBucket {
	const found = bucketStore.getTree().find(b => b.id === id)
	if (!found)
		throw new Error(`Missing bucket ${id}`)
	return found
}

function bucketRegion(name: string): HTMLElement {
	const region = screen.getByRole('region', { name: `${name} 버킷 내용` })
	if (!(region instanceof HTMLElement))
		throw new Error(`Missing rendered bucket region ${name}`)
	return region
}

function openBucket(name: string): HTMLButtonElement {
	const toggle = screen.getByRole('button', { name: `${name} 버킷 열기` })
	fireEvent.click(toggle)
	return screen.getByRole('button', { name: `${name} 버킷 닫기` })
}

function allItems(tree: BoardBucket[]): BoardAlbum[] {
	return tree.flatMap(b => [...b.albums, ...allItems(b.children)])
}

beforeEach(() => {
	localStorage.clear()
	sessionStorage.clear()
	bucketStore.clear()
	vi.clearAllMocks()
	vi.mocked(api.listBuckets).mockResolvedValue([])
	vi.mocked(api.addBucketItem).mockResolvedValue({ item: null, conflict: true })
	vi.mocked(api.reorderItems).mockResolvedValue()
	vi.mocked(spotifyApi.listRecentlyListened).mockResolvedValue({
		items: [{
			album_id: ALBUM_ID,
			last_played_at: '2026-08-06T00:00:00Z',
			album: {
				id: ALBUM_ID,
				title: ALBUM_TITLE,
				artist_names: [ALBUM_ARTIST],
				cover_url: null,
				release_date: '2026-01-01',
			},
		}],
		lastSyncedAt: null,
	})
})

describe('bucketBoard optimistic album copy', () => {
	it('promotes a pending copy in the bucket it moved to before the add resolved', async () => {
		let resolveAdd!: (outcome: AddItemOutcome) => void
		const pendingAdd = new Promise<AddItemOutcome>((resolve) => {
			resolveAdd = resolve
		})
		vi.mocked(api.addBucketItem).mockReturnValue(pendingAdd)
		bucketStore.setTree([
			bucket('bucket-a', 'A'),
			bucket('bucket-b', 'B'),
		])

		render(<BucketBoard onOpen={vi.fn()} reviews={[]} />)

		openBucket('A')
		const recentTile = await screen.findByTitle(TILE_TITLE)
		fireEvent.click(within(recentTile).getByRole('button', { name: '앨범 동작' }))
		fireEvent.click(within(screen.getByRole('dialog', { name: ALBUM_TITLE })).getByRole('button', { name: '버킷에 추가' }))
		fireEvent.click(within(screen.getByRole('dialog', { name: '버킷에 추가' })).getByRole('button', { name: 'A' }))

		await waitFor(() => expect(storedBucket('bucket-a').albums).toHaveLength(1))
		const tempId = storedBucket('bucket-a').albums[0].itemId
		expect(tempId).toMatch(/^temp:/)
		expect(within(bucketRegion('A')).getByTitle(TILE_TITLE)).toBeInTheDocument()
		expect(api.addBucketItem).toHaveBeenCalledWith('bucket-a', ALBUM_ID)

		const tempTile = within(bucketRegion('A')).getByTitle(TILE_TITLE)
		fireEvent.click(within(tempTile).getByRole('button', { name: '앨범 동작' }))
		fireEvent.click(within(screen.getByRole('dialog', { name: ALBUM_TITLE })).getByRole('button', { name: '다른 버킷으로 이동' }))
		fireEvent.click(within(screen.getByRole('dialog', { name: '다른 버킷으로 이동' })).getByRole('button', { name: 'B' }))

		await waitFor(() => expect(storedBucket('bucket-b').albums.map(a => a.itemId)).toEqual([tempId]))
		expect(storedBucket('bucket-a').albums).toHaveLength(0)
		// Each bucket owns its content inline. Opening B leaves A open, and each
		// region reflects only its own current membership.
		openBucket('B')
		expect(within(bucketRegion('B')).getByTitle(TILE_TITLE)).toBeInTheDocument()
		expect(within(bucketRegion('A')).queryByTitle(TILE_TITLE)).not.toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'A 버킷 닫기' })).toHaveAttribute('aria-expanded', 'true')
		expect(screen.getByRole('button', { name: 'B 버킷 닫기' })).toHaveAttribute('aria-expanded', 'true')

		await act(async () => {
			resolveAdd({ item: album('real-item-1'), conflict: false })
			await pendingAdd
		})

		// This intentionally asserts only client-tree promotion. The accepted residual
		// edge case may leave the server-side row in the original bucket A for now.
		await waitFor(() => expect(storedBucket('bucket-b').albums.map(a => a.itemId)).toEqual(['real-item-1']))
		expect(storedBucket('bucket-a').albums).toHaveLength(0)
		expect(allItems(bucketStore.getTree()).some(a => a.itemId.startsWith('temp:'))).toBe(false)
		expect(within(bucketRegion('B')).getByTitle(TILE_TITLE)).toBeInTheDocument()
		expect(within(bucketRegion('A')).queryByTitle(TILE_TITLE)).not.toBeInTheDocument()
	})
})

describe('bucketBoard inline disclosure ownership', () => {
	it('starts closed, keeps siblings independently open, and never writes bucket URL/history state', async () => {
		bucketStore.setTree([bucket('bucket-a', 'A'), bucket('bucket-b', 'B')])
		const pushState = vi.spyOn(history, 'pushState')
		const replaceState = vi.spyOn(history, 'replaceState')
		const before = {
			pathname: location.pathname,
			search: location.search,
			hash: location.hash,
			length: history.length,
		}

		const { container } = render(<BucketBoard onOpen={vi.fn()} reviews={[]} />)
		await screen.findByTitle(TILE_TITLE)
		expect(screen.getByRole('button', { name: 'A 버킷 열기' })).toHaveAttribute('aria-expanded', 'false')
		expect(screen.getByRole('button', { name: 'B 버킷 열기' })).toHaveAttribute('aria-expanded', 'false')
		expect(container.querySelector('[aria-selected]')).toBeNull()
		expect(container.querySelector('aside[aria-label="버킷 탐색"]')).toBeNull()

		openBucket('A')
		openBucket('B')
		fireEvent.click(screen.getByRole('button', { name: 'A 버킷 닫기' }))

		expect(screen.getByRole('button', { name: 'A 버킷 열기' })).toHaveAttribute('aria-expanded', 'false')
		expect(screen.getByRole('button', { name: 'B 버킷 닫기' })).toHaveAttribute('aria-expanded', 'true')
		expect(pushState).not.toHaveBeenCalled()
		expect(replaceState).not.toHaveBeenCalled()
		expect({ pathname: location.pathname, search: location.search, hash: location.hash, length: history.length }).toEqual(before)
	})

	it('hides descendants with a closed parent without clearing their open bits', async () => {
		const parent = bucket('parent', 'Parent')
		parent.children = [bucket('child', 'Child')]
		bucketStore.setTree([parent])

		const { container } = render(<BucketBoard onOpen={vi.fn()} reviews={[]} />)
		await screen.findByTitle(TILE_TITLE)
		openBucket('Parent')
		openBucket('Child')
		fireEvent.click(screen.getByRole('button', { name: 'Parent 버킷 닫기' }))

		const childNode = container.querySelector('[data-bucket-inline-node="child"]')
		expect(childNode?.querySelector('.bb-bucket-object')).toHaveAttribute('aria-expanded', 'true')
		expect(screen.queryByRole('button', { name: 'Child 버킷 닫기' })).toBeNull()

		openBucket('Parent')
		expect(screen.getByRole('button', { name: 'Child 버킷 닫기' })).toHaveAttribute('aria-expanded', 'true')
		expect(screen.getByRole('region', { name: 'Child 버킷 내용' })).toBeVisible()
	})

	it('keeps the complete long mixed-language name in disclosure semantics and DOM text', async () => {
		const name = '2026 다시 듣기 Revisit Notes 모음 Albums that reward another patient listen'
		bucketStore.setTree([bucket('long-name', name)])

		const { container } = render(<BucketBoard onOpen={vi.fn()} reviews={[]} />)
		await screen.findByTitle(TILE_TITLE)
		const toggle = screen.getByRole('button', { name: `${name} 버킷 열기` })
		expect(toggle).toHaveAttribute('aria-controls', 'bucket-inline-region-long-name')
		expect(container.querySelector('.bb-bucket-title')).toHaveTextContent(name)
	})

	it('toggles the owning disclosure with Enter and Space', async () => {
		bucketStore.setTree([bucket('keyboard', 'Keyboard')])

		render(<BucketBoard onOpen={vi.fn()} reviews={[]} />)
		await screen.findByTitle(TILE_TITLE)
		const closed = screen.getByRole('button', { name: 'Keyboard 버킷 열기' })
		fireEvent.keyDown(closed, { key: 'Enter' })
		const opened = screen.getByRole('button', { name: 'Keyboard 버킷 닫기' })
		expect(opened).toHaveAttribute('aria-expanded', 'true')

		fireEvent.keyDown(opened, { key: ' ' })
		expect(screen.getByRole('button', { name: 'Keyboard 버킷 열기' })).toHaveAttribute('aria-expanded', 'false')
	})

	it('keeps valid, rejected, and received DnD feedback distinct without opening the target', async () => {
		const general = bucket('general', 'General target')
		const artist = bucket('artist', 'Artist target')
		artist.type = 'artist'
		bucketStore.setTree([general, artist])
		const { container } = render(<BucketBoard onOpen={vi.fn()} reviews={[]} />)
		await screen.findByTitle(TILE_TITLE)
		vi.useFakeTimers()
		const generalToggle = screen.getByRole('button', { name: 'General target 버킷 열기' })
		const generalGroup = generalToggle.closest('.bb-bucket-object-group')

		act(() => {
			window.dispatchEvent(new CustomEvent(PB_DND_START_EVENT, {
				detail: { ref: { entity: 'album', albumId: ALBUM_ID }, origin: { kind: 'external', copies: true } },
			}))
		})
		fireEvent.dragOver(generalToggle)
		expect(generalGroup).toHaveAttribute('data-state', 'valid')
		await act(async () => {
			fireEvent.drop(generalToggle)
			await Promise.resolve()
		})
		expect(generalGroup).toHaveAttribute('data-state', 'received')
		expect(generalToggle).toHaveAttribute('aria-expanded', 'false')
		expect(screen.getByText('General target에 담았어요')).toBeInTheDocument()

		act(() => {
			window.dispatchEvent(new CustomEvent(PB_DND_START_EVENT, {
				detail: { ref: null, origin: { kind: 'external', itemType: 'snapshot' } },
			}))
		})
		const artistToggle = screen.getByRole('button', { name: 'Artist target 버킷 열기' })
		fireEvent.dragOver(artistToggle)
		const artistGroup = container.querySelector('[data-bucket-inline-node="artist"] .bb-bucket-object-group')
		expect(artistGroup).toHaveAttribute('data-state', 'rejected')
		expect(artistGroup).toHaveAttribute('data-dropreject', 'true')
		expect(screen.getByText('아티스트 · 앨범 · 트랙만 받아요')).toBeInTheDocument()
		act(() => vi.runOnlyPendingTimers())
		vi.useRealTimers()
	})

	it('keeps a rejected nested drop on the child instead of lighting its accepting parent', async () => {
		const parent = bucket('general-parent', 'General parent')
		const child = bucket('artist-child', 'Artist child')
		child.type = 'artist'
		parent.children = [child]
		bucketStore.setTree([parent])
		const { container } = render(<BucketBoard onOpen={vi.fn()} reviews={[]} />)
		await screen.findByTitle(TILE_TITLE)
		openBucket('General parent')
		openBucket('Artist child')

		act(() => {
			window.dispatchEvent(new CustomEvent(PB_DND_START_EVENT, {
				detail: { ref: null, origin: { kind: 'external', itemType: 'snapshot' } },
			}))
		})
		fireEvent.dragOver(screen.getByRole('button', { name: 'Artist child 버킷 닫기' }))

		const parentGroup = container.querySelector('[data-bucket-inline-node="general-parent"] > .bb-bucket-object-group')
		const childGroup = container.querySelector('[data-bucket-inline-node="artist-child"] > .bb-bucket-object-group')
		expect(childGroup).toHaveAttribute('data-state', 'rejected')
		expect(parentGroup).toHaveAttribute('data-state', 'open')
	})
})

function adapterProps(overrides: Partial<ComponentProps<typeof BucketAlbumCardAdapter>> = {}): ComponentProps<typeof BucketAlbumCardAdapter> {
	return {
		album: album('item-1'),
		bucketId: 'bucket-a',
		bucketType: 'general',
		rated: false,
		score: null,
		onOpen: vi.fn(),
		draggingId: null,
		setDraggingId: vi.fn(),
		setDragKind: vi.fn(),
		onTouchActions: vi.fn(),
		...overrides,
	}
}

describe('bucketAlbumCardAdapter', () => {
	it('projects bucket state onto the canonical card without changing open or touch actions', () => {
		const onOpen = vi.fn()
		const onTouchActions = vi.fn()
		const { container } = render(<BucketAlbumCardAdapter {...adapterProps({ onOpen, onTouchActions })} />)

		expect(container.querySelector('[data-album-card-layout="grid"]')).toBeInTheDocument()
		expect(screen.getByText(ALBUM_TITLE)).toBeInTheDocument()
		expect(screen.getByText(ALBUM_ARTIST)).toBeInTheDocument()
		expect(screen.queryByText('2026')).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: `${ALBUM_TITLE} — ${ALBUM_ARTIST} 앨범 보기` }))
		expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({
			albumId: ALBUM_ID,
			bucketId: 'bucket-a',
			itemId: 'item-1',
			writable: true,
		}))

		fireEvent.click(screen.getByRole('button', { name: '앨범 동작' }))
		expect(onTouchActions).toHaveBeenCalledTimes(1)
		expect(onOpen).toHaveBeenCalledTimes(1)
	})

	it('injects the existing membership drag payload and clears adapter drag state', () => {
		const start = vi.fn()
		const boardStart = vi.fn()
		const end = vi.fn()
		const boardEnd = vi.fn()
		const setDraggingId = vi.fn()
		const setDragKind = vi.fn()
		window.addEventListener(PB_DND_START_EVENT, start)
		window.addEventListener(PB_BOARD_DND_START_EVENT, boardStart)
		window.addEventListener(PB_DND_END_EVENT, end)
		window.addEventListener(PB_BOARD_DND_END_EVENT, boardEnd)
		const { container } = render(<BucketAlbumCardAdapter {...adapterProps({ setDraggingId, setDragKind })} />)
		const card = container.querySelector('[draggable="true"]')!
		const dataTransfer = { effectAllowed: 'uninitialized' }

		fireEvent.dragStart(card, { dataTransfer })
		expect(dataTransfer.effectAllowed).toBe('move')
		expect((start.mock.calls[0][0] as CustomEvent).detail).toEqual({
			ref: { entity: 'album', albumId: ALBUM_ID },
			origin: { kind: 'internal', itemId: 'item-1', fromBucketId: 'bucket-a', itemType: 'album' },
		})
		expect((boardStart.mock.calls[0][0] as CustomEvent).detail).toEqual((start.mock.calls[0][0] as CustomEvent).detail)
		expect(setDraggingId).toHaveBeenCalledWith('item-1')
		expect(setDragKind).toHaveBeenCalledWith('member')

		fireEvent.dragEnd(card)
		expect(end).toHaveBeenCalledTimes(1)
		expect(boardEnd).toHaveBeenCalledTimes(1)
		expect(setDraggingId).toHaveBeenLastCalledWith(null)
		expect(setDragKind).toHaveBeenLastCalledWith(null)
		window.removeEventListener(PB_DND_START_EVENT, start)
		window.removeEventListener(PB_BOARD_DND_START_EVENT, boardStart)
		window.removeEventListener(PB_DND_END_EVENT, end)
		window.removeEventListener(PB_BOARD_DND_END_EVENT, boardEnd)
	})

	it('keeps the frozen bucket identity and controls after legacy removal', () => {
		const { container } = render(<BucketAlbumCardAdapter {...adapterProps()} />)

		expect(screen.getByText(ALBUM_TITLE)).toBeInTheDocument()
		expect(screen.getByText(ALBUM_ARTIST)).toBeInTheDocument()
		expect(screen.getByTitle(TILE_TITLE)).toBeInTheDocument()
		expect(screen.getByRole('button', { name: '앨범 동작' })).toHaveTextContent('⋯')
		expect(container.querySelector('[data-cover-state="fallback"]')).toHaveTextContent('DE')
	})

	it('makes a catalog-id-less album inert instead of emitting a mixed-namespace operation', () => {
		const unresolved = album('item-unresolved')
		unresolved.albumId = null
		const { container } = render(<BucketAlbumCardAdapter {...adapterProps({ album: unresolved })} />)

		expect(container.querySelector('[draggable]')).toBeNull()
		expect(screen.queryByRole('button', { name: /앨범 보기|앨범 동작/ })).toBeNull()
	})

	it('leaves generalized non-album bucket members on their existing renderer', async () => {
		const track = album('track-item-1')
		track.itemType = 'track'
		track.albumId = null
		track.trackId = 'track-1'
		track.title = 'Track member'
		const target = bucket('bucket-a', 'A')
		target.albums = [track]
		bucketStore.setTree([target])

		render(<BucketBoard onOpen={vi.fn()} reviews={[]} />)
		const tile = await screen.findByTitle(`Track member — ${ALBUM_ARTIST}`)
		expect(tile.querySelector('[data-album-card-layout]')).toBeNull()
		expect(within(tile).getByText('트랙')).toBeInTheDocument()
	})
})
