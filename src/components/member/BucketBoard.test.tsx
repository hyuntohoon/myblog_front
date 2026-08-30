import type { AddItemOutcome, BoardAlbum, BoardBucket } from '@lib/buckets'
import type { ComponentProps } from 'react'
import { useLayoutEffect } from 'react'
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
	createBucket: vi.fn(),
	deleteBucket: vi.fn(),
	moveBucket: vi.fn(),
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

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

function findStoredBucket(id: string, tree = bucketStore.getTree()): BoardBucket | null {
	return api.findBucket(tree, id)
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
	vi.mocked(api.createBucket).mockResolvedValue(bucket('created', 'Created'))
	vi.mocked(api.deleteBucket).mockResolvedValue()
	vi.mocked(api.moveBucket).mockResolvedValue([])
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

describe('bucketBoard structural request queue', () => {
	it('creates a nested bucket before issuing its queued move', async () => {
		let resolveCreate!: (created: BoardBucket) => void
		const creating = new Promise<BoardBucket>((resolve) => {
			resolveCreate = resolve
		})
		vi.mocked(api.createBucket).mockReturnValue(creating)
		const parent = bucket('parent', 'Parent')
		bucketStore.setTree([parent])

		render(<BucketBoard isOwner onOpen={vi.fn()} reviews={[]} />)
		await screen.findByTitle(TILE_TITLE)
		fireEvent.click(screen.getByTitle('하위 버킷 추가'))

		await waitFor(() => expect(api.createBucket).toHaveBeenCalledWith('새 버킷', 'general'))
		expect(api.moveBucket).not.toHaveBeenCalled()

		await act(async () => {
			resolveCreate(bucket('child', 'Child'))
			await creating
		})

		await waitFor(() => expect(api.moveBucket).toHaveBeenCalledWith('child', 'parent', 0))
	})

	it('reconciles a created bucket to root after nesting fails without losing a later board move', async () => {
		const creating = deferred<BoardBucket>()
		const nesting = deferred<BoardBucket[]>()
		const laterMove = deferred<BoardBucket[]>()
		const parent = bucket('parent', 'Parent')
		const later = bucket('later', 'Later')
		const target = bucket('target', 'Target')
		const created = bucket('created', 'Created')
		const finalTree = [parent, { ...target, children: [later] }, created]
		vi.mocked(api.createBucket).mockReturnValue(creating.promise)
		vi.mocked(api.moveBucket)
			.mockReturnValueOnce(nesting.promise)
			.mockReturnValueOnce(laterMove.promise)
		vi.mocked(api.listBuckets).mockResolvedValue(finalTree)
		bucketStore.setTree([parent, later, target])

		render(<BucketBoard isOwner onOpen={vi.fn()} reviews={[]} />)
		await screen.findByTitle(TILE_TITLE)
		openBucket('Parent')
		fireEvent.click(within(bucketRegion('Parent')).getByTitle('하위 버킷 추가'))
		await waitFor(() => expect(api.createBucket).toHaveBeenCalledTimes(1))

		await act(async () => {
			creating.resolve(created)
			await creating.promise
		})
		await waitFor(() => expect(api.moveBucket).toHaveBeenNthCalledWith(1, 'created', 'parent', 0))
		expect(findStoredBucket('parent')?.children.map(item => item.id)).toEqual(['created'])

		openBucket('Later')
		fireEvent.click(within(bucketRegion('Later')).getByTitle('버킷 동작'))
		fireEvent.click(within(screen.getByRole('dialog', { name: 'Later' })).getByRole('button', { name: '이동 / 중첩' }))
		fireEvent.click(within(screen.getByRole('dialog', { name: '이동 / 중첩할 위치' })).getByRole('button', { name: 'Target' }))
		expect(findStoredBucket('target')?.children.map(item => item.id)).toEqual(['later'])
		expect(api.moveBucket).toHaveBeenCalledTimes(1)

		await act(async () => {
			nesting.reject(new Error('nest failed'))
			await Promise.resolve()
		})
		await waitFor(() => expect(api.moveBucket).toHaveBeenNthCalledWith(2, 'later', 'target', 0))
		expect(bucketStore.getTree().map(item => item.id)).toEqual(['parent', 'target', 'created'])
		expect(findStoredBucket('parent')?.children).toEqual([])
		expect(findStoredBucket('target')?.children.map(item => item.id)).toEqual(['later'])
		expect(api.listBuckets).not.toHaveBeenCalled()

		await act(async () => {
			laterMove.resolve(finalTree)
			await laterMove.promise
		})
		await waitFor(() => expect(api.listBuckets).toHaveBeenCalledTimes(1))
		expect(bucketStore.getTree()).toEqual(finalTree)
	})

	it('replays a later cross-island move when a nested before-gap move fails', async () => {
		const nestedMove = deferred<BoardBucket[]>()
		const laterMove = deferred<void>()
		const childX = bucket('child-x', 'Child X')
		const childY = bucket('child-y', 'Child Y')
		const parent = bucket('parent', 'Parent')
		parent.children = [childX, childY]
		const rootZ = bucket('root-z', 'Root Z')
		const initial = [parent, rootZ]
		const laterProjection = (tree: BoardBucket[]) => {
			const next = structuredClone(tree)
			const rootIndex = next.findIndex(item => item.id === 'root-z')
			const parentNode = api.findBucket(next, 'parent')
			if (rootIndex < 0 || !parentNode)
				return next
			const [moved] = next.splice(rootIndex, 1)
			const beforeIndex = parentNode.children.findIndex(item => item.id === 'child-y')
			parentNode.children.splice(beforeIndex, 0, moved)
			return next
		}
		const finalTree = laterProjection(initial)
		vi.mocked(api.moveBucket).mockReturnValueOnce(nestedMove.promise)
		vi.mocked(api.listBuckets).mockResolvedValue(finalTree)
		bucketStore.setTree(initial)

		const { container } = render(<BucketBoard isOwner onOpen={vi.fn()} reviews={[]} />)
		await screen.findByTitle(TILE_TITLE)
		openBucket('Parent')
		const source = screen.getByRole('button', { name: 'Child Y 버킷 열기' })
		const childXNode = container.querySelector('[data-bucket-inline-node="child-x"]')
		const beforeChildXGap = childXNode?.parentElement?.firstElementChild
		if (!(beforeChildXGap instanceof HTMLElement))
			throw new Error('Missing nested gap before Child X')
		fireEvent.dragStart(source, { dataTransfer: { effectAllowed: 'move' } })
		fireEvent.dragOver(beforeChildXGap)
		fireEvent.drop(beforeChildXGap)

		await waitFor(() => expect(api.moveBucket).toHaveBeenCalledWith('child-y', 'parent', 0))
		expect(findStoredBucket('parent')?.children.map(item => item.id)).toEqual(['child-y', 'child-x'])

		let endLaterMove!: () => void
		let laterRun!: Promise<void>
		act(() => {
			endLaterMove = bucketStore.beginStructuralMutation()
			bucketStore.setTree(laterProjection(bucketStore.getTree()))
			laterRun = bucketStore.enqueueStructuralMutation(
				async ({ tree, commitTree }) => {
					expect(findStoredBucket('parent', tree)?.children.map(item => item.id)).toEqual(['child-x', 'child-y'])
					await laterMove.promise
					commitTree(laterProjection(tree))
				},
				laterProjection,
			)
		})
		expect(findStoredBucket('parent')?.children.map(item => item.id)).toEqual(['root-z', 'child-y', 'child-x'])

		await act(async () => {
			nestedMove.reject(new Error('nested move failed'))
			await Promise.resolve()
		})
		await waitFor(() => {
			expect(findStoredBucket('parent')?.children.map(item => item.id)).toEqual(['child-x', 'root-z', 'child-y'])
		})
		expect(api.listBuckets).not.toHaveBeenCalled()

		await act(async () => {
			laterMove.resolve()
			await laterRun
			endLaterMove()
		})
		await waitFor(() => expect(api.listBuckets).toHaveBeenCalledTimes(1))
		expect(bucketStore.getTree()).toEqual(finalTree)
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

		render(<BucketBoard isOwner onOpen={vi.fn()} reviews={[]} />)

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

		const { container } = render(<BucketBoard isOwner onOpen={vi.fn()} reviews={[]} />)
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

		const { container } = render(<BucketBoard isOwner onOpen={vi.fn()} reviews={[]} />)
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

		const { container } = render(<BucketBoard isOwner onOpen={vi.fn()} reviews={[]} />)
		await screen.findByTitle(TILE_TITLE)
		const toggle = screen.getByRole('button', { name: `${name} 버킷 열기` })
		expect(toggle).toHaveAttribute('aria-controls', 'bucket-inline-region-long-name')
		expect(container.querySelector('.bb-bucket-title')).toHaveTextContent(name)
	})

	it('toggles the owning disclosure with Enter and Space', async () => {
		bucketStore.setTree([bucket('keyboard', 'Keyboard')])

		render(<BucketBoard isOwner onOpen={vi.fn()} reviews={[]} />)
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
		const { container } = render(<BucketBoard isOwner onOpen={vi.fn()} reviews={[]} />)
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
		const { container } = render(<BucketBoard isOwner onOpen={vi.fn()} reviews={[]} />)
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

		render(<BucketBoard isOwner onOpen={vi.fn()} reviews={[]} />)
		const tile = await screen.findByTitle(`Track member — ${ALBUM_ARTIST}`)
		expect(tile.querySelector('[data-album-card-layout]')).toBeNull()
		expect(within(tile).getByText('트랙')).toBeInTheDocument()
	})
})

// SEC-member-listening-data-boundary Step 1 — the 최근 들은 앨범 strip.
//
// Gating the FETCH alone is not enough here: this strip seeds its state from a
// localStorage cache (`lf_crate_recent`), so a member who loaded the board while
// the read was still ungated would keep painting the OWNER's albums from their
// own browser forever after the server closed. These two pin both halves.
function _cachedOwnerAlbum() {
	return {
		itemId: 'recent:owner-album',
		itemType: 'album',
		albumId: 'owner-album',
		trackId: null,
		reviewTargetId: null,
		artistId: null,
		title: '오너의 앨범',
		artist: 'Owner Artist',
		cover: null,
		year: 2026,
		alreadyReviewed: false,
		postId: null,
		researchSelected: false,
	}
}

describe('bucketBoard 최근 들은 앨범 owner boundary', () => {
	beforeEach(() => {
		localStorage.clear()
		vi.mocked(spotifyApi.listRecentlyListened).mockResolvedValue({ items: [], lastSyncedAt: null })
	})

	it('does not read recently-listened for a member', async () => {
		render(<BucketBoard isOwner={false} onOpen={vi.fn()} reviews={[]} />)
		await waitFor(() => expect(vi.mocked(api.listBuckets)).toHaveBeenCalled())
		expect(vi.mocked(spotifyApi.listRecentlyListened)).not.toHaveBeenCalled()
	})

	// The eviction effect and the refused seed are indistinguishable AFTER mount —
	// both end at an empty strip. This probe separates them. Its `useLayoutEffect`
	// fires after the initial commit but before BucketBoard's passive effect, so it
	// captures exactly the frame a member would see painted if the seed were read.
	// Without it, dropping the seed guard and keeping only the eviction is a mutant
	// the suite cannot kill (checked — it survived).
	function FirstPaintProbe({ onCommit }: { onCommit: (html: string) => void }) {
		useLayoutEffect(() => {
			onCommit(document.body.innerHTML)
		}, [onCommit])
		return null
	}

	it('never paints a cache written before the gate, not even for one frame', async () => {
		localStorage.setItem('lf_crate_recent', JSON.stringify([_cachedOwnerAlbum()]))
		let firstPaint = ''
		const onCommit = (html: string) => {
			firstPaint = html
		}

		render(
			<>
				<BucketBoard isOwner={false} onOpen={vi.fn()} reviews={[]} />
				<FirstPaintProbe onCommit={onCommit} />
			</>,
		)

		expect(firstPaint).not.toContain('오너의 앨범')
		await waitFor(() => expect(localStorage.getItem('lf_crate_recent')).toBeNull())
	})

	it('evicts a cache written before the gate instead of painting it', async () => {
		localStorage.setItem('lf_crate_recent', JSON.stringify([_cachedOwnerAlbum()]))

		render(<BucketBoard isOwner={false} onOpen={vi.fn()} reviews={[]} />)

		await waitFor(() => expect(localStorage.getItem('lf_crate_recent')).toBeNull())
		expect(screen.queryByText('오너의 앨범')).toBeNull()
	})
})
