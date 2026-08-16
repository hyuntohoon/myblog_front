// A11Y-modal-background-inert Step 2 — this panel was the least modal of the
// three migrated surfaces: it had `role="dialog"` without `aria-modal`, no ESC
// at all (the scrim tap and the 닫기 button were the only exits), no focus trap
// and no focus restore. It is also the one NOT portalled to <body>, so it is
// where the inert controller's "keep the dialog's own <body>-child ancestor"
// walk is exercised through an intermediate wrapper.
//
// `usePocket` is stubbed rather than wrapped in the real provider: the provider
// reads localStorage and drives the live tray, none of which this file's a11y
// wiring depends on.
import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { POCKET_DESIGN_DEFAULTS } from '@lib/pocketBuckit/design'
import { PocketDesignSettings } from './PocketDesignSettings'

vi.mock('./PocketBuckitProvider', () => ({
  usePocket: () => ({
    design: POCKET_DESIGN_DEFAULTS,
    setDesign: vi.fn(),
    resetDesign: vi.fn(),
    setOpen: vi.fn(),
  }),
}))

// jsdom computes no layout, so `offsetParent` is always null and the hook's
// `visibleFocusables` filter would drop every button.
const originalOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() { return this.parentElement },
  })
})
afterAll(() => {
  if (originalOffsetParent)
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', originalOffsetParent)
})

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>디자인</button>
      {open && <PocketDesignSettings onClose={() => setOpen(false)} />}
    </>
  )
}

describe('pocketDesignSettings — modal behaviour after the useDismissable migration', () => {
  it('is announced as a modal dialog', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '디자인' }))
    const dialog = await screen.findByRole('dialog', { name: 'Pocket 디자인 설정' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('closes on ESC — it had no keyboard exit at all before — and restores focus', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: '디자인' })
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = await screen.findByRole('dialog', { name: 'Pocket 디자인 설정' })
    expect(dialog.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pocket 디자인 설정' })).not.toBeInTheDocument())
    expect(document.activeElement).toBe(trigger)
  })

  it('traps Tab inside the panel instead of letting it walk into the page behind', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '디자인' }))
    const dialog = await screen.findByRole('dialog', { name: 'Pocket 디자인 설정' })

    const focusables = [...dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]
    expect(focusables.length).toBeGreaterThan(1)

    focusables.at(-1)!.focus()
    fireEvent.keyDown(focusables.at(-1)!, { key: 'Tab' })
    expect(document.activeElement).toBe(focusables[0])

    fireEvent.keyDown(focusables[0], { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(focusables.at(-1))
  })

  it('inerts the background while open and restores it on close', async () => {
    const bg = document.createElement('div')
    document.body.appendChild(bg)
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '디자인' }))
    const dialog = await screen.findByRole('dialog', { name: 'Pocket 디자인 설정' })

    expect(bg.hasAttribute('inert')).toBe(true)
    // Rendered in place, not portalled: the kept element is the <body> child
    // that CONTAINS the dialog, not the dialog itself.
    const kept = [...document.body.children].find(c => c.contains(dialog))!
    expect(kept).not.toBe(dialog)
    expect(kept.hasAttribute('inert')).toBe(false)

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(bg.hasAttribute('inert')).toBe(false))
    bg.remove()
  })
})
