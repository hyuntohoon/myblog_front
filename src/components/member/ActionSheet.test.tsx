// Characterization tests for the ActionSheet modal shell extracted from
// BucketBoard.tsx (REFACTOR-frontend-member-surface Step 4c). Pins the rendered
// structure (title/subtitle/action list + danger styling) and the close paths
// (Escape key, scrim tap, ✕ button) so the extraction is a proven no-op.
//
// A11Y-modal-background-inert Step 2 moved the sheet onto `useDismissable`. The
// ESC assertion below therefore fires on `document`, not `window`: the shared
// hook listens on `document` in the capture phase, and an event dispatched
// directly at `window` never reaches a `document` listener. The added cases pin
// what the migration bought — a focus trap, focus restore, background inert, and
// an ESC that respects the nesting stack instead of firing from any layer.
import { useRef, useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { useDismissable } from '@lib/useDismissable'
import { ActionSheet } from './ActionSheet'

// jsdom never computes layout, so `offsetParent` is always null and the hook's
// `visibleFocusables` filter would drop every button. Same stub the other
// `useDismissable` suites use (useDismissable.test.ts, AddToBucketMenu.test.tsx).
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

describe('actionSheet', () => {
  it('renders the title, subtitle, and one button per action', () => {
    render(
      <ActionSheet
	title="Kind of Blue"
	subtitle="Miles Davis"
	actions={[{ label: '조사하기', onClick: vi.fn() }, { label: '삭제', onClick: vi.fn(), danger: true }]}
	onClose={vi.fn()}
      />,
    )
    expect(screen.getByRole('dialog', { name: 'Kind of Blue' })).toBeInTheDocument()
    expect(screen.getByText('Miles Davis')).toBeInTheDocument()
    expect(screen.getByText('조사하기')).toBeInTheDocument()
    expect(screen.getByText('삭제')).toBeInTheDocument()
  })

  it('runs an action onClick when its button is tapped', () => {
    const onClick = vi.fn()
    render(<ActionSheet title="t" actions={[{ label: '조사하기', onClick }]} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('조사하기'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('closes on the ✕ button, the scrim, and the Escape key', () => {
    const onClose = vi.fn()
    render(<ActionSheet title="t" actions={[]} onClose={onClose} />)

    fireEvent.click(screen.getByLabelText('닫기'))
    expect(onClose).toHaveBeenCalledTimes(1)

    // scrim tap (the presentation-role backdrop)
    fireEvent.click(screen.getByRole('presentation'))
    expect(onClose).toHaveBeenCalledTimes(2)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('does not close when the sheet body itself is clicked', () => {
    const onClose = vi.fn()
    render(<ActionSheet title="Kind of Blue" actions={[]} onClose={onClose} />)
    fireEvent.click(screen.getByRole('dialog', { name: 'Kind of Blue' }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('traps Tab inside the sheet and restores focus to the trigger on close', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>열기</button>
          {open && <ActionSheet title="t" actions={[{ label: '조사하기', onClick: vi.fn() }]} onClose={() => setOpen(false)} />}
        </>
      )
    }
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: '열기' })
    // Focus the trigger the way a keyboard user would; a bare programmatic
    // click leaves activeElement on <body>, which makes restore untestable.
    trigger.focus()
    fireEvent.click(trigger)

    const sheet = await screen.findByRole('dialog', { name: 't' })
    const close = screen.getByLabelText('닫기')
    expect(document.activeElement).toBe(close)

    // Wrap-around at the end of the sheet's own focusables, not into the page.
    const action = screen.getByText('조사하기').closest('button')!
    action.focus()
    fireEvent.keyDown(action, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    expect(sheet.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 't' })).not.toBeInTheDocument())
    expect(document.activeElement).toBe(trigger)
  })

  it('inerts the background while open and leaves nothing behind on close', async () => {
    const onClose = vi.fn()
    const bg = document.createElement('div')
    document.body.appendChild(bg)
    const { unmount } = render(<ActionSheet title="t" actions={[]} onClose={onClose} />)
    expect(bg.hasAttribute('inert')).toBe(true)
    // The portalled scrim is itself a <body> child and must stay live.
    expect(screen.getByRole('presentation').hasAttribute('inert')).toBe(false)
    unmount()
    await waitFor(() => expect(bg.hasAttribute('inert')).toBe(false))
    bg.remove()
  })

  it('escape closes only the top layer — the sheet, not the dialog underneath it', async () => {
    const onHostClose = vi.fn()
    function NestedHarness() {
      const hostRef = useRef<HTMLDivElement>(null)
      const [sheet, setSheet] = useState(false)
      useDismissable(true, onHostClose, hostRef, { autoFocus: false })
      return (
        <div ref={hostRef} role="dialog" aria-label="호스트">
          {/* Opened by a tap, as the board opens it — a sheet mounted in the
              same commit as its host would register FIRST (React runs child
              effects before parent ones) and land UNDER it on the stack. */}
          <button type="button" onClick={() => setSheet(true)}>⋯</button>
          {sheet && <ActionSheet title="t" actions={[]} onClose={() => setSheet(false)} />}
        </div>
      )
    }
    render(<NestedHarness />)
    fireEvent.click(screen.getByRole('button', { name: '⋯' }))
    await screen.findByRole('dialog', { name: 't' })

    // Before Step 2 the sheet's own `window` listener sat outside `openStack`,
    // so this first ESC fired both layers at once.
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 't' })).not.toBeInTheDocument())
    expect(onHostClose).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onHostClose).toHaveBeenCalledTimes(1)
  })
})
