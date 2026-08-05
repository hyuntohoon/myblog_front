import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TrashDrawer } from './BucketBoard'

describe('trashDrawer', () => {
  it('renders and closes through the button, scrim, and Escape but not the drawer body', () => {
    const onClose = vi.fn()
    render(
      <TrashDrawer
	trash={[]}
	onRestore={vi.fn()}
	onPurge={vi.fn()}
	onEmpty={vi.fn()}
	onClose={onClose}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: '휴지통' })

    fireEvent.click(dialog)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('닫기'))
    fireEvent.click(screen.getByRole('presentation'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
