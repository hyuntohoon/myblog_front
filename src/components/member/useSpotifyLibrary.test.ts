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

    const { result } = renderHook(() => useSpotifyLibrary(vi.fn()))

    await waitFor(() => expect(result.current.libState).not.toBeNull())
    expect(result.current.libAlbumMap.get('a1')?.source).toBe('myblog_added')
    await waitFor(() => expect(result.current.listenedAlbumIds.size).toBe(2))
    expect(result.current.listenedAlbumIds.has('a1')).toBe(true)
    expect(result.current.listenedAlbumIds.has('a2')).toBe(true)
  })

  it('stays null / empty and never throws when the mount fetches reject', async () => {
    api.getSpotifyLibraryState.mockRejectedValue(new Error('401'))
    api.listListenedAlbums.mockRejectedValue(new Error('network'))

    const { result } = renderHook(() => useSpotifyLibrary(vi.fn()))
    // let the rejected promises settle
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.libState).toBeNull()
    expect(result.current.libAlbumMap.size).toBe(0)
    expect(result.current.listenedAlbumIds.size).toBe(0)
  })
})

describe('useSpotifyLibrary — runLibrarySync', () => {
  it('a debounced sync refetches state and does NOT call onSynced (no poll)', async () => {
    api.getSpotifyLibraryState.mockResolvedValue(libState({ last_synced_at: '2026-01-01T00:00:00Z' }))
    api.listListenedAlbums.mockResolvedValue(listened())
    api.syncSpotifyLibrary.mockResolvedValue({ status: 'debounced' })
    const onSynced = vi.fn().mockResolvedValue(undefined)

    const { result } = renderHook(() => useSpotifyLibrary(onSynced))
    await waitFor(() => expect(result.current.libState).not.toBeNull())

    await act(async () => {
      await result.current.runLibrarySync()
    })

    expect(api.syncSpotifyLibrary).toHaveBeenCalledTimes(1)
    expect(onSynced).not.toHaveBeenCalled()
    expect(result.current.syncing).toBe(false)
  })

  it('ignores a second sync while one is already in flight', async () => {
    api.getSpotifyLibraryState.mockResolvedValue(libState())
    api.listListenedAlbums.mockResolvedValue(listened())
    // first sync hangs so `syncing` stays true across the second call
    let release: () => void = () => {}
    api.syncSpotifyLibrary.mockReturnValue(new Promise((res) => {
      release = () => res({ status: 'ok' })
    }))

    const { result } = renderHook(() => useSpotifyLibrary(vi.fn()))
    await waitFor(() => expect(result.current.libState).not.toBeNull())

    act(() => {
      void result.current.runLibrarySync()
    })
    await waitFor(() => expect(result.current.syncing).toBe(true))
    act(() => {
      void result.current.runLibrarySync() // guarded — no second enqueue
    })

    expect(api.syncSpotifyLibrary).toHaveBeenCalledTimes(1)
    act(() => release())
  })
})
