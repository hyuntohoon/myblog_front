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
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  /**
   * Subscribers, so a test can push a session update into a MOUNTED viewer.
   * `useSyncExternalStore` bails when the snapshot reference is unchanged, so
   * `setSession` below replaces the object rather than mutating it — which is
   * also how the real session behaves (`patch` builds a new state).
   */
  subscribers: new Set<() => void>(),
  snapshot: { v: null as unknown as Record<string, unknown> },
  sessionState: {
    currentItemId: null,
    external: null,
    playing: true,
    anchor: null as { ms: number, wallMs: number } | null,
    durationMs: null as number | null,
    notice: null as { tone: string, message: string } | null,
    transportBusy: false,
    noActiveDevice: false,
    isOwner: true,
    ownerPresent: true,
    ownerRung: null,
  },
}))

vi.mock('@lib/playback/session', () => ({
  playbackSession: {
    subscribe: (cb: () => void) => {
      mocks.subscribers.add(cb)
      return () => mocks.subscribers.delete(cb)
    },
    getSnapshot: () => mocks.snapshot.v,
    getServerSnapshot: () => mocks.snapshot.v,
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
  // Line taps use a stable handler whose latest closure is installed by a
  // passive effect after the async lyric document render.
  await act(async () => {})
}

/** Replace the snapshot (new reference) and, if a viewer is mounted, notify it. */
function setSession(patch: Record<string, unknown>): void {
  mocks.snapshot.v = { ...mocks.snapshot.v, ...patch }
  act(() => {
    for (const cb of mocks.subscribers)
      cb()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.canControl = true
  mocks.subscribers.clear()
  mocks.snapshot.v = { ...mocks.sessionState, playing: true, anchor: null, durationMs: null, notice: null, transportBusy: false, noActiveDevice: false }
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

  it('returns from a tapped browse line to the unchanged live anchor', async () => {
    render(<LyricsViewer spotifyTrackId="track-1" canRefresh initialProgressMs={10_000} onClose={() => {}} />)
    await screen.findByText('second line')
    expect(focusedText()).toBe('first line')

    vi.useFakeTimers()
    try {
      fireEvent.click(screen.getByText('second line'))

      expect(mocks.seekTo).not.toHaveBeenCalled()
      expect(focusedText()).toBe('second line')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000)
      })
      expect(focusedText()).toBe('first line')
    }
    finally {
      vi.useRealTimers()
    }
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
    setSession({ anchor: { ms: 1_000, wallMs: 0 }, durationMs: 200_000 })
    // A fresh render is how a subscription update reaches the component here.
    render(<LyricsViewer spotifyTrackId="track-1" canRefresh onClose={() => {}} />)

    await waitFor(() => expect(mocks.getLyrics).toHaveBeenCalledWith('track-2'))
  })
})

// ── ARCH-playback-authority-convergence Step 3 ───────────────────────────────

describe('the viewer opens in the play state the session is actually in (E5)', () => {
  // It seeded `useState(true)` on the premise that "the live entry only exists
  // while a track is playing". 가사 is a button on a PAUSED Global Player too, so
  // opening from there showed ⏸ over silence and ran the line scheduler forward.
  //
  // The seed reads `playbackSession.getSnapshot()` rather than a new field on
  // `OpenLiveLyricsDetail`: the session is this RFC's single writer of playback
  // truth, and growing the event would put a second copy of it on the wire.
  it('shows ▶ and not ⏸ when the session is paused at open', async () => {
    setSession({ playing: false })
    await open()

    expect(screen.getByLabelText('재생')).toBeTruthy()
    expect(screen.queryByLabelText('일시정지')).toBeNull()
  })

  it('still shows ⏸ when the session is playing', async () => {
    await open()

    expect(screen.getByLabelText('일시정지')).toBeTruthy()
  })
})

describe('paused browse does not snap back on a timer', () => {
  async function openWithAnchor() {
    render(
      <LyricsViewer
	spotifyTrackId="track-1"
	canRefresh
	initialProgressMs={0}
	initialProgressAtMs={0}
	initialDurationMs={200_000}
	onClose={() => {}}
      />,
    )
    await screen.findByText('second line')
  }

  it('keeps the browsed line while the music is stopped, past the idle window', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      setSession({ playing: false })
      await openWithAnchor()

      fireEvent.keyDown(document.querySelector('.lyv-panel')!, { key: 'ArrowDown' })
      expect(focusedText()).toBe('second line')
      // ↩ is still offered — the way back exists, it just is not automatic.
      expect(screen.getByLabelText('현재 줄로 돌아가기')).toBeTruthy()

      // Four times the browse-idle window. Before Step 3 the timer fired at 3s and
      // yanked the reader back to line 1, over and over, for as long as the viewer
      // stayed open on a stopped player.
      await vi.advanceTimersByTimeAsync(12_000)
      expect(focusedText()).toBe('second line')
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('snaps back on the idle timer while the music IS playing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await openWithAnchor()

      fireEvent.keyDown(document.querySelector('.lyv-panel')!, { key: 'ArrowDown' })
      expect(focusedText()).toBe('second line')

      await vi.advanceTimersByTimeAsync(4_000)
      await waitFor(() => expect(focusedText()).toBe('first line'))
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('returns to follow when playback resumes', async () => {
    // The session has to NAME the track for its play state to reach the viewer:
    // the adoption effect is keyed on `currentSpotifyTrackId()`, and a session that
    // cannot say what is sounding has nothing to hand over.
    mocks.currentSpotifyTrackId.mockReturnValue('track-1')
    setSession({ playing: false })
    await openWithAnchor()

    fireEvent.keyDown(document.querySelector('.lyv-panel')!, { key: 'ArrowDown' })
    expect(focusedText()).toBe('second line')

    // The resume arrives as a session update to the MOUNTED viewer. Without the
    // false→true edge effect the lyrics stay parked on the browsed line while the
    // song runs on — which is what a member sees after ▶ if only `armSuspend`'s
    // timer had been removed and nothing replaced it.
    setSession({ playing: true, anchor: { ms: 0, wallMs: performance.now() } })
    await waitFor(() => expect(focusedText()).toBe('first line'))
  })
})

describe('the queue screen agrees with what the session can adopt (E4)', () => {
  const track = { id: 't1', uri: 'spotify:track:t1', name: 'A Song', artist: 'Someone', mediaType: 'track' as const }
  const episode = { id: 'e1', uri: 'spotify:episode:e1', name: 'An Episode', artist: null, mediaType: 'episode' as const }

  it('renders an episode row inert while a track row stays tappable', async () => {
    mocks.readQueue.mockResolvedValue({ ok: true, current: null, items: [episode, track] })
    await open()

    fireEvent.click(screen.getByLabelText('대기열'))
    const rows = await screen.findAllByText(/A Song|An Episode/)
    const episodeRow = rows.find(n => n.textContent === 'An Episode')!.closest('.lyv-queue-row')!
    const trackRow = rows.find(n => n.textContent === 'A Song')!.closest('.lyv-queue-row')!

    // The episode is still LISTED — it really is in the member's queue, and hiding
    // it would make this screen disagree with the Spotify app.
    expect(episodeRow.tagName).toBe('DIV')
    expect(trackRow.tagName).toBe('BUTTON')
  })

  it('offers a retry for a missing device, which is recoverable, unlike a missing scope', async () => {
    mocks.readQueue.mockResolvedValue({ ok: false, reason: 'no-active-device' })
    await open()

    fireEvent.click(screen.getByLabelText('대기열'))
    await screen.findByText('재생 중인 기기가 없어요. Spotify 앱에서 재생을 시작해 주세요')
    expect(screen.getByText('다시 시도')).toBeTruthy()
  })

  it('offers no retry for a missing scope', async () => {
    mocks.readQueue.mockResolvedValue({ ok: false, reason: 'no-capability' })
    await open()

    fireEvent.click(screen.getByLabelText('대기열'))
    await screen.findByText('이 계정에서는 대기열을 볼 수 없어요')
    expect(screen.queryByText('다시 시도')).toBeNull()
  })
})
