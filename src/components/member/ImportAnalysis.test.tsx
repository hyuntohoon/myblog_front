import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ItemDetailSlideover } from './ImportAnalysis'

vi.mock('./analysis.api', async importOriginal => ({
  ...await importOriginal<typeof import('./analysis.api')>(),
  getStreamItem: vi.fn(() => new Promise(() => {})),
}))

describe('itemDetailSlideover', () => {
  it('renders and closes through the button, scrim, and Escape but not the slideover body', () => {
    const onClose = vi.fn()
    render(
      <ItemDetailSlideover
	target={{ type: 'track', id: 'track-1', label: '테스트 트랙' }}
	metric="count"
	period={{ kind: 'all' }}
	onClose={onClose}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: '테스트 트랙 청취 상세' })

    fireEvent.click(dialog)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('닫기'))
    fireEvent.click(screen.getByRole('presentation'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
