import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useScrollLock } from './useScrollLock'

beforeEach(() => {
  document.body.style.overflow = ''
})

afterEach(() => {
  document.body.style.overflow = ''
})

describe('useScrollLock', () => {
  it('locks the body while mounted and restores on unmount', () => {
    const { unmount } = renderHook(() => useScrollLock())
    expect(document.body.style.overflow).toBe('hidden')

    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('toggles the lock as the `lock` flag changes', () => {
    const { rerender, unmount } = renderHook(({ lock }: { lock: boolean }) => useScrollLock(lock), {
      initialProps: { lock: false },
    })
    expect(document.body.style.overflow).toBe('')

    rerender({ lock: true })
    expect(document.body.style.overflow).toBe('hidden')

    rerender({ lock: false })
    expect(document.body.style.overflow).toBe('')

    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('stays locked while any nested overlay still holds the lock (refcount)', () => {
    const outer = renderHook(() => useScrollLock())
    expect(document.body.style.overflow).toBe('hidden')

    const inner = renderHook(() => useScrollLock())
    expect(document.body.style.overflow).toBe('hidden')

    // The inner (later-opened, first-closed) overlay releases first — the outer
    // overlay must keep the body locked.
    inner.unmount()
    expect(document.body.style.overflow).toBe('hidden')

    outer.unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('preserves the original overflow value captured before the first lock', () => {
    document.body.style.overflow = 'scroll'
    const { unmount } = renderHook(() => useScrollLock())
    expect(document.body.style.overflow).toBe('hidden')

    unmount()
    expect(document.body.style.overflow).toBe('scroll')
  })

  it('does not restore a stale value when the outer lock closes before the inner one', () => {
    // Regression guard: if a naive per-instance save/restore were used instead of
    // the module-level refcount, the outer overlay closing first would restore
    // `overflow: hidden` (its own captured value) while the inner overlay is still
    // open, or leave the body in the wrong state once the inner overlay closes too.
    const outer = renderHook(() => useScrollLock())
    const inner = renderHook(() => useScrollLock())

    outer.unmount()
    expect(document.body.style.overflow).toBe('hidden')

    inner.unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
