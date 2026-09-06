import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '@lib/api'
import { invalidateUri } from '@lib/playback/uris'
import { youtubeMappingError } from '@lib/youtubeMapping'
import { YouTubeMappingPicker } from './YouTubeMappingPicker'

vi.mock('@lib/api', () => ({ apiFetch: vi.fn() }))
vi.mock('@lib/playback/uris', () => ({ invalidateUri: vi.fn() }))

const api = vi.mocked(apiFetch)
const malicious = '<img src=x onerror=alert(1)>'
const candidates = {
  track_id: 'track-1',
  track_duration_sec: 150,
  query: 'Song',
  candidates: [
    { video_id: 'fan-video', title: malicious, channel_title: `Fan ${malicious}`, duration_sec: 150, duration_delta_sec: 0, embeddable: true, search_rank: 1, thumbnail_url: 'https://i.ytimg.com/vi/fan-video/default.jpg' },
    { video_id: 'official-video', title: 'Official audio', channel_title: 'Official Artist', duration_sec: 193, duration_delta_sec: 43, embeddable: true, search_rank: 2, thumbnail_url: 'https://i.ytimg.com/vi/official-video/default.jpg' },
    { video_id: 'no-channel', title: 'Unknown channel', channel_title: null, duration_sec: 150, duration_delta_sec: 0, embeddable: true, search_rank: 4 },
    { video_id: 'blocked-video', title: 'Unavailable', channel_title: 'Other', duration_sec: 150, duration_delta_sec: 0, embeddable: false, search_rank: 3 },
  ],
}

function response(body: unknown = candidates, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), { status, headers })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function openPicker(props: Partial<Parameters<typeof YouTubeMappingPicker>[0]> = {}) {
  const onClose = vi.fn()
  const onChanged = vi.fn()
  const view = render(<YouTubeMappingPicker trackId="track-1" trackTitle="Song" onClose={onClose} onChanged={onChanged} {...props} />)
  await screen.findByText('Official audio')
  return { ...view, onClose, onChanged }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Awaited promises keep search completions asynchronous, like the real API.
  api.mockImplementation(async () => response())
})

describe('youTubeMappingPicker', () => {
  it('shows channels and duration differences as text, never auto-selects a match', async () => {
    await openPicker({ hasMapping: false })
    expect(api).toHaveBeenCalledWith('https://music.test/api/music/search/youtube-candidates?track_id=track-1&limit=5', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(screen.getByText('채널: Official Artist')).toBeInTheDocument()
    expect(screen.getByText('3:13 · 43초 차이')).toBeInTheDocument()
    expect(screen.getByText(/재생시간이 같아도 다른 영상/)).toBeInTheDocument()
    for (const radio of screen.getAllByRole('radio'))
      expect(radio).not.toBeChecked()
    expect(screen.getByRole('button', { name: '이 영상으로 확정' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '이 영상 아님' })).not.toBeInTheDocument()
    expect(screen.getByText(malicious)).toBeInTheDocument()
    expect(screen.getByText(`채널: Fan ${malicious}`)).toBeInTheDocument()
    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelector('[onerror]')).toBeNull()
    expect(dialog.querySelector('a')).toBeNull()
    expect(dialog.querySelectorAll('img')).toHaveLength(2)
    expect(screen.getByRole('radio', { name: /Unavailable/ })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /Unknown channel/ })).toBeDisabled()
    expect(api).toHaveBeenCalledTimes(1)
  })

  it('saves only the explicitly selected video and invalidates the provider cache before closing', async () => {
    const { onClose, onChanged } = await openPicker()
    fireEvent.click(screen.getByRole('radio', { name: /Official audio/ }))
    expect(api).toHaveBeenCalledTimes(1)
    api.mockResolvedValueOnce(response({ video_id: 'official-video' }))
    fireEvent.click(screen.getByRole('button', { name: '이 영상으로 확정' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('confirmed'))
    expect(api).toHaveBeenLastCalledWith('https://backend.test/api/playback/track/track-1/youtube-mapping', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ video_id: 'official-video' }), signal: expect.any(AbortSignal) }))
    expect(invalidateUri).toHaveBeenCalledWith('track-1', 'youtube')
    expect(vi.mocked(invalidateUri).mock.invocationCallOrder[0]).toBeLessThan(onChanged.mock.invocationCallOrder[0])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('deletes an incorrect mapping without requiring a candidate selection', async () => {
    const { onChanged } = await openPicker()
    api.mockResolvedValueOnce(new Response(null, { status: 204 }))
    fireEvent.click(screen.getByRole('button', { name: '이 영상 아님' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('deleted'))
    expect(api).toHaveBeenLastCalledWith('https://backend.test/api/playback/track/track-1/youtube-mapping', expect.objectContaining({ method: 'DELETE' }))
    expect(api.mock.calls.at(-1)?.[1]).not.toHaveProperty('body')
    expect(invalidateUri).toHaveBeenCalledWith('track-1', 'youtube')
  })

  it('keeps a failed confirmation open and does not invalidate or report success', async () => {
    const { onClose, onChanged } = await openPicker()
    api.mockResolvedValueOnce(response({ detail: 'youtube_video_unusable: embed not available' }, 422))
    fireEvent.click(screen.getByRole('radio', { name: /Official audio/ }))
    fireEvent.click(screen.getByRole('button', { name: '이 영상으로 확정' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('다른 영상을 골라 주세요')
    expect(invalidateUri).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '이 영상으로 확정' })).toBeEnabled()
  })

  it('ignores an old track search that resolves after the next track search', async () => {
    const first = deferred<Response>()
    api.mockReturnValueOnce(first.promise)
    const { rerender } = render(<YouTubeMappingPicker trackId="old" trackTitle="Old" onClose={vi.fn()} />)
    const oldSignal = api.mock.calls[0][1]?.signal
    rerender(<YouTubeMappingPicker trackId="new" trackTitle="New" onClose={vi.fn()} />)
    await screen.findByText('Official audio')
    expect(oldSignal?.aborted).toBe(true)
    await act(async () => first.resolve(response({ ...candidates, candidates: [{ ...candidates.candidates[0], title: 'Stale result' }] })))
    expect(screen.queryByText('Stale result')).not.toBeInTheDocument()
    expect(screen.getByText('Official audio')).toBeInTheDocument()
  })

  it('resets selected video when a different track is opened', async () => {
    const { rerender } = await openPicker()
    fireEvent.click(screen.getByRole('radio', { name: /Official audio/ }))
    rerender(<YouTubeMappingPicker trackId="track-2" trackTitle="Second" onClose={vi.fn()} />)
    await screen.findByText('Official audio')
    expect(screen.getByRole('button', { name: '이 영상으로 확정' })).toBeDisabled()
  })

  it('aborts an unmounted mutation, invalidates a late successful response, and suppresses stale callbacks', async () => {
    const { unmount, onChanged, onClose } = await openPicker()
    const write = deferred<Response>()
    api.mockReturnValueOnce(write.promise)
    fireEvent.click(screen.getByRole('button', { name: '이 영상 아님' }))
    const signal = api.mock.calls.at(-1)?.[1]?.signal
    unmount()
    expect(signal?.aborted).toBe(true)
    await act(async () => write.resolve(new Response(null, { status: 204 })))
    expect(invalidateUri).toHaveBeenCalledWith('track-1', 'youtube')
    expect(onChanged).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('invalidates an aborted write whose server outcome is unknown', async () => {
    const { unmount, onChanged } = await openPicker()
    const write = deferred<Response | null>()
    api.mockReturnValueOnce(write.promise)
    fireEvent.click(screen.getByRole('button', { name: '이 영상 아님' }))
    unmount()
    await act(async () => write.resolve(null))
    expect(invalidateUri).toHaveBeenCalledWith('track-1', 'youtube')
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('blocks repeated writes while the server is still responding', async () => {
    await openPicker()
    const write = deferred<Response>()
    api.mockReturnValueOnce(write.promise)
    fireEvent.click(screen.getByRole('button', { name: '이 영상 아님' }))
    fireEvent.click(screen.getByRole('button', { name: '이 영상 아님' }))
    expect(screen.getByRole('button', { name: '이 영상 아님' })).toBeDisabled()
    expect(api).toHaveBeenCalledTimes(2)
    await act(async () => write.resolve(new Response(null, { status: 204 })))
  })

  it('shows the standing gate failure and lets the user retry search', async () => {
    api.mockResolvedValueOnce(response({}, 403))
    render(<YouTubeMappingPicker trackId="track-1" trackTitle="Song" onClose={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('내 버킷에 담은 뒤')
    fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
    await screen.findByText('Official audio')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('youTube mapping errors', () => {
  it.each([
    [429, '30', '30초 후'],
    [429, '86400', '오늘의 YouTube 검색 한도'],
    [503, null, 'YouTube 연결을 잠시 사용할 수 없어요'],
    [403, null, '내 버킷에 담은 뒤'],
  ])('explains HTTP %s Retry-After %s', async (status, retryAfter, message) => {
    expect(await youtubeMappingError(response({}, status, retryAfter ? { 'Retry-After': retryAfter } : undefined))).toContain(message)
  })

  it('recognizes daily quota exhaustion even seconds before the Pacific reset', async () => {
    expect(await youtubeMappingError(response({ detail: 'youtube_quota_exhausted: no quota' }, 429, { 'Retry-After': '10' }))).toContain('오늘의 YouTube 검색 한도')
  })

  it('handles an unavailable response', async () => {
    expect(await youtubeMappingError(null)).toContain('연결하지 못했어요')
  })
})
