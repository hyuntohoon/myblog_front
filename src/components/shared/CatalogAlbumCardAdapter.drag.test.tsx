import type { BoardBucket } from '@lib/buckets'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as buckets from '@lib/buckets'
import { bucketStore } from '@lib/pocketBuckit/bucketStore'
import { PocketBuckitProvider } from '@components/member/pocket/PocketBuckitProvider'
import { PocketTray } from '@components/member/pocket/PocketTray'
import { CatalogAlbumCardAdapter } from './CatalogAlbumCardAdapter'

vi.mock('@lib/auth', () => ({
	isLoggedIn: () => true,
}))

vi.mock('@lib/owner', () => ({
	isOwnerUser: () => false,
}))

vi.mock('@lib/buckets', async importOriginal => ({
	...await importOriginal<typeof import('@lib/buckets')>(),
	addBucketItem: vi.fn(),
	expandAlbumTracks: vi.fn(),
	expandSourceArtists: vi.fn(),
	listBuckets: vi.fn(),
}))

const TARGET: BoardBucket = {
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
}

beforeEach(() => {
	sessionStorage.clear()
	bucketStore.clear()
	vi.mocked(buckets.listBuckets).mockReset().mockResolvedValue([TARGET])
	vi.mocked(buckets.addBucketItem).mockReset().mockResolvedValue({ item: null, conflict: false })
	vi.mocked(buckets.expandAlbumTracks).mockReset()
	vi.mocked(buckets.expandSourceArtists).mockReset()
})

describe('catalog album card desktop drag to Pocket', () => {
	it('copies the catalog album through the live cross-island drag bridge', async () => {
		const { container } = render(
			<PocketBuckitProvider>
				<CatalogAlbumCardAdapter
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
					capabilities={{ open: vi.fn() }}
				/>
				<PocketTray />
			</PocketBuckitProvider>,
		)

		await waitFor(() => expect(container.querySelector('.pkt-ctrl')).toBeInTheDocument())
		fireEvent.click(container.querySelector('.pkt-ctrl')!)
		const target = await waitFor(() => {
			const node = container.querySelector<HTMLElement>('[data-chip-id="bucket-1"]')
			expect(node).toBeInTheDocument()
			return node!
		})
		const source = screen.getByRole('button', { name: 'Kind of Blue — Miles Davis 앨범 보기' })
		const dataTransfer = { effectAllowed: 'uninitialized' }

		fireEvent.dragStart(source, { dataTransfer })
		fireEvent.dragOver(target, { dataTransfer })
		fireEvent.drop(target, { dataTransfer })
		fireEvent.dragEnd(source, { dataTransfer })

		await waitFor(() => expect(buckets.addBucketItem).toHaveBeenCalledWith('bucket-1', 'album-1'))
		expect(dataTransfer.effectAllowed).toBe('copy')
		expect(buckets.expandAlbumTracks).not.toHaveBeenCalled()
		expect(buckets.expandSourceArtists).not.toHaveBeenCalled()
	})
})
