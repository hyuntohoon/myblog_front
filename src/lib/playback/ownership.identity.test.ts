/**
 * @vitest-environment-options { "url": "https://blog.test/" }
 */
// FIX-auth-identity-lifecycle Step 1 — the account boundary for playback ownership.
//
// The bus is shared by every tab on this origin, and those tabs need not be the same
// account: a switch in one leaves the others running under the old one until they
// notice. Before the account stamp, tab A's `command` and `state` envelopes were
// indistinguishable from tab B's — so account A could drive account B's transport, and
// read back what B was listening to.
//
// Scope note: this covers the BOUNDARY only. Transport and queue correctness belong to
// ARCH-playback-authority-convergence, and the lease key stays origin-scoped on purpose
// — two accounts in one browser still share one pair of speakers, so one owner per
// origin remains the right rule.
import type { OwnershipMessage, OwnershipTransport } from './ownership'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type OwnershipModule = typeof import('./ownership')

const loaded: OwnershipModule[] = []

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

/** A bus this test drives by hand, so a message's arrival is an explicit step. */
function manualBus(): { transport: OwnershipTransport, deliver: (message: OwnershipMessage) => void, sent: OwnershipMessage[] } {
  const listeners = new Set<(message: OwnershipMessage) => void>()
  const sent: OwnershipMessage[] = []
  return {
    sent,
    deliver(message) {
      for (const cb of [...listeners]) cb(message)
    },
    transport: {
      post(message) {
        sent.push(message)
      },
      onMessage(cb) {
        listeners.add(cb)
        return () => listeners.delete(cb)
      },
    },
  }
}

async function freshOwnership(transport: OwnershipTransport): Promise<OwnershipModule> {
  vi.resetModules()
  const instance = await import('./ownership')
  instance.__setTransport(transport)
  loaded.push(instance)
  return instance
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'))
  localStorage.clear()
  loaded.length = 0
})

afterEach(() => {
  for (const instance of loaded)
    instance.__setTransport(null)
  vi.useRealTimers()
})

describe('bus messages carry the sending account', () => {
  it('stamps every outbound message with the current account', async () => {
    localStorage.setItem('id_token', idTokenFor('user-a'))
    const bus = manualBus()
    const ownership = await freshOwnership(bus.transport)

    ownership.playbackOwnership.claim()

    expect(bus.sent.at(-1)).toMatchObject({ type: 'claimed', acct: 'user-a' })
  })

  it('re-stamps after an account change rather than reusing a captured value', async () => {
    localStorage.setItem('id_token', idTokenFor('user-a'))
    const bus = manualBus()
    const ownership = await freshOwnership(bus.transport)

    otherTabWrote('id_token', idTokenFor('user-b'))
    ownership.playbackOwnership.claim()

    expect(bus.sent.at(-1)).toMatchObject({ acct: 'user-b' })
  })
})

describe('messages from another account are dropped', () => {
  it('does not let account A\'s claim take ownership away from account B\'s tab', async () => {
    localStorage.setItem('id_token', idTokenFor('user-b'))
    const bus = manualBus()
    const ownership = await freshOwnership(bus.transport)
    ownership.playbackOwnership.claim()
    expect(ownership.playbackOwnership.getSnapshot().isOwner).toBe(true)

    bus.deliver({ type: 'claimed', from: 'tab-a', acct: 'user-a' })

    expect(ownership.playbackOwnership.getSnapshot().isOwner).toBe(true)
  })

  it('does not forward another account\'s state/command messages to the session', async () => {
    // The layer that matters most: a `state` envelope from the old account would
    // repaint the new account's now-playing with someone else's listening.
    localStorage.setItem('id_token', idTokenFor('user-b'))
    const bus = manualBus()
    const ownership = await freshOwnership(bus.transport)
    const seen: OwnershipMessage[] = []
    ownership.playbackOwnership.onMessage(message => seen.push(message))

    bus.deliver({ type: 'state', from: 'tab-a', acct: 'user-a', state: { playing: true } })
    bus.deliver({ type: 'command', from: 'tab-a', acct: 'user-a', cmd: { kind: 'pause' } })

    expect(seen).toEqual([])
  })

  it('drops an unstamped message from a tab still running the previous bundle', async () => {
    // Fail closed. An unstamped envelope cannot be attributed to any account, so
    // trusting it would leave the hole open for exactly the case the stamp closes.
    //
    // The line that enforces this is the account comparison in `handleMessage`
    // (`undefined` matches no account), NOT the `typeof message.acct` check in
    // `isOwnershipMessage` — deleting that one leaves this test green, which is how
    // its comment came to be corrected. It earns its place as a type-level guard, not
    // as a second filter, and this test is deliberately not asserting otherwise.
    localStorage.setItem('id_token', idTokenFor('user-b'))
    const bus = manualBus()
    const ownership = await freshOwnership(bus.transport)
    const seen: OwnershipMessage[] = []
    ownership.playbackOwnership.onMessage(message => seen.push(message))

    bus.deliver({ type: 'state', from: 'tab-a', state: { playing: true } } as unknown as OwnershipMessage)

    expect(seen).toEqual([])
  })

  it('still delivers messages from the SAME account', async () => {
    // The control. A filter that rejected everything would satisfy all of the above
    // and silently break every legitimate cross-tab mirror.
    localStorage.setItem('id_token', idTokenFor('user-b'))
    const bus = manualBus()
    const ownership = await freshOwnership(bus.transport)
    const seen: OwnershipMessage[] = []
    ownership.playbackOwnership.onMessage(message => seen.push(message))

    bus.deliver({ type: 'state', from: 'tab-other', acct: 'user-b', state: { playing: true } })

    expect(seen).toHaveLength(1)
  })
})

describe('ownership resets at the account boundary', () => {
  it('gives up the lease when the account changes in another tab', async () => {
    localStorage.setItem('id_token', idTokenFor('user-a'))
    const bus = manualBus()
    const ownership = await freshOwnership(bus.transport)
    ownership.playbackOwnership.claim()
    expect(localStorage.getItem('pb:playback-owner')).not.toBeNull()

    otherTabWrote('id_token', idTokenFor('user-b'))

    expect(ownership.playbackOwnership.getSnapshot().isOwner).toBe(false)
    expect(localStorage.getItem('pb:playback-owner')).toBeNull()
  })

  it('tells the other tabs it released, so none of them waits out the stale window', async () => {
    localStorage.setItem('id_token', idTokenFor('user-a'))
    const bus = manualBus()
    const ownership = await freshOwnership(bus.transport)
    ownership.playbackOwnership.claim()
    bus.sent.length = 0

    otherTabWrote('id_token', idTokenFor('user-b'))

    expect(bus.sent).toContainEqual(expect.objectContaining({ type: 'released' }))
  })

  it('resets on logout as well as on a switch', async () => {
    localStorage.setItem('id_token', idTokenFor('user-a'))
    const bus = manualBus()
    const ownership = await freshOwnership(bus.transport)
    ownership.playbackOwnership.claim()

    otherTabWrote('id_token', null)

    expect(ownership.playbackOwnership.getSnapshot().isOwner).toBe(false)
  })

  it('keeps the lease while the account is unchanged', async () => {
    // The control for the resets: an ownership module that dropped its lease on any
    // storage event would pass the three above and lose playback constantly.
    localStorage.setItem('id_token', idTokenFor('user-a'))
    const bus = manualBus()
    const ownership = await freshOwnership(bus.transport)
    ownership.playbackOwnership.claim()

    otherTabWrote('pb:design', '{"order":"name"}')

    expect(ownership.playbackOwnership.getSnapshot().isOwner).toBe(true)
  })
})
