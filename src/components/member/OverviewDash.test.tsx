import { fireEvent, render, screen } from '@testing-library/react'
import type { MemberReview } from '@lib/member'
import { describe, expect, it, vi } from 'vitest'
import { MiniReview, RecentAlbumsModal, RecentTracksModal } from './OverviewDash'

vi.mock('@lib/auth', () => ({ isLoggedIn: () => true, goLogin: vi.fn() }))

describe('recentAlbumsModal', () => {
  it('renders and closes through the button, scrim, and Escape but not the dialog body', () => {
    const onClose = vi.fn()
    render(<RecentAlbumsModal items={[]} onOpen={vi.fn()} onClose={onClose} />)
    const dialog = screen.getByRole('dialog', { name: '최근 들은 앨범 전체' })

    fireEvent.click(dialog)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('닫기'))
    fireEvent.click(screen.getByRole('presentation'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})

describe('recentTracksModal', () => {
  it('renders and closes through the button, scrim, and Escape but not the dialog body', () => {
    const onClose = vi.fn()
    render(<RecentTracksModal items={[]} view="list" onOpen={vi.fn()} onClose={onClose} />)
    const dialog = screen.getByRole('dialog', { name: '최근 재생 트랙 전체' })

    fireEvent.click(dialog)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('닫기'))
    fireEvent.click(screen.getByRole('presentation'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('offers static lyrics only for rows carrying a Spotify track id', () => {
    const onOpenLyrics = vi.fn()
    render(
		<RecentTracksModal
			items={[
				{ id: 'one', track: 'So What', artist: 'Miles Davis', album: 'Kind of Blue', len: '9:22', when: '오늘', spotifyTrackId: 'spotify-track-1' },
				{ id: 'two', track: 'Freddie Freeloader', artist: 'Miles Davis', album: 'Kind of Blue', len: '9:46', when: '어제' },
			]}
			view="list"
			onOpen={vi.fn()}
			onClose={vi.fn()}
			onOpenLyrics={onOpenLyrics}
		/>,
    )

    fireEvent.click(screen.getByLabelText('So What 가사 보기'))
    expect(onOpenLyrics).toHaveBeenCalledWith('spotify-track-1')
    expect(screen.queryByLabelText('Freddie Freeloader 가사 보기')).toBeNull()
  })
})

describe('miniReview', () => {
  const base: MemberReview = { slug: '', type: '평가', album: 'Kind of Blue', artist: 'Miles Davis', genre: '', year: null, rating: 4.5, date: '2026-10-01T00:00:00Z', excerpt: '', cover: null, albumIds: ['album-1'] }

  it('renders a member 평가 as the canonical album card with ＋ and copy-drag', () => {
    const onOpen = vi.fn()
    const { container } = render(<MiniReview r={base} onOpen={onOpen} />)

    const card = container.querySelector('.album-card')
    expect(card).not.toBeNull()
    expect(card!.getAttribute('draggable')).toBe('true')
    expect(screen.getByRole('button', { name: 'Kind of Blue 버킷에 담기' })).toBeTruthy()
    expect(screen.getByText('평가 · 2026')).toBeTruthy()
    expect(screen.getByText('Miles Davis')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Kind of Blue.*보기/ }))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ album: 'Kind of Blue', albumId: 'album-1', real: true }))
  })

  it('keeps the owner\'s 칼럼 a plain row with the shared cover, not an album card', () => {
    const onOpen = vi.fn()
    const column: MemberReview = { ...base, slug: 'essay', type: '칼럼', album: 'On Listening', rating: null, albumIds: [] }
    const { container } = render(<MiniReview r={column} onOpen={onOpen} />)

    expect(container.querySelector('.album-card')).toBeNull()
    expect(container.querySelector('.cover[data-cover-state="fallback"]')).not.toBeNull()
    expect(screen.queryByText(/카탈로그 ID 없음/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /On Listening/ }))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ album: 'On Listening', albumId: undefined }))
  })
})
