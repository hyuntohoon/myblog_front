// FEAT-lyrics-match-correction Step 3b — a member's "가사가 틀려요" in the viewer.
//
// Pins: the button is a member's only (never the owner's, not even before the owner check
// settles), it shows only on rendered lyrics, one tap sends one report and swaps the button
// for its confirmation line, and a track swap resets it.
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
  isOwner: { v: false as boolean, resolve: null as null | ((v: boolean) => void), deferred: false },
  reportLyrics: vi.fn(),
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
vi.mock('@lib/owner', () => ({
  isOwnerUser: () => mocks.isOwner.deferred ?
    new Promise<boolean>((resolve) => { mocks.isOwner.resolve = resolve }) :
    Promise.resolve(mocks.isOwner.v),
}))
vi.mock('./lyricsReport.api', () => ({ reportLyrics: mocks.reportLyrics }))

const DURATION_MS = 180_000

function lyrics(tag: string): LyricsResponse {
  return {
    availability: 'ok',
    normalizer_version: 1,
    trackable: false,
    source_kind: 'plain',
    segments: [{ i: 0, text: `${tag} plain`, start_ms: null }],
  } as LyricsResponse
}

let lyricsById: Record<string, LyricsResponse> = {}

async function settle() {
  await act(async () => {})
}

function mount(id = 'A') {
  mocks.sessionTrack.id = id
  mocks.snapshot.v = {
    ...mocks.snapshot.v,
    external: { title: `Title ${id}`, artist: `Artist ${id}`, albumCoverUrl: null, spotifyTrackId: id },
  }
  return render(
    <LyricsViewer
	spotifyTrackId={id}
	initialDurationMs={DURATION_MS}
	initialTrack={`Title ${id}`}
	initialArtist={`Artist ${id}`}
	onClose={() => {}}
    />,
  )
}

const BUTTON = { name: '가사가 틀려요' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.subscribers.clear()
  mocks.isOwner.v = false
  mocks.isOwner.deferred = false
  mocks.isOwner.resolve = null
  mocks.sessionTrack.id = null
  mocks.snapshot.v = {
    currentItemId: null,
external: null,
playing: false,
anchor: null,
durationMs: null,
    notice: null,
busy: false,
pendingItemId: null,
pendingLabel: null,
transportBusy: false,
    noActiveDevice: false,
isOwner: false,
ownerPresent: true,
ownerRung: null,
  }
  lyricsById = { A: lyrics('A'), B: lyrics('B') }
  mocks.getLyrics.mockImplementation(async (id: string) =>
    lyricsById[id] ?? { availability: 'no_lyrics', normalizer_version: 1, trackable: false, segments: [] })
  mocks.readQueue.mockResolvedValue({ ok: true, current: null, items: [] })
  mocks.readLivePlayback.mockResolvedValue({ state: 'idle' })
  mocks.watchExternalPlayback.mockImplementation(() => mocks.releaseWatch)
  mocks.observeLive.mockResolvedValue({ k: 'mirror' })
})
afterEach(() => {
  cleanup()
})

describe('가사가 틀려요', () => {
  it('a member reports once, and the button gives way to the confirmation line', async () => {
    mocks.reportLyrics.mockResolvedValue('reported')
    mount()
    fireEvent.click(await screen.findByRole('button', BUTTON))
    await waitFor(() => expect(mocks.reportLyrics).toHaveBeenCalledWith('A'))
    expect(await screen.findByText('알려 주셔서 고마워요. 오너가 확인할게요')).toBeTruthy()
    expect(screen.queryByRole('button', BUTTON)).toBeNull()
    expect(mocks.reportLyrics).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['already_reported', '이미 신고한 가사예요'],
    ['limit', '오늘은 더 신고할 수 없어요'],
  ])('%s has its own line', async (outcome, line) => {
    mocks.reportLyrics.mockResolvedValue(outcome)
    mount()
    fireEvent.click(await screen.findByRole('button', BUTTON))
    expect(await screen.findByText(line)).toBeTruthy()
  })

  it('a failed send keeps a retry next to its line', async () => {
    mocks.reportLyrics.mockResolvedValue('error')
    mount()
    fireEvent.click(await screen.findByRole('button', BUTTON))
    expect(await screen.findByText('신고를 보내지 못했어요')).toBeTruthy()
    expect(screen.getByRole('button', { name: '다시 신고' })).toBeTruthy()
  })

  it('is never offered to the owner, not even before the owner check settles', async () => {
    mocks.isOwner.deferred = true
    mount()
    await screen.findByText('A plain')
    expect(screen.queryByRole('button', BUTTON)).toBeNull()
    await act(async () => mocks.isOwner.resolve?.(true))
    await settle()
    expect(screen.queryByRole('button', BUTTON)).toBeNull()
    expect(screen.getByRole('button', { name: '다른 가사' })).toBeTruthy()
  })

  it('is not offered where no lyrics are rendered', async () => {
    lyricsById = {}
    mount('Z')
    await waitFor(() => expect(mocks.getLyrics).toHaveBeenCalledWith('Z'))
    await settle()
    expect(screen.queryByRole('button', BUTTON)).toBeNull()
  })

  it('a track swap resets it', async () => {
    mocks.reportLyrics.mockResolvedValue('reported')
    mount('A')
    fireEvent.click(await screen.findByRole('button', BUTTON))
    await screen.findByText('알려 주셔서 고마워요. 오너가 확인할게요')
    // The next song, as the session names it (the viewer follows the session).
    await new Promise(r => setTimeout(r, 5))
    mocks.sessionTrack.id = 'B'
    mocks.snapshot.v = {
      ...mocks.snapshot.v,
      external: { title: 'Title B', artist: 'Artist B', albumCoverUrl: null, spotifyTrackId: 'B' },
      anchor: { ms: 500, wallMs: performance.now() },
    }
    act(() => {
      for (const cb of mocks.subscribers)
        cb()
    })
    await screen.findByText('B plain')
    expect(screen.queryByText('알려 주셔서 고마워요. 오너가 확인할게요')).toBeNull()
    expect(screen.getByRole('button', BUTTON)).toBeTruthy()
  })
})
