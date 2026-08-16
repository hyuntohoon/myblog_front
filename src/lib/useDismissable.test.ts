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

  // A11Y-modal-background-inert Step 1. The focus trap above does nothing for a
  // screen-reader virtual cursor, so a modal must also mark every OTHER <body> child
  // `inert` while it is open.
  describe('inertBackground', () => {
    function backgroundChild() {
      const el = document.createElement('div')
      document.body.append(el)
      mountedRoots.push(el)
      return el
    }

    it('does not inert anything by default', () => {
      backgroundChild()
      const ref = { current: dismissableRoot().root }
      renderHook(() => useDismissable(true, vi.fn(), ref))

      expect(document.querySelectorAll('[inert]')).toHaveLength(0)
    })

    it('defaults to lockScroll, so a scroll-locking modal inerts the background', () => {
      const background = backgroundChild()
      const ref = { current: dismissableRoot().root }
      renderHook(() => useDismissable(true, vi.fn(), ref, { lockScroll: true }))

      expect(background.hasAttribute('inert')).toBe(true)
    })

    it('inerts the siblings but never the dialog own <body> child ancestor', () => {
      const background = backgroundChild()
      const shell = backgroundChild()
      const nested = document.createElement('div')
      shell.append(nested)
      const ref = { current: nested }
      renderHook(() => useDismissable(true, vi.fn(), ref, { inertBackground: true }))

      expect(background.hasAttribute('inert')).toBe(true)
      expect(shell.hasAttribute('inert')).toBe(false)
      expect(nested.hasAttribute('inert')).toBe(false)
    })

    it('recomputes on nested open and restores in order on close', () => {
      const background = backgroundChild()
      const outerRef = { current: dismissableRoot().root }
      const innerRef = { current: dismissableRoot().root }

      const outer = renderHook(() => useDismissable(true, vi.fn(), outerRef, { inertBackground: true }))
      expect(background.hasAttribute('inert')).toBe(true)
      expect(outerRef.current.hasAttribute('inert')).toBe(false)

      const inner = renderHook(() => useDismissable(true, vi.fn(), innerRef, { inertBackground: true }))
      expect(innerRef.current.hasAttribute('inert')).toBe(false)
      expect(outerRef.current.hasAttribute('inert')).toBe(true)
      expect(background.hasAttribute('inert')).toBe(true)

      inner.unmount()
      expect(outerRef.current.hasAttribute('inert')).toBe(false)
      expect(background.hasAttribute('inert')).toBe(true)

      outer.unmount()
      expect(document.querySelectorAll('[inert]')).toHaveLength(0)
    })

    // An anchored popup opts out of scroll lock, hence out of inert. Opening one over
    // a modal must not hand the background back to assistive tech.
    it('keeps a non-inerting overlay stacked above a modal reachable', () => {
      const background = backgroundChild()
      const modalRef = { current: dismissableRoot().root }
      const popupRef = { current: dismissableRoot().root }

      renderHook(() => useDismissable(true, vi.fn(), modalRef, { inertBackground: true }))
      renderHook(() => useDismissable(true, vi.fn(), popupRef))

      expect(popupRef.current.hasAttribute('inert')).toBe(false)
      expect(modalRef.current.hasAttribute('inert')).toBe(false)
      expect(background.hasAttribute('inert')).toBe(true)
    })

    it('leaves a pre-existing inert attribute alone on open and on close', () => {
      const preexisting = backgroundChild()
      preexisting.setAttribute('inert', '')
      const ref = { current: dismissableRoot().root }

      const { unmount } = renderHook(() => useDismissable(true, vi.fn(), ref, { inertBackground: true }))
      expect(preexisting.hasAttribute('inert')).toBe(true)

      unmount()
      expect(preexisting.hasAttribute('inert')).toBe(true)
    })

    // The background is released before focus is restored to the trigger — the other
    // cleanup order would drop the restore, since focusing into an inert subtree is a
    // no-op in a real browser.
    it('releases the background before restoring focus to the trigger', () => {
      const background = backgroundChild()
      const trigger = document.createElement('button')
      background.append(trigger)
      trigger.focus()

      const ref = { current: dismissableRoot().root }
      const { unmount } = renderHook(() => useDismissable(true, vi.fn(), ref, { inertBackground: true }))
      expect(background.hasAttribute('inert')).toBe(true)

      let inertAtRestore: boolean | null = null
      trigger.addEventListener('focus', () => {
        inertAtRestore = background.hasAttribute('inert')
      })
      unmount()

      expect(document.activeElement).toBe(trigger)
      expect(inertAtRestore).toBe(false)
    })

    // ClientRouter destroys a non-persisted island's DOM without unmounting React, so
    // its cleanup never runs. Without the swap sweep the persisted islands — which do
    // survive — would stay inert for the rest of the session.
    it('strands no inert attribute when a ClientRouter swap destroys the dialog', () => {
      const persisted = backgroundChild()
      const { root } = dismissableRoot()
      const ref = { current: root }
      renderHook(() => useDismissable(true, vi.fn(), ref, { inertBackground: true }))
      expect(persisted.hasAttribute('inert')).toBe(true)

      root.remove()
      document.dispatchEvent(new Event('astro:after-swap'))

      expect(persisted.hasAttribute('inert')).toBe(false)
    })
  })
})
