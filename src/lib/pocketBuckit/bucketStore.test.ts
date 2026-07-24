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
