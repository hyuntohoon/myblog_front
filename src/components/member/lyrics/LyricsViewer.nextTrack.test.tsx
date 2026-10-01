// OPS-project-stabilization Step 2A — an open lyrics viewer moves to the next song
// and STAYS there.
//
// The owner's report (2026-09-28): with lyrics open when the next song starts, the
// viewer goes back to the old song. Finding B traced it: the viewer read Spotify
// directly, saw B, set B — and its own adoption rule then trusted the shared session,
// still naming A, and put it back. Finding C: the only thing that noticed the song
// ending lived inside the timed-lyrics scheduler, so plain or missing lyrics, a
// browse, or the queue view switched it off.
//
// Every test here drives ONE mounted viewer and asserts what it finally shows —
// title and rendered lyrics — never merely that B was requested. The regression the
// RFC asks for is the first `describe`: it fails on the pre-fix component, and no
// remount is involved in making it pass.
import type { LyricsResponse } from './lyrics.api'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LyricsViewer } from './LyricsViewer'

const mocks = vi.hoisted(() => ({
  provider: { provider: 'spotify', trackId: null, videoId: null, title: null },
  subscribers: new Set<() => void>(),
  snapshot: { v: null as unknown as Record<string, unknown> },
  /** What the session names as sounding — the thing the viewer's adoption rule trusts. */
  sessionTrack: { id: null as string | null },
  /** 'owner' → `observeLive` adopts through the session; 'mirror' → the viewer must read itself. */
  role: { v: 'owner' as 'owner' | 'mirror' },
  pending: { v: false },
  observeLive: vi.fn(),
  releaseWatch: vi.fn(),
  watchExternalPlayback: vi.fn(),
  syncFromLive: vi.fn(async () => {}),
  getLyrics: vi.fn(),
  readLivePlayback: vi.fn(),
  readQueue: vi.fn(),
}))

vi.mock('@lib/playback/session', () => ({
  EPOCH_RESTART_MS: 5_000,
  nonCoalescingBlocked: () => false,
  playbackSession: {
    subscribe: (cb: () => void) => {
      mocks.subscribers.add(cb)
      return () => mocks.subscribers.delete(cb)
    },
    getSnapshot: () => mocks.snapshot.v,
    getServerSnapshot: () => mocks.snapshot.v,
    currentSpotifyTrackId: () => mocks.sessionTrack.id,
    currentRow: () => null,
    observeLive: mocks.observeLive,
    watchExternalPlayback: mocks.watchExternalPlayback,
    boundaryConfirmationPending: () => mocks.pending.v,
    syncFromLive: mocks.syncFromLive,
    seekTo: vi.fn(async () => ({ ok: true })),
    togglePlay: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    takeOver: vi.fn(),
    jumpToSpotifyQueue: vi.fn(),
  },
}))
vi.mock('@lib/playback/provider', () => ({
  providerStore: {
    subscribe: () => () => {},
    getSnapshot: () => mocks.provider,
    getServerSnapshot: () => mocks.provider,
  },
}))
vi.mock('@lib/playback/uris', () => ({ cachedUri: vi.fn(), resolveUri: vi.fn() }))
vi.mock('@lib/playback/ownership', () => ({ canControlPlayback: () => true }))
vi.mock('./lyrics.api', () => ({ getLyrics: mocks.getLyrics, requestTranslation: vi.fn() }))
vi.mock('./playback.api', () => ({ readLivePlayback: mocks.readLivePlayback }))
vi.mock('./queue.api', () => ({ readQueue: mocks.readQueue }))
vi.mock('@lib/useDismissable', () => ({ useDismissable: () => {} }))
vi.mock('@lib/useScrollLock', () => ({ useScrollLock: () => {} }))
vi.mock('../NowPlaying', () => ({ ArtistNames: ({ text }: { text: string | null }) => <span>{text}</span> }))

const DURATION_MS = 180_000

function synced(tag: string): LyricsResponse {
  return {
    availability: 'ok',
    normalizer_version: 1,
    trackable: true,
    source_kind: 'synced',
    segments: [
      { i: 0, text: `${tag} one`, start_ms: 0 },
      { i: 1, text: `${tag} two`, start_ms: 60_000 },
      { i: 2, text: `${tag} three`, start_ms: 120_000 },
    ],
  } as LyricsResponse
}

function plain(tag: string): LyricsResponse {
  return {
    availability: 'ok',
    normalizer_version: 1,
    trackable: false,
    source_kind: 'plain',
    segments: [{ i: 0, text: `${tag} plain`, start_ms: null }],
  } as LyricsResponse
}

const MISSING = { availability: 'none', normalizer_version: 1, trackable: false, segments: [] } as unknown as LyricsResponse

let lyricsById: Record<string, LyricsResponse> = {}

/** A live read naming `trackId`, stamped NOW — the viewer compares read instants. */
function live(trackId: string, progressMs = 1_000, state: 'playing' | 'paused' = 'playing') {
  return {
    state,
    trackId,
    progressMs,
    readAtMs: performance.now(),
    durationMs: DURATION_MS,
    track: `Title ${trackId}`,
    artist: `Artist ${trackId}`,
    artists: [],
    album: null,
    albumSpotifyId: null,
    albumCoverUrl: null,
    deviceName: 'phone',
    deviceId: 'dev',
    shuffle: null,
    repeat: null,
    volumePercent: null,
    contextUri: null,
    contextType: null,
  }
}

/** Answer reads in order; the last one repeats. */
function answerReads(...reads: Array<() => unknown>): void {
  let i = 0
  mocks.readLivePlayback.mockImplementation(async () => {
    const r = reads[Math.min(i, reads.length - 1)]
    i += 1
    return r()
  })
}

function setSession(patch: Record<string, unknown>): void {
  mocks.snapshot.v = { ...mocks.snapshot.v, ...patch }
  act(() => {
    for (const cb of mocks.subscribers)
      cb()
  })
}

/**
 * What the real session does with an adopted read: it now NAMES that song and
 * carries the read's anchor. Modelled here so the owner path is tested against a
 * session that actually moves, not one that merely returns a value.
 */
function adoptIntoSession(r: ReturnType<typeof live>): void {
  mocks.sessionTrack.id = r.trackId
  setSession({
    external: { title: r.track, artist: r.artist, albumCoverUrl: null, spotifyTrackId: r.trackId },
    playing: r.state === 'playing',
    anchor: { ms: r.progressMs, wallMs: r.readAtMs },
    durationMs: r.durationMs,
  })
}

function title(): string | null {
  return document.querySelector('.lyv-title')?.textContent ?? null
}

async function settle() {
  await act(async () => {})
}

/** Mount the viewer on song A, mid-track, with the session agreeing it is A. */
async function openOnA(progressMs = 30_000) {
  const readAt = performance.now()
  mocks.sessionTrack.id = 'A'
  mocks.snapshot.v = {
    ...mocks.snapshot.v,
    external: { title: 'Title A', artist: 'Artist A', albumCoverUrl: null, spotifyTrackId: 'A' },
    playing: true,
    anchor: { ms: progressMs, wallMs: readAt },
    durationMs: DURATION_MS,
  }
  render(
    <LyricsViewer
	spotifyTrackId="A"
	canRefresh
	initialProgressMs={progressMs}
	initialProgressAtMs={readAt}
	initialDurationMs={DURATION_MS}
	initialTrack="Title A"
	initialArtist="Artist A"
	onClose={() => {}}
    />,
  )
  await waitFor(() => expect(mocks.getLyrics).toHaveBeenCalledWith('A'))
  await settle()
}

async function refreshNow() {
  fireEvent.click(screen.getByLabelText('현재 재생 새로고침'))
  await settle()
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.subscribers.clear()
  mocks.role.v = 'owner'
  mocks.pending.v = false
  mocks.sessionTrack.id = null
  mocks.snapshot.v = {
    currentItemId: null,
    external: null,
    playing: true,
    anchor: null,
    durationMs: null,
    notice: null,
    busy: false,
    transportBusy: false,
    noActiveDevice: false,
    isOwner: true,
    ownerPresent: true,
    ownerRung: null,
  }
  lyricsById = { A: synced('A'), B: synced('B'), C: synced('C') }
  mocks.getLyrics.mockImplementation(async (id: string) => lyricsById[id] ?? MISSING)
  mocks.readQueue.mockResolvedValue({ ok: true, current: null, items: [] })
  mocks.readLivePlayback.mockResolvedValue({ state: 'idle' })
  mocks.watchExternalPlayback.mockImplementation(() => mocks.releaseWatch)
  // The real contract: the owner adopts the read into the session; a mirror may not,
  // and the viewer is told to read for itself.
  mocks.observeLive.mockImplementation(async () => {
    if (mocks.role.v === 'mirror')
      return { k: 'mirror' }
    const r = await mocks.readLivePlayback()
    if (r.state === 'playing' || r.state === 'paused')
      adoptIntoSession(r)
    return { k: 'adopted', live: r }
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('finding B — the same mounted viewer adopts B and keeps it (case 3)', () => {
  // The RFC's isolated reproduction, row 1: provider B, shared session still A.
  // A mirror tab is exactly that state — it may not adopt, so the session keeps
  // naming A until the owner catches up. Pre-fix: A → B → A.
  it('keeps B when the shared session still names A', async () => {
    mocks.role.v = 'mirror'
    await openOnA()
    answerReads(() => live('B'))

    await refreshNow()

    await waitFor(() => expect(screen.getByText('B one')).toBeTruthy())
    // An unrelated session re-render with the SAME stale A must not undo it.
    setSession({ transportBusy: false, notice: null })
    await settle()
    expect(screen.queryByText('A one')).toBeNull()
    expect(screen.getByText('B one')).toBeTruthy()
    expect(mocks.getLyrics).toHaveBeenLastCalledWith('B')
  })

  it('moves the SESSION too when this tab owns playback, so every surface agrees', async () => {
    await openOnA()
    answerReads(() => live('B'))

    await refreshNow()

    await waitFor(() => expect(screen.getByText('B one')).toBeTruthy())
    expect(mocks.sessionTrack.id).toBe('B')
    // One read, and it was the session's — not a second one beside it.
    expect(mocks.observeLive).toHaveBeenCalledTimes(1)
    expect(mocks.readLivePlayback).toHaveBeenCalledTimes(1)
    expect(title()).toContain('Title B')
  })

  it('does nothing of its own when the session says a newer answer already won', async () => {
    await openOnA()
    mocks.observeLive.mockResolvedValueOnce({ k: 'superseded' })

    await refreshNow()

    expect(mocks.readLivePlayback).not.toHaveBeenCalled()
    expect(screen.getByText('A one')).toBeTruthy()
    expect(screen.queryByText('재생 상태를 확인하지 못했어요')).toBeNull()
  })
})

describe('the latest confirmed song wins (case 6)', () => {
  it('adopts a session answer that is NEWER than its own read', async () => {
    mocks.role.v = 'mirror'
    await openOnA()
    answerReads(() => live('B'))
    await refreshNow()
    await waitFor(() => expect(screen.getByText('B one')).toBeTruthy())

    // The owner catches up past B: C, read after the viewer's read of B.
    await new Promise(r => setTimeout(r, 5))
    mocks.sessionTrack.id = 'C'
    setSession({ external: { title: 'Title C', artist: 'Artist C', albumCoverUrl: null, spotifyTrackId: 'C' }, anchor: { ms: 500, wallMs: performance.now() } })

    await waitFor(() => expect(screen.getByText('C one')).toBeTruthy())
  })

  // Review 2026-09-30: an identity with no anchor has no age. Refusing it made a
  // newer song wait for some later patch; it is adopted, as it always was.
  it('adopts a session answer that carries no anchor at all', async () => {
    mocks.role.v = 'mirror'
    await openOnA()
    answerReads(() => live('B'))
    await refreshNow()
    await waitFor(() => expect(screen.getByText('B one')).toBeTruthy())

    mocks.sessionTrack.id = 'C'
    setSession({ external: { title: 'Title C', artist: 'Artist C', albumCoverUrl: null, spotifyTrackId: 'C' }, anchor: null })

    await waitFor(() => expect(screen.getByText('C one')).toBeTruthy())
  })

  it('refuses a session answer that is OLDER than its own read, even a different song', async () => {
    mocks.role.v = 'mirror'
    await openOnA()
    const olderThanTheRead = performance.now()
    await new Promise(r => setTimeout(r, 5))
    answerReads(() => live('B'))
    await refreshNow()
    await waitFor(() => expect(screen.getByText('B one')).toBeTruthy())

    // A delayed broadcast lands AFTER the read but describes a moment BEFORE it.
    mocks.sessionTrack.id = 'C'
    setSession({ external: { title: 'Title C', artist: 'Artist C', albumCoverUrl: null, spotifyTrackId: 'C' }, anchor: { ms: 500, wallMs: olderThanTheRead } })
    await settle()

    expect(screen.getByText('B one')).toBeTruthy()
    expect(mocks.getLyrics).not.toHaveBeenCalledWith('C')
  })
})

describe('a mirror asks the owner only when it has news (review 2026-09-30)', () => {
  it('forwards a sync when its own read disagrees with the session', async () => {
    mocks.role.v = 'mirror'
    await openOnA()
    answerReads(() => live('B'))

    await refreshNow()

    await waitFor(() => expect(screen.getByText('B one')).toBeTruthy())
    expect(mocks.syncFromLive).toHaveBeenCalledTimes(1)
  })

  it('stays quiet when its own read agrees', async () => {
    mocks.role.v = 'mirror'
    await openOnA()
    answerReads(() => live('A', 40_000))

    await refreshNow()
    await settle()

    expect(mocks.readLivePlayback).toHaveBeenCalledTimes(1)
    expect(mocks.syncFromLive).not.toHaveBeenCalled()
  })
})

describe('the natural end confirms with a bounded burst (case 4)', () => {
  /** Open 2s before A ends, then run the clock past the end + grace + the whole burst. */
  async function runPastTheEnd(): Promise<void> {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await openOnA(DURATION_MS - 2_000)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000 + 1_500 + 4 * 500 + 200)
    })
  }

  it('asks again through a stale A, unavailable and a transitional idle, then lands on B', async () => {
    answerReads(
      () => live('A', DURATION_MS),
      () => ({ state: 'unavailable' }),
      () => ({ state: 'idle' }),
      () => live('B', 800),
    )

    await runPastTheEnd()

    await waitFor(() => expect(screen.getByText('B one')).toBeTruthy())
    expect(mocks.readLivePlayback).toHaveBeenCalledTimes(4)
    expect(screen.queryByText('지금 재생 중인 곡이 없어요')).toBeNull()
  })

  it('stops after its budget when playback genuinely stopped', async () => {
    answerReads(() => ({ state: 'idle' }))

    await runPastTheEnd()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(mocks.readLivePlayback).toHaveBeenCalledTimes(4)
    expect(screen.getByText('지금 재생 중인 곡이 없어요')).toBeTruthy()
  })

  it('settles on a same-song restart near zero (repeat-one) without spending the budget', async () => {
    answerReads(() => live('A', 400))

    await runPastTheEnd()

    expect(mocks.readLivePlayback).toHaveBeenCalledTimes(1)
    expect(screen.getByText('A one')).toBeTruthy()
  })

  // A player wedged at the end keeps answering "A, at the end". The burst spends its
  // budget and stops. A mirror's session still carries the OLDER mid-track anchor,
  // and every broadcast hands it back to the viewer — which must not
  // count as a fresh position, or each patch buys another four reads.
  it('does not re-arm a spent burst when the session re-delivers an older position', async () => {
    mocks.role.v = 'mirror'
    answerReads(() => live('A', DURATION_MS))

    await runPastTheEnd()
    expect(mocks.readLivePlayback).toHaveBeenCalledTimes(4)

    // A broadcast rebuilds `external` as a new object on every owner patch — that,
    // not the content, is what re-runs the viewer's adoption effect.
    const a = mocks.snapshot.v.external as Record<string, unknown>
    setSession({ external: { ...a } })
    setSession({ external: { ...a } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })

    expect(mocks.readLivePlayback).toHaveBeenCalledTimes(4)
  })

  // Review 2026-09-30 (blocker). Deferring is only safe if the viewer then shows
  // what the session's burst decided — and "nothing is playing" arrives as a CLEARED
  // identity, which the adoption effect used to skip. The old test asserted only
  // that the viewer did not read, which is how the gap got through.
  it('leaves the boundary to the session, then follows it to B', async () => {
    mocks.pending.v = true
    answerReads(() => live('B', 800))

    await runPastTheEnd()
    expect(mocks.observeLive).not.toHaveBeenCalled()

    adoptIntoSession(live('B', 900))
    await waitFor(() => expect(screen.getByText('B one')).toBeTruthy())
  })

  it('leaves the boundary to the session, then says so when the session settles on a stop', async () => {
    mocks.pending.v = true

    await runPastTheEnd()
    expect(mocks.observeLive).not.toHaveBeenCalled()

    mocks.sessionTrack.id = null
    setSession({ external: null, currentItemId: null, playing: false })

    await waitFor(() => expect(screen.getByText('지금 재생 중인 곡이 없어요')).toBeTruthy())
  })
})

describe('song detection does not depend on the lyrics (case 7)', () => {
  it.each([
    ['plain (untimed) lyrics', () => plain('A')],
    ['no lyrics at all', () => MISSING],
  ])('moves on from A to B when A has %s', async (_label, lyricsForA) => {
    lyricsById.A = lyricsForA()
    answerReads(() => live('B', 800))
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await openOnA(DURATION_MS - 2_000)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000 + 1_500 + 200)
    })

    await waitFor(() => expect(screen.getByText('B one')).toBeTruthy())
    expect(title()).toContain('Title B')
  })

  it('moves on while the member is browsing lines', async () => {
    answerReads(() => live('B', 800))
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await openOnA(DURATION_MS - 2_000)
    // A wheel step is a browse: it suspends the follow scheduler.
    fireEvent.wheel(document.querySelector('.lyv-scroll')!, { deltaY: 200 })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000 + 1_500 + 200)
    })

    await waitFor(() => expect(screen.getByText('B one')).toBeTruthy())
  })

  it('moves on while the queue view is open', async () => {
    answerReads(() => live('B', 800))
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await openOnA(DURATION_MS - 2_000)
    fireEvent.click(screen.getByLabelText('대기열'))
    await settle()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000 + 1_500 + 200)
    })

    await waitFor(() => expect(title()).toContain('Title B'))
    fireEvent.click(screen.getByLabelText('대기열'))
    await waitFor(() => expect(screen.getByText('B one')).toBeTruthy())
  })
})

describe('the external watch belongs to the open viewer (OQ2)', () => {
  it('asks the session to watch while bound to live playback, and releases on close', async () => {
    await openOnA()
    expect(mocks.watchExternalPlayback).toHaveBeenCalledOnce()
    expect(mocks.releaseWatch).not.toHaveBeenCalled()

    cleanup()

    expect(mocks.releaseWatch).toHaveBeenCalledOnce()
  })

  it('does not ask from a static entry, which has no live playback to watch', async () => {
    render(<LyricsViewer spotifyTrackId="A" onClose={() => {}} />)
    await waitFor(() => expect(mocks.getLyrics).toHaveBeenCalledWith('A'))

    expect(mocks.watchExternalPlayback).not.toHaveBeenCalled()
  })

  it('spends no read of its own between events: the watch is the session\'s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await openOnA()
    mocks.observeLive.mockClear()
    mocks.readLivePlayback.mockClear()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(mocks.observeLive).not.toHaveBeenCalled()
    expect(mocks.readLivePlayback).not.toHaveBeenCalled()
  })
})
