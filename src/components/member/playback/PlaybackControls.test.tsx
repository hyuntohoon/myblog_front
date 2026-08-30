import type { PlaybackDevice } from '@lib/spotifyPlayback'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { playbackControlCopy, PlaybackDevicePicker, PlaybackLikeControl, PlaybackModeControls, seekPlayback, setPlaybackMode, togglePlaybackLiked, useSeekControl } from './PlaybackControls'

const sessionMocks = vi.hoisted(() => ({
  seekTo: vi.fn(),
  setMode: vi.fn(),
  toggleLiked: vi.fn(),
}))

vi.mock('@lib/playback/session', () => ({ playbackSession: sessionMocks }))

beforeEach(() => {
  vi.clearAllMocks()
  sessionMocks.seekTo.mockResolvedValue({ ok: true })
  sessionMocks.setMode.mockResolvedValue({ ok: true })
  sessionMocks.toggleLiked.mockResolvedValue({ ok: true })
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia
})

describe('shared playback feedback', () => {
  it('preserves seek, fixed-volume, and Like failure copy', async () => {
    const onNotice = vi.fn()
    sessionMocks.seekTo.mockResolvedValueOnce({ ok: false, reason: 'no-capability' })
    sessionMocks.setMode.mockResolvedValueOnce({ ok: false, reason: 'unsupported-on-device' })
    sessionMocks.toggleLiked.mockResolvedValueOnce({ ok: false, reason: 'transient' })

    await seekPlayback(12_000, onNotice)
    await setPlaybackMode({ kind: 'volume', percent: 80 }, onNotice)
    await togglePlaybackLiked(onNotice)

    expect(onNotice.mock.calls.map(([message]) => message)).toEqual([
      playbackControlCopy.unavailable,
      playbackControlCopy.fixedVolume,
      playbackControlCopy.likeFailed,
    ])
  })

  it('leaves missing Like scope to the re-consent control without a duplicate error', async () => {
    const onNotice = vi.fn()
    sessionMocks.toggleLiked.mockResolvedValueOnce({ ok: false, reason: 'library-scope-missing' })

    await togglePlaybackLiked(onNotice)

    expect(onNotice).not.toHaveBeenCalled()
  })
})

describe('playbackModeControls', () => {
  it.each([
    ['off', 'context'],
    ['context', 'track'],
    ['track', 'off'],
  ] as const)('cycles repeat from %s to %s', async (repeat, expected) => {
    const onSet = vi.fn(() => Promise.resolve())
    render(<PlaybackModeControls shuffle={null} repeat={repeat} volumePercent={null} onSet={onSet} micro={false} />)

    fireEvent.click(screen.getByRole('button'))

    expect(onSet).toHaveBeenCalledWith({ kind: 'repeat', mode: expected })
  })

  it('hides device-unsupported axes instead of rendering dead controls', () => {
    render(<PlaybackModeControls shuffle={null} repeat={null} volumePercent={null} onSet={vi.fn()} micro={false} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('slider', { name: '볼륨' })).not.toBeInTheDocument()
  })

  it('leaves responsive visibility to the consuming surface', () => {
    const props = { shuffle: true, repeat: 'off' as const, volumePercent: 50, onSet: vi.fn(), micro: false }
    const { rerender } = render(<PlaybackModeControls {...props} />)
    expect(screen.getByRole('button', { name: '셔플 끄기' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: '볼륨' })).toBeInTheDocument()

    rerender(<PlaybackModeControls {...props} hidden />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })
})

describe('playbackLikeControl', () => {
  it('renders interactive liked/unliked states and disables an unresolved state', () => {
    const onToggle = vi.fn()
    const { rerender } = render(<PlaybackLikeControl state="unliked" onToggle={onToggle} size={27} />)
    fireEvent.click(screen.getByRole('button', { name: '좋아요' }))
    expect(onToggle).toHaveBeenCalledOnce()

    rerender(<PlaybackLikeControl state="liked" onToggle={onToggle} size={27} />)
    expect(screen.getByRole('button', { name: '좋아요 취소' })).toHaveAttribute('aria-pressed', 'true')

    rerender(<PlaybackLikeControl state="loading" onToggle={onToggle} size={27} />)
    expect(screen.getByRole('button', { name: '좋아요' })).toBeDisabled()
  })

  it('turns missing library scope into the Integration re-consent path', () => {
    render(<PlaybackLikeControl state="scope-missing" onToggle={vi.fn()} size={27} />)

    expect(screen.getByRole('link', { name: '좋아요 권한 재동의하기' })).toHaveAttribute('href', '/members/?me&tab=integration')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('playbackDevicePicker', () => {
  const devices: PlaybackDevice[] = [
    { id: 'phone', name: 'Phone', type: 'Smartphone', isActive: true, isInPage: false },
    { id: 'speaker', name: 'Speaker', type: 'Speaker', isActive: false, isInPage: false },
  ]

  it('fetches only when opened and exposes the Premium fetch failure', async () => {
    const onRefresh = vi.fn().mockResolvedValue({ ok: false, reason: 'no-capability' })
    render(
      <PlaybackDevicePicker
	name={null}
	devices={null}
	activeDeviceId={null}
	onRefresh={onRefresh}
	onTransfer={vi.fn()}
	onSwitched={vi.fn()}
      />,
    )

    expect(onRefresh).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '재생 기기 선택' }))

    expect(screen.getByText('기기를 찾는 중…')).toBeInTheDocument()
    await screen.findByText('기기 목록은 Spotify Premium 계정에서 볼 수 있어요.')
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('shows transfer progress, updates through the callback, and closes on success', async () => {
    let resolveTransfer!: (value: { ok: true }) => void
    const onTransfer = vi.fn(() => new Promise<{ ok: true }>((resolve) => {
      resolveTransfer = resolve
    }))
    const onSwitched = vi.fn()
    const onRefresh = vi.fn().mockResolvedValue({ ok: true, devices })
    render(
      <PlaybackDevicePicker
	name="Phone"
	devices={devices}
	activeDeviceId="phone"
	onRefresh={onRefresh}
	onTransfer={onTransfer}
	onSwitched={onSwitched}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '재생 기기 바꾸기' }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('option', { name: /Speaker/ }))

    expect(screen.getByText('옮기는 중…')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Speaker/ })).toBeDisabled()
    await act(async () => resolveTransfer({ ok: true }))

    expect(onTransfer).toHaveBeenCalledWith('speaker')
    expect(onSwitched).toHaveBeenCalledOnce()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('raises this browser with the dedicated transfer option and preserves its failure copy', async () => {
    const onTransfer = vi.fn().mockResolvedValue({ ok: false, reason: 'no-capability' })
    render(
      <PlaybackDevicePicker
	name={null}
	devices={[]}
	activeDeviceId={null}
	onRefresh={vi.fn().mockResolvedValue({ ok: true, devices: [] })}
	onTransfer={onTransfer}
	onSwitched={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '재생 기기 선택' }))
    fireEvent.click(await screen.findByRole('option', { name: '이 브라우저 (음질 제한)' }))

    await screen.findByText('이 브라우저 재생은 Spotify Premium 계정에서 사용할 수 있어요.')
    expect(onTransfer).toHaveBeenCalledWith('', { raiseInPageFirst: true })
  })
})

function SeekHarness({ enabled = true, onSeek }: { enabled?: boolean, onSeek: (ms: number) => void }) {
  const control = useSeekControl({ enabled, durationMs: 100_000, elapsedMs: 50_000, onSeek })
  return <div ref={control.ref} role="slider" aria-label="재생 위치" onClick={control.onClick} onKeyDown={control.onKeyDown} tabIndex={0} />
}

describe('useSeekControl', () => {
  it('maps pointer position and keyboard arrows onto the shared seek callback', () => {
    const onSeek = vi.fn()
    render(<SeekHarness onSeek={onSeek} />)
    const slider = screen.getByRole('slider', { name: '재생 위치' })
    slider.getBoundingClientRect = () => ({ left: 10, width: 200, right: 210, top: 0, bottom: 10, height: 10, x: 10, y: 0, toJSON: () => {} })

    fireEvent.click(slider, { clientX: 60 })
    fireEvent.keyDown(slider, { key: 'ArrowLeft' })
    fireEvent.keyDown(slider, { key: 'ArrowRight' })

    expect(onSeek.mock.calls.map(([ms]) => ms)).toEqual([25_000, 45_000, 55_000])
  })
})

describe('the E1 copy split reaches the helpers the player routes through', () => {
  // Review caught this file as the miss. The split landed in `session.ts`,
  // `NowPlaying`, the lyrics queue screen and `PlaybackNotices`, but seek and the
  // modes go through these two helpers — which fell through to the generic
  // "잠시 후 다시 시도", the retry sentence, for the one failure a retry cannot
  // fix, shown beside the correct sentence at the same moment.
  it('names the missing device on a seek rather than offering a retry', async () => {
    const notices: string[] = []
    sessionMocks.seekTo.mockResolvedValue({ ok: false, reason: 'no-active-device' })

    await seekPlayback(1_000, m => notices.push(m))

    expect(notices).toEqual([playbackControlCopy.noDevice])
    expect(notices).not.toContain(playbackControlCopy.failed)
  })

  it('names it on a mode write too, and does not call it a device limit', async () => {
    const notices: string[] = []
    sessionMocks.setMode.mockResolvedValue({ ok: false, reason: 'no-active-device' })

    await setPlaybackMode({ kind: 'volume', percent: 40 }, m => notices.push(m))

    expect(notices).toEqual([playbackControlCopy.noDevice])
    // A sleeping phone is not a speaker without a volume knob.
    expect(notices).not.toContain(playbackControlCopy.fixedVolume)
  })
})
