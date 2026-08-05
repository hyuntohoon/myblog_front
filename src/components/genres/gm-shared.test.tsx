import type { GmDoc } from './gm-model'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Peek } from './gm-shared'

// jsdom never computes layout, so `offsetParent` is always null — the same stub
// useDismissable.test.ts uses to make its `visibleFocusables` filter see anything.
const originalOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      return this.parentElement
    },
  })
})
afterEach(() => {
  if (originalOffsetParent)
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', originalOffsetParent)
})

const DOC: GmDoc = {
  order: ['rock'],
  childOrder: { rock: [] },
  nodes: {
    rock: {
      id: 'rock',
      slug: 'rock',
      label: '록',
      tier: 0,
      count: 12,
      def: '록 장르 설명',
      parents: [],
      influencedBy: [],
      related: [],
    },
  },
}

function PeekHost({ nodeId, onClose }: { nodeId: string | null, onClose: () => void }) {
  return (
    <Peek
	doc={DOC}
	nodeId={nodeId}
	onNavigate={vi.fn()}
	onBack={vi.fn()}
	onClose={onClose}
	hasBack={false}
    />
  )
}

describe('peek', () => {
  it('renders and closes through the button, scrim, and Escape but not the dialog body', () => {
    const onClose = vi.fn()
    const { container } = render(
      <Peek
	doc={DOC}
	nodeId="rock"
	onNavigate={vi.fn()}
	onBack={vi.fn()}
	onClose={onClose}
	hasBack={false}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: '록 관계 보기' })

    fireEvent.click(dialog)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTitle('닫기'))
    fireEvent.click(container.querySelector('.gm-peek-scrim')!)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('autofocuses the close button when it opens from an already-mounted, closed state', () => {
    // GenreMap.tsx never unmounts Peek — it renders it once with nodeId=null and
    // flips nodeId later. useDismissable's mount-time effect must therefore key
    // off `!!node`, not a hardcoded `true`, or autoFocus/Tab-trap silently never
    // fire once `ref.current` stops being null (regression: 2026-08-05).
    const { rerender } = render(<PeekHost nodeId={null} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    rerender(<PeekHost nodeId="rock" onClose={vi.fn()} />)
    expect(screen.getByTitle('닫기')).toHaveFocus()
  })
})
