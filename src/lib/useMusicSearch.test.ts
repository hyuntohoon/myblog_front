// REFACTOR Step 2 — request-cancel for debounced/as-you-type search. Pins that a
// newer search aborts the previous in-flight fetch on the wire (not just drops
// its result via the seqRef guard), and that an aborted search does not flash a
// failure status.
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from './api'
import { useMusicSearch } from './useMusicSearch'

vi.mock('./api', () => ({ apiFetch: vi.fn() }))

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('useMusicSearch cancellation', () => {
  it('aborts the previous in-flight DB search when a new one starts', () => {
    const signals: (AbortSignal | null | undefined)[] = []
    // never-resolving fetch → both searches stay in-flight so we can inspect abort state
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      signals.push(init?.signal)
      return new Promise<Response>(() => {})
    }))

    const { result } = renderHook(() => useMusicSearch({ recallTypes: ['album', 'artist'] }))
    act(() => result.current.setQuery('bts'))
    act(() => {
      void result.current.runDbSearch()
    })
    act(() => {
      void result.current.runDbSearch()
    })

    expect(signals.length).toBe(2)
    expect(signals[0]?.aborted).toBe(true) // first search cancelled by the second
    expect(signals[1]?.aborted).toBe(false) // newest search still live
  })

  it('does not flash 검색 실패 when a search is aborted by its successor', async () => {
    // first fetch rejects on abort (like a real cancelled request); second hangs
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })))

    const { result } = renderHook(() => useMusicSearch({ recallTypes: ['album'] }))
    act(() => result.current.setQuery('bts'))
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.runDbSearch()
    })
    act(() => {
      void result.current.runDbSearch() // aborts the first
    })
    await act(async () => {
      await first
    })

    expect(result.current.status).not.toBe('검색 실패')
  })
})

describe('useMusicSearch Spotify sync split', () => {
  const candidateBody = {
    albums: [{ spotify_id: 'album-1', title: 'Candidate album' }],
    tracks: [{
      spotify_id: 'track-1',
      title: 'Candidate track',
      album: { spotify_id: 'album-2', title: 'Track album' },
    }],
  }

  it('performs candidate GET before explicit sync POST and reports acceptance', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(candidateBody), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'accepted' }), { status: 202 }))

    const { result } = renderHook(() => useMusicSearch({ recallTypes: ['album', 'track'] }))
    act(() => result.current.setQuery('candidate'))
    await act(async () => {
      await result.current.runSpotifySync()
    })

    expect(apiFetch).toHaveBeenCalledTimes(2)
    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toContain('/api/music/search/candidates?')
    expect(vi.mocked(apiFetch).mock.calls[0]?.[1]?.method).toBeUndefined()
    expect(vi.mocked(apiFetch).mock.calls[1]?.[0]).toContain('/api/music/sync-requests')
    expect(vi.mocked(apiFetch).mock.calls[1]?.[1]).toMatchObject({ method: 'POST' })
    expect(JSON.parse(String(vi.mocked(apiFetch).mock.calls[1]?.[1]?.body))).toEqual({
      album_ids: ['album-1', 'album-2'],
      market: 'KR',
    })
    expect(result.current.status).toBe('Spotify 결과 · 동기화 요청됨')
  })

  it('preserves candidate results and reports sync failure when POST is rejected', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(candidateBody), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'failed' }), { status: 503 }))

    const { result } = renderHook(() => useMusicSearch({ recallTypes: ['album', 'track'] }))
    act(() => result.current.setQuery('candidate'))
    await act(async () => {
      await result.current.runSpotifySync()
    })

    expect(result.current.albums).toHaveLength(1)
    expect(result.current.tracks).toHaveLength(1)
    expect(result.current.albums[0]?.title).toBe('Candidate album')
    expect(result.current.status).toBe('Spotify 결과 · 동기화 요청 실패')
  })

  it('does not publish an old sync result after the query changes during POST', async () => {
    let resolvePost!: (response: Response) => void
    const deferredPost = new Promise<Response>((resolve) => {
      resolvePost = resolve
    })
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(candidateBody), { status: 200 }))
      .mockReturnValueOnce(deferredPost)

    const { result } = renderHook(() => useMusicSearch({ recallTypes: ['album', 'track'] }))
    act(() => result.current.setQuery('candidate'))
    let pending: Promise<void> = Promise.resolve()
    await act(async () => {
      pending = result.current.runSpotifySync()
      await Promise.resolve()
    })
    expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(2)

    act(() => result.current.setQuery('new query'))
    resolvePost(new Response(JSON.stringify({ status: 'accepted' }), { status: 202 }))
    await act(async () => {
      await pending
    })

    expect(result.current.query).toBe('new query')
    expect(result.current.status).toBe('')
  })
})

// FIX-user-flow-state-consistency leg 3 — `status` is a display string that
// carries 검색 실패, DB에 결과 없음 and the Spotify messages all at once, so a
// consumer could not tell a dead backend from a genuine zero-result answer
// without matching on Korean prose. These pin the machine-readable half that
// the /search page and the header dropdown now branch on.
describe('useMusicSearch failure signalling', () => {
  function jsonOnce(body: unknown) {
    return { ok: true, status: 200, json: async () => body } as unknown as Response
  }

  it('raises searchFailed on a non-2xx search and clears it on the next good one', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 } as unknown as Response)
      .mockResolvedValueOnce(jsonOnce({ albums: [], artists: [], tracks: [] }))
    vi.stubGlobal('fetch', f)

    const { result } = renderHook(() => useMusicSearch({ recallTypes: ['album'] }))
    act(() => result.current.setQuery('bts'))
    await act(async () => {
      await result.current.runDbSearch()
    })
    expect(result.current.searchFailed).toBe(true)

    await act(async () => {
      await result.current.runDbSearch()
    })
    expect(result.current.searchFailed).toBe(false)
    // a real empty answer must NOT read as a failure
    expect(result.current.status).toBe('DB에 결과 없음')
  })

  it('leaves searchFailed down when a search is merely superseded', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })))

    const { result } = renderHook(() => useMusicSearch({ recallTypes: ['album'] }))
    act(() => result.current.setQuery('bts'))
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.runDbSearch()
    })
    act(() => {
      void result.current.runDbSearch()
    })
    await act(async () => {
      await first
    })

    expect(result.current.searchFailed).toBe(false)
  })

  it('scopes a failed 더 보기 page to the bucket that asked for it', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(jsonOnce({
        albums: [{ id: 'a1', title: 'One' }],
        artists: [],
        tracks: [],
      }))
      .mockResolvedValueOnce({ ok: false, status: 502 } as unknown as Response)
    vi.stubGlobal('fetch', f)

    const { result } = renderHook(() => useMusicSearch({ recallTypes: ['album'], pageLimit: 1 }))
    act(() => result.current.setQuery('bts'))
    await act(async () => {
      await result.current.runDbSearch()
    })
    expect(result.current.hasMore.album).toBe(1)

    await act(async () => {
      await result.current.loadMore('album')
    })

    expect(result.current.moreFailed).toBe('album')
    // the rows already on screen survive a failed next page
    expect(result.current.albums).toHaveLength(1)
  })
})
