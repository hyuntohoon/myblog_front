import { afterEach, describe, expect, it, vi } from 'vitest'
import { observePlaybackLifecycle } from './lifecycle'

const sync = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('./session', () => ({ playbackSession: { syncFromLive: sync } }))
const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  vi.restoreAllMocks()
  sync.mockClear()
})

describe('persisted playback lifecycle', () => {
  it('reads at initial entry, client navigation, page restore and foreground return', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    cleanups.push(observePlaybackLifecycle())
    expect(sync).toHaveBeenCalledTimes(1)
    document.dispatchEvent(new Event('astro:page-load'))
    window.dispatchEvent(new Event('pageshow'))
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
    expect(sync).toHaveBeenCalledTimes(5)
  })

  it('shares listeners across player surfaces and releases them after the last unmount', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const first = observePlaybackLifecycle()
    const second = observePlaybackLifecycle()
    cleanups.push(first, second)
    expect(sync).toHaveBeenCalledTimes(1)
    first()
    document.dispatchEvent(new Event('astro:page-load'))
    expect(sync).toHaveBeenCalledTimes(2)
    second()
    document.dispatchEvent(new Event('astro:page-load'))
    window.dispatchEvent(new Event('focus'))
    expect(sync).toHaveBeenCalledTimes(2)
  })

  it('defers hidden-page reads until the page becomes visible', () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    cleanups.push(observePlaybackLifecycle())
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('pageshow'))
    expect(sync).not.toHaveBeenCalled()
    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(sync).toHaveBeenCalledOnce()
  })
})
