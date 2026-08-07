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
	const titleButton = screen.getByRole('button', { name })
	const region = titleButton.parentElement?.parentElement
	if (!(region instanceof HTMLElement))
		throw new Error(`Missing rendered bucket region ${name}`)
	return region
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
		expect(within(bucketRegion('B')).getByTitle(TILE_TITLE)).toBeInTheDocument()
		expect(within(bucketRegion('A')).queryByTitle(TILE_TITLE)).not.toBeInTheDocument()

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
