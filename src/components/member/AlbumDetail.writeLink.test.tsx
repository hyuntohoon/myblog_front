// FEAT-album-review-authoring Step 4 — the memo window's 전체 에디터 hand-off is
// owner-only.
//
// Surfaced by the security review of this step, not by the RFC: `MemoWindow`
// opens for ANY member's own bucket album (the branch needs only `writable` +
// a bucket-item handle, and members create buckets through AddAlbumModal), so
// `전체 에디터에서 작성 →` was offering /write — a 평론 editor 하드 룰 1 reserves
// for editors — to people the page guard then bounces.
//
// The memo itself stays theirs. Only the hand-off is gated, so the negative
// assertion is paired with a positive one that the window still rendered.
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const owner = vi.hoisted(() => ({ isOwnerUser: vi.fn() }))

const FIXTURE = {
	album: { id: 'album-1', title: 'Kind of Blue', release_date: '1959-08-17', cover_url: null, album_type: 'album', label: null },
	artists: [],
	tracks: [{ id: 'track-db-1', title: 'So What', track_no: 1, duration_sec: 545, spotify_id: 'sp-1', feat_artist_names: [] }],
}

vi.mock('@lib/albumDetail', () => ({
	getCachedAlbumDetail: () => FIXTURE,
	fetchAlbumDetail: () => Promise.resolve(FIXTURE),
}))
vi.mock('@lib/owner', () => owner)
vi.mock('./AlbumRatingBlock', () => ({ default: () => <div data-testid="rating-block" /> }))
vi.mock('../album/AlbumRatingBlock', () => ({ default: () => <div data-testid="rating-block" /> }))
vi.mock('./pocket/AddToBucketMenu', () => ({ AddToBucketMenu: () => <div /> }))

const { AlbumDetail } = await import('./AlbumDetail')

window.matchMedia = window.matchMedia || ((query: string) => ({
	matches: false,
	media: query,
	onchange: null,
	addListener: () => {},
	removeListener: () => {},
	addEventListener: () => {},
	removeEventListener: () => {},
	dispatchEvent: () => false,
}) as MediaQueryList)

/** A member's own bucket album — the case that opens MemoWindow. */
const BUCKET_ALBUM = {
	album: 'Kind of Blue',
	artist: 'Miles Davis',
	albumId: 'album-1',
	writable: true,
	bucketId: 'bucket-1',
	itemId: 'item-1',
}

const EDITOR_LINK = /전체 에디터에서 작성/

beforeEach(() => {
	vi.clearAllMocks()
})

describe('the memo window\'s 전체 에디터 hand-off', () => {
	it('is offered to the owner', async () => {
		owner.isOwnerUser.mockResolvedValue(true)
		render(<AlbumDetail album={BUCKET_ALBUM} reviews={[]} onClose={() => {}} />)
		const link = await screen.findByText(EDITOR_LINK)
		expect(link.getAttribute('href')).toBe('/write?album=album-1')
	})

	it('is not offered to a member, whose memo window still opens', async () => {
		owner.isOwnerUser.mockResolvedValue(false)
		render(<AlbumDetail album={BUCKET_ALBUM} reviews={[]} onClose={() => {}} />)
		// The window itself is theirs — assert it rendered before concluding the
		// link is absent, or a crash would read as a pass.
		expect(await screen.findByText('떠오른 대로 던져두는 곳')).toBeTruthy()
		await waitFor(() => expect(owner.isOwnerUser).toHaveBeenCalled())
		expect(screen.queryByText(EDITOR_LINK)).toBeNull()
	})

	it('shows nothing while the owner probe is still in flight', async () => {
		// Fail-closed on the way in as well: an unresolved probe must not paint the
		// link and then remove it.
		let settle: (v: boolean) => void = () => {}
		const held = new Promise<boolean>((resolve) => {
			settle = resolve
		})
		owner.isOwnerUser.mockReturnValue(held)
		render(<AlbumDetail album={BUCKET_ALBUM} reviews={[]} onClose={() => {}} />)
		expect(await screen.findByText('떠오른 대로 던져두는 곳')).toBeTruthy()
		expect(screen.queryByText(EDITOR_LINK)).toBeNull()
		settle(true)
		expect(await screen.findByText(EDITOR_LINK)).toBeTruthy()
	})
})
