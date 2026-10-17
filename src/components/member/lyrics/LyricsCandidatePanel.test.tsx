// FEAT-lyrics-match-correction Step 3a — the owner's candidate panel.
import type { AdminLyricsCandidates } from './lyricsAdmin.api'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LyricsCandidatePanel, POLL_INTERVAL_MS } from './LyricsCandidatePanel'
import * as api from './lyricsAdmin.api'

vi.mock('./lyricsAdmin.api', async (orig) => {
  const real = await orig<typeof import('./lyricsAdmin.api')>()
  return {
    ...real,
    getLyricsCandidates: vi.fn(),
    refreshLyricsCandidates: vi.fn(),
    decideLyrics: vi.fn(),
  }
})

const SID = '4k6Uh1HXdhtusDW5y8Gbvy'

function snapshot(over: Partial<AdminLyricsCandidates> = {}): AdminLyricsCandidates {
  return {
    spotify_track_id: SID,
    track_title: 'Bad Habit',
    track_artists: ['Steve Lacy'],
    duration_sec: 232,
    current: { match_status: 'matched', lrclib_id: 8996695, lock: null },
    candidates: [
      { lrclib_id: 34738767, title: 'Bad Habit', artist: 'Steve Lacy', album: 'Gemini Rights', duration_sec: 232, has_synced: true, has_plain: true, instrumental: false, preview: 'I wish I knew you— / Wanted me', cluster_size: 19, verdict: 'picked', rejected: false, current: false },
      { lrclib_id: 8996695, title: 'Bad Habit', artist: 'Steve Lacy', album: null, duration_sec: 232, has_synced: true, has_plain: true, instrumental: false, preview: '<img src=x onerror=alert(1)> Bad Habits - Ed Sheeran', cluster_size: 1, verdict: 'outvoted', rejected: false, current: true },
    ],
    fetched_at: '2026-10-16T09:00:00Z',
    matcher_version: 'step4-v1',
    stale: false,
    rejected_lrclib_ids: [],
    ...over,
  }
}

const get = vi.mocked(api.getLyricsCandidates)
const refresh = vi.mocked(api.refreshLyricsCandidates)
const decide = vi.mocked(api.decideLyrics)

beforeEach(() => {
  get.mockReset()
  refresh.mockReset()
  decide.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
})

function mount(onChanged = vi.fn()) {
  render(<LyricsCandidatePanel spotifyTrackId={SID} onClose={vi.fn()} onChanged={onChanged} />)
  return onChanged
}

describe('lyricsCandidatePanel', () => {
  it('lists candidates with verdict, current flag, and crowd text as text only', async () => {
    get.mockResolvedValue(snapshot())
    mount()
    expect(await screen.findByText('자동 선택')).toBeTruthy()
    expect(screen.getByText('다수 본문에 밀림')).toBeTruthy()
    expect(screen.getByText('현재')).toBeTruthy()
    expect(screen.getByText('같은 본문 19')).toBeTruthy()
    // An uploaded preview containing markup stays literal text: no element is created.
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeTruthy()
    expect(document.querySelector('.lyv-cand img')).toBeNull()
  })

  it('reject needs a second click, then reports the takedown', async () => {
    get.mockResolvedValue(snapshot())
    decide.mockResolvedValue({ action: 'reject', outcome: 'applied', recheck_enqueued: true, reports_resolved: 0, current: { match_status: 'review_required', lock: null } })
    const onChanged = mount()
    await screen.findByText('다수 본문에 밀림')
    const rejectButtons = screen.getAllByRole('button', { name: '거부' })
    fireEvent.click(rejectButtons[1])
    expect(decide).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '거부하고 내리기 — 확인' }))
    await waitFor(() => expect(decide).toHaveBeenCalledWith(SID, 'reject', 8996695))
    expect(await screen.findByText('거부했어요. 내린 뒤 다시 찾는 중이에요.')).toBeTruthy()
    expect(onChanged).toHaveBeenCalled()
  })

  it('a pick polls until the locked pick shows up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    get.mockResolvedValueOnce(snapshot())
    get.mockResolvedValueOnce(snapshot()) // first poll: not yet
    get.mockResolvedValue(snapshot({ current: { match_status: 'matched', lrclib_id: 34738767, lock: 'manual' } }))
    decide.mockResolvedValue({ action: 'pick', outcome: 'enqueued', recheck_enqueued: false, reports_resolved: 0, current: { match_status: 'matched', lrclib_id: 8996695, lock: null } })
    const onChanged = mount()
    await screen.findByText('자동 선택')
    fireEvent.click(screen.getAllByRole('button', { name: '이 가사로 고정' })[0])
    await waitFor(() => expect(decide).toHaveBeenCalledWith(SID, 'pick', 34738767))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2 + 10)
    })
    expect(await screen.findByText('이 가사로 고정했어요.')).toBeTruthy()
    expect(screen.getByText('잠김 · 직접 고름')).toBeTruthy()
    expect(onChanged).toHaveBeenCalled()
  })

  it('maps a 409 to its reason', async () => {
    get.mockResolvedValue(snapshot())
    decide.mockRejectedValue(new api.LyricsAdminError(409, 'not_a_candidate'))
    mount()
    await screen.findByText('자동 선택')
    fireEvent.click(screen.getAllByRole('button', { name: '이 가사로 고정' })[0])
    expect(await screen.findByText(/저장된 후보 목록에 없는 가사예요/)).toBeTruthy()
  })

  it('an empty, never-fetched set says so and offers the refresh', async () => {
    get.mockResolvedValue(snapshot({ candidates: [], fetched_at: null, stale: true, current: { match_status: null, lock: null } }))
    refresh.mockResolvedValue({ enqueued: true })
    mount()
    expect(await screen.findByText('저장된 후보 없음')).toBeTruthy()
    expect(screen.getByText('갱신 필요')).toBeTruthy()
    expect(screen.getByText('평가 기록 없음')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '후보 새로 가져오기' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledWith(SID))
  })

  it('unlock is offered only on a locked track', async () => {
    get.mockResolvedValue(snapshot({ current: { match_status: 'matched', lrclib_id: 8996695, lock: 'manual_fix' } }))
    mount()
    expect(await screen.findByText('잠김 · 수동 수정')).toBeTruthy()
    expect(screen.getByRole('button', { name: '잠금 해제' })).toBeTruthy()
  })
})
