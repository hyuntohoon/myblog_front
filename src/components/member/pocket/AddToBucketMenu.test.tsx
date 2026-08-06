import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'
import { useDismissable } from '@lib/useDismissable'
import { AddToBucketMenu } from './AddToBucketMenu'

vi.mock('@lib/auth', () => ({
	isLoggedIn: () => true,
	goLogin: vi.fn(),
}))

vi.mock('@lib/buckets', () => ({
	addBucketItem: vi.fn(),
	addBucketPlayback: vi.fn(),
	addBucketReview: vi.fn(),
	addBucketSnapshot: vi.fn(),
	addBucketTrack: vi.fn(),
	deleteBucketItem: vi.fn(),
	isManualAddTarget: () => true,
	listBuckets: vi.fn().mockResolvedValue([]),
}))

vi.mock('@lib/pocketBuckit/bucketStore', () => ({
	bucketStore: { ensureFresh: vi.fn() },
}))

vi.mock('@lib/playback/session', () => ({
	playbackSession: { onDropped: vi.fn() },
}))

vi.mock('@lib/pocketBuckit/intent', () => ({
	writePocketIntent: vi.fn(),
}))

const originalOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')

beforeEach(() => {
	Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
		configurable: true,
		get() {
			return this.parentElement
		},
	})
})

afterEach(() => {
	if (originalOffsetParent)
		Object.defineProperty(HTMLElement.prototype, 'offsetParent', originalOffsetParent)
})

function NestedHarness({ onHostClose }: { onHostClose: () => void }) {
	const hostRef = useRef<HTMLDivElement>(null)
	useDismissable(true, onHostClose, hostRef, { autoFocus: false })
	return (
		<div ref={hostRef} role="dialog" aria-label="앨범 메모">
			<AddToBucketMenu item={{ itemType: 'track', trackId: 'track-1', title: 'So What' }} />
		</div>
	)
}

describe('addToBucketMenu dismissable stack', () => {
	it('traps focus in the picker and lets Escape close it before its host', async () => {
		const onHostClose = vi.fn()
		render(<NestedHarness onHostClose={onHostClose} />)

		fireEvent.click(screen.getByRole('button', { name: '버킷에 담기' }))
		const picker = await screen.findByRole('dialog', { name: '버킷 선택' })
		const controls = [...picker.querySelectorAll<HTMLButtonElement>('button')]
		const close = screen.getByRole('button', { name: '닫기' })
		expect(document.activeElement).toBe(close)

		controls.at(-1)!.focus()
		fireEvent.keyDown(controls.at(-1)!, { key: 'Tab' })
		expect(document.activeElement).toBe(close)

		fireEvent.keyDown(document, { key: 'Escape' })
		await waitFor(() => expect(screen.queryByRole('dialog', { name: '버킷 선택' })).not.toBeInTheDocument())
		expect(onHostClose).not.toHaveBeenCalled()

		fireEvent.keyDown(document, { key: 'Escape' })
		expect(onHostClose).toHaveBeenCalledTimes(1)
	})
})
