import type { BoardAlbum, BoardBucket } from '@lib/buckets'
import type { PlaybackSessionState } from '@lib/playback/session'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PLAYBACK_KIND, PLAYBACK_TYPE } from '@lib/buckets'
import { bucketStore } from '@lib/pocketBuckit/bucketStore'
import { GlobalPlaybackBar, isGlobalPlaybackBarVisible } from './GlobalPlaybackBar'

const lyrics = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('./playbackEntryActions', () => ({ openPlaybackLyrics: lyrics.open }))
const provider = vi.hoisted(() => ({ state: { provider: 'spotify', trackId: null as string | null, title: null as string | null } }))
vi.mock('@lib/playback/provider', () => ({
  providerStore: { subscribe: () => () => {}, getSnapshot: () => provider.state, getServerSnapshot: () => provider.state },
}))

const session = vi.hoisted(() => ({
  state: null as PlaybackSessionState | null,
  subscribe: vi.fn(() => () => {}),
  prefetch: vi.fn(),
  syncFromLive: vi.fn().mockResolvedValue(undefined),
  currentSpotifyTrackId: vi.fn(() => 'spotify-current'),
  loadLiked: vi.fn(),
  toggleLiked: vi.fn().mockResolvedValue({ ok: true }),
  setMode: vi.fn().mockResolvedValue({ ok: true }),
  seekTo: vi.fn().mockResolvedValue({ ok: true }),
  refreshDevices: vi.fn().mockResolvedValue({ ok: true, devices: [] }),
  transferTo: vi.fn().mockResolvedValue({ ok: true }),
  previous: vi.fn().mockResolvedValue(undefined),
  togglePlay: vi.fn().mockResolvedValue(undefined),
  next: vi.fn().mockResolvedValue(undefined),
  release: vi.fn(),
  watchExternalPlayback: vi.fn(),
}))

vi.mock('@lib/playback/session', () => ({
  playbackSession: {
    subscribe: session.subscribe,
    getSnapshot: () => session.state,
    getServerSnapshot: () => session.state,
    prefetch: session.prefetch,
    syncFromLive: session.syncFromLive,
    currentSpotifyTrackId: session.currentSpotifyTrackId,
    loadLiked: session.loadLiked,
    toggleLiked: session.toggleLiked,
    setMode: session.setMode,
    seekTo: session.seekTo,
    refreshDevices: session.refreshDevices,
    transferTo: session.transferTo,
    previous: session.previous,
    togglePlay: session.togglePlay,
    next: session.next,
    watchExternalPlayback: session.watchExternalPlayback,
  },
}))

const EMPTY_STATE: PlaybackSessionState = {
  currentItemId: null,
  external: null,
  playing: false,
  anchor: null,
  durationMs: null,
  rung: null,
  degraded: false,
  device: null,
  capabilityTier: 'fallback',
  noActiveDevice: false,
  devices: null,
  activeDeviceId: null,
  shuffle: null,
  repeat: null,
  volumePercent: null,
  liked: 'unknown',
  reconnect: false,
  notice: null,
  discoveryFailed: false,
  busy: false,
  pendingItemId: null,
  pendingLabel: null,
  transportBusy: false,
  isOwner: true,
  ownerPresent: false,
  ownerRung: null,
}

function row(cover = '/queue-cover.jpg'): BoardAlbum {
  return {
    itemId: 'item-1',
    itemType: 'playback',
    albumId: null,
    trackId: 'track-1',
    reviewTargetId: null,
    artistId: null,
    title: 'Queue title',
    artist: 'Queue artist',
    cover,
    year: null,
    alreadyReviewed: false,
    postId: null,
    researchSelected: false,
    note: null,
    prepTonight: false,
    researchStatus: null,
    popularity: null,
    releaseDate: null,
    artistNames: [],
    genres: [],
    durationSec: 200,
  }
}

function queueBucket(items: BoardAlbum[]): BoardBucket {
  return {
    id: 'queue',
    name: 'Playback Bucket',
    color: null,
    isDone: false,
    kind: PLAYBACK_KIND,
    type: PLAYBACK_TYPE,
    isPublic: false,
    researchMode: 'off',
    albums: items,
    children: [],
  }
}

function activeState(patch: Partial<PlaybackSessionState> = {}): PlaybackSessionState {
  return {
    ...EMPTY_STATE,
    currentItemId: 'item-1',
    anchor: { ms: 50_000, wallMs: performance.now() },
    durationMs: 200_000,
    capabilityTier: 'full',
    shuffle: false,
    repeat: 'off',
    volumePercent: 65,
    liked: 'unliked',
    devices: [
      { id: 'phone', name: 'Phone', type: 'Smartphone', isActive: true, isInPage: false },
      { id: 'speaker', name: 'Speaker', type: 'Speaker', isActive: false, isInPage: false },
    ],
    activeDeviceId: 'phone',
    device: { id: 'phone', name: 'Phone', type: 'Smartphone', isActive: true, isInPage: false },
    ...patch,
  }
}

let mobile = false

beforeEach(() => {
  vi.clearAllMocks()
  mobile = false
  provider.state = { provider: 'spotify', trackId: null, title: null }
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: mobile && (query.includes('1179px') || query.includes('767px')),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia
  session.state = { ...EMPTY_STATE }
  session.currentSpotifyTrackId.mockReturnValue('spotify-current')
  session.toggleLiked.mockResolvedValue({ ok: true })
  session.setMode.mockResolvedValue({ ok: true })
  session.seekTo.mockResolvedValue({ ok: true })
  session.refreshDevices.mockResolvedValue({ ok: true, devices: activeState().devices })
  session.transferTo.mockResolvedValue({ ok: true })
  session.watchExternalPlayback.mockReturnValue(session.release)
  bucketStore.setTree([])
  document.documentElement.style.removeProperty('--global-player-h')
})

describe('globalPlaybackBar', () => {
  // OPS-project-stabilization Step 2A, finding A2.
  it('says the read failed, instead of rendering nothing, once discovery has given up', async () => {
    session.state = { ...EMPTY_STATE, discoveryFailed: true }
    render(<GlobalPlaybackBar playbackPanelOpen={false} onOpenPlaybackPanel={vi.fn()} />)
    // The lifecycle's own mount read is not the one under test.
    session.syncFromLive.mockClear()
    let finish!: () => void
    session.syncFromLive.mockReturnValueOnce(new Promise<void>((resolve) => {
      finish = resolve
    }))

    const pill = screen.getByRole('button', { name: /재생 정보를 불러오지 못했어요/ })
    expect(screen.queryByRole('region', { name: '전역 재생 제어' })).toBeNull()
    fireEvent.click(pill)
    expect(session.syncFromLive).toHaveBeenCalledOnce()
    expect(pill).toBeDisabled()
    expect(pill).toHaveAccessibleName('재생 정보를 다시 확인하는 중')

    await act(async () => finish())
    expect(pill).not.toBeDisabled()
  })

  // OPS-project-stabilization Step 2A, owner decision 2026-10-06 (finding E): the bar
  // is the second surface that asks for the external watch — a phone skip must reach
  // it without the lyrics viewer open.
  it('asks for the external watch while it shows a song, and releases it when the song goes', () => {
    session.state = activeState({ currentItemId: null, external: { title: 'Phone song', artist: 'Artist', albumCoverUrl: null, spotifyTrackId: 'sp-1', spotifyAlbumId: null, deviceName: 'Phone' } })
    const { rerender, unmount } = render(<GlobalPlaybackBar playbackPanelOpen={false} onOpenPlaybackPanel={vi.fn()} />)
    expect(session.watchExternalPlayback).toHaveBeenCalledOnce()
    expect(session.release).not.toHaveBeenCalled()

    session.state = { ...EMPTY_STATE }
    rerender(<GlobalPlaybackBar playbackPanelOpen={false} onOpenPlaybackPanel={vi.fn()} />)
    expect(session.release).toHaveBeenCalledOnce()

    unmount()
    expect(session.watchExternalPlayback).toHaveBeenCalledOnce()
    expect(session.release).toHaveBeenCalledOnce()
  })

  it('releases the external watch on unmount', () => {
    session.state = activeState()
    const { unmount } = render(<GlobalPlaybackBar playbackPanelOpen={false} onOpenPlaybackPanel={vi.fn()} />)
    expect(session.watchExternalPlayback).toHaveBeenCalledOnce()
    unmount()
    expect(session.release).toHaveBeenCalledOnce()
  })

  it('releases the external watch when the session switches to YouTube under a visible bar', () => {
    session.state = activeState()
    const { rerender } = render(<GlobalPlaybackBar playbackPanelOpen={false} onOpenPlaybackPanel={vi.fn()} />)
    expect(session.watchExternalPlayback).toHaveBeenCalledOnce()

    provider.state = { provider: 'youtube', trackId: 'yt-track', title: 'YouTube song' }
    rerender(<GlobalPlaybackBar playbackPanelOpen={false} onOpenPlaybackPanel={vi.fn()} />)
    expect(session.release).toHaveBeenCalledOnce()
    expect(session.watchExternalPlayback).toHaveBeenCalledOnce()
  })

  it('does not ask for the external watch with nothing to show, or for a YouTube session', () => {
    render(<GlobalPlaybackBar playbackPanelOpen={false} onOpenPlaybackPanel={vi.fn()} />)
    expect(session.watchExternalPlayback).not.toHaveBeenCalled()

    provider.state = { provider: 'youtube', trackId: 'yt-track', title: 'YouTube song' }
    session.state = activeState()
    render(<GlobalPlaybackBar playbackPanelOpen={false} onOpenPlaybackPanel={vi.fn()} />)
    expect(session.watchExternalPlayback).not.toHaveBeenCalled()
  })

  it('renders nothing when nothing is playing and nothing failed', () => {
    const { container } = render(<GlobalPlaybackBar playbackPanelOpen={false} onOpenPlaybackPanel={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps the Spotify failure out of a YouTube session', () => {
    provider.state = { provider: 'youtube', trackId: null, title: null }
    session.state = { ...EMPTY_STATE, discoveryFailed: true }
    const { container } = render(<GlobalPlaybackBar playbackPanelOpen={false} onOpenPlaybackPanel={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('uses the exact active-or-external visibility rule for playing and paused playback', () => {
    expect(isGlobalPlaybackBarVisible(EMPTY_STATE)).toBe(false)
    expect(isGlobalPlaybackBarVisible({ ...EMPTY_STATE, currentItemId: 'item-1', playing: true })).toBe(true)
    expect(isGlobalPlaybackBarVisible({ ...EMPTY_STATE, currentItemId: 'item-1', playing: false })).toBe(true)
    expect(isGlobalPlaybackBarVisible({
      ...EMPTY_STATE,
      external: { title: 'External', artist: 'Artist', albumCoverUrl: null, spotifyTrackId: 'sp-1', spotifyAlbumId: null, deviceName: null },
    })).toBe(true)
  })

  // OPS-project-stabilization Step 2A, 2026-10-09: on a cold start the bar stayed
  // absent for the whole rung-2 bootstrap, because it waited for `currentItemId`.
  it('answers a ▶ at once with the pressed row, marked as getting ready', () => {
    bucketStore.setTree([queueBucket([row()])])
    session.state = { ...EMPTY_STATE, busy: true, pendingItemId: 'item-1' }
    expect(isGlobalPlaybackBarVisible(session.state)).toBe(true)
    render(<GlobalPlaybackBar playbackPanelOpen={false} onOpenPlaybackPanel={vi.fn()} />)

    expect(screen.getByText('Queue title')).toBeInTheDocument()
    expect(screen.getByText('재생 준비 중…')).toBeInTheDocument()
    // Nothing sounds yet: no external watch, no liked read for a song not playing.
    expect(session.watchExternalPlayback).not.toHaveBeenCalled()
    expect(session.loadLiked).not.toHaveBeenCalled()
  })

  it('shows the pressed row over the song still sounding, and drops the label once it plays', () => {
    const other = { ...row(), itemId: 'item-2', title: 'Pressed title' }
    bucketStore.setTree([queueBucket([row(), other])])
    session.state = activeState({ busy: true, pendingItemId: 'item-2' })
    const { rerender } = render(<GlobalPlaybackBar playbackPanelOpen={false} onOpenPlaybackPanel={vi.fn()} />)
    expect(screen.getByText('Pressed title')).toBeInTheDocument()
    expect(screen.queryByText('Queue title')).not.toBeInTheDocument()
    // Row-scoped controls would act on the old track under the new title — withheld.
    expect(screen.queryByRole('button', { name: '좋아요' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '현재 곡 가사 열기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'YouTube 영상 고르기' })).not.toBeInTheDocument()
    expect(screen.getByRole('slider', { name: '재생 위치' })).toHaveAttribute('aria-valuetext', '— / —')

    session.state = activeState({ currentItemId: 'item-2' })
    rerender(<GlobalPlaybackBar playbackPanelOpen={false} onOpenPlaybackPanel={vi.fn()} />)
    expect(screen.getByText('Pressed title')).toBeInTheDocument()
    expect(screen.queryByText('재생 준비 중…')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '좋아요' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '현재 곡 가사 열기' })).toBeInTheDocument()
  })

  it('names an album ▶ by its title before its queue rows exist', () => {
    session.state = { ...EMPTY_STATE, busy: true, pendingLabel: 'Popstar' }
    expect(isGlobalPlaybackBarVisible(session.state)).toBe(true)
    render(<GlobalPlaybackBar playbackPanelOpen={false} onOpenPlaybackPanel={vi.fn()} />)

    expect(screen.getByText('Popstar')).toBeInTheDocument()
    expect(screen.getByText('재생 준비 중…')).toBeInTheDocument()
  })

  it('prefers queue identity artwork and falls back to external artwork', () => {
    bucketStore.setTree([queueBucket([row()])])
    session.state = activeState()
    const { container, unmount } = render(<GlobalPlaybackBar playbackPanelOpen={false} onOpenPlaybackPanel={vi.fn()} />)

    expect(screen.getByText('Queue title')).toBeInTheDocument()
    expect(container.querySelector('img')).toHaveAttribute('src', '/queue-cover.jpg')
    unmount()

    bucketStore.setTree([])
    session.state = activeState({
      currentItemId: null,
      external: { title: 'External title', artist: 'External artist', albumCoverUrl: '/external-cover.jpg', spotifyTrackId: 'sp-1', spotifyAlbumId: null, deviceName: 'Phone' },
    })
    const external = render(<GlobalPlaybackBar playbackPanelOpen={false} onOpenPlaybackPanel={vi.fn()} />)

    expect(screen.getByText('External title')).toBeInTheDocument()
    expect(external.container.querySelector('img')).toHaveAttribute('src', '/external-cover.jpg')
  })

  it('routes Like, shuffle, and repeat through the shared session controls', async () => {
    bucketStore.setTree([queueBucket([row()])])
    session.state = activeState()
    render(<GlobalPlaybackBar playbackPanelOpen={false} onOpenPlaybackPanel={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '좋아요' }))
    fireEvent.click(screen.getByRole('button', { name: '셔플 켜기' }))
    fireEvent.click(screen.getByRole('button', { name: /반복/ }))

    await waitFor(() => expect(session.toggleLiked).toHaveBeenCalledOnce())
    expect(session.setMode).toHaveBeenCalledWith({ kind: 'shuffle', on: true })
    expect(session.setMode).toHaveBeenCalledWith({ kind: 'repeat', mode: 'context' })
  })

  it('maps timeline pointer position to the one session seek command', async () => {
    bucketStore.setTree([queueBucket([row()])])
    session.state = activeState()
    render(<GlobalPlaybackBar playbackPanelOpen={false} onOpenPlaybackPanel={vi.fn()} />)
    const slider = screen.getByRole('slider', { name: '재생 위치' })
    slider.getBoundingClientRect = () => ({ left: 20, width: 400, right: 420, top: 0, bottom: 10, height: 10, x: 20, y: 0, toJSON: () => {} })

    fireEvent.click(slider, { clientX: 120 })

    await waitFor(() => expect(session.seekTo).toHaveBeenCalledWith(50_000, undefined))
  })

  it('opens the lifted panel callback and reflects its one shared expanded state', () => {
    bucketStore.setTree([queueBucket([row()])])
    session.state = activeState()
    const openPanel = vi.fn()
    render(<GlobalPlaybackBar playbackPanelOpen onOpenPlaybackPanel={openPanel} />)

    const queue = screen.getByRole('button', { name: '재생 대기열 열기' })
    expect(queue).toHaveAttribute('aria-controls', 'global-playback-panel')
    expect(queue).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(queue)
    expect(openPanel).toHaveBeenCalledOnce()
    expect(screen.queryByLabelText('재생 대기열 플레이어')).not.toBeInTheDocument()
  })

  it('opens current queue and external lyrics directly without opening the queue', () => {
    const current = row()
    bucketStore.setTree([queueBucket([current])])
    session.state = activeState()
    const openPanel = vi.fn()
    const { rerender } = render(<GlobalPlaybackBar playbackPanelOpen={false} onOpenPlaybackPanel={openPanel} />)
    fireEvent.click(screen.getByRole('button', { name: '현재 곡 가사 열기' }))
    expect(lyrics.open).toHaveBeenLastCalledWith(current, session.state)
    session.state = activeState({ currentItemId: null, external: { title: 'External song', artist: 'Artist', albumCoverUrl: null, spotifyTrackId: 'external-id', spotifyAlbumId: null, deviceName: 'Living room' } })
    rerender(<GlobalPlaybackBar playbackPanelOpen={false} onOpenPlaybackPanel={openPanel} />)
    fireEvent.click(screen.getByRole('button', { name: '현재 곡 가사 열기' }))
    expect(lyrics.open).toHaveBeenLastCalledWith(null, session.state)
    expect(openPanel).not.toHaveBeenCalled()
    expect(screen.getByText('Living room')).toBeInTheDocument()
  })

  it('keeps YouTube mapping and lyrics reachable while hiding Spotify-only controls', () => {
    bucketStore.setTree([queueBucket([row()])])
    session.state = activeState({ shuffle: null, repeat: null, volumePercent: 60 })
    provider.state = { provider: 'youtube', trackId: 'youtube-catalog-track', title: 'YouTube song' }
    const listener = vi.fn()
    window.addEventListener('myblog:open-youtube-mapping', listener)
    render(<GlobalPlaybackBar playbackPanelOpen={false} onOpenPlaybackPanel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'YouTube 영상 고르기' }))
    expect(listener.mock.calls[0][0].detail).toEqual({ trackId: 'youtube-catalog-track', title: 'YouTube song' })
    expect(screen.getByRole('button', { name: '현재 곡 가사 열기' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '좋아요' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '재생 기기 바꾸기' })).not.toBeInTheDocument()
    expect(session.loadLiked).not.toHaveBeenCalled()
    window.removeEventListener('myblog:open-youtube-mapping', listener)
  })

  it('reserves the measured bar including reflow, restores after navigation and releases on collapse', () => {
    let resize = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe() {}
      disconnect = disconnect
    })
    bucketStore.setTree([queueBucket([row()])])
    session.state = activeState()
    const { unmount } = render(<GlobalPlaybackBar playbackPanelOpen={false} onOpenPlaybackPanel={vi.fn()} />)
    const bar = screen.getByRole('region', { name: '전역 재생 제어' })
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({ height: 237.5 } as DOMRect)
    act(() => resize())
    expect(document.documentElement.style.getPropertyValue('--global-player-h')).toBe('238px')
    document.documentElement.style.removeProperty('--global-player-h')
    act(() => document.dispatchEvent(new Event('astro:after-swap')))
    expect(document.documentElement.style.getPropertyValue('--global-player-h')).toBe('238px')
    fireEvent.click(screen.getByRole('button', { name: '재생 바 접기' }))
    expect(document.documentElement.style.getPropertyValue('--global-player-h')).toBe('0px')
    expect(disconnect).toHaveBeenCalled()
    unmount()
    vi.unstubAllGlobals()
  })

  it('opens the shared device picker and transfers to the selected device', async () => {
    bucketStore.setTree([queueBucket([row()])])
    session.state = activeState()
    render(<GlobalPlaybackBar playbackPanelOpen={false} onOpenPlaybackPanel={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '재생 기기 바꾸기' }))
    const listbox = await screen.findByRole('listbox', { name: '재생 기기' })
    fireEvent.click(within(listbox).getByRole('option', { name: /Speaker/ }))

    await waitFor(() => expect(session.transferTo).toHaveBeenCalledWith('speaker'))
  })

  it('keeps every desktop control reachable in the mobile three-group bar', () => {
    mobile = true
    bucketStore.setTree([queueBucket([row()])])
    session.state = activeState()
    render(<GlobalPlaybackBar playbackPanelOpen={false} onOpenPlaybackPanel={vi.fn()} />)

    const deck = screen.getByRole('region', { name: '전역 재생 제어' })
    expect(deck).toHaveAttribute('data-mobile-layout', 'three-group')
    expect(screen.getByRole('button', { name: '좋아요' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '셔플 켜기' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '이전 곡' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '재생' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다음 곡' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /반복/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '재생 대기열 열기' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '재생 기기 바꾸기' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '볼륨 조절' }))
    expect(screen.getByRole('slider', { name: '볼륨' })).toBeInTheDocument()
  })
})
