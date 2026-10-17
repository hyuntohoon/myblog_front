// FEAT-lyrics-match-correction Step 3b — the owner's lyrics report queue.
import type { AdminLyricsReport } from '../member/lyrics/lyricsAdmin.api'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../member/lyrics/lyricsAdmin.api'
import LyricsReportsBoard from './LyricsReportsBoard'

vi.mock('../member/lyrics/lyricsAdmin.api', async (orig) => {
  const real = await orig<typeof import('../member/lyrics/lyricsAdmin.api')>()
  return { ...real, getLyricsReports: vi.fn(), decideLyrics: vi.fn(), getLyricsCandidates: vi.fn(() => new Promise(() => {})) }
})

const get = vi.mocked(api.getLyricsReports)
const decide = vi.mocked(api.decideLyrics)

function item(over: Partial<AdminLyricsReport> = {}): AdminLyricsReport {
  return {
    spotify_track_id: 'sid-go-go',
    track_title: 'Go Go',
    track_artists: ['BTS'],
    report_count: 2,
    member_count: 2,
    system_reasons: [],
    first_reported_at: '2026-10-16T09:00:00Z',
    last_reported_at: '2026-10-16T10:00:00Z',
    reported: { match_status: 'matched', lrclib_id: 111 },
    current: { match_status: 'matched', lrclib_id: 111, lock: null },
    state: 'open',
    ...over,
  }
}

beforeEach(() => {
  get.mockReset()
  decide.mockReset()
})

describe('lyricsReportsBoard', () => {
  it('lists tracks with counts and what changed, crowd/catalog text as text only', async () => {
    get.mockResolvedValue({ items: [
      item(),
      item({ spotify_track_id: 'x', track_title: '<img src=x onerror=alert(1)>', state: 'auto_resolved', current: { match_status: 'matched', lrclib_id: 222, lock: 'manual' } }),
    ], total_tracks: 2, truncated: false })
    render(<LyricsReportsBoard />)
    expect(await screen.findByText('Go Go')).toBeTruthy()
    expect(screen.getByText('신고가 열린 곡 2곡')).toBeTruthy()
    expect(screen.getAllByText('재검사 뒤 가사가 바뀌었어요 — 확인해 주세요')).toHaveLength(1)
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeTruthy()
    expect(document.querySelector('.lrq img')).toBeNull()
  })

  it('keep closes the reports and re-reads the queue', async () => {
    get.mockResolvedValueOnce({ items: [item()], total_tracks: 1, truncated: false })
    get.mockResolvedValueOnce({ items: [], total_tracks: 0, truncated: false })
    decide.mockResolvedValue({ action: 'keep', outcome: 'applied', reports_resolved: 2, recheck_enqueued: false, current: { lock: null } })
    render(<LyricsReportsBoard />)
    fireEvent.click(await screen.findByRole('button', { name: '지금 가사가 맞아요' }))
    await waitFor(() => expect(decide).toHaveBeenCalledWith('sid-go-go', 'keep'))
    expect(await screen.findByText('「Go Go」 신고 2건을 닫았어요.')).toBeTruthy()
    expect(await screen.findByText('열린 신고가 없어요.')).toBeTruthy()
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('opens the candidate panel for a row', async () => {
    get.mockResolvedValue({ items: [item()], total_tracks: 1, truncated: false })
    render(<LyricsReportsBoard />)
    fireEvent.click(await screen.findByRole('button', { name: '후보 보기' }))
    expect(await screen.findByRole('dialog', { name: '가사 후보' })).toBeTruthy()
    await waitFor(() => expect(api.getLyricsCandidates).toHaveBeenCalledWith('sid-go-go'))
  })

  it('a member token reads as owner-only', async () => {
    get.mockRejectedValue(new api.LyricsAdminError(403, null))
    render(<LyricsReportsBoard />)
    expect(await screen.findByText('오너만 볼 수 있어요.')).toBeTruthy()
  })

  it('says when the list is truncated', async () => {
    get.mockResolvedValue({ items: [item()], total_tracks: 250, truncated: true })
    render(<LyricsReportsBoard />)
    expect(await screen.findByText('신고가 열린 곡 250곡 · 많이 신고된 1곡만 보여요')).toBeTruthy()
  })
})
