import type { OwnershipMessage, OwnershipTransport } from './ownership'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type OwnershipModule = typeof import('./ownership')

const loaded: OwnershipModule[] = []

function testBus(delayMs = 1): { transport: OwnershipTransport, messages: OwnershipMessage[] } {
  const listeners = new Set<(message: OwnershipMessage) => void>()
  const messages: OwnershipMessage[] = []
  return {
    messages,
    transport: {
      post(message) {
        messages.push(message)
        const recipients = [...listeners]
        window.setTimeout(() => {
          for (const cb of recipients) cb(message)
        }, delayMs)
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
  vi.setSystemTime(new Date('2026-08-03T00:00:00.000Z'))
  window.localStorage.clear()
  loaded.length = 0
})

afterEach(() => {
  for (const instance of loaded)
    instance.playbackOwnership.__reset()
  window.localStorage.clear()
  vi.useRealTimers()
})

describe('playback ownership', () => {
  it('transfers explicitly even while the current lease is fresh', async () => {
    const bus = testBus()
    const a = await freshOwnership(bus.transport)
    a.playbackOwnership.claim()
    const b = await freshOwnership(bus.transport)

    b.playbackOwnership.claim()
    await vi.advanceTimersByTimeAsync(1)

    expect(b.playbackOwnership.getSnapshot()).toMatchObject({ isOwner: true, ownerPresent: true })
    expect(a.playbackOwnership.getSnapshot()).toMatchObject({
      isOwner: false,
      ownerTabId: b.playbackOwnership.getSnapshot().tabId,
      ownerPresent: true,
    })
  })

  it('does not take a stale lease when the challenged owner answers asynchronously', async () => {
    const bus = testBus()
    const a = await freshOwnership(bus.transport)
    a.playbackOwnership.claim()
    await vi.advanceTimersByTimeAsync(1)
    const b = await freshOwnership(bus.transport)

    await vi.advanceTimersByTimeAsync(a.HEARTBEAT_MS - 1)
    window.localStorage.setItem('pb:playback-owner', JSON.stringify({
      tabId: a.playbackOwnership.getSnapshot().tabId,
      heartbeatAt: Date.now() - a.STALE_MS - 1,
    }))

    await vi.advanceTimersByTimeAsync(1)
    expect(bus.messages.some(message => message.type === 'challenge')).toBe(true)
    expect(bus.messages.some(message => message.type === 'alive')).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(bus.messages.some(message => message.type === 'alive')).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(a.CHALLENGE_MS)

    expect(a.playbackOwnership.getSnapshot().isOwner).toBe(true)
    expect(b.playbackOwnership.getSnapshot()).toMatchObject({
      isOwner: false,
      ownerTabId: a.playbackOwnership.getSnapshot().tabId,
      ownerPresent: true,
    })
  })

  it('claims after a stale lease owner fails to answer the challenge', async () => {
    const bus = testBus()
    window.localStorage.setItem('pb:playback-owner', JSON.stringify({
      tabId: 'crashed-tab',
      heartbeatAt: Date.now() - 15_001,
    }))
    const b = await freshOwnership(bus.transport)

    await vi.advanceTimersByTimeAsync(b.HEARTBEAT_MS)
    expect(bus.messages.some(message => message.type === 'challenge')).toBe(true)
    expect(b.playbackOwnership.getSnapshot().isOwner).toBe(false)

    await vi.advanceTimersByTimeAsync(b.CHALLENGE_MS)
    expect(b.playbackOwnership.getSnapshot()).toMatchObject({ isOwner: true, ownerPresent: true })
    expect(JSON.parse(window.localStorage.getItem('pb:playback-owner') ?? 'null')).toMatchObject({
      tabId: b.playbackOwnership.getSnapshot().tabId,
    })
  })

  it('releases immediately when the owner page is hidden for teardown', async () => {
    const bus = testBus()
    const a = await freshOwnership(bus.transport)
    a.playbackOwnership.claim()
    const b = await freshOwnership(bus.transport)

    window.dispatchEvent(new Event('pagehide'))
    expect(window.localStorage.getItem('pb:playback-owner')).toBeNull()
    expect(bus.messages.some(message => message.type === 'released')).toBe(true)

    await vi.advanceTimersByTimeAsync(1)
    expect(b.playbackOwnership.getSnapshot()).toMatchObject({
      isOwner: false,
      ownerTabId: null,
      ownerPresent: false,
    })
  })
})
