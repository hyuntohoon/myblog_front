// FIX-user-flow-state-consistency leg 4 — the /collection attribution is a link.
//
// It was plain text, under a comment saying "until member pages are
// runtime-reachable". That stopped being true and the comment did not notice:
// /members/?u=<handle> is live and already linked from the members hub and from
// every rating byline. This shelf was the one surface that named a member and
// then dead-ended on them.
import type { PublicCollection } from '@lib/buckets'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CollectionView from './CollectionView'

const buckets = vi.hoisted(() => ({ listPublicBuckets: vi.fn() }))
const mocks = vi.hoisted(() => ({ openAlbum: vi.fn(), loggedIn: false }))

vi.mock('@lib/buckets', async importOriginal => ({
	...await importOriginal<typeof import('@lib/buckets')>(),
	listPublicBuckets: buckets.listPublicBuckets,
}))
// jsdom serves from localhost, where isLoggedIn() is always true — pin it.
vi.mock('@lib/auth', () => ({ isLoggedIn: () => mocks.loggedIn, goLogin: vi.fn() }))
vi.mock('@lib/entityLinks', async () => ({
	...await vi.importActual<typeof import('@lib/entityLinks')>('@lib/entityLinks'),
	openAlbum: mocks.openAlbum,
}))

function collection(owner: PublicCollection['owner']): PublicCollection {
	return {
		id: 'bucket-1',
		name: '9월의 발견',
		color: null,
		owner,
		albums: [{
			albumId: 'album-1',
			title: 'Kind of Blue',
			artist: 'Miles Davis',
			cover: null,
			year: 1959,
			alreadyReviewed: false,
			genres: [],
		}],
	}
}

beforeEach(() => {
	buckets.listPublicBuckets.mockReset()
	mocks.loggedIn = false
})

afterEach(() => {
	vi.clearAllMocks()
})

describe('/collection attribution', () => {
	it('links the shelf owner to their member page', async () => {
		buckets.listPublicBuckets.mockResolvedValue([collection({ handle: 'user-a4f83dcc', displayName: 'Smoke User' })])
		render(<CollectionView />)

		const link = await screen.findByRole('link', { name: 'Smoke User' })
		expect(link).toHaveAttribute('href', '/members/?u=user-a4f83dcc')
	})

	it('encodes the handle rather than pasting it into the query', async () => {
		// no display name → the label falls back to the neutral stand-in (audit
		// E-2), but the href still has to carry the real handle, encoded
		buckets.listPublicBuckets.mockResolvedValue([collection({ handle: 'a b&c', displayName: null })])
		render(<CollectionView />)

		const link = await screen.findByRole('link', { name: '이름 없는 회원' })
		expect(link).toHaveAttribute('href', '/members/?u=a%20b%26c')
	})

	it('stays plain text when there is no owner to link to', async () => {
		buckets.listPublicBuckets.mockResolvedValue([collection(null)])
		render(<CollectionView />)

		await screen.findByText('9월의 발견')
		// no handle → no /members/?u= with an empty parameter, which would be a
		// link that renders fine and lands nowhere
		expect(screen.queryByRole('link', { name: /.*/ })).toBeNull()
		expect(document.body.innerHTML).not.toContain('/members/?u=')
	})

	it('does not link an owner whose handle is empty', async () => {
		buckets.listPublicBuckets.mockResolvedValue([collection({ handle: '', displayName: 'No Handle' })])
		render(<CollectionView />)

		await waitFor(() => {
			expect(screen.getByText('9월의 발견')).toBeTruthy()
		})
		expect(document.body.innerHTML).not.toContain('/members/?u=')
	})
})

// Front UI/UX audit S1 — a shelf album is the canonical AlbumCard through
// CatalogAlbumCardAdapter: the same open + ＋ as on /search and /artist.
describe('/collection album cards', () => {
	const OWNER = { handle: 'user-a4f83dcc', displayName: 'Smoke User' }

	it('opens the album with the payload the old tile sent', async () => {
		buckets.listPublicBuckets.mockResolvedValue([collection(OWNER)])
		render(<CollectionView />)

		fireEvent.click(await screen.findByRole('button', { name: 'Kind of Blue — Miles Davis 앨범 보기' }))
		expect(mocks.openAlbum).toHaveBeenCalledWith({ albumId: 'album-1', title: 'Kind of Blue', artist: 'Miles Davis', cover: null, year: 1959 })
	})

	it('renders the canonical card with ＋ and the artist · year byline', async () => {
		buckets.listPublicBuckets.mockResolvedValue([collection(OWNER)])
		render(<CollectionView />)

		const article = (await screen.findByRole('button', { name: 'Kind of Blue — Miles Davis 앨범 보기' })).closest('article') as HTMLElement
		expect(article.className).toContain('album-card--grid')
		expect(screen.getByRole('heading', { level: 3, name: 'Kind of Blue' })).toBeTruthy()
		expect(article.querySelector('.album-card__byline')?.textContent).toBe('Miles Davis · 1959')
		expect(screen.getByRole('button', { name: 'Kind of Blue 버킷에 담기' })).toBeTruthy()
	})

	it('drags only when logged in', async () => {
		buckets.listPublicBuckets.mockResolvedValue([collection(OWNER)])
		const { unmount } = render(<CollectionView />)
		const anon = (await screen.findByRole('button', { name: 'Kind of Blue — Miles Davis 앨범 보기' })).closest('article') as HTMLElement
		expect(anon.getAttribute('draggable')).toBeNull()
		unmount()

		mocks.loggedIn = true
		render(<CollectionView />)
		const member = (await screen.findByRole('button', { name: 'Kind of Blue — Miles Davis 앨범 보기' })).closest('article') as HTMLElement
		expect(member.getAttribute('draggable')).toBe('true')
	})
})
