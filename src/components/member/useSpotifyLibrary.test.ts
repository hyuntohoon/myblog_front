// Characterization tests for the Spotify-library surface hook extracted from
// BucketBoard.tsx (REFACTOR-frontend-member-surface Step 4b). Pins the mount
// fetches (sync-state + listened archive → derived badge map), the debounced-sync
// short-circuit, the in-flight re-entrancy guard, and the non-fatal error paths
// so the extraction is a proven no-op. The full poll loop's real 2s waits are not
// timer-driven here (kept out to stay deterministic); the debounced branch
// exercises the same state-refetch + onSynced contract without a timer.
import type { SpotifyLibraryState } from './spotify.api'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as spotifyApi from './spotify.api'
import { useSpotifyLibrary } from './useSpotifyLibrary'

vi.mock('./spotify.api', () => ({
  getSpotifyLibraryState: vi.fn(),
  listListenedAlbums: vi.fn(),
  syncSpotifyLibrary: vi.fn(),
}))

const api = vi.mocked(spotifyApi)

type Listened = Awaited<ReturnType<typeof spotifyApi.listListenedAlbums>>

function libState(over: Record<string, unknown> = {}): SpotifyLibraryState {
  return {
    last_synced_at: null,
    needs_reauth: false,
    writes_enabled: true,
    albums: [],
    ...over,
  } as unknown as SpotifyLibraryState
}

// The hook only reads `album_id` off each listened row, so a partial is enough.
function listened(...ids: (string | null)[]): Listened {
  return ids.map(id => ({ album_id: id })) as unknown as Listened
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('useSpotifyLibrary — mount', () => {
  it('loads sync state + listened archive and derives the badge map', async () => {
    api.getSpotifyLibraryState.mockResolvedValue(libState({
      albums: [{ album_id: 'a1', source: 'myblog_added', state: 'ok' }],
    }))
    api.listListenedAlbums.mockResolvedValue(listened('a1', 'a2', null))

    const { result } = renderHook(() => useSpotifyLibrary(vi.fn(), true))

    await waitFor(() => expect(result.current.libState).not.toBeNull())
    expect(result.current.libAlbumMap.get('a1')?.source).toBe('myblog_added')
    await waitFor(() => expect(result.current.listenedAlbumIds.size).toBe(2))
    expect(result.current.listenedAlbumIds.has('a1')).toBe(true)
    expect(result.current.listenedAlbumIds.has('a2')).toBe(true)
  })

  it('stays null / empty and never throws when the mount fetches reject', async () => {
    api.getSpotifyLibraryState.mockRejectedValue(new Error('401'))
    api.listListenedAlbums.mockRejectedValue(new Error('network'))

    const { result } = renderHook(() => useSpotifyLibrary(vi.fn(), true))
    // let the rejected promises settle
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.libState).toBeNull()
    expect(result.current.libAlbumMap.size).toBe(0)
    expect(result.current.listenedAlbumIds.size).toBe(0)
  })
})

describe('useSpotifyLibrary — entry sync (FEAT-spotify-library-autosync)', () => {
  afterEach(() => {
    vi.useRealTimers()
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })

  it('an active mount POSTs once; a debounced answer reads state once and never polls or repaints', async () => {
    api.getSpotifyLibraryState.mockResolvedValue(libState({ last_synced_at: '2026-01-01T00:00:00Z' }))
    api.listListenedAlbums.mockResolvedValue(listened())
    api.syncSpotifyLibrary.mockResolvedValue({ status: 'debounced' })
    const onSynced = vi.fn().mockResolvedValue(undefined)

    const { result } = renderHook(() => useSpotifyLibrary(onSynced, true))
    await waitFor(() => expect(result.current.syncing).toBe(false))
    await waitFor(() => expect(result.current.libState).not.toBeNull())

    expect(api.syncSpotifyLibrary).toHaveBeenCalledTimes(1)
    expect(api.getSpotifyLibraryState).toHaveBeenCalledTimes(1)
    expect(onSynced).not.toHaveBeenCalled()
  })

  it('does not POST while inactive, and POSTs once when the board becomes active', async () => {
    api.getSpotifyLibraryState.mockResolvedValue(libState())
    api.listListenedAlbums.mockResolvedValue(listened())
    api.syncSpotifyLibrary.mockResolvedValue({ status: 'debounced' })

    const { rerender } = renderHook(({ active }) => useSpotifyLibrary(vi.fn(), true, active), { initialProps: { active: false } })
    await act(async () => {
      await Promise.resolve()
    })
    expect(api.syncSpotifyLibrary).not.toHaveBeenCalled()

    rerender({ active: true })
    await waitFor(() => expect(api.syncSpotifyLibrary).toHaveBeenCalledTimes(1))
  })

  it('a hidden page waits for visibility before POSTing', async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    api.getSpotifyLibraryState.mockResolvedValue(libState())
    api.listListenedAlbums.mockResolvedValue(listened())
    api.syncSpotifyLibrary.mockResolvedValue({ status: 'debounced' })

    renderHook(() => useSpotifyLibrary(vi.fn(), true))
    await act(async () => {
      await Promise.resolve()
    })
    expect(api.syncSpotifyLibrary).not.toHaveBeenCalled()

    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => expect(api.syncSpotifyLibrary).toHaveBeenCalledTimes(1))
  })

  it('in_flight polls until the server says done, and repaints only if the library changed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.listListenedAlbums.mockResolvedValue(listened())
    api.syncSpotifyLibrary.mockResolvedValue({ status: 'in_flight' })
    api.getSpotifyLibraryState
      .mockResolvedValueOnce(libState({ sync_in_flight: true, last_synced_at: 'A' }))
      .mockResolvedValueOnce(libState({ sync_in_flight: true, last_synced_at: 'A' }))
      .mockResolvedValueOnce(libState({ sync_in_flight: false, last_synced_at: 'B' }))
    const onSynced = vi.fn().mockResolvedValue(undefined)

    renderHook(() => useSpotifyLibrary(onSynced, true))
    await vi.advanceTimersByTimeAsync(5000)

    await waitFor(() => expect(onSynced).toHaveBeenCalledTimes(1))
    expect(api.getSpotifyLibraryState).toHaveBeenCalledTimes(3)
    expect(api.syncSpotifyLibrary).toHaveBeenCalledTimes(1)
  })

  it('a finished pass that changed nothing does not repaint the board', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.listListenedAlbums.mockResolvedValue(listened())
    api.syncSpotifyLibrary.mockResolvedValue({ status: 'queued' })
    api.getSpotifyLibraryState
      .mockResolvedValueOnce(libState({ sync_in_flight: true, last_synced_at: 'A' }))
      .mockResolvedValueOnce(libState({ sync_in_flight: false, last_synced_at: 'A' }))
    const onSynced = vi.fn().mockResolvedValue(undefined)

    const { result } = renderHook(() => useSpotifyLibrary(onSynced, true))
    await vi.advanceTimersByTimeAsync(3000)
    await waitFor(() => expect(result.current.syncing).toBe(false))
    expect(api.getSpotifyLibraryState).toHaveBeenCalledTimes(2)
    expect(onSynced).not.toHaveBeenCalled()
  })

  it('unmounting mid-poll stops the poll', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.listListenedAlbums.mockResolvedValue(listened())
    api.syncSpotifyLibrary.mockResolvedValue({ status: 'queued' })
    api.getSpotifyLibraryState.mockResolvedValue(libState({ sync_in_flight: true }))

    const { unmount } = renderHook(() => useSpotifyLibrary(vi.fn(), true))
    await waitFor(() => expect(api.getSpotifyLibraryState).toHaveBeenCalledTimes(1))
    unmount()
    await vi.advanceTimersByTimeAsync(20000)
    expect(api.getSpotifyLibraryState).toHaveBeenCalledTimes(1)
  })

  it('a manual sync during an entry sync is ignored (one loop per hook)', async () => {
    api.getSpotifyLibraryState.mockResolvedValue(libState())
    api.listListenedAlbums.mockResolvedValue(listened())
    let release: () => void = () => {}
    api.syncSpotifyLibrary.mockReturnValue(new Promise((res) => {
      release = () => res({ status: 'debounced' })
    }))

    const { result } = renderHook(() => useSpotifyLibrary(vi.fn(), true))
    await waitFor(() => expect(result.current.syncing).toBe(true))
    act(() => {
      void result.current.runLibrarySync() // guarded — no second enqueue
    })

    expect(api.syncSpotifyLibrary).toHaveBeenCalledTimes(1)
    await act(async () => release())
  })
})

// SEC-member-listening-data-boundary Step 1 — the surface the RFC's own table
// missed and review caught. `listListenedAlbums` is one of the nine owner-global
// reads, and this hook called it on every board mount regardless of who was
// looking; `getSpotifyLibraryState` was already owner-only, so a member was
// eating a 403 here already, which is probably why the other read went unnoticed.
//
// These assert on the api mocks rather than on rendered output, because the leak
// IS the request: the listened set only ever produced a subtle "이미 들음" cover
// hint, so a render-level assertion would have missed it entirely.
describe('useSpotifyLibrary — owner boundary', () => {
  it('makes neither mount read for a non-owner', async () => {
    api.getSpotifyLibraryState.mockResolvedValue(libState())
    api.listListenedAlbums.mockResolvedValue(listened('a1'))

    const { result } = renderHook(() => useSpotifyLibrary(vi.fn(), false))

    await waitFor(() => expect(result.current.listenedAlbumIds.size).toBe(0))
    expect(api.listListenedAlbums).not.toHaveBeenCalled()
    expect(api.getSpotifyLibraryState).not.toHaveBeenCalled()
    expect(result.current.libState).toBeNull()
  })

  it('refuses the manual sync for a non-owner even if the callback is invoked', async () => {
    const { result } = renderHook(() => useSpotifyLibrary(vi.fn(), false))

    await act(async () => {
      await result.current.runLibrarySync()
    })

    expect(api.syncSpotifyLibrary).not.toHaveBeenCalled()
    expect(result.current.syncing).toBe(false)
  })
})
