// FIX-user-flow-state-consistency leg 4 — the /collection attribution is a link.
//
// It was plain text, under a comment saying "until member pages are
// runtime-reachable". That stopped being true and the comment did not notice:
// /members/?u=<handle> is live and already linked from the members hub and from
// every rating byline. This shelf was the one surface that named a member and
// then dead-ended on them.
import type { PublicCollection } from '@lib/buckets'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CollectionView from './CollectionView'

const buckets = vi.hoisted(() => ({ listPublicBuckets: vi.fn() }))

vi.mock('@lib/buckets', async importOriginal => ({
	...await importOriginal<typeof import('@lib/buckets')>(),
	listPublicBuckets: buckets.listPublicBuckets,
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
