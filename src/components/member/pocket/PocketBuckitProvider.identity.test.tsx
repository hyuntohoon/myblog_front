/**
 * @vitest-environment-options { "url": "https://blog.test/" }
 */
// FIX-auth-identity-lifecycle Step 1 — private Pocket UI closes at the account boundary.
//
// The provider is mounted once by the layout and `transition:persist`ed, which makes it
// precisely the thing that does NOT get torn down when the account changes in another
// tab. Everything it holds is account-private: which drawers are open names the user's
// bucket ids, the undo toast carries a re-add closure that would run against whoever is
// signed in when it is pressed, and edit mode is a destructive affordance the new
// account never enabled.
//
// The persisted drawer-position map is checked here too. RFC open question 1 was
// resolved account-private at acceptance, because its keys ARE bucket ids: a shared
// `pb:drawers` handed the next person on the same device a readable list of them.
import type { ReactNode } from 'react'
import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PocketBuckitProvider, usePocket } from './PocketBuckitProvider'

const authMock = vi.hoisted(() => ({ loggedIn: false }))

vi.mock('@lib/auth', () => ({
  isLoggedIn: () => authMock.loggedIn,
}))

const listBuckets = vi.hoisted(() => vi.fn().mockResolvedValue([]))

vi.mock('@lib/buckets', async importOriginal => ({
  ...(await importOriginal<typeof import('@lib/buckets')>()),
  listBuckets,
}))

function idTokenFor(sub: string): string {
  return `header.${btoa(JSON.stringify({ sub }))}.signature`
}

function otherTabWrote(key: string, value: string | null): void {
  const oldValue = localStorage.getItem(key)
  if (value === null)
    localStorage.removeItem(key)
  else localStorage.setItem(key, value)
  window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue: value }))
}

/**
 * Put the identity singleton into a known signed-in state.
 *
 * It has to go through the storage-event path rather than a bare `setItem`. The module
 * is imported once for the whole file and carries its identity between tests, so a test
 * that only wrote the token would leave the singleton on the PREVIOUS test's account —
 * and then its own "switch to user-b" would be a no-op change that fires no callback and
 * passes for the wrong reason. (It did, before this helper existed.)
 */
function signedInAs(sub: string): void {
  otherTabWrote('id_token', idTokenFor(sub))
}

type Pocket = ReturnType<typeof usePocket>
let pocket: Pocket

function Probe(): ReactNode {
  pocket = usePocket()
  return null
}

function mount() {
  return render(<PocketBuckitProvider><Probe /></PocketBuckitProvider>)
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  authMock.loggedIn = false
  listBuckets.mockClear()
})

describe('pocket private UI at the account boundary', () => {
  it('closes every open drawer when the account changes in another tab', () => {
    signedInAs('user-a')
    mount()
    act(() => {
      pocket.openDrawer('bucket-1')
      pocket.openDrawer('bucket-2')
    })
    expect(pocket.openDrawers).toHaveLength(2)

    act(() => otherTabWrote('id_token', idTokenFor('user-b')))

    expect(pocket.openDrawers).toEqual([])
  })

  it('closes the tray and leaves edit mode', () => {
    signedInAs('user-a')
    mount()
    act(() => {
      pocket.setOpen(true)
      pocket.setEditMode(true)
    })

    act(() => otherTabWrote('id_token', idTokenFor('user-b')))

    expect(pocket.open).toBe(false)
    expect(pocket.editMode).toBe(false)
  })

  it('closes on logout too, not only on a switch to another account', () => {
    signedInAs('user-a')
    mount()
    act(() => pocket.openDrawer('bucket-1'))

    act(() => otherTabWrote('id_token', null))

    expect(pocket.openDrawers).toEqual([])
  })

  it('leaves the drawers alone while the account is unchanged', () => {
    // The control. A provider that closed its drawers on any storage event — or on
    // every render — would satisfy the three cases above and be unusable.
    signedInAs('user-a')
    mount()
    act(() => pocket.openDrawer('bucket-1'))

    act(() => otherTabWrote('pb:design', '{"order":"name"}'))

    expect(pocket.openDrawers).toHaveLength(1)
  })
})

describe('persisted drawer positions are account-private', () => {
  it('writes a moved drawer under the signed-in account\'s own key', () => {
    signedInAs('user-a')
    mount()

    act(() => pocket.moveDrawer('bucket-1', { x: 10, y: 20 }))

    expect(JSON.parse(localStorage.getItem('pb:drawers:user-a') ?? '{}')).toEqual({ 'bucket-1': { x: 10, y: 20 } })
    expect(localStorage.getItem('pb:drawers')).toBeNull()
  })

  it('does not show account B the positions — or the bucket ids — account A left behind', () => {
    signedInAs('user-a')
    localStorage.setItem('pb:drawers:user-a', JSON.stringify({ 'a-secret-bucket': { x: 5, y: 5 } }))
    mount()
    expect(pocket.drawerPosFor('a-secret-bucket')).toEqual({ x: 5, y: 5 })

    act(() => otherTabWrote('id_token', idTokenFor('user-b')))

    expect(pocket.drawerPosFor('a-secret-bucket')).toBeNull()
    // …and A's blob is gone from the device, not merely unread.
    expect(localStorage.getItem('pb:drawers:user-a')).toBeNull()
  })

  it('erases every other account\'s positions from the device as soon as one signs in', () => {
    // Namespacing alone would stop B READING A's map. Pruning is the stronger and
    // deliberate choice, matching what `bucketStore` already does with its cached
    // trees: a shared device does not keep the previous person's bucket ids lying
    // around at all. The price is that switching back does not restore a layout —
    // positions are re-clamped to the viewport when a drawer opens anyway, so what
    // is lost is a coordinate, not any of the user's work.
    localStorage.setItem('pb:drawers:user-b', JSON.stringify({ 'b-bucket': { x: 7, y: 9 } }))
    signedInAs('user-a')

    mount()

    expect(localStorage.getItem('pb:drawers:user-b')).toBeNull()
    expect(pocket.drawerPosFor('b-bucket')).toBeNull()
  })

  it('migrates the pre-Step-1 shared key to the current account exactly once', () => {
    signedInAs('user-a')
    localStorage.setItem('pb:drawers', JSON.stringify({ 'legacy-bucket': { x: 1, y: 2 } }))

    mount()

    expect(pocket.drawerPosFor('legacy-bucket')).toEqual({ x: 1, y: 2 })
    expect(localStorage.getItem('pb:drawers')).toBeNull()
    expect(localStorage.getItem('pb:drawers:user-a')).not.toBeNull()
  })
})

describe('the new account\'s tree is loaded, not just the old one dropped', () => {
  it('fetches for the account that just became current', async () => {
    // Found in a real two-tab clickthrough, not by a test: `bucketStore` rescopes to an
    // empty tree and the mount effect has already run, so without this the tray stays
    // empty for the rest of the tab's life — safe, and visibly broken.
    authMock.loggedIn = true
    signedInAs('user-a')
    mount()
    await act(async () => {})
    listBuckets.mockClear()

    await act(async () => {
      otherTabWrote('id_token', idTokenFor('user-b'))
    })

    expect(listBuckets).toHaveBeenCalled()
  })

  it('does not fetch on logout, when there is no account to fetch for', async () => {
    authMock.loggedIn = true
    signedInAs('user-a')
    mount()
    await act(async () => {})
    listBuckets.mockClear()
    authMock.loggedIn = false

    await act(async () => {
      otherTabWrote('id_token', null)
    })

    expect(listBuckets).not.toHaveBeenCalled()
  })
})
