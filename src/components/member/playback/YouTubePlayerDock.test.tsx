import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { YouTubePlayerDock } from './YouTubePlayerDock'

const mocks = vi.hoisted(() => ({
  setHost: vi.fn(),
  stop: vi.fn(),
  sync: vi.fn(),
  toggle: vi.fn(),
  seek: vi.fn(),
  provider: { provider: 'youtube', title: 'Come Back to Earth' },
  session: { playing: true, busy: false, durationMs: 180_000, anchor: { ms: 20_000 } },
}))
vi.mock('@lib/youtubePlayback', () => ({ setYouTubeHost: mocks.setHost, getLastErrorCode: () => null }))
vi.mock('@lib/playback/provider', () => ({
  providerStore: { subscribe: () => () => {}, getSnapshot: () => mocks.provider, getServerSnapshot: () => mocks.provider },
}))
vi.mock('@lib/playback/session', () => ({
  playbackSession: {
    subscribe: () => () => {},
    getSnapshot: () => mocks.session,
    getServerSnapshot: () => mocks.session,
    stopYouTube: mocks.stop,
    syncFromLive: mocks.sync,
    togglePlay: mocks.toggle,
    seekTo: mocks.seek,
  },
}))

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  vi.stubGlobal('innerWidth', 1024)
  vi.stubGlobal('innerHeight', 768)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  mocks.sync.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 10)))
})
afterEach(async () => {
  cleanup()
  await vi.runOnlyPendingTimersAsync()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('youTubePlayerDock visibility lifecycle', () => {
  it('releases the player host on unmount and cancels live polling', async () => {
    const { unmount } = render(<YouTubePlayerDock onChooseVideo={vi.fn()} />)
    const host = mocks.setHost.mock.calls[0][0] as HTMLElement
    expect(host).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(250))
    expect(mocks.sync).toHaveBeenCalledOnce()

    unmount()
    await act(() => vi.advanceTimersByTimeAsync(1000))

    expect(mocks.setHost).toHaveBeenLastCalledWith(null)
    expect(host).not.toBeInTheDocument()
    expect(mocks.sync).toHaveBeenCalledOnce()
    document.dispatchEvent(new Event('astro:before-swap'))
    expect(mocks.stop).not.toHaveBeenCalled()
  })

  it('cancels playback if a delayed mapping mounts the dock after the tab was already hidden', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')

    render(<YouTubePlayerDock onChooseVideo={vi.fn()} />)

    expect(mocks.stop).toHaveBeenCalledOnce()
    expect(mocks.setHost).not.toHaveBeenCalled()
  })

  it('stops sound when the document becomes hidden', () => {
    render(<YouTubePlayerDock onChooseVideo={vi.fn()} />)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(mocks.stop).not.toHaveBeenCalled()

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))

    expect(mocks.stop).toHaveBeenCalledOnce()
  })

  it.each(['astro:before-swap', 'pagehide'])('stops sound on %s', (event) => {
    render(<YouTubePlayerDock onChooseVideo={vi.fn()} />)

    const target = event === 'pagehide' ? window : document
    target.dispatchEvent(new Event(event))

    expect(mocks.stop).toHaveBeenCalledOnce()
  })

  it.each([[479, 768], [1024, 409]])('stops sound when the viewport shrinks to %i by %i', (width, height) => {
    render(<YouTubePlayerDock onChooseVideo={vi.fn()} />)
    window.dispatchEvent(new Event('resize'))
    expect(mocks.stop).not.toHaveBeenCalled()

    vi.stubGlobal('innerWidth', width)
    vi.stubGlobal('innerHeight', height)
    window.dispatchEvent(new Event('resize'))

    expect(mocks.stop).toHaveBeenCalledOnce()
  })

  it.each([[479, 768], [1024, 409]])('does not mount an invisible player in a %i by %i viewport', (width, height) => {
    vi.stubGlobal('innerWidth', width)
    vi.stubGlobal('innerHeight', height)

    render(<YouTubePlayerDock onChooseVideo={vi.fn()} />)

    expect(mocks.setHost).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('480px')
    expect(screen.queryByRole('region', { name: 'YouTube 플레이어' })).not.toBeInTheDocument()
  })
})

describe('youTubePlayerDock controls and frame', () => {
  it('keeps attribution and controls outside an unobstructed 16:9 frame of at least 480 by 270', () => {
    const style = document.createElement('style')
    style.textContent = readFileSync(resolve(process.cwd(), 'src/styles/youtube-player.css'), 'utf8')
    document.head.appendChild(style)
    try {
      render(<YouTubePlayerDock onChooseVideo={vi.fn()} />)
      const host = mocks.setHost.mock.calls[0][0] as HTMLElement
      const frame = host.parentElement!
      const computed = getComputedStyle(frame)

      expect(computed.minWidth).toBe('480px')
      expect(computed.minHeight).toBe('270px')
      expect(computed.aspectRatio).toBe('16 / 9')
      expect(frame.children).toHaveLength(1)
      expect(frame).not.toContainElement(screen.getByRole('link', { name: 'YouTube' }))
      for (const button of screen.getAllByRole('button'))
        expect(frame).not.toContainElement(button)
    }
    finally {
      style.remove()
    }
  })

  it('routes pause and seek gestures to the shared playback session', () => {
    render(<YouTubePlayerDock onChooseVideo={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '일시정지' }))
    fireEvent.change(screen.getByRole('slider', { name: 'YouTube 재생 위치' }), { target: { value: '42000' } })

    expect(mocks.toggle).toHaveBeenCalledOnce()
    expect(mocks.seek).toHaveBeenCalledWith(42_000)
  })

  it('offers a replacement without stopping playback until the member chooses it', () => {
    const choose = vi.fn()
    render(<YouTubePlayerDock onChooseVideo={choose} />)

    fireEvent.click(screen.getByRole('button', { name: '다른 영상 고르기' }))

    expect(choose).toHaveBeenCalledOnce()
    expect(mocks.stop).not.toHaveBeenCalled()
  })

  it('stops sound when the member closes the dock', () => {
    render(<YouTubePlayerDock onChooseVideo={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'YouTube 재생 종료' }))

    expect(mocks.stop).toHaveBeenCalledOnce()
  })
})
