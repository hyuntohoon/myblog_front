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
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LyricsSheet } from './LyricsSheet'
import { TRANSLATION_RETRY_MS } from './useLyricsDocument'

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
