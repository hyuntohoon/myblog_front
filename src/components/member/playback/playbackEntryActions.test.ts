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
  provider: { provider: 'spotify', trackId: null, videoId: null } as { provider: string, trackId: string | null, videoId: string | null },
  cachedUri: vi.fn(),
  resolveUri: vi.fn(),
  reportNotice: vi.fn(),
  snapshot: { anchor: null, durationMs: null } as unknown as PlaybackSessionState,
  currentRow: null as BoardAlbum | null,
  observeLive: vi.fn(),
  readLivePlayback: vi.fn(),
}))

vi.mock('@lib/playback/provider', () => ({ providerStore: { getSnapshot: () => mocks.provider } }))

vi.mock('@lib/playback/uris', () => ({
  cachedUri: mocks.cachedUri,
  resolveUri: mocks.resolveUri,
}))

vi.mock('@lib/playback/session', () => ({
  playbackSession: {
    reportNotice: mocks.reportNotice,
    getSnapshot: () => mocks.snapshot,
    currentRow: () => mocks.currentRow,
    observeLive: mocks.observeLive,
  },
}))

vi.mock('@components/member/lyrics/playback.api', () => ({ readLivePlayback: mocks.readLivePlayback }))

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
  mocks.provider = { provider: 'spotify', trackId: null, videoId: null }
  mocks.snapshot = { anchor: null, durationMs: null } as unknown as PlaybackSessionState
  mocks.currentRow = null
  // Default: the press-time read fails, so the stored-identity path below runs.
  mocks.observeLive.mockResolvedValue({ k: 'adopted', live: { state: 'unavailable' } })
})

/**
 * Press 가사 on `row`/`state` with the session holding the same — the stored-
 * identity path reads the session as it stands after the press-time read.
 */
function press(row: BoardAlbum | null, state: PlaybackSessionState): void {
  mocks.currentRow = row
  mocks.snapshot = { ...state, ...stripUndefined(mocks.snapshot) } as PlaybackSessionState
  openPlaybackLyrics(row, state)
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v != null)) as Partial<T>
}

function live(trackId: string, state: 'playing' | 'paused' | 'idle' = 'playing') {
  if (state === 'idle')
    return { state }
  return {
    state,
    trackId,
    progressMs: 61_000,
    readAtMs: 4_242,
    durationMs: 180_000,
    track: `Song ${trackId}`,
    artist: 'Live Artist',
    artists: [{ id: 'ar1', name: 'Live Artist' }],
    album: 'Live Album',
    albumSpotifyId: null,
    albumCoverUrl: `https://img/${trackId}`,
    deviceName: 'Phone',
    shuffle: null,
    repeat: null,
    volumePercent: null,
    contextUri: null,
    contextType: null,
  }
}

describe('openPlaybackLyrics', () => {
  it('opens straight from the cache without spending a request', async () => {
    mocks.cachedUri.mockReturnValue('spotify:track:abc')
    const event = opened()

    press(ROW, STATE)

    expect((await event).detail.trackId).toBe('abc')
    expect(mocks.resolveUri).not.toHaveBeenCalled()
  })

  it('resolves on a cache miss instead of returning silently', async () => {
    // `undefined` is "never asked" — the state the idle prefetch leaves behind on
    // a row it has not reached yet, and the one the shipped code treated as fatal.
    mocks.cachedUri.mockReturnValue(undefined)
    mocks.resolveUri.mockResolvedValue('spotify:track:xyz')
    const event = opened()

    press(ROW, STATE)

    expect((await event).detail.trackId).toBe('xyz')
    expect(mocks.resolveUri).toHaveBeenCalledWith('track-1')
    expect(mocks.reportNotice).not.toHaveBeenCalled()
  })

  it('does not re-ask for a uri already known not to resolve', async () => {
    // `null` is "asked, and it does not resolve" — memoised by `resolveUri`, so
    // re-asking spends a round trip to be told the same thing.
    mocks.cachedUri.mockReturnValue(null)

    press(ROW, STATE)
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

    press(ROW, STATE)
    await settle()

    expect(openedAt).toBeNull()
    expect(mocks.reportNotice).toHaveBeenCalledWith(expect.objectContaining({
      tone: 'error',
      reason: 'unresolvable',
    }))
  })

  it('falls back to external playback when there is no row at all', async () => {
    const event = opened()

    press(null, { ...STATE, external: { spotifyTrackId: 'ext-1' } } as unknown as PlaybackSessionState)

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

    press(ROW, { ...STATE, anchor: { ms: 1_000, wallMs: 1 } } as unknown as PlaybackSessionState)

    const detail = (await event).detail
    expect(detail.progressMs).toBe(9_000)
    expect(detail.durationMs).toBe(200_000)
  })
})

describe('provider-safe lyrics entry', () => {
  it('resolves an uncached external YouTube catalog track on the first press', async () => {
    mocks.provider = { provider: 'youtube', trackId: 'catalog-youtube', videoId: 'video-1' }
    mocks.cachedUri.mockReturnValue(undefined)
    mocks.resolveUri.mockResolvedValue('spotify:track:youtube-lyrics')
    const event = opened()

    openPlaybackLyrics(null, { ...STATE, external: { title: 'YouTube song', spotifyTrackId: null } } as PlaybackSessionState)

    expect((await event).detail.trackId).toBe('youtube-lyrics')
    expect(mocks.resolveUri).toHaveBeenCalledWith('catalog-youtube')
  })

  it('opens the same YouTube track when resolution also warms the session identity', async () => {
    mocks.provider = { provider: 'youtube', trackId: 'catalog-youtube', videoId: 'video-1' }
    mocks.cachedUri.mockReturnValue(undefined)
    mocks.resolveUri.mockImplementation(async () => {
      mocks.snapshot = { ...mocks.snapshot, external: { spotifyTrackId: 'resolved-youtube' } } as PlaybackSessionState
      return 'spotify:track:resolved-youtube'
    })
    const event = opened()
    openPlaybackLyrics(null, STATE)
    expect((await event).detail.trackId).toBe('resolved-youtube')
  })

  it('does not borrow a stale Spotify identity from a YouTube session without a catalog track', async () => {
    mocks.provider = { provider: 'youtube', trackId: null, videoId: 'video-1' }
    const listener = vi.fn()
    window.addEventListener(ENT_OPEN_LIVE_LYRICS, listener)
    openPlaybackLyrics(null, { ...STATE, external: { spotifyTrackId: 'old-spotify' } } as PlaybackSessionState)
    await settle()
    expect(listener).not.toHaveBeenCalled()
    expect(mocks.reportNotice).toHaveBeenCalledWith(expect.objectContaining({ reason: 'unresolvable' }))
    window.removeEventListener(ENT_OPEN_LIVE_LYRICS, listener)
  })

  it.each(['provider', 'track'])('discards a resolve after the %s changes', async (change) => {
    let finish!: (uri: string) => void
    mocks.cachedUri.mockReturnValue(undefined)
    mocks.resolveUri.mockReturnValue(new Promise<string>((resolve) => {
      finish = resolve
    }))
    const listener = vi.fn()
    window.addEventListener(ENT_OPEN_LIVE_LYRICS, listener)
    press(ROW, STATE)
    // The change lands while the URI resolve is in flight, after the press-time read.
    await settle()
    if (change === 'provider')
      mocks.provider = { provider: 'youtube', trackId: 'catalog-youtube', videoId: 'video-1' }
    else
      mocks.snapshot = { ...mocks.snapshot, currentItemId: 'new-track', anchor: { ms: 90_000, wallMs: 10 } }
    finish('spotify:track:old-song')
    await settle()

    expect(listener).not.toHaveBeenCalled()
    expect(mocks.reportNotice).not.toHaveBeenCalled()
    window.removeEventListener(ENT_OPEN_LIVE_LYRICS, listener)
  })
})

// OPS-project-stabilization Step 2A, finding A5 — the press opens what is playing
// NOW, not what the session last stored. With the song changed on a phone since
// the page last read, the stored identity is the previous song, and the viewer
// trusts its entry: it showed A's lyrics until A's estimated end.
describe('press-time observation', () => {
  it('opens the song Spotify names now, with its own clock, over a stale stored song', async () => {
    mocks.observeLive.mockResolvedValue({ k: 'adopted', live: live('B') })
    mocks.cachedUri.mockReturnValue('spotify:track:A')
    const event = opened()

    openPlaybackLyrics(ROW, { ...STATE, anchor: { ms: 1_000, wallMs: 1 } } as unknown as PlaybackSessionState)

    const detail = (await event).detail
    expect(detail).toMatchObject({
      trackId: 'B',
      progressMs: 61_000,
      progressAtMs: 4_242,
      durationMs: 180_000,
      track: 'Song B',
      albumCoverUrl: 'https://img/B',
    })
    expect(mocks.cachedUri).not.toHaveBeenCalled()
    expect(mocks.resolveUri).not.toHaveBeenCalled()
  })

  it('opens a paused song as well — held is not idle', async () => {
    mocks.observeLive.mockResolvedValue({ k: 'adopted', live: live('P', 'paused') })
    const event = opened()
    openPlaybackLyrics(null, STATE)
    expect((await event).detail.trackId).toBe('P')
  })

  it('opens nothing when Spotify says nothing is playing', async () => {
    mocks.observeLive.mockResolvedValue({ k: 'adopted', live: live('', 'idle') })
    const listener = vi.fn()
    window.addEventListener(ENT_OPEN_LIVE_LYRICS, listener)
    press(ROW, { ...STATE, external: { spotifyTrackId: 'stale' } } as unknown as PlaybackSessionState)
    await settle()
    expect(listener).not.toHaveBeenCalled()
    window.removeEventListener(ENT_OPEN_LIVE_LYRICS, listener)
  })

  it('reads for itself in a mirror tab, which may not adopt', async () => {
    mocks.observeLive.mockResolvedValue({ k: 'mirror' })
    mocks.readLivePlayback.mockResolvedValue(live('M'))
    const event = opened()
    openPlaybackLyrics(ROW, STATE)
    expect((await event).detail.trackId).toBe('M')
    expect(mocks.readLivePlayback).toHaveBeenCalledOnce()
  })

  it('falls back to what the session holds AFTER the read when the session is settling', async () => {
    // `superseded`: a command or boundary burst owns the answer. What it settled
    // on is the session's row now, not the row that was pressed.
    mocks.observeLive.mockImplementation(async () => {
      mocks.currentRow = { ...ROW, itemId: 'i2', trackId: 'track-2' } as BoardAlbum
      return { k: 'superseded' }
    })
    mocks.cachedUri.mockImplementation((id: string) => `spotify:track:${id}-uri`)
    const event = opened()
    openPlaybackLyrics(ROW, STATE)
    expect((await event).detail.trackId).toBe('track-2-uri')
  })

  it('drops the answer when the provider switched during the read', async () => {
    mocks.observeLive.mockImplementation(async () => {
      mocks.provider = { provider: 'youtube', trackId: 'yt', videoId: 'v' }
      return { k: 'adopted', live: live('B') }
    })
    const listener = vi.fn()
    window.addEventListener(ENT_OPEN_LIVE_LYRICS, listener)
    openPlaybackLyrics(ROW, STATE)
    await settle()
    expect(listener).not.toHaveBeenCalled()
    window.removeEventListener(ENT_OPEN_LIVE_LYRICS, listener)
  })

  it('does not read Spotify at all for a YouTube session', async () => {
    mocks.provider = { provider: 'youtube', trackId: 'catalog-youtube', videoId: 'video-1' }
    mocks.cachedUri.mockReturnValue('spotify:track:yt-lyrics')
    const event = opened()
    openPlaybackLyrics(null, STATE)
    expect((await event).detail.trackId).toBe('yt-lyrics')
    expect(mocks.observeLive).not.toHaveBeenCalled()
  })
})
