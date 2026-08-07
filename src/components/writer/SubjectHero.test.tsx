import type { ReviewCard } from '@lib/reviews'
import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewsIndex from '../reviews/ReviewsIndex'
import SubjectHero, { EditorialAlbumTargetAdapter } from './SubjectHero'
import type { AlbumDetail } from './types'

const ALBUM = {
  id: 'album-1',
  title: 'Kind of Blue',
  cover_url: null,
  release_date: '1959-08-17',
  artists: [{ id: 'artist-1', name: 'Miles Davis' }],
  tracks: [],
  kind: 'album',
} satisfies AlbumDetail

const ARTIST = {
  id: 'artist-1',
  title: 'Miles Davis',
  cover_url: null,
  release_date: null,
  artists: [{ id: 'artist-1', name: 'Miles Davis' }],
  tracks: [],
  kind: 'artist',
} satisfies AlbumDetail

const REVIEW = {
  slug: 'kind-of-blue',
  album: 'Kind of Blue',
  artist: 'Miles Davis',
  genres: ['Jazz'],
  category: 'reviews',
  tags: ['classic'],
  date: '2026-08-07T00:00:00.000Z',
  year: 1959,
  rating: 5,
  bestNew: false,
  cover: null,
  excerpt: 'A published review remains a document.',
  albumIds: ['album-1'],
  artistIds: ['artist-1'],
} satisfies ReviewCard

function props(overrides: Partial<ComponentProps<typeof SubjectHero>> = {}): ComponentProps<typeof SubjectHero> {
  return {
    subject: ALBUM,
    score: 3,
    onScoreChange: vi.fn(),
    subjectBestNew: false,
    onSubjectBestNewChange: vi.fn(),
    onOpenSearch: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('albumCard Stage 8 editorial adapter', () => {
  it('projects an album onto the canonical card and preserves the editorial hierarchy', () => {
    const { container } = render(<EditorialAlbumTargetAdapter {...props()} subject={ALBUM} />)

    expect(container.querySelector('[data-album-card-layout="row"]')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Kind of Blue' })).toBeInTheDocument()
    expect(screen.getByText('Miles Davis')).toBeInTheDocument()
    expect(screen.getByText('1959')).toBeInTheDocument()
    expect(screen.getByText('리뷰 · 앨범')).toBeInTheDocument()
    expect(container.querySelector('[data-cover-state="fallback"]')).toHaveTextContent('KI')
  })

  it('keeps reopen, BEST NEW MUSIC, and rating changes writer-owned', () => {
    const onOpenSearch = vi.fn()
    const onSubjectBestNewChange = vi.fn()
    const onScoreChange = vi.fn()
    render(<SubjectHero {...props({ onOpenSearch, onSubjectBestNewChange, onScoreChange })} />)

    fireEvent.click(screen.getByRole('button', { name: '작품 변경 ↺' }))
    fireEvent.click(screen.getByRole('button', { name: 'Kind of Blue 작품 변경' }))
    fireEvent.click(screen.getByRole('button', { name: 'BEST NEW MUSIC' }))
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' })

    expect(onOpenSearch).toHaveBeenCalledTimes(2)
    expect(onSubjectBestNewChange).toHaveBeenCalledWith(true)
    expect(onScoreChange).toHaveBeenCalledWith(3.1)
  })

  it('keeps empty and artist subjects on their bespoke non-album paths', () => {
    const { container, rerender } = render(<SubjectHero {...props({ subject: null })} />)
    expect(screen.getByRole('button', { name: /작품 선택/ })).toBeInTheDocument()
    expect(container.querySelector('.album-card')).toBeNull()

    rerender(<SubjectHero {...props({ subject: ARTIST })} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Miles Davis' })).toBeInTheDocument()
    expect(screen.getByText('리뷰 · 아티스트')).toBeInTheDocument()
    expect(container.querySelector('.album-card')).toBeNull()
  })

  it('keeps all editorial controls outside one another', () => {
    const { container } = render(<SubjectHero {...props()} />)
    expect(container.querySelector('button button, button a, a button, a a')).toBeNull()
  })

  it('leaves published ReviewCard on its document renderer', () => {
    const { container } = render(<ReviewsIndex reviews={[REVIEW]} />)
    expect(container.querySelector('.rev-card')).toBeInTheDocument()
    expect(container.querySelector('.rev-card-album')).toHaveTextContent('Kind of Blue')
    expect(container.querySelector('.album-card')).toBeNull()
  })
})
