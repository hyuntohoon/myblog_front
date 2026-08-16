// BUG-20: BucketPickerSheet had zero test coverage — the exact place LikedBoard's
// promote-to-bucket flow shipped without a `skip` prop, letting a member add into
// the sync-owned spotify_library mirror bucket (no caller-side guard, no server
// backstop). This pins the `skip` contract itself: a skipped bucket (and its
// subtree) never renders as a pickable entry, and the default (no `skip`) hides
// nothing — so a future caller that forgets `skip` fails loudly in a real render,
// not silently in production.
import type { BoardBucket } from '@lib/buckets'
import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { isManualAddTarget, SLIB_KIND } from '@lib/buckets'
import { BucketPickerSheet } from './BucketPickerSheet'

// jsdom computes no layout, so `offsetParent` is always null and the hook's
// `visibleFocusables` filter would drop every button. Same stub as the other
// `useDismissable` suites.
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

function bucket(over: Partial<BoardBucket> = {}): BoardBucket {
  return {
    id: 'b',
    name: 'b',
    color: null,
    isDone: false,
    kind: 'review',
    type: 'general',
    isPublic: false,
    researchMode: 'off',
    albums: [],
    children: [],
    ...over,
  }
}

describe('bucketPickerSheet — skip contract', () => {
  it('with no skip prop, every bucket (incl. spotify_library) renders — the caller must opt in', () => {
    render(
      <BucketPickerSheet
	title="담기"
	tree={[bucket({ id: 'general', name: '일반 버킷' }), bucket({ id: 'lib', name: 'Spotify 라이브러리', kind: SLIB_KIND })]}
	onPick={vi.fn()}
	onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('일반 버킷')).toBeInTheDocument()
    expect(screen.getByText('Spotify 라이브러리')).toBeInTheDocument()
  })

  it('with skip={b => !isManualAddTarget(b)}, the spotify_library bucket is hidden', () => {
    render(
      <BucketPickerSheet
	title="My Buckit에 담기"
	tree={[bucket({ id: 'general', name: '일반 버킷' }), bucket({ id: 'lib', name: 'Spotify 라이브러리', kind: SLIB_KIND })]}
	skip={b => !isManualAddTarget(b)}
	onPick={vi.fn()}
	onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('일반 버킷')).toBeInTheDocument()
    expect(screen.queryByText('Spotify 라이브러리')).not.toBeInTheDocument()
  })

  it('skipping a bucket also skips its subtree', () => {
    render(
      <BucketPickerSheet
	title="My Buckit에 담기"
	tree={[bucket({ id: 'lib', name: 'Spotify 라이브러리', kind: SLIB_KIND, children: [bucket({ id: 'nested', name: '중첩 버킷' })] })]}
	skip={b => !isManualAddTarget(b)}
	onPick={vi.fn()}
	onClose={vi.fn()}
      />,
    )
    expect(screen.queryByText('중첩 버킷')).not.toBeInTheDocument()
  })
})

// A11Y-modal-background-inert Step 2 — the sheet declared `aria-modal="true"`
// but hand-rolled a `window` ESC listener and had no trap and no focus restore.
// These pin what the `useDismissable` migration bought.
describe('bucketPickerSheet — modal behaviour after the useDismissable migration', () => {
  function Harness() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>열기</button>
        {open && (
          <BucketPickerSheet
	title="담기"
	tree={[bucket({ id: 'general', name: '일반 버킷' })]}
	onPick={vi.fn()}
	onClose={() => setOpen(false)}
          />
        )}
      </>
    )
  }

  it('autofocuses into the sheet, traps Tab, and restores focus to the trigger on ESC', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: '열기' })
    // Focus as a keyboard user would — a bare programmatic click leaves
    // activeElement on <body> and makes restore untestable.
    trigger.focus()
    fireEvent.click(trigger)

    const sheet = await screen.findByRole('dialog', { name: '담기' })
    const close = screen.getByLabelText('닫기')
    expect(document.activeElement).toBe(close)

    const entry = screen.getByText('일반 버킷').closest('button')!
    entry.focus()
    fireEvent.keyDown(entry, { key: 'Tab' })
    expect(sheet.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(close)

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '담기' })).not.toBeInTheDocument())
    expect(document.activeElement).toBe(trigger)
  })

  it('inerts the other <body> children while open, never its own portalled scrim', async () => {
    const bg = document.createElement('div')
    document.body.appendChild(bg)
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '열기' }))
    await screen.findByRole('dialog', { name: '담기' })

    expect(bg.hasAttribute('inert')).toBe(true)
    expect(screen.getByRole('presentation').hasAttribute('inert')).toBe(false)

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(bg.hasAttribute('inert')).toBe(false))
    bg.remove()
  })
})
