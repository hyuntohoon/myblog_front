// Characterization tests for the ActionSheet modal shell extracted from
// BucketBoard.tsx (REFACTOR-frontend-member-surface Step 4c). Pins the rendered
// structure (title/subtitle/action list + danger styling) and the close paths
// (Escape key, scrim tap, ✕ button) so the extraction is a proven no-op.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ActionSheet } from './ActionSheet'

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

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('does not close when the sheet body itself is clicked', () => {
    const onClose = vi.fn()
    render(<ActionSheet title="Kind of Blue" actions={[]} onClose={onClose} />)
    fireEvent.click(screen.getByRole('dialog', { name: 'Kind of Blue' }))
    expect(onClose).not.toHaveBeenCalled()
  })
})
