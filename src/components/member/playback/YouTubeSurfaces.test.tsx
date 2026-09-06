import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '@lib/api'
import { cachedUri, invalidateUri } from '@lib/playback/uris'
import { playbackSession } from '@lib/playback/session'
import { openYouTubeMapping } from '@lib/playback/youtubeEvents'
import { YouTubeSurfaces } from './YouTubeSurfaces'

const mocks = vi.hoisted(() => ({
  provider: { provider: 'spotify', trackId: null, needsMapping: false, mappingTrackId: null },
}))
vi.mock('@lib/api', () => ({ apiFetch: vi.fn() }))
vi.mock('@lib/playback/uris', () => ({ cachedUri: vi.fn(() => undefined), invalidateUri: vi.fn() }))
vi.mock('@lib/playback/provider', () => ({
  clearMappingPrompt: vi.fn(),
  providerStore: { subscribe: () => () => {}, getSnapshot: () => mocks.provider, getServerSnapshot: () => mocks.provider },
}))
vi.mock('@lib/playback/session', () => ({ playbackSession: { stopYouTube: vi.fn(), replaceQueueAndPlay: vi.fn(), togglePlay: vi.fn() } }))
vi.mock('./YouTubePlayerDock', () => ({ YouTubePlayerDock: () => null }))

const candidateResult = {
  track_id: 'track-1',
  track_duration_sec: 120,
  query: 'Song',
  candidates: [{ video_id: 'official-video', title: 'Official audio', channel_title: 'Artist', duration_sec: 120, duration_delta_sec: 0, embeddable: true, search_rank: 1 }],
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.provider = { provider: 'spotify', trackId: null, needsMapping: false, mappingTrackId: null }
  vi.mocked(cachedUri).mockReturnValue(undefined)
  vi.mocked(apiFetch).mockImplementation(async (_path, options) => options?.method ?
    new Response(null, { status: 204 }) :
    new Response(JSON.stringify(candidateResult), { status: 200 }))
})

async function openPicker() {
  act(() => openYouTubeMapping('track-1', 'Song'))
  await screen.findByText('Official audio')
}

describe('youTubeSurfaces mapping lifecycle', () => {
  it('keeps deletion available after confirmation invalidates the URI cache, without starting playback', async () => {
    render(<YouTubeSurfaces />)
    await openPicker()
    fireEvent.click(screen.getByRole('radio', { name: /Official audio/ }))
    fireEvent.click(screen.getByRole('button', { name: '이 영상으로 확정' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(invalidateUri).toHaveBeenCalledWith('track-1', 'youtube')
    expect(screen.getByRole('status')).toHaveTextContent('YouTube 영상을 연결했어요. 재생 버튼을 눌러 들어보세요.')

    // No playback has populated the URI cache between saving and reopening.
    await openPicker()
    expect(screen.queryByText(/YouTube 영상을 연결했어요/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '이 영상 아님' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(apiFetch).toHaveBeenLastCalledWith('https://backend.test/api/playback/track/track-1/youtube-mapping', expect.objectContaining({ method: 'DELETE' }))
    expect(invalidateUri).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('status')).toHaveTextContent('YouTube 연결을 해제했어요.')
    expect(cachedUri).not.toHaveBeenCalled()
    expect(playbackSession.replaceQueueAndPlay).not.toHaveBeenCalled()
    expect(playbackSession.togglePlay).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '영상 변경 안내 닫기' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('hides saved confirmation feedback when the video player becomes active', async () => {
    const { rerender } = render(<YouTubeSurfaces />)
    await openPicker()
    fireEvent.click(screen.getByRole('radio', { name: /Official audio/ }))
    fireEvent.click(screen.getByRole('button', { name: '이 영상으로 확정' }))
    await screen.findByText(/YouTube 영상을 연결했어요/)
    mocks.provider = { ...mocks.provider, provider: 'youtube' }
    rerender(<YouTubeSurfaces />)
    expect(screen.queryByText(/YouTube 영상을 연결했어요/)).not.toBeInTheDocument()
  })

  it('keeps failed deletion in the picker with the API error and no success notice', async () => {
    render(<YouTubeSurfaces />)
    await openPicker()
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'forbidden' }), { status: 403 }))
    fireEvent.click(screen.getByRole('button', { name: '이 영상 아님' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('내 버킷에 담은 뒤')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByText('YouTube 연결을 해제했어요.')).not.toBeInTheDocument()
    expect(invalidateUri).not.toHaveBeenCalled()
  })
})
