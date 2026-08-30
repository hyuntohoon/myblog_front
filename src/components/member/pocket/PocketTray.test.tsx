import type { PocketLeaf } from '@lib/pocketBuckit/leaf'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POCKET_DESIGN_DEFAULTS } from '@lib/pocketBuckit/design'
import { PocketTray } from './PocketTray'
import { usePocket } from './PocketBuckitProvider'

vi.mock('@lib/auth', () => ({ isLoggedIn: () => true }))
vi.mock('@lib/owner', () => ({ isOwnerUser: () => false }))
vi.mock('@lib/pocketBuckit/boardDnd', () => ({
  boardDragAccepts: () => false,
  externalAlbumCopy: () => null,
  getBoardDnd: () => null,
  useBoardDnd: () => null,
}))
vi.mock('./PocketBuckitProvider', () => ({ usePocket: vi.fn() }))

const mockUsePocket = vi.mocked(usePocket)

function leaf(index: number): PocketLeaf {
  return {
    id: `bucket-${index}`,
    name: `Bucket ${index}`,
    path: [`Bucket ${index}`],
    verb: '담기',
    action: 'add',
    accepts: '앨범',
    n: 0,
    color: null,
    kind: 'review',
    type: 'general',
    pinned: true,
    recent: [],
  }
}

function pocketValue(shell: 'f2' | 'f6' = 'f2'): ReturnType<typeof usePocket> {
  return {
    design: { ...POCKET_DESIGN_DEFAULTS, shell },
    leaves: Array.from({ length: 7 }, (_, index) => leaf(index + 1)),
    open: true,
    setOpen: vi.fn(),
    openDrawers: [],
    openDrawer: vi.fn(),
    isDrawerOpen: () => false,
    closeAllDrawers: vi.fn(),
    editMode: false,
    setEditMode: vi.fn(),
    deleteBucket: vi.fn(),
    undo: null,
    runUndo: vi.fn(),
    reorderBucket: vi.fn(),
    dropExternalAlbum: vi.fn(),
  } as unknown as ReturnType<typeof usePocket>
}

beforeEach(() => {
  mockUsePocket.mockReturnValue(pocketValue())
})

describe('pocketTray overflow=more', () => {
  it('keeps the first six buckets visible and links the +N handoff to the full bucket page', () => {
    render(<PocketTray />)

    expect(screen.getAllByRole('button', { name: /버킷 열기$/ })).toHaveLength(6)
    const more = screen.getByRole('link', { name: '숨겨진 버킷 1개 전체 페이지에서 보기' })
    expect(more).toHaveAttribute('href', '/members/?me&tab=bucket')
    expect(more).toHaveClass('lchip')
    expect(more).toHaveStyle({ opacity: '0.7' })
  })

  it('gives the F6 +N sticker its own opaque readable surface', () => {
    mockUsePocket.mockReturnValue(pocketValue('f6'))

    render(<PocketTray />)

    const more = screen.getByRole('link', { name: '숨겨진 버킷 1개 전체 페이지에서 보기' })
    expect(more).toHaveClass('schip')
    expect(more).toHaveStyle({
      opacity: '1',
      color: 'var(--color-text)',
      background: 'color-mix(in srgb, var(--color-accent) 14%, var(--color-bg))',
    })
  })
})
