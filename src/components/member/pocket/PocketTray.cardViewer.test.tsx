// Front UI/UX audit S1 — the drawer's Card Viewer: album members compose the canonical
// AlbumCard through Pocket's adapter; non-album members keep their bespoke tile. Both
// drag-outs must hand the board a `DragPayload` its `toDndItem` can read.
import type { BoardAlbum, BoardBucket } from '@lib/buckets'
import type { DragPayload } from '@lib/entityDrag'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POCKET_DESIGN_DEFAULTS } from '@lib/pocketBuckit/design'
import { toDndItem } from '@lib/entityDrag'
import { openAlbum } from '@lib/entityEvents'
import { PB_DND_START_EVENT } from '@lib/pocketBuckit/events'
import { PocketTray } from './PocketTray'
import { usePocket } from './PocketBuckitProvider'

vi.mock('@lib/auth', () => ({ isLoggedIn: () => true, goLogin: vi.fn() }))
vi.mock('@lib/owner', () => ({ isOwnerUser: () => new Promise(() => {}) }))
vi.mock('@lib/entityEvents', async importOriginal => ({ ...(await importOriginal<object>()), openAlbum: vi.fn() }))
vi.mock('@lib/pocketBuckit/boardDnd', () => ({
  boardDragAccepts: () => false,
  externalAlbumCopy: () => null,
  getBoardDnd: () => null,
  useBoardDnd: () => null,
}))
vi.mock('./PocketBuckitProvider', () => ({ usePocket: vi.fn() }))

const mockUsePocket = vi.mocked(usePocket)

function member(over: Partial<BoardAlbum>): BoardAlbum {
  return {
    itemId: 'item-1',
    itemType: 'album',
    albumId: 'album-1',
    trackId: null,
    reviewTargetId: null,
    artistId: null,
    title: 'Blue',
    artist: 'Joni Mitchell',
    cover: null,
    year: 1971,
    alreadyReviewed: false,
    postId: null,
    ...over,
  } as BoardAlbum
}

const bucket = {
  id: 'bucket-1',
  name: 'Crate',
  color: null,
  kind: 'review',
  type: 'general',
  albums: [
    member({}),
    member({ itemId: 'item-2', itemType: 'artist', albumId: null, artistId: 'artist-9', title: 'Joni Mitchell', artist: '' }),
  ],
} as unknown as BoardBucket

function pocketValue(editMode: boolean, removeItem = vi.fn()): ReturnType<typeof usePocket> {
  return {
    design: { ...POCKET_DESIGN_DEFAULTS, shell: 'f2' },
    leaves: [],
    open: true,
    setOpen: vi.fn(),
    openDrawers: [{ bucketId: bucket.id, z: 0 }],
    openDrawer: vi.fn(),
    isDrawerOpen: () => true,
    closeDrawer: vi.fn(),
    closeAllDrawers: vi.fn(),
    focusDrawer: vi.fn(),
    moveDrawer: vi.fn(),
    drawerPosFor: () => null,
    bucketById: (id: string) => (id === bucket.id ? bucket : undefined),
    removeItem,
    editMode,
    setEditMode: vi.fn(),
    deleteBucket: vi.fn(),
    undo: null,
    runUndo: vi.fn(),
    reorderBucket: vi.fn(),
    dropExternalAlbum: vi.fn(),
  } as unknown as ReturnType<typeof usePocket>
}

function openCardView() {
  render(<PocketTray />)
  fireEvent.click(screen.getByRole('button', { name: '카드 보기로 전환' }))
}

function captureDragStart(el: Element): DragPayload {
  let detail: DragPayload | null = null
  const on = (e: Event) => {
    detail = (e as CustomEvent<DragPayload>).detail
  }
  window.addEventListener(PB_DND_START_EVENT, on)
  fireEvent.dragStart(el, { dataTransfer: { effectAllowed: '', setData: vi.fn() } })
  window.removeEventListener(PB_DND_START_EVENT, on)
  expect(detail).not.toBeNull()
  return detail!
}

beforeEach(() => {
  mockUsePocket.mockReturnValue(pocketValue(false))
})

afterEach(() => {
  vi.mocked(openAlbum).mockClear()
})

describe('pocketTray card viewer (front audit S1)', () => {
  it('renders an album member as the canonical AlbumCard that opens the shared overlay', () => {
    openCardView()

    const open = screen.getByRole('button', { name: 'Blue — Joni Mitchell 앨범 보기' })
    expect(open.closest('article.album-card')).not.toBeNull()
    fireEvent.click(open)
    expect(openAlbum).toHaveBeenCalledWith({ albumId: 'album-1', title: 'Blue', artist: 'Joni Mitchell', cover: null })
    expect(screen.getByRole('button', { name: 'Blue 다른 버킷에 담기' })).toBeInTheDocument()
  })

  it('drags an album card out as an internal member payload the board can read', () => {
    openCardView()

    const card = screen.getByRole('button', { name: 'Blue — Joni Mitchell 앨범 보기' }).closest('article')!
    const it = toDndItem(captureDragStart(card))
    expect(it).toMatchObject({ kind: 'member', albumId: 'album-1', itemId: 'item-1', fromBucketId: 'bucket-1', srcItemType: 'album' })
  })

  it('drags an artist tile out as an internal member payload the board can read', () => {
    openCardView()

    const tile = document.querySelector('.pb-card[data-artist]')!
    expect(tile.querySelector('article')).toBeNull()
    const it = toDndItem(captureDragStart(tile))
    expect(it).toMatchObject({ kind: 'member', artistId: 'artist-9', itemId: 'item-2', fromBucketId: 'bucket-1', srcItemType: 'artist' })
  })

  it('edit-mode − removes the album member without opening it', () => {
    const removeItem = vi.fn(() => Promise.resolve())
    mockUsePocket.mockReturnValue(pocketValue(true, removeItem))
    openCardView()

    fireEvent.click(screen.getByRole('button', { name: 'Blue 버킷에서 제거' }))
    expect(removeItem).toHaveBeenCalledWith('bucket-1', 'item-1', 'album-1', 'Blue')
    expect(openAlbum).not.toHaveBeenCalled()
  })
})
