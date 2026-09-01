// ARCH-playback-authority-convergence Step 4 — G2.
//
// `트랙 정보` sat on two playback surfaces (the desktop panel's entry row and the
// mobile sheet's entry strip) wired, at BOTH of its call sites, to
// `NOOP_PLAYBACK_ENTRY` — a handler whose body was `{}`. Pressing it did
// nothing, said nothing, and had done nothing for as long as it had existed.
//
// The fix is not "delete the feature": the product may yet grow a track-detail
// destination. It is that the entry renders only where it HAS one, so the
// affordance and the destination can never drift apart again.
import type { BoardAlbum } from '@lib/buckets'
import type { PlaybackSessionState } from '@lib/playback/session'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PlaybackEntries } from './PlaybackPanel'

const STATE = { external: null } as unknown as PlaybackSessionState
const ROW = { itemId: 'i1', trackId: 't1', title: 'So What' } as unknown as BoardAlbum

describe('the playback entry row only offers what it can reach (G2)', () => {
  it('renders no 트랙 정보 when there is no destination to send it to', () => {
    render(<PlaybackEntries current={ROW} state={STATE} onOpenLyrics={() => {}} />)

    // The two entries that DO go somewhere are still there — this is the control
    // that the row rendered at all, so an absent 트랙 정보 means "not offered",
    // not "nothing rendered".
    expect(screen.getByText('가사')).toBeTruthy()
    expect(screen.getByText('앨범 정보')).toBeTruthy()
    expect(screen.queryByText('트랙 정보')).toBeNull()
  })

  it('renders it, and wires it, the moment a destination is passed', () => {
    const onOpenTrackInfo = vi.fn()
    render(<PlaybackEntries current={ROW} state={STATE} onOpenLyrics={() => {}} onOpenTrackInfo={onOpenTrackInfo} />)

    fireEvent.click(screen.getByText('트랙 정보'))

    expect(onOpenTrackInfo).toHaveBeenCalledWith(ROW, STATE)
  })
})
