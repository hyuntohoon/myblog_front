// Characterization tests for `bucketStore` — the shared SWR bucket-tree cache the
// board + pocket tray subscribe to. These pin the freshness / force-refetch /
// superseded-drop semantics (audit calls this the strength to build on) so any
// future refactor keeps them. bucketStore is a module SINGLETON, so each test
// resets the module registry and re-imports a fresh instance.
import type { BoardBucket } from '@lib/buckets'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Replace the network layer (`listBuckets`) with a controllable mock. The factory
// re-runs on every vi.resetModules(), so each freshStore() gets its own vi.fn.
vi.mock('@lib/buckets', () => ({ listBuckets: vi.fn() }))

function bucket(id: string, name = id): BoardBucket {
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

function moveBefore(tree: BoardBucket[], draggedId: string, targetId: string): BoardBucket[] {
  const next = [...tree]
  const from = next.findIndex(item => item.id === draggedId)
  const [moved] = next.splice(from, 1)
  next.splice(next.findIndex(item => item.id === targetId), 0, moved)
  return next
}

async function freshStore() {
  vi.resetModules()
  const buckets = await import('@lib/buckets')
  const mod = await import('./bucketStore')
  return { store: mod.bucketStore, listBuckets: vi.mocked(buckets.listBuckets) }
}

beforeEach(() => {
  sessionStorage.clear()
  vi.useRealTimers()
  vi.clearAllMocks() // reset shared-mock call history between tests
})

describe('bucketStore.ensureFresh', () => {
  it('fetches once and exposes the tree via getSnapshot', async () => {
    const { store, listBuckets } = await freshStore()
    listBuckets.mockResolvedValue([bucket('a')])

    await store.ensureFresh()

    expect(listBuckets).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().tree?.map(b => b.id)).toEqual(['a'])
    expect(store.getSnapshot().loading).toBe(false)
  })

  it('reuses a fresh cache with NO network call inside the SWR window', async () => {
    const { store, listBuckets } = await freshStore()
    listBuckets.mockResolvedValue([bucket('a')])

    await store.ensureFresh()
    await store.ensureFresh() // still fresh → no refetch

    expect(listBuckets).toHaveBeenCalledTimes(1)
  })

  it('refetches once the tree is older than the stale window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-24T00:00:00Z'))
    const { store, listBuckets } = await freshStore()
    listBuckets.mockResolvedValue([bucket('a')])

    await store.ensureFresh()
    vi.setSystemTime(new Date('2026-07-24T00:06:00Z')) // +6min > 5min window
    await store.ensureFresh()

    expect(listBuckets).toHaveBeenCalledTimes(2)
  })

  it('force=true always refetches even within the fresh window', async () => {
    const { store, listBuckets } = await freshStore()
    listBuckets.mockResolvedValue([bucket('a')])

    await store.ensureFresh()
    await store.ensureFresh(true)

    expect(listBuckets).toHaveBeenCalledTimes(2)
  })

  it('a forced refetch supersedes an in-flight non-forced fetch (stale result dropped)', async () => {
    const { store, listBuckets } = await freshStore()
    let resolveFirst: (v: BoardBucket[]) => void = () => {}
    listBuckets
      .mockImplementationOnce(() => new Promise<BoardBucket[]>((res) => { resolveFirst = res }))
      .mockResolvedValueOnce([bucket('forced')])

    const p1 = store.ensureFresh() // in-flight, unresolved
    const p2 = store.ensureFresh(true) // forced — issues its own fetch
    await p2
    // now let the original (superseded) fetch resolve with stale data
    resolveFirst([bucket('stale')])
    await p1

    // the forced result wins; the late stale result is discarded by the fetchSeq guard
    expect(store.getSnapshot().tree?.map(b => b.id)).toEqual(['forced'])
  })

  it('does not let an older forced refresh overwrite a newer optimistic mutation', async () => {
    const { store, listBuckets } = await freshStore()
    let resolveRefresh: (v: BoardBucket[]) => void = () => {}
    listBuckets.mockImplementationOnce(() => new Promise<BoardBucket[]>((resolve) => {
      resolveRefresh = resolve
    }))

    const refresh = store.ensureFresh(true)
    store.setTree([bucket('newer-mutation')])
    resolveRefresh([bucket('stale-refresh')])
    await refresh

    expect(store.getSnapshot().tree?.map(b => b.id)).toEqual(['newer-mutation'])
    expect(store.getSnapshot().loading).toBe(false)
  })

  it('defers a forced refresh until every structural mutation settles', async () => {
    const { store, listBuckets } = await freshStore()
    listBuckets.mockResolvedValue([bucket('server-after-mutations')])
    const endFirst = store.beginStructuralMutation()
    const endSecond = store.beginStructuralMutation()
    store.setTree([bucket('optimistic')])

    const refresh = store.ensureFresh(true)
    await Promise.resolve()
    expect(listBuckets).not.toHaveBeenCalled()

    endFirst()
    await Promise.resolve()
    expect(listBuckets).not.toHaveBeenCalled()

    endSecond()
    await refresh

    expect(listBuckets).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().tree?.map(b => b.id)).toEqual(['server-after-mutations'])
  })

  it('records an error message when the fetch rejects', async () => {
    const { store, listBuckets } = await freshStore()
    listBuckets.mockRejectedValue(new Error('load failed'))

    await store.ensureFresh()

    expect(store.getSnapshot().error).toBe('load failed')
    expect(store.getSnapshot().tree).toBeNull()
  })
})

describe('bucketStore.setTree / clear', () => {
  it('setTree optimistically replaces the tree and persists to sessionStorage', async () => {
    const { store } = await freshStore()
    store.setTree([bucket('opt')])

    expect(store.getSnapshot().tree?.map(b => b.id)).toEqual(['opt'])
    // persisted under this scope's key so a same-tab navigation reuses it
    const keys = Object.keys(sessionStorage).filter(k => k.startsWith('pb:cache:buckets:'))
    expect(keys.length).toBe(1)
  })

  it('clear drops the in-memory tree and the cached blob', async () => {
    const { store } = await freshStore()
    store.setTree([bucket('opt')])
    store.clear()

    expect(store.getSnapshot().tree).toBeNull()
    const keys = Object.keys(sessionStorage).filter(k => k.startsWith('pb:cache:buckets:'))
    expect(keys.length).toBe(0)
  })

  it('notifies subscribers on setTree', async () => {
    const { store } = await freshStore()
    const cb = vi.fn()
    const unsub = store.subscribe(cb)
    store.setTree([bucket('opt')])
    expect(cb).toHaveBeenCalled()
    unsub()
  })
})

describe('bucketStore.enqueueStructuralMutation', () => {
  it('invokes structural requests in FIFO order', async () => {
    const { store } = await freshStore()
    const first = deferred<void>()
    const second = deferred<void>()
    const invoked: string[] = []

    const firstRun = store.enqueueStructuralMutation(() => {
      invoked.push('first')
      return first.promise
    })
    const secondRun = store.enqueueStructuralMutation(() => {
      invoked.push('second')
      return second.promise
    })
    await Promise.resolve()
    expect(invoked).toEqual(['first'])

    first.resolve()
    await firstRun
    await Promise.resolve()
    expect(invoked).toEqual(['first', 'second'])

    second.resolve()
    await secondRun
  })

  it('continues with the next request after a rejection', async () => {
    const { store } = await freshStore()
    const first = deferred<void>()
    const invoked: string[] = []

    const firstRun = store.enqueueStructuralMutation(() => {
      invoked.push('first')
      return first.promise
    })
    const secondRun = store.enqueueStructuralMutation(async () => {
      invoked.push('second')
    })
    await Promise.resolve()

    first.reject(new Error('first failed'))
    await expect(firstRun).rejects.toThrow('first failed')
    await secondRun

    expect(invoked).toEqual(['first', 'second'])
  })

  it('replays later intents from the last successful server tree after a rejection', async () => {
    const { store } = await freshStore()
    store.setTree([bucket('a'), bucket('b')])
    const first = deferred<void>()

    const firstRun = store.enqueueStructuralMutation(async ({ commitTree }) => {
      await first.promise
      commitTree([bucket('failed-tree')])
    })
    const secondRun = store.enqueueStructuralMutation(async ({ tree, commitTree }) => {
      expect(tree.map(item => item.id)).toEqual(['a', 'b'])
      commitTree([bucket('second-success')])
    })
    await Promise.resolve()

    first.reject(new Error('first failed'))
    await expect(firstRun).rejects.toThrow('first failed')
    await secondRun
  })

  it('removes a failed optimistic projection while preserving later queued intent', async () => {
    const { store } = await freshStore()
    const initial = [bucket('a'), bucket('b'), bucket('c'), bucket('d')]
    const deleteRequest = deferred<void>()
    const moveRequest = deferred<void>()
    const withoutA = (tree: BoardBucket[]) => tree.filter(item => item.id !== 'a')
    const moveC = (tree: BoardBucket[]) => moveBefore(tree, 'c', 'b')
    store.setTree(initial)

    const endDelete = store.beginStructuralMutation()
    store.setTree(withoutA(store.getTree()))
    const deleting = store.enqueueStructuralMutation(
      async () => deleteRequest.promise,
      withoutA,
    )
    const endMove = store.beginStructuralMutation()
    store.setTree(moveC(store.getTree()))
    const moving = store.enqueueStructuralMutation(
      async ({ tree, commitTree }) => {
        expect(tree.map(item => item.id)).toEqual(['a', 'b', 'c', 'd'])
        await moveRequest.promise
        commitTree(moveC(tree))
      },
      moveC,
    )

    deleteRequest.reject(new Error('delete failed'))
    await expect(deleting).rejects.toThrow('delete failed')
    endDelete()
    expect(store.getTree().map(item => item.id)).toEqual(['a', 'c', 'b', 'd'])

    moveRequest.resolve()
    await moving
    endMove()
  })

  it('keeps an intent enqueued after failure while the rollback refresh is still deferred', async () => {
    const { store, listBuckets } = await freshStore()
    const initial = [bucket('a'), bucket('b'), bucket('c')]
    const deleteRequest = deferred<void>()
    const moveRequest = deferred<void>()
    const withoutA = (tree: BoardBucket[]) => tree.filter(item => item.id !== 'a')
    const moveC = (tree: BoardBucket[]) => moveBefore(tree, 'c', 'b')
    listBuckets.mockResolvedValue(moveC(initial))
    store.setTree(initial)

    const endDelete = store.beginStructuralMutation()
    store.setTree(withoutA(store.getTree()))
    const deleting = store.enqueueStructuralMutation(
      async () => deleteRequest.promise,
      withoutA,
    )
    deleteRequest.reject(new Error('delete failed'))
    await expect(deleting).rejects.toThrow('delete failed')
    expect(store.getTree().map(item => item.id)).toEqual(['a', 'b', 'c'])

    // A different island can issue a new optimistic action before the failed
    // caller reaches its catch/finally and schedules the forced refresh.
    const endMove = store.beginStructuralMutation()
    store.setTree(moveC(store.getTree()))
    const moving = store.enqueueStructuralMutation(
      async ({ tree, commitTree }) => {
        expect(tree.map(item => item.id)).toEqual(['a', 'b', 'c'])
        await moveRequest.promise
        commitTree(moveC(tree))
      },
      moveC,
    )
    endDelete()
    const refresh = store.ensureFresh(true)
    await Promise.resolve()
    expect(listBuckets).not.toHaveBeenCalled()
    expect(store.getTree().map(item => item.id)).toEqual(['a', 'c', 'b'])

    moveRequest.resolve()
    await moving
    endMove()
    await refresh

    expect(listBuckets).toHaveBeenCalledTimes(1)
    expect(store.getTree().map(item => item.id)).toEqual(['a', 'c', 'b'])
  })
})
