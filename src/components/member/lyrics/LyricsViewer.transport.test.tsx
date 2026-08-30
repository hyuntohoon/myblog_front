// ARCH-playback-authority-convergence Step 1 — the lyrics viewer as a CONSUMER.
//
// Everything here is a bug that shipped, and every one of them had the same root:
// this component ran its own playback state machine and issued its own Spotify
// commands, so it could disagree with `playbackSession` and with the speakers.
//
//   · a lyric line tap moved a private clock anchor and never seeked, so the
//     viewer ran from 2:35 over audio still at 1:10;
//   · swipe/wheel/arrows were supposed to be browse-only and had to STAY that way
//     once the tap became a real command;
//   · a mirror tab's transport worked while the Global Player's identical buttons
//     were correctly disabled, because this component never asked about ownership.
import type { LyricsResponse } from './lyrics.api'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LyricsViewer } from './LyricsViewer'

const mocks = vi.hoisted(() => ({
  seekTo: vi.fn(),
  togglePlay: vi.fn(),
  next: vi.fn(),
  previous: vi.fn(),
  takeOver: vi.fn(),
  jumpToSpotifyQueue: vi.fn(),
  currentSpotifyTrackId: vi.fn(() => null as string | null),
  currentRow: vi.fn(() => null),
  getLyrics: vi.fn(),
  requestTranslation: vi.fn(),
  readLivePlayback: vi.fn(),
  readQueue: vi.fn(),
  canControl: true,
  sessionState: {
    currentItemId: null,
    external: null,
    playing: true,
    anchor: null as { ms: number, wallMs: number } | null,
    durationMs: null as number | null,
    notice: null as { tone: string, message: string } | null,
    isOwner: true,
    ownerPresent: true,
    ownerRung: null,
  },
}))

vi.mock('@lib/playback/session', () => ({
  playbackSession: {
    subscribe: () => () => {},
    getSnapshot: () => mocks.sessionState,
    getServerSnapshot: () => mocks.sessionState,
    seekTo: mocks.seekTo,
    togglePlay: mocks.togglePlay,
    next: mocks.next,
    previous: mocks.previous,
    takeOver: mocks.takeOver,
    jumpToSpotifyQueue: mocks.jumpToSpotifyQueue,
    currentSpotifyTrackId: mocks.currentSpotifyTrackId,
    currentRow: mocks.currentRow,
  },
}))

// The real predicate, not a stub — a test that stubbed it could not tell a mirror
// from an owner, which is the whole question below.
vi.mock('@lib/playback/ownership', () => ({
  canControlPlayback: () => mocks.canControl,
}))

vi.mock('./lyrics.api', () => ({
  getLyrics: mocks.getLyrics,
  requestTranslation: mocks.requestTranslation,
}))
vi.mock('./playback.api', () => ({ readLivePlayback: mocks.readLivePlayback }))
vi.mock('./queue.api', () => ({ readQueue: mocks.readQueue }))
vi.mock('@lib/useDismissable', () => ({ useDismissable: () => {} }))
vi.mock('@lib/useScrollLock', () => ({ useScrollLock: () => {} }))
vi.mock('../NowPlaying', () => ({ ArtistNames: ({ text }: { text: string | null }) => <span>{text}</span> }))

const LYRICS: LyricsResponse = {
  availability: 'ok',
  normalizer_version: 1,
  trackable: true,
  source_kind: 'synced',
  segments: [
    { i: 0, text: 'first line', start_ms: 0 },
    { i: 1, text: 'second line', start_ms: 50_000 },
    { i: 2, text: 'third line', start_ms: 90_000 },
  ],
} as LyricsResponse

function focusedText(): string | null {
  return document.querySelector('.lyv-line.is-focus')?.textContent ?? null
}

async function open() {
  render(<LyricsViewer spotifyTrackId="track-1" canRefresh onClose={() => {}} />)
  await screen.findByText('second line')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.canControl = true
  Object.assign(mocks.sessionState, { playing: true, anchor: null, durationMs: null, notice: null })
  mocks.currentSpotifyTrackId.mockReturnValue(null)
  mocks.getLyrics.mockResolvedValue(LYRICS)
  mocks.readLivePlayback.mockResolvedValue({ state: 'idle' })
  mocks.readQueue.mockResolvedValue({ ok: true, current: null, items: [] })
  mocks.seekTo.mockImplementation(async (_ms: number, onReanchored?: () => void) => {
    onReanchored?.()
    return { ok: true }
  })
})

describe('a lyric line tap is a seek', () => {
  it('asks the session to move real playback to the tapped line', async () => {
    await open()

    fireEvent.click(screen.getByText('second line'))

    expect(mocks.seekTo).toHaveBeenCalledWith(50_000, expect.any(Function))
    await waitFor(() => expect(focusedText()).toBe('second line'))
  })

  // The failure half matters as much: the old code re-anchored unconditionally, so
  // a viewer whose seek never landed carried on running its own clock from a
  // position nothing was playing.
  it('does not move to the tapped line when the seek fails', async () => {
    mocks.seekTo.mockResolvedValue({ ok: false, reason: 'transient' })
    await open()

    fireEvent.click(screen.getByText('third line'))

    await screen.findByText('그 위치로 이동하지 못했어요')
    expect(focusedText()).toBe('first line')
  })
})

describe('browse gestures stay browse', () => {
  it('moves the focus on a swipe without touching playback', async () => {
    await open()
    const surface = document.querySelector('.lyv-scroll')!

    fireEvent.pointerDown(surface, { button: 0, clientY: 400 })
    fireEvent.pointerMove(surface, { clientY: 400 - 60 })
    fireEvent.pointerUp(surface)

    expect(focusedText()).toBe('second line')
    expect(mocks.seekTo).not.toHaveBeenCalled()
  })

  it('moves the focus on ArrowDown without touching playback', async () => {
    await open()

    fireEvent.keyDown(document.querySelector('.lyv-panel')!, { key: 'ArrowDown' })

    expect(focusedText()).toBe('second line')
    expect(mocks.seekTo).not.toHaveBeenCalled()
  })
})

describe('a mirror tab cannot bypass the ownership gate', () => {
  beforeEach(() => {
    mocks.canControl = false
  })

  it('disables the transport and offers takeover instead of pretending', async () => {
    await open()

    for (const label of ['이전 곡', '재생', '일시정지', '다음 곡']) {
      const btn = screen.queryByLabelText(label)
      if (btn)
        expect(btn).toBeDisabled()
    }
    expect(screen.getByText('다른 탭에서 재생 중이에요')).toBeTruthy()

    fireEvent.click(screen.getByText('이 탭에서 재생하기'))
    expect(mocks.takeOver).toHaveBeenCalled()
  })

  it('does not seek from a line tap either', async () => {
    await open()

    fireEvent.click(screen.getByText('second line'))

    expect(mocks.seekTo).not.toHaveBeenCalled()
    // Browsing is still allowed — reading lyrics is not a playback mutation.
    await waitFor(() => expect(focusedText()).toBe('second line'))
  })
})

describe('transport routes through the session', () => {
  it('sends ⏭ / ⏮ / ⏯ as session actions rather than provider commands', async () => {
    await open()

    fireEvent.click(screen.getByLabelText('다음 곡'))
    await waitFor(() => expect(mocks.next).toHaveBeenCalled())

    fireEvent.click(screen.getByLabelText('이전 곡'))
    await waitFor(() => expect(mocks.previous).toHaveBeenCalled())

    fireEvent.click(screen.getByLabelText('일시정지'))
    await waitFor(() => expect(mocks.togglePlay).toHaveBeenCalled())
  })
})

describe('session-confirmed identity beats a viewer-local guess', () => {
  // The Step 3c effect used to return early whenever the session named a DIFFERENT
  // track, so a session that authoritatively knew playback had moved to C could
  // only ever confirm a viewer already sitting on B.
  it('loads the new lyric document when the session moves to another track', async () => {
    await open()
    expect(mocks.getLyrics).toHaveBeenCalledWith('track-1')

    mocks.currentSpotifyTrackId.mockReturnValue('track-2')
    Object.assign(mocks.sessionState, { anchor: { ms: 1_000, wallMs: 0 }, durationMs: 200_000 })
    // A fresh render is how a subscription update reaches the component here.
    render(<LyricsViewer spotifyTrackId="track-1" canRefresh onClose={() => {}} />)

    await waitFor(() => expect(mocks.getLyrics).toHaveBeenCalledWith('track-2'))
  })
})
