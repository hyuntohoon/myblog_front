import { fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDismissable } from './useDismissable'

const mountedRoots: HTMLElement[] = []
const originalOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')

function dismissableRoot() {
  const root = document.createElement('div')
  const first = document.createElement('button')
  const last = document.createElement('button')
  first.textContent = '첫 번째'
  last.textContent = '마지막'
  root.append(first, last)
  document.body.append(root)
  mountedRoots.push(root)
  return { root, first, last }
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      return this.parentElement
    },
  })
})

afterEach(() => {
  mountedRoots.splice(0).forEach(root => root.remove())
  if (originalOffsetParent)
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', originalOffsetParent)
})

describe('useDismissable', () => {
  it('calls onClose on Escape when open', () => {
    const onClose = vi.fn()
    const { root } = dismissableRoot()
    const ref = { current: root }
    renderHook(() => useDismissable(true, onClose, ref))

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose on Escape when closed', () => {
    const onClose = vi.fn()
    const { root } = dismissableRoot()
    const ref = { current: root }
    renderHook(() => useDismissable(false, onClose, ref))

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).not.toHaveBeenCalled()
  })

  it('wraps Tab between the first and last focusable elements', () => {
    const { root, first, last } = dismissableRoot()
    const ref = { current: root }
    renderHook(() => useDismissable(true, vi.fn(), ref))

    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    first.focus()
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('restores focus to the trigger when the dismissable closes', () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    mountedRoots.push(trigger)
    trigger.focus()
    const { root, first } = dismissableRoot()
    const ref = { current: root }
    const onClose = vi.fn()
    const { rerender } = renderHook(
      ({ open }: { open: boolean }) => useDismissable(open, onClose, ref),
      { initialProps: { open: false } },
    )

    rerender({ open: true })
    expect(document.activeElement).toBe(first)

    rerender({ open: false })
    expect(document.activeElement).toBe(trigger)
  })

  it('only lets the top nested dismissable handle Escape', () => {
    const onFirstClose = vi.fn()
    const onSecondClose = vi.fn()
    const firstRef = { current: dismissableRoot().root }
    const secondRef = { current: dismissableRoot().root }
    renderHook(() => {
      useDismissable(true, onFirstClose, firstRef, { autoFocus: false })
      useDismissable(true, onSecondClose, secondRef, { autoFocus: false })
    })

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onSecondClose).toHaveBeenCalledTimes(1)
    expect(onFirstClose).not.toHaveBeenCalled()
  })

  it('does not steal focus when autoFocus is false', () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    mountedRoots.push(trigger)
    trigger.focus()
    const ref = { current: dismissableRoot().root }

    renderHook(() => useDismissable(true, vi.fn(), ref, { autoFocus: false }))

    expect(document.activeElement).toBe(trigger)
  })

  describe('lockScroll', () => {
    beforeEach(() => {
      document.body.style.overflow = ''
    })
    afterEach(() => {
      document.body.style.overflow = ''
    })

    it('does not lock the background scroll by default', () => {
      const ref = { current: dismissableRoot().root }
      renderHook(() => useDismissable(true, vi.fn(), ref))
      expect(document.body.style.overflow).toBe('')
    })

    it('locks the background scroll while open when opted in, and releases on close', () => {
      const ref = { current: dismissableRoot().root }
      const { rerender } = renderHook(
        ({ open }: { open: boolean }) => useDismissable(open, vi.fn(), ref, { lockScroll: true }),
        { initialProps: { open: true } },
      )
      expect(document.body.style.overflow).toBe('hidden')

      rerender({ open: false })
      expect(document.body.style.overflow).toBe('')
    })
  })
})
