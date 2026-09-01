// FIX-user-flow-state-consistency leg 4 — the catalog re-read offered after an
// accepted Spotify sync request.
//
// The hook's `syncRequested` is pinned in useMusicSearch.test.ts; this pins that
// a surface actually renders the affordance off it and wires it to the DB
// re-read. Without that, an accepted sync leaves the reader holding Spotify
// rows they cannot add, with 동기화 요청됨 as the last thing they were told.
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CommandPalette from './CommandPalette'

const state = vi.hoisted(() => ({
  syncRequested: false,
  loading: false,
  runDbSearch: vi.fn(),
}))

vi.mock('../../lib/useMusicSearch', () => ({
  useMusicSearch: () => ({
    query: 'candidate',
    source: 'spotify',
    albums: [],
    artists: [],
    tracks: [],
    loading: state.loading,
    spotifyCooldown: false,
    status: 'Spotify 결과 · 동기화 요청됨',
    syncRequested: state.syncRequested,
    hasMore: { album: 0, artist: 0, track: 0 },
    setQuery: vi.fn(),
    runDbSearch: state.runDbSearch,
  }),
}))

function renderPalette() {
  return render(<CommandPalette currentSubjectId={null} onPick={vi.fn()} onClose={vi.fn()} />)
}

beforeEach(() => {
  state.syncRequested = false
  state.loading = false
  state.runDbSearch = vi.fn()
})

describe('commandPalette sync follow-up', () => {
  it('offers nothing until a sync request has been accepted', () => {
    renderPalette()
    expect(screen.queryByRole('button', { name: '카탈로그 새로고침' })).toBeNull()
  })

  it('offers the catalog re-read once a sync request is accepted', () => {
    state.syncRequested = true
    renderPalette()

    fireEvent.click(screen.getByRole('button', { name: '카탈로그 새로고침' }))
    expect(state.runDbSearch).toHaveBeenCalled()
  })

  it('does not invite a second read while one is already running', () => {
    state.syncRequested = true
    state.loading = true
    renderPalette()

    expect(screen.getByRole('button', { name: '불러오는 중…' })).toBeDisabled()
  })
})
