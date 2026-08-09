import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'
import * as buckets from '@lib/buckets'
import { useDismissable } from '@lib/useDismissable'
import { HomeAlbumCardAdapter } from '@components/home/HomeAlbumCardAdapter'
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
	expandAlbumTracks: vi.fn(),
	isManualAddTarget: () => true,
	listBuckets: vi.fn().mockResolvedValue([]),
	PLAYBACK_TYPE: 'playback',
}))

vi.mock('@lib/pocketBuckit/bucketStore', () => ({
	bucketStore: { ensureFresh: vi.fn().mockResolvedValue(undefined) },
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

describe('home album-card add fallback', () => {
	it('opens the existing picker and writes the catalog album id', async () => {
		vi.mocked(buckets.listBuckets).mockResolvedValue([{
			id: 'bucket-1',
			name: 'Pocket Buckit',
			color: null,
			isDone: false,
			kind: 'review',
			type: 'general',
			isPublic: false,
			researchMode: 'off',
			albums: [],
			children: [],
		}])
		vi.mocked(buckets.addBucketItem).mockResolvedValue({ item: null, conflict: true })

		render(
			<HomeAlbumCardAdapter
				data={{
					catalogAlbumId: 'album-1',
					spotifyAlbumId: null,
					title: 'Kind of Blue',
					artist: 'Miles Davis',
					artistId: 'artist-1',
					cover: null,
					year: 1959,
				}}
				layout="grid"
			/>,
		)

		fireEvent.click(screen.getByRole('button', { name: 'Kind of Blue 버킷에 담기' }))
		const picker = await screen.findByRole('dialog', { name: '버킷 선택' })
		expect(picker).toHaveTextContent('«Kind of Blue» 담기')
		fireEvent.click(screen.getByRole('button', { name: 'Pocket Buckit' }))

		await waitFor(() => expect(buckets.addBucketItem).toHaveBeenCalledWith('bucket-1', 'album-1'))
	})
})

// FEAT-playback-bucket-player Step 8 — the mobile/non-drag peer of boardDnd.ts's
// routeAlbumDrop PLAYBACK_TYPE branch: an album dropped on the Playback Bucket
// expands into its tracks, the same as the drag path, rather than 400ing on a
// plain album add (the backend's add_item type gate rejects item_type='album'
// on a type='playback' bucket).
describe('album add fallback into the Playback Bucket', () => {
	const playbackBucket = {
		id: 'pb-1',
		name: '재생 대기열',
		color: null,
		isDone: false,
		kind: 'playback_queue',
		type: 'playback',
		isPublic: false,
		researchMode: 'off',
		albums: [],
		children: [],
	}

	it('expands the album into its tracks instead of a plain album add', async () => {
		vi.mocked(buckets.addBucketItem).mockClear()
		vi.mocked(buckets.listBuckets).mockResolvedValue([playbackBucket])
		vi.mocked(buckets.expandAlbumTracks).mockResolvedValue([
			{ id: 't1', title: 'So What', artistNames: ['Miles Davis'] },
			{ id: 't2', title: 'Freddie Freeloader', artistNames: ['Miles Davis'] },
		])

		render(<AddToBucketMenu item={{ albumId: 'album-1', title: 'Kind of Blue' }} />)

		fireEvent.click(screen.getByRole('button', { name: '버킷에 담기' }))
		await screen.findByRole('dialog', { name: '버킷 선택' })
		fireEvent.click(screen.getByRole('button', { name: '재생 대기열' }))

		await waitFor(() => expect(buckets.expandAlbumTracks).toHaveBeenCalledWith('pb-1', 'album-1'))
		expect(buckets.addBucketItem).not.toHaveBeenCalled()
		await screen.findByText('2곡을 재생 대기열에 추가했어요')
	})

	it('reports a real no-tracks-synced-yet state rather than a generic failure', async () => {
		vi.mocked(buckets.listBuckets).mockResolvedValue([playbackBucket])
		vi.mocked(buckets.expandAlbumTracks).mockResolvedValue([])

		render(<AddToBucketMenu item={{ albumId: 'album-2', title: 'No Tracks Yet' }} />)

		fireEvent.click(screen.getByRole('button', { name: '버킷에 담기' }))
		await screen.findByRole('dialog', { name: '버킷 선택' })
		fireEvent.click(screen.getByRole('button', { name: '재생 대기열' }))

		await screen.findByText('이 앨범은 아직 트랙 정보가 없어요')
	})
})
