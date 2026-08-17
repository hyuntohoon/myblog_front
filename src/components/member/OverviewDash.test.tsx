import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RecentAlbumsModal, RecentTracksModal } from './OverviewDash'

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
