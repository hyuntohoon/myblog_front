// ARCH-entity-interaction-v2 Step 5 (E4) — the play/add/drag slots and the
// whole-row `openLyrics` identity action (memo-trow's adopted shape). Pins:
// (1) `open` keeps its existing identity-only-button behavior unchanged, (2)
// `openLyrics` makes the WHOLE row the click/keyboard target and disappears
// to a plain row when omitted, (3) `play`/`add` are plain callback buttons,
// (4) `drag` dispatches both the tray→board and board→tray bridge events on
// dragstart, and clears them on dragend — the same wire every existing drag
// source uses, so a future consumer needs no extra plumbing.
import type { DragPayload } from '@lib/entityDrag'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PB_BOARD_DND_END_EVENT, PB_BOARD_DND_START_EVENT, PB_DND_END_EVENT, PB_DND_START_EVENT } from '@lib/pocketBuckit/events'
import { TrackRow } from './TrackRow'

describe('trackRow — identity actions', () => {
	it('open wraps only the identity cell in a button', () => {
		const fire = vi.fn()
		render(<TrackRow title="Track A" actions={{ open: { fire, title: '작품 상세' } }} />)
		fireEvent.click(screen.getByTitle('작품 상세'))
		expect(fire).toHaveBeenCalledTimes(1)
		expect(screen.getAllByRole('button')).toHaveLength(1) // just the identity button, no whole-row wrapper
	})

	it('openLyrics makes the whole row the click target, with a role and keyboard support', () => {
		const fire = vi.fn()
		render(<TrackRow title="Track A" actions={{ openLyrics: { fire, title: '가사 보기' } }} />)
		const row = screen.getByRole('button')
		fireEvent.click(row)
		expect(fire).toHaveBeenCalledTimes(1)
		fireEvent.keyDown(row, { key: 'Enter' })
		expect(fire).toHaveBeenCalledTimes(2)
		fireEvent.keyDown(row, { key: ' ' })
		expect(fire).toHaveBeenCalledTimes(3)
	})

	it('omitting openLyrics renders a plain, non-interactive row', () => {
		render(<TrackRow title="Track A" actions={{}} />)
		expect(screen.queryByRole('button')).toBeNull()
		expect(screen.getByText('Track A')).toBeInTheDocument()
	})

	it('open wins if both open and openLyrics are somehow granted', () => {
		const openFire = vi.fn()
		const lyricsFire = vi.fn()
		render(<TrackRow title="Track A" actions={{ open: { fire: openFire, title: '작품 상세' }, openLyrics: { fire: lyricsFire, title: '가사 보기' } }} />)
		fireEvent.click(screen.getByTitle('작품 상세'))
		expect(openFire).toHaveBeenCalledTimes(1)
		expect(lyricsFire).not.toHaveBeenCalled()
	})
})

describe('trackRow — play/add', () => {
	it('renders play and add as plain callback buttons', () => {
		const play = vi.fn()
		const add = vi.fn()
		render(<TrackRow title="Track A" actions={{ play, add }} />)
		fireEvent.click(screen.getByLabelText('Track A 재생'))
		fireEvent.click(screen.getByLabelText('Track A 담기'))
		expect(play).toHaveBeenCalledTimes(1)
		expect(add).toHaveBeenCalledTimes(1)
	})

	it('omits play/add buttons when not granted', () => {
		render(<TrackRow title="Track A" actions={{}} />)
		expect(screen.queryByLabelText('Track A 재생')).toBeNull()
		expect(screen.queryByLabelText('Track A 담기')).toBeNull()
	})
})

describe('trackRow — drag', () => {
	const payload: DragPayload = { ref: { entity: 'track', trackId: 't1', albumId: 'a1' }, origin: { kind: 'external', copies: true } }

	it('dispatches both bridge events on dragstart, with the granted payload', () => {
		const startSpy = vi.fn()
		const boardStartSpy = vi.fn()
		window.addEventListener(PB_DND_START_EVENT, startSpy)
		window.addEventListener(PB_BOARD_DND_START_EVENT, boardStartSpy)
		render(<TrackRow title="Track A" actions={{ drag: payload }} />)
		fireEvent.dragStart(screen.getByText('Track A').closest('[draggable]')!, { dataTransfer: {} })
		expect(startSpy).toHaveBeenCalledTimes(1)
		expect(boardStartSpy).toHaveBeenCalledTimes(1)
		expect((startSpy.mock.calls[0][0] as CustomEvent<DragPayload>).detail).toEqual(payload)
		expect((boardStartSpy.mock.calls[0][0] as CustomEvent<DragPayload>).detail).toEqual(payload)
		window.removeEventListener(PB_DND_START_EVENT, startSpy)
		window.removeEventListener(PB_BOARD_DND_START_EVENT, boardStartSpy)
	})

	it('clears both bridges on dragend', () => {
		const endSpy = vi.fn()
		const boardEndSpy = vi.fn()
		window.addEventListener(PB_DND_END_EVENT, endSpy)
		window.addEventListener(PB_BOARD_DND_END_EVENT, boardEndSpy)
		render(<TrackRow title="Track A" actions={{ drag: payload }} />)
		const row = screen.getByText('Track A').closest('[draggable]')!
		fireEvent.dragStart(row, { dataTransfer: {} })
		fireEvent.dragEnd(row)
		expect(endSpy).toHaveBeenCalledTimes(1)
		expect(boardEndSpy).toHaveBeenCalledTimes(1)
		window.removeEventListener(PB_DND_END_EVENT, endSpy)
		window.removeEventListener(PB_BOARD_DND_END_EVENT, boardEndSpy)
	})

	it('is not draggable when the action is omitted', () => {
		render(<TrackRow title="Track A" actions={{}} />)
		expect(screen.getByText('Track A').closest('[draggable]')).toBeNull()
	})
})
