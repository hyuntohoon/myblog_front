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

// FIX-user-flow-state-consistency leg 4 — 더 보기 must survive its own first
// page. Found by clicking the button leg 3 had just wired up, against
// production: the rows appended, and then the button vanished.
//
// `loadMore` set `didAppend` inside the `setBuckets` updater and read it on the
// next line. React runs an updater during render, not at the call site — and it
// only ever evaluates one eagerly when the fiber has no pending lanes, which
// `setLoadingMore(kind)` a few lines earlier guarantees it does. So `didAppend`
// was always false: every successful page took the "the API repeated itself"
// branch, zeroing `lastReturned` (which hides 더 보기) and returning before
// `offsets` advanced. One page was all you could ever load.
describe('useMusicSearch pagination continuity', () => {
  function page(n: number, offset: number) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        albums: Array.from({ length: n }, (_, i) => ({ id: `album-${offset + i}`, title: `A${offset + i}` })),
        artists: [],
        tracks: [],
      }),
    } as unknown as Response
  }

  it('keeps offering 더 보기 and advances the offset across pages', async () => {
    const urls: string[] = []
    const f = vi.fn(async (url: string) => {
      urls.push(url)
      const off = Number(new URL(url, 'https://x.test').searchParams.get('album_offset') || 0)
      return page(1, off)
    })
    vi.stubGlobal('fetch', f)

    const { result } = renderHook(() => useMusicSearch({ recallTypes: ['album'], pageLimit: 1 }))
    act(() => result.current.setQuery('bts'))
    await act(async () => {
      await result.current.runDbSearch()
    })
    expect(result.current.albums).toHaveLength(1)
    expect(result.current.hasMore.album).toBe(1)

    await act(async () => {
      await result.current.loadMore('album')
    })
    expect(result.current.albums.map(a => a.id)).toEqual(['album-0', 'album-1'])
    // the page was full, so there may well be another one — keep offering it
    expect(result.current.hasMore.album).toBe(1)

    await act(async () => {
      await result.current.loadMore('album')
    })
    expect(result.current.albums.map(a => a.id)).toEqual(['album-0', 'album-1', 'album-2'])
    // and the offset actually moved, rather than re-asking for the same page
    expect(urls.at(-1)).toContain('album_offset=2')
  })

  it('stops offering 더 보기 when the API repeats a page it already gave', async () => {
    const f = vi.fn(async () => page(1, 0))
    vi.stubGlobal('fetch', f)

    const { result } = renderHook(() => useMusicSearch({ recallTypes: ['album'], pageLimit: 1 }))
    act(() => result.current.setQuery('bts'))
    await act(async () => {
      await result.current.runDbSearch()
    })
    await act(async () => {
      await result.current.loadMore('album')
    })

    expect(result.current.albums).toHaveLength(1)
    expect(result.current.hasMore.album).toBe(0)
  })
})

// FIX-user-flow-state-consistency leg 4 — after a sync request is accepted the
// reader is left holding Spotify rows they cannot add, and the only way to see
// the newly-synced catalog is to guess that pressing 검색 again is the move.
// There is no job-status contract to wait on (that design is tracked
// separately), so this flag does not claim the worker finished — it just lets a
// surface offer the catalog re-read.
describe('useMusicSearch sync-request follow-up', () => {
  const candidateBody = { albums: [{ spotify_id: 'album-1', title: 'Candidate album' }], tracks: [] }

  async function acceptedSync() {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(candidateBody), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'accepted' }), { status: 202 }))
    const { result } = renderHook(() => useMusicSearch({ recallTypes: ['album'] }))
    act(() => result.current.setQuery('candidate'))
    await act(async () => {
      await result.current.runSpotifySync()
    })
    return result
  }

  it('offers the follow-up read once a sync request is accepted', async () => {
    const result = await acceptedSync()
    expect(result.current.syncRequested).toBe(true)
  })

  it('does not offer it when the sync request was rejected', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(candidateBody), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'failed' }), { status: 503 }))
    const { result } = renderHook(() => useMusicSearch({ recallTypes: ['album'] }))
    act(() => result.current.setQuery('candidate'))
    await act(async () => {
      await result.current.runSpotifySync()
    })

    expect(result.current.syncRequested).toBe(false)
  })

  it('retires the offer once the catalog has actually been re-read', async () => {
    const result = await acceptedSync()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ albums: [], artists: [], tracks: [] }),
    } as unknown as Response)))

    await act(async () => {
      await result.current.runDbSearch()
    })

    expect(result.current.syncRequested).toBe(false)
  })

  it('retires the offer when the reader moves to a different query', async () => {
    const result = await acceptedSync()
    act(() => result.current.setQuery('something else'))
    expect(result.current.syncRequested).toBe(false)
  })
})
