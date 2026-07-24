// REFACTOR Step 2 — request-cancel for debounced/as-you-type search. Pins that a
// newer search aborts the previous in-flight fetch on the wire (not just drops
// its result via the seqRef guard), and that an aborted search does not flash a
// failure status.
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMusicSearch } from './useMusicSearch'

afterEach(() => {
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
