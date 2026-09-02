/**
 * @vitest-environment-options { "url": "https://blog.test/" }
 */
// FIX-auth-identity-lifecycle Step 1 — the bucket store follows the account.
//
// The defect: `scope` and `cacheKey` were module constants, computed once when the
// module was first imported. That is correct for the page load that computed them and
// permanently wrong for a tab that was already open when the account changed. The store
// went on painting account A's tree, and any read A had already issued wrote its result
// under A's key — into a UI now labelled B.
//
// The reversed case is the one that matters and it is the one an "account changed →
// tree cleared" test misses: the account switch and the resolution of A's in-flight
// fetch happen in the other order.
import type { BoardBucket } from '@lib/buckets'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@lib/buckets', () => ({ listBuckets: vi.fn() }))

function idTokenFor(sub: string): string {
  return `header.${btoa(JSON.stringify({ sub }))}.signature`
}

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
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

/** See authIdentity.test.ts — the write lands first, the event is a later delivery. */
function otherTabWrote(key: string, value: string | null): void {
  const oldValue = localStorage.getItem(key)
  if (value === null)
    localStorage.removeItem(key)
  else localStorage.setItem(key, value)
  window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue: value }))
}

const CACHE_PREFIX = 'pb:cache:buckets:'

async function freshStore() {
  vi.resetModules()
  const buckets = await import('@lib/buckets')
  const store = await import('./bucketStore')
  return { ...store, listBuckets: vi.mocked(buckets.listBuckets) }
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('bucketStore across an account boundary', () => {
  it('keys the cache by the signed-in account rather than a fixed scope', async () => {
    localStorage.setItem('id_token', idTokenFor('user-a'))
    const { bucketStore, listBuckets } = await freshStore()
    listBuckets.mockResolvedValue([bucket('b1')])

    await bucketStore.ensureFresh(true)

    expect(sessionStorage.getItem(`${CACHE_PREFIX}user-a`)).not.toBeNull()
  })

  it('drops the result of account A\'s in-flight read when it lands after a switch to B', async () => {
    localStorage.setItem('id_token', idTokenFor('user-a'))
    const { bucketStore, listBuckets } = await freshStore()
    const pending = deferred<BoardBucket[]>()
    listBuckets.mockReturnValue(pending.promise)

    const inflight = bucketStore.ensureFresh(true)
    // The account switches while A's tree is still on the wire…
    otherTabWrote('id_token', idTokenFor('user-b'))
    // …and only then does A's tree arrive.
    pending.resolve([bucket('a-private', 'A의 비공개 버킷')])
    await inflight

    expect(bucketStore.getSnapshot().tree).toBeNull()
    expect(sessionStorage.getItem(`${CACHE_PREFIX}user-b`)).toBeNull()
  })

  it('never writes account A\'s late tree under account B\'s cache key', async () => {
    localStorage.setItem('id_token', idTokenFor('user-a'))
    const { bucketStore, listBuckets } = await freshStore()
    const pending = deferred<BoardBucket[]>()
    listBuckets.mockReturnValue(pending.promise)

    const inflight = bucketStore.ensureFresh(true)
    otherTabWrote('id_token', idTokenFor('user-b'))
    pending.resolve([bucket('a-private')])
    await inflight

    const stored = sessionStorage.getItem(`${CACHE_PREFIX}user-b`)
    expect(stored).toBeNull()
    expect(JSON.stringify(sessionStorage)).not.toContain('a-private')
  })

  it('stops painting account A\'s cached tree the moment the account changes', async () => {
    localStorage.setItem('id_token', idTokenFor('user-a'))
    const { bucketStore, listBuckets } = await freshStore()
    listBuckets.mockResolvedValue([bucket('a-only')])
    await bucketStore.ensureFresh(true)
    expect(bucketStore.getSnapshot().tree).toHaveLength(1)

    otherTabWrote('id_token', idTokenFor('user-b'))

    expect(bucketStore.getSnapshot().tree).toBeNull()
  })

  it('erases account A\'s cached blob from the device on the switch', async () => {
    localStorage.setItem('id_token', idTokenFor('user-a'))
    const { bucketStore, listBuckets } = await freshStore()
    listBuckets.mockResolvedValue([bucket('a-only')])
    await bucketStore.ensureFresh(true)
    expect(sessionStorage.getItem(`${CACHE_PREFIX}user-a`)).not.toBeNull()

    otherTabWrote('id_token', idTokenFor('user-b'))

    expect(sessionStorage.getItem(`${CACHE_PREFIX}user-a`)).toBeNull()
  })

  it('repoints the cache key rather than only clearing it', async () => {
    // Rescoping has to leave a WORKING store, not just an empty one — a store that had
    // simply forgotten how to write its cache would satisfy every "cleared" assertion
    // above. After the switch, B's own read must land under B's key.
    //
    // This deliberately does not assert that B's PRE-EXISTING cached tree is restored.
    // It would not be: `ensureSeeded` prunes every other scope's blob, so whichever
    // account seeds first on this device removes the other's. That is the isolation
    // guarantee the module was built around, and an earlier draft of this test passed
    // only because it never let account A seed — an ordering the real tray never has.
    localStorage.setItem('id_token', idTokenFor('user-a'))
    const { bucketStore, listBuckets } = await freshStore()
    listBuckets.mockResolvedValue([bucket('a-only')])
    await bucketStore.ensureFresh(true)

    otherTabWrote('id_token', idTokenFor('user-b'))
    listBuckets.mockResolvedValue([bucket('b-only')])
    await bucketStore.ensureFresh(true)

    expect(bucketStore.getSnapshot().tree).toEqual([bucket('b-only')])
    expect(sessionStorage.getItem(`${CACHE_PREFIX}user-b`)).toContain('b-only')
    expect(sessionStorage.getItem(`${CACHE_PREFIX}user-a`)).toBeNull()
  })

  it('notifies subscribers so a mounted board repaints instead of showing a stale tree', async () => {
    localStorage.setItem('id_token', idTokenFor('user-a'))
    const { bucketStore, listBuckets } = await freshStore()
    listBuckets.mockResolvedValue([bucket('a-only')])
    await bucketStore.ensureFresh(true)
    let notified = 0
    bucketStore.subscribe(() => {
      notified += 1
    })

    otherTabWrote('id_token', idTokenFor('user-b'))

    expect(notified).toBeGreaterThan(0)
  })

  it('still applies a read that resolves with no account change in between', async () => {
    // The control. A store that dropped every resolving read would satisfy the
    // cases above and be useless.
    localStorage.setItem('id_token', idTokenFor('user-a'))
    const { bucketStore, listBuckets } = await freshStore()
    const pending = deferred<BoardBucket[]>()
    listBuckets.mockReturnValue(pending.promise)

    const inflight = bucketStore.ensureFresh(true)
    pending.resolve([bucket('a1')])
    await inflight

    expect(bucketStore.getSnapshot().tree).toEqual([bucket('a1')])
  })
})
