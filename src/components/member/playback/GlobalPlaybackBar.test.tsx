import type { BoardAlbum, BoardBucket } from '@lib/buckets'
import type { PlaybackSessionState } from '@lib/playback/session'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PLAYBACK_KIND, PLAYBACK_TYPE } from '@lib/buckets'
import { bucketStore } from '@lib/pocketBuckit/bucketStore'
import { GlobalPlaybackBar, isGlobalPlaybackBarVisible } from './GlobalPlaybackBar'

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
  devices: null,
  activeDeviceId: null,
  shuffle: null,
  repeat: null,
  volumePercent: null,
  liked: 'unknown',
  reconnect: false,
  notice: null,
  busy: false,
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
  bucketStore.setTree([])
  document.documentElement.style.removeProperty('--global-player-h')
})

describe('globalPlaybackBar', () => {
  it('uses the exact active-or-external visibility rule for playing and paused playback', () => {
    expect(isGlobalPlaybackBarVisible(EMPTY_STATE)).toBe(false)
    expect(isGlobalPlaybackBarVisible({ ...EMPTY_STATE, currentItemId: 'item-1', playing: true })).toBe(true)
    expect(isGlobalPlaybackBarVisible({ ...EMPTY_STATE, currentItemId: 'item-1', playing: false })).toBe(true)
    expect(isGlobalPlaybackBarVisible({
      ...EMPTY_STATE,
      external: { title: 'External', artist: 'Artist', albumCoverUrl: null, spotifyTrackId: 'sp-1', spotifyAlbumId: null, deviceName: null },
    })).toBe(true)
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

  it('maps signal-rail pointer position to the one session seek command', async () => {
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

  it('opens the shared device picker and transfers to the selected device', async () => {
    bucketStore.setTree([queueBucket([row()])])
    session.state = activeState()
    render(<GlobalPlaybackBar playbackPanelOpen={false} onOpenPlaybackPanel={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '재생 기기 바꾸기' }))
    const listbox = await screen.findByRole('listbox', { name: '재생 기기' })
    fireEvent.click(within(listbox).getByRole('option', { name: /Speaker/ }))

    await waitFor(() => expect(session.transferTo).toHaveBeenCalledWith('speaker'))
  })

  it('keeps every desktop control reachable in the mobile two-row deck', () => {
    mobile = true
    bucketStore.setTree([queueBucket([row()])])
    session.state = activeState()
    render(<GlobalPlaybackBar playbackPanelOpen={false} onOpenPlaybackPanel={vi.fn()} />)

    const deck = screen.getByRole('region', { name: '전역 재생 제어' })
    expect(deck).toHaveAttribute('data-mobile-layout', 'two-row')
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
