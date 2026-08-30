import type { BoardBucket } from '@lib/buckets'
import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as buckets from '@lib/buckets'
import { bucketStore } from '@lib/pocketBuckit/bucketStore'
import { PocketBuckitProvider, usePocket } from './PocketBuckitProvider'

vi.mock('@lib/auth', () => ({
	isLoggedIn: () => false,
}))

vi.mock('@lib/buckets', async importOriginal => ({
	...(await importOriginal<typeof import('@lib/buckets')>()),
	deleteBucket: vi.fn(),
	listBuckets: vi.fn(),
	moveBucket: vi.fn(),
}))

interface Deferred<T> {
	promise: Promise<T>
	resolve: (value: T) => void
	reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

function bucket(id: string): BoardBucket {
	return {
		id,
		name: id.toUpperCase(),
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

const A = bucket('a')
const B = bucket('b')
const C = bucket('c')
const D = bucket('d')

function ids(): string[] {
	return bucketStore.getTree().map(item => item.id)
}

let pocket!: ReturnType<typeof usePocket>

function MutationHarness() {
	pocket = usePocket()
	return null
}

function renderProvider(): void {
	render(
		<PocketBuckitProvider>
			<MutationHarness />
		</PocketBuckitProvider>,
	)
}

beforeEach(() => {
	localStorage.clear()
	sessionStorage.clear()
	bucketStore.clear()
	vi.clearAllMocks()
	vi.mocked(buckets.listBuckets).mockRejectedValue(new Error('refresh unavailable'))
})

describe('pocketBuckitProvider structural mutation ordering', () => {
	it('serializes structural requests without delaying the second optimistic reorder', async () => {
		const reorderA = deferred<BoardBucket[]>()
		const reorderB = deferred<BoardBucket[]>()
		vi.mocked(buckets.moveBucket)
			.mockReturnValueOnce(reorderA.promise)
			.mockReturnValueOnce(reorderB.promise)
		bucketStore.setTree([A, B, C])
		renderProvider()

		let first!: Promise<void>
		act(() => {
			first = pocket.reorderBucket('a', 'c', 'after')
		})

		let second!: Promise<void>
		act(() => {
			second = pocket.reorderBucket('b', 'a', 'after')
		})
		expect(ids()).toEqual(['c', 'a', 'b'])
		await act(async () => {
			await Promise.resolve()
		})
		expect(buckets.moveBucket).toHaveBeenCalledTimes(1)

		await act(async () => {
			reorderA.resolve([B, C, A])
			await first
		})
		expect(buckets.moveBucket).toHaveBeenCalledTimes(2)

		await act(async () => {
			reorderB.resolve([C, A, B])
			await second
		})
	})

	it('keeps the newer reorder while queued server responses settle', async () => {
		const reorderA = deferred<BoardBucket[]>()
		const reorderB = deferred<BoardBucket[]>()
		vi.mocked(buckets.moveBucket)
			.mockReturnValueOnce(reorderA.promise)
			.mockReturnValueOnce(reorderB.promise)
		bucketStore.setTree([A, B, C])
		renderProvider()

		let first!: Promise<void>
		act(() => {
			first = pocket.reorderBucket('a', 'c', 'after')
		})
		expect(ids()).toEqual(['b', 'c', 'a'])

		let second!: Promise<void>
		act(() => {
			second = pocket.reorderBucket('b', 'a', 'after')
		})
		expect(ids()).toEqual(['c', 'a', 'b'])
		await act(async () => {
			await Promise.resolve()
		})
		expect(buckets.moveBucket).toHaveBeenNthCalledWith(1, 'a', null, 2)
		expect(buckets.moveBucket).toHaveBeenCalledTimes(1)

		await act(async () => {
			reorderA.resolve([B, C, A])
			await first
		})
		expect(buckets.moveBucket).toHaveBeenCalledTimes(2)
		expect(buckets.moveBucket).toHaveBeenNthCalledWith(2, 'b', null, 2)
		expect(ids()).toEqual(['c', 'a', 'b'])

		await act(async () => {
			reorderB.resolve([C, A, B])
			await second
		})

		expect(ids()).toEqual(['c', 'a', 'b'])
	})

	it('restores a failed delete without discarding a newer successful reorder', async () => {
		const deleteA = deferred<void>()
		vi.mocked(buckets.deleteBucket).mockReturnValue(deleteA.promise)
		vi.mocked(buckets.moveBucket).mockResolvedValue([A, C, B])
		vi.mocked(buckets.listBuckets).mockResolvedValue([A, C, B])
		bucketStore.setTree([A, B, C])
		renderProvider()

		let deleting!: Promise<void>
		act(() => {
			deleting = pocket.deleteBucket('a')
		})
		expect(ids()).toEqual(['b', 'c'])

		let reordering!: Promise<void>
		act(() => {
			reordering = pocket.reorderBucket('b', 'c', 'after')
		})
		expect(ids()).toEqual(['c', 'b'])
		await act(async () => {
			await Promise.resolve()
		})
		expect(buckets.deleteBucket).toHaveBeenCalledTimes(1)
		expect(buckets.moveBucket).not.toHaveBeenCalled()

		await act(async () => {
			deleteA.reject(new Error('delete failed'))
			await deleting
		})
		await act(async () => {
			await reordering
			await Promise.resolve()
		})

		expect(buckets.moveBucket).toHaveBeenCalledWith('b', null, 2)
		expect(buckets.listBuckets).toHaveBeenCalledTimes(1)
		expect(ids()).toEqual(['a', 'c', 'b'])
	})

	it('does not resurrect a successful delete from a concurrent reorder response', async () => {
		const deleteA = deferred<void>()
		const reorderB = deferred<BoardBucket[]>()
		vi.mocked(buckets.deleteBucket).mockReturnValue(deleteA.promise)
		vi.mocked(buckets.moveBucket).mockReturnValue(reorderB.promise)
		bucketStore.setTree([A, B, C])
		renderProvider()

		let deleting!: Promise<void>
		act(() => {
			deleting = pocket.deleteBucket('a')
		})

		let reordering!: Promise<void>
		act(() => {
			reordering = pocket.reorderBucket('b', 'c', 'after')
		})
		expect(ids()).toEqual(['c', 'b'])
		await act(async () => {
			await Promise.resolve()
		})
		expect(buckets.deleteBucket).toHaveBeenCalledTimes(1)
		expect(buckets.moveBucket).not.toHaveBeenCalled()

		await act(async () => {
			deleteA.resolve()
			await deleting
		})
		expect(ids()).toEqual(['c', 'b'])

		await act(async () => {
			reorderB.resolve([A, C, B])
			await reordering
		})
		expect(ids()).toEqual(['c', 'b'])
	})

	it('replays multiple queued reorder intents from the restored server state after a delete failure', async () => {
		const deleteA = deferred<void>()
		let serverTree = [A, B, C, D]
		vi.mocked(buckets.deleteBucket).mockReturnValue(deleteA.promise)
		vi.mocked(buckets.moveBucket).mockImplementation(async (draggedId, _parentId, position) => {
			const next = [...serverTree]
			const from = next.findIndex(item => item.id === draggedId)
			const [moved] = next.splice(from, 1)
			next.splice(position, 0, moved)
			serverTree = next
			return serverTree
		})
		vi.mocked(buckets.listBuckets).mockImplementation(async () => serverTree)
		bucketStore.setTree([A, B, C, D])
		renderProvider()

		let deleting!: Promise<void>
		act(() => {
			deleting = pocket.deleteBucket('a')
		})
		let moveC!: Promise<void>
		act(() => {
			moveC = pocket.reorderBucket('c', 'b', 'before')
		})
		let moveD!: Promise<void>
		act(() => {
			moveD = pocket.reorderBucket('d', 'c', 'before')
		})
		expect(ids()).toEqual(['d', 'c', 'b'])

		await act(async () => {
			await Promise.resolve()
			deleteA.reject(new Error('delete failed'))
			await deleting
			await moveC
			await moveD
			await Promise.resolve()
		})

		expect(buckets.moveBucket).toHaveBeenNthCalledWith(1, 'c', null, 1)
		expect(buckets.moveBucket).toHaveBeenNthCalledWith(2, 'd', null, 1)
		expect(serverTree.map(item => item.id)).toEqual(['a', 'd', 'c', 'b'])
		expect(ids()).toEqual(['a', 'd', 'c', 'b'])
	})
})
