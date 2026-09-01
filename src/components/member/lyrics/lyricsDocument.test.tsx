// ARCH-playback-authority-convergence Step 4 — G3 and G4.
//
// G4: `LyricsViewer` and `LyricsSheet` each implemented the same document
// lifecycle — the read, the loading/error phase, the translation row, the local
// 요청됨 override, the 번역 default and a copy of `isKoreanDominant` whose own
// comment called itself a mirror. These tests drive the SHEET; the sibling case
// in LyricsViewer.transport.test.tsx drives the viewer through the same hook, so
// a regression in the shared lifecycle fails on both surfaces at once, which is
// the property the extraction exists to buy.
//
// G3: a finished translation never reached an open screen. `requestTr` wrote a
// local 요청됨 and nothing re-read the row, so the real status arrived only if
// the member happened to change tracks. The completed translation is not a flag
// — it is `text_ko` on every segment — so "it arrived" is asserted here as the
// KOREAN TEXT being on screen, not as a status string.
import type { LyricsResponse, LyricsTranslationInfo } from './lyrics.api'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LyricsSheet } from './LyricsSheet'
import { TRANSLATION_RETRY_MS, useLyricsDocument } from './useLyricsDocument'

const mocks = vi.hoisted(() => ({
  getLyrics: vi.fn(),
  requestTranslation: vi.fn(),
}))

vi.mock('./lyrics.api', () => ({
  getLyrics: mocks.getLyrics,
  requestTranslation: mocks.requestTranslation,
}))
vi.mock('@lib/useDismissable', () => ({ useDismissable: () => {} }))
vi.mock('@lib/useScrollLock', () => ({ useScrollLock: () => {} }))

function doc(status: LyricsTranslationInfo['status'], ko: boolean): LyricsResponse {
  return {
    availability: 'ok',
    normalizer_version: 1,
    trackable: true,
    source_kind: 'synced',
    segments: [
      { i: 0, text: 'first line', start_ms: 0, text_ko: ko ? '첫째 줄' : null },
      { i: 1, text: 'second line', start_ms: 50_000, text_ko: ko ? '둘째 줄' : null },
    ],
    translation: { status, lang: 'ko', origin: 'poller' },
  } as LyricsResponse
}

async function openSheet() {
  render(<LyricsSheet spotifyTrackId="track-1" onClose={() => {}} />)
  await screen.findByText('first line')
  // The mount is not finished when the lyric text appears: `findByText` resolves
  // off a DOM mutation, which React fires at commit, before that commit's passive
  // effects run — and the visibility listener these tests dispatch at is
  // registered by one of them. Without this, the dispatch lands before the
  // listener exists and the test reads as "it did not ask again". Caught by
  // repetition, at 1 full-suite run in 20, not by a single green run.
  await act(async () => {})
}

/** The burst's total span, plus a beat — every armed attempt has fired by then. */
const BURST_SPAN_MS = TRANSLATION_RETRY_MS.reduce((a, b) => a + b, 0) + 1000

beforeEach(() => {
  vi.clearAllMocks()
})

describe('a translation that finishes while the screen is open (G3)', () => {
  it('arrives on the bounded catch-up burst, with no track change and no toggle', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      mocks.getLyrics
        .mockResolvedValueOnce(doc('requested', false))
        .mockResolvedValue(doc('done', true))
      await openSheet()
      // Before: the row is pending and there is no Korean on screen at all.
      expect(screen.getByText('요청됨 · 확인')).toBeTruthy()
      expect(screen.queryByText('첫째 줄')).toBeNull()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(TRANSLATION_RETRY_MS[0] + 100)
      })

      // The translation is ON SCREEN, not merely "status: done". A finished
      // translation shows by default, which is the whole point of arriving.
      await waitFor(() => expect(screen.getByText('첫째 줄')).toBeTruthy())
      expect(screen.queryByText('요청됨 · 확인')).toBeNull()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('stops asking — the burst is bounded, not a poll', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      mocks.getLyrics.mockResolvedValue(doc('requested', false))
      await openSheet()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(BURST_SPAN_MS)
      })
      const spent = mocks.getLyrics.mock.calls.length
      expect(spent).toBe(1 + TRANSLATION_RETRY_MS.length)

      // Ten more minutes buys nothing. A schedule that re-armed itself — the
      // failure mode the RFC's "no new polling loop" non-goal forbids — would
      // keep counting here.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600_000)
      })
      expect(mocks.getLyrics.mock.calls.length).toBe(spent)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('asks again when the member comes back to the tab, and only while pending', async () => {
    mocks.getLyrics.mockResolvedValue(doc('requested', false))
    await openSheet()
    expect(mocks.getLyrics).toHaveBeenCalledTimes(1)

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(mocks.getLyrics).toHaveBeenCalledTimes(2)
  })

  // The control for the test above: same event, same screen, different status.
  // A settled row must not spend a request on every tab switch for the rest of
  // the session — which is what "only while pending" has to mean to be worth
  // anything. Its own `it` because RTL keeps the previous render mounted, and a
  // second listening screen would answer for the first.
  it('does not ask on a tab return once the row has settled', async () => {
    mocks.getLyrics.mockResolvedValue(doc('done', true))
    await openSheet()
    expect(mocks.getLyrics).toHaveBeenCalledTimes(1)

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(mocks.getLyrics).toHaveBeenCalledTimes(1)
  })

  it('re-checks on the explicit 확인 press', async () => {
    mocks.getLyrics.mockResolvedValueOnce(doc('requested', false)).mockResolvedValue(doc('done', true))
    await openSheet()

    await act(async () => {
      fireEvent.click(screen.getByText('요청됨 · 확인'))
    })
    await waitFor(() => expect(screen.getByText('첫째 줄')).toBeTruthy())
  })

  it('leaves the document alone when the status check itself fails', async () => {
    mocks.getLyrics.mockResolvedValueOnce(doc('requested', false)).mockRejectedValue(new Error('HTTP 500'))
    await openSheet()

    await act(async () => {
      fireEvent.click(screen.getByText('요청됨 · 확인'))
    })
    // A background refresh that fails is not a document error: the lyric the
    // member is reading stays exactly where it was, and 다시 시도 — the failed-
    // LOAD affordance — must not appear.
    await waitFor(() => expect(screen.getByText('first line')).toBeTruthy())
    expect(screen.queryByText('다시 시도')).toBeNull()
    expect(screen.getByText('요청됨 · 확인')).toBeTruthy()
  })
})

describe('the load callback runs IN the load, not after the commit', () => {
  // The invariant `LyricsViewer` needs and cannot test. Seeding its clock from an
  // effect on `phase` puts the anchor one commit behind the lyrics: the list
  // paints focused on line 1 with no anchor, and anything the member does in that
  // window is overwritten by the seed landing behind it.
  //
  // Testing it through the viewer means catching a pre-passive-effect DOM state,
  // which RTL's async helpers flush before they resolve — an attempt to assert it
  // that way failed to kill its own mutant and was deleted. The invariant is the
  // HOOK's contract, though, and that is directly observable: ask what the last
  // RENDERED phase was at the moment `onLoaded` ran. In the load's own batch the
  // answer is `loading`, because the `ready` phase has not committed yet. From an
  // effect on `phase` it would be `ready`.
  it('sees the pre-commit phase, and runs before any effect keyed on the phase', async () => {
    mocks.getLyrics.mockResolvedValue(doc('none', false))
    const order: string[] = []
    let lastRendered: string | null = null
    let phaseWhenLoadedRan: string | null = null

    function Probe() {
      const d = useLyricsDocument('track-1', {
        onLoaded: () => {
          phaseWhenLoadedRan = lastRendered
          order.push('onLoaded')
        },
      })
      lastRendered = d.phase.k
      useEffect(() => {
        if (d.phase.k === 'ready')
          order.push('phaseEffect')
      }, [d.phase])
      return <span>{d.phase.k}</span>
    }

    render(<Probe />)
    await screen.findByText('ready')

    expect(phaseWhenLoadedRan).toBe('loading')
    expect(order).toEqual(['onLoaded', 'phaseEffect'])
  })
})

describe('a request whose track moved on underneath it (review finding)', () => {
  // `requestTr` was the one async write in the hook without the epoch guard the
  // rest of the file uses twice. A POST issued for A that lands after the screen
  // has moved to B wrote `요청됨` onto B — and `pending` then arms a three-attempt
  // burst and a visibility listener against a state B never asked for.
  it('does not write A\'s answer onto B, and reports the press as dropped', async () => {
    let release: ((v: LyricsTranslationInfo) => void) | null = null
    mocks.requestTranslation.mockImplementation(() => new Promise<LyricsTranslationInfo>((r) => {
      release = r
    }))
    mocks.getLyrics.mockResolvedValue(doc('none', false))

    let api: ReturnType<typeof useLyricsDocument> | null = null
    function Probe({ id }: { id: string }) {
      api = useLyricsDocument(id)
      return <span>{api.phase.k === 'ready' ? `ready:${id}` : api.phase.k}</span>
    }

    const { rerender } = render(<Probe id="track-A" />)
    await screen.findByText('ready:track-A')

    let pending: Promise<'ok' | 'failed' | 'dropped'>
    await act(async () => {
      pending = api!.requestTr()
    })

    // The track turns over while the POST is still in flight.
    await act(async () => {
      rerender(<Probe id="track-B" />)
    })
    await screen.findByText('ready:track-B')

    await act(async () => {
      release!({ status: 'requested', lang: 'ko', origin: 'manual' })
      await pending
    })

    await expect(pending!).resolves.toBe('dropped')
    // B must not have inherited A's 요청됨 — there is nothing for a burst to arm
    // against, and no re-check control on a row nobody asked about.
    expect(api!.translation?.status).not.toBe('requested')
  })

  // The other `dropped` case, and the reason the result is a tri-state rather
  // than a boolean: a press that was never sent has no news. Reporting it as a
  // success made the caller run `setNotice(null)` and wipe whatever unrelated
  // notice was on screen — a 복사에 실패했어요, say — on a double-tap alone.
  it('reports a press made while one is already in flight as dropped, not ok', async () => {
    let release: ((v: LyricsTranslationInfo) => void) | null = null
    mocks.requestTranslation.mockImplementation(() => new Promise<LyricsTranslationInfo>((r) => {
      release = r
    }))
    mocks.getLyrics.mockResolvedValue(doc('none', false))

    let api: ReturnType<typeof useLyricsDocument> | null = null
    function Probe() {
      api = useLyricsDocument('track-1')
      return <span>{api.phase.k}</span>
    }
    render(<Probe />)
    await screen.findByText('ready')

    let first: Promise<'ok' | 'failed' | 'dropped'>
    await act(async () => {
      first = api!.requestTr()
    })
    const second = await api!.requestTr()
    expect(second).toBe('dropped')

    await act(async () => {
      release!({ status: 'requested', lang: 'ko', origin: 'manual' })
      await first
    })
    await expect(first!).resolves.toBe('ok')
    expect(mocks.requestTranslation).toHaveBeenCalledTimes(1)
  })
})

describe('the translation live region is stable across the arrival', () => {
  // A live region only announces changes to a region that was ALREADY in the
  // tree. Putting `aria-live` on the branch instead of the wrapper mounts the
  // region together with its own news, which announces nothing — so the
  // assertion has to be that the same DOM node carries the attribute before and
  // after 요청됨 → 번역, not merely that some node has it afterwards.
  it('keeps one node with aria-live across 요청됨 → 번역', async () => {
    mocks.getLyrics
      .mockResolvedValueOnce(doc('requested', false))
      .mockResolvedValue(doc('done', true))
    await openSheet()

    const region = document.querySelector('.lys-tr-live')
    expect(region?.getAttribute('aria-live')).toBe('polite')
    expect(region?.textContent).toContain('요청됨')

    await act(async () => {
      fireEvent.click(screen.getByText('요청됨 · 확인'))
    })
    await waitFor(() => expect(screen.getByText('첫째 줄')).toBeTruthy())

    // Same node, new contents — that is what makes the arrival announceable.
    expect(document.querySelector('.lys-tr-live')).toBe(region)
    expect(region?.getAttribute('aria-live')).toBe('polite')
    expect(region?.textContent).toContain('번역')
  })
})

describe('the burst stays invisible (review finding)', () => {
  // `checkingTr` used to be set by every re-check, the burst's three included, so
  // a member who was only reading watched the control grey itself out at +8s,
  // +33s and +93s. The burst not being felt is the whole justification for it not
  // being a poll.
  it('does not put the control in a busy state when the burst fires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      mocks.getLyrics.mockResolvedValue(doc('requested', false))
      await openSheet()
      const before = mocks.getLyrics.mock.calls.length

      await act(async () => {
        await vi.advanceTimersByTimeAsync(TRANSLATION_RETRY_MS[0] + 100)
      })

      // It DID ask — the control simply never announced it.
      expect(mocks.getLyrics.mock.calls.length).toBeGreaterThan(before)
      expect(screen.getByText('요청됨 · 확인').getAttribute('aria-busy')).toBe('false')
    }
    finally {
      vi.useRealTimers()
    }
  })
})
