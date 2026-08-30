// ARCH-playback-authority-convergence Step 3, G1 — the 가사 button either opens
// the viewer or says why not. It used to do neither.
//
// What shipped: `cachedUri(row.trackId)` and `return` on a miss. So whether 가사
// did anything depended entirely on whether the panel's idle prefetch had happened
// to warm this row yet — the button worked on the second press and looked broken
// on the first, which is the signature of a silent failure rather than a missing
// feature.
import type { BoardAlbum } from '@lib/buckets'
import type { PlaybackSessionState } from '@lib/playback/session'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ENT_OPEN_LIVE_LYRICS } from '@lib/entityEvents'
import { openPlaybackLyrics } from './playbackEntryActions'

const mocks = vi.hoisted(() => ({
  cachedUri: vi.fn(),
  resolveUri: vi.fn(),
  reportNotice: vi.fn(),
  snapshot: { anchor: null, durationMs: null } as unknown as PlaybackSessionState,
}))

vi.mock('@lib/playback/uris', () => ({
  cachedUri: mocks.cachedUri,
  resolveUri: mocks.resolveUri,
}))

vi.mock('@lib/playback/session', () => ({
  playbackSession: {
    reportNotice: mocks.reportNotice,
    getSnapshot: () => mocks.snapshot,
  },
}))

const ROW = { itemId: 'i1', trackId: 'track-1', title: 'A Song', artist: 'Someone', cover: null } as BoardAlbum
const STATE = { anchor: null, durationMs: null, external: null } as unknown as PlaybackSessionState

function opened(): Promise<CustomEvent> {
  return new Promise((resolve) => {
    window.addEventListener(ENT_OPEN_LIVE_LYRICS, e => resolve(e as CustomEvent), { once: true })
  })
}

/** The handler is fire-and-forget by signature; give its async body a turn. */
async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.snapshot = { anchor: null, durationMs: null } as unknown as PlaybackSessionState
})

describe('openPlaybackLyrics', () => {
  it('opens straight from the cache without spending a request', async () => {
    mocks.cachedUri.mockReturnValue('spotify:track:abc')
    const event = opened()

    openPlaybackLyrics(ROW, STATE)

    expect((await event).detail.trackId).toBe('abc')
    expect(mocks.resolveUri).not.toHaveBeenCalled()
  })

  it('resolves on a cache miss instead of returning silently', async () => {
    // `undefined` is "never asked" — the state the idle prefetch leaves behind on
    // a row it has not reached yet, and the one the shipped code treated as fatal.
    mocks.cachedUri.mockReturnValue(undefined)
    mocks.resolveUri.mockResolvedValue('spotify:track:xyz')
    const event = opened()

    openPlaybackLyrics(ROW, STATE)

    expect((await event).detail.trackId).toBe('xyz')
    expect(mocks.resolveUri).toHaveBeenCalledWith('track-1')
    expect(mocks.reportNotice).not.toHaveBeenCalled()
  })

  it('does not re-ask for a uri already known not to resolve', async () => {
    // `null` is "asked, and it does not resolve" — memoised by `resolveUri`, so
    // re-asking spends a round trip to be told the same thing.
    mocks.cachedUri.mockReturnValue(null)

    openPlaybackLyrics(ROW, STATE)
    await settle()

    expect(mocks.resolveUri).not.toHaveBeenCalled()
    expect(mocks.reportNotice).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }))
  })

  it('says so when the resolve fails, rather than doing nothing', async () => {
    mocks.cachedUri.mockReturnValue(undefined)
    mocks.resolveUri.mockResolvedValue(null)
    let openedAt: unknown = null
    window.addEventListener(ENT_OPEN_LIVE_LYRICS, (e) => {
      openedAt = e
    }, { once: true })

    openPlaybackLyrics(ROW, STATE)
    await settle()

    expect(openedAt).toBeNull()
    expect(mocks.reportNotice).toHaveBeenCalledWith(expect.objectContaining({
      tone: 'error',
      reason: 'unresolvable',
    }))
  })

  it('falls back to external playback when there is no row at all', async () => {
    const event = opened()

    openPlaybackLyrics(null, { ...STATE, external: { spotifyTrackId: 'ext-1' } } as unknown as PlaybackSessionState)

    expect((await event).detail.trackId).toBe('ext-1')
    expect(mocks.cachedUri).not.toHaveBeenCalled()
  })

  it('seeds the clock from the anchor as it stands AFTER the resolve', async () => {
    // The resolve costs a round trip on a miss, and the viewer's clock has to start
    // from the playhead at OPEN time, not from where it was when the button was
    // pressed — otherwise every cache-miss open starts a request-length behind.
    mocks.cachedUri.mockReturnValue(undefined)
    mocks.resolveUri.mockImplementation(async () => {
      mocks.snapshot = { anchor: { ms: 9_000, wallMs: 5 }, durationMs: 200_000 } as unknown as PlaybackSessionState
      return 'spotify:track:xyz'
    })
    const event = opened()

    openPlaybackLyrics(ROW, { ...STATE, anchor: { ms: 1_000, wallMs: 1 } } as unknown as PlaybackSessionState)

    const detail = (await event).detail
    expect(detail.progressMs).toBe(9_000)
    expect(detail.durationMs).toBe(200_000)
  })
})
