import type { PostListItem } from '../../scripts/write/api'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DraftsInbox from './DraftsInbox'

vi.mock('../../scripts/write/api', () => ({
  hardDeletePost: vi.fn(),
}))

const DRAFT: PostListItem = {
  album_cover_url: null,
  category: '앨범 리뷰',
  description: '',
  id: 'draft-1',
  posted_date: '2026-08-05',
  rating: null,
  slug: 'test-draft',
  status: 'draft',
  tags: [],
  title: '테스트 초안',
}

describe('draftsInbox', () => {
  it('renders and closes through the button, scrim, and Escape but not the inbox body', () => {
    const onClose = vi.fn()
    render(<DraftsInbox drafts={[]} currentPostId={null} onDeleted={vi.fn()} onClose={onClose} />)
    const dialog = screen.getByRole('dialog', { name: '임시 저장함' })

    fireEvent.click(dialog)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('닫기'))
    fireEvent.click(screen.getByRole('presentation'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('disarms an armed delete row on Escape before closing the inbox', () => {
    const onClose = vi.fn()
    render(<DraftsInbox drafts={[DRAFT]} currentPostId={null} onDeleted={vi.fn()} onClose={onClose} />)

    fireEvent.click(screen.getByLabelText('테스트 초안 삭제'))
    expect(screen.getByLabelText('테스트 초안 삭제 확인')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByLabelText('테스트 초안 삭제')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
