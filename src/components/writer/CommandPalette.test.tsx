import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CommandPalette from './CommandPalette'

vi.mock('../../lib/useMusicSearch', () => ({
  useMusicSearch: () => ({
    query: '',
    source: 'db',
    albums: [],
    artists: [],
    tracks: [],
    loading: false,
    spotifyCooldown: false,
    status: '',
    hasMore: { album: 0, artist: 0, track: 0 },
    setQuery: vi.fn(),
  }),
}))

describe('commandPalette', () => {
  it('closes through the scrim and Escape but not a click inside the palette', () => {
    const onClose = vi.fn()
    const { container } = render(
      <CommandPalette currentSubjectId={null} onPick={vi.fn()} onClose={onClose} />,
    )
    const dialog = screen.getByRole('dialog', { name: '작품 검색' })

    fireEvent.click(dialog)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(container.querySelector('.wr-palette-scrim')!)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
