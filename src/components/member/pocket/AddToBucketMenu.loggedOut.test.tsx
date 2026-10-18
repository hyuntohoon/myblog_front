// Front UI/UX audit S5 — a logged-out ＋ explains the login in-site before leaving
// for Cognito, and a logged-out catalog card offers no drag.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { goLogin } from '@lib/auth'
import { __resetAuthIdentity, syncAuthIdentity } from '@lib/authIdentity'
import { writePostLoginIntent } from '@lib/postLoginIntent'
import { CatalogAlbumCardAdapter } from '@components/shared/CatalogAlbumCardAdapter'
import { AddToBucketMenu } from './AddToBucketMenu'

const auth = vi.hoisted(() => ({ loggedIn: false }))

vi.mock('@lib/auth', () => ({
	isLoggedIn: () => auth.loggedIn,
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

vi.mock('@lib/postLoginIntent', () => ({
	writePostLoginIntent: vi.fn(),
}))

const CARD = {
	catalogAlbumId: 'album-1',
	spotifyAlbumId: null,
	title: 'Kind of Blue',
	artist: 'Miles Davis',
	artistId: 'artist-1',
	cover: null,
	year: 1959,
}

function idToken(sub: string): string {
	return `x.${btoa(JSON.stringify({ sub }))}.y`
}

beforeEach(() => {
	auth.loggedIn = false
	localStorage.clear()
	__resetAuthIdentity()
	vi.mocked(goLogin).mockClear()
	vi.mocked(writePostLoginIntent).mockClear()
})

afterEach(() => {
	localStorage.clear()
})

describe('logged-out ＋ opens the login-intent sheet', () => {
	it('shows the sheet instead of leaving for Cognito, and parks nothing yet', () => {
		render(<CatalogAlbumCardAdapter data={CARD} layout="grid" />)
		fireEvent.click(screen.getByRole('button', { name: 'Kind of Blue 버킷에 담기' }))

		const sheet = screen.getByRole('dialog', { name: '로그인하고 담기' })
		expect(sheet.textContent).toContain('«Kind of Blue»')
		expect(sheet.textContent).toContain('이 페이지로 돌아와')
		expect(goLogin).not.toHaveBeenCalled()
		expect(writePostLoginIntent).not.toHaveBeenCalled()
	})

	it.each([
		['카카오로 계속하기', 'Kakao'],
		['Google로 계속하기', 'Google'],
		['이메일로 계속하기', undefined],
	])('%s parks the album intent, then logs in with that provider', (label, idp) => {
		render(<CatalogAlbumCardAdapter data={CARD} layout="grid" />)
		fireEvent.click(screen.getByRole('button', { name: 'Kind of Blue 버킷에 담기' }))
		fireEvent.click(screen.getByRole('button', { name: label }))

		expect(writePostLoginIntent).toHaveBeenCalledWith({ kind: 'bucket-add', itemType: 'album', albumId: 'album-1', title: 'Kind of Blue' })
		expect(goLogin).toHaveBeenCalledWith(false, idp)
		expect(vi.mocked(writePostLoginIntent).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(goLogin).mock.invocationCallOrder[0])
	})

	it('parks a track intent for a track target', () => {
		render(<AddToBucketMenu item={{ itemType: 'track', trackId: 'track-1', title: 'So What' }} />)
		fireEvent.click(screen.getByRole('button', { name: '버킷에 담기' }))
		fireEvent.click(screen.getByRole('button', { name: '카카오로 계속하기' }))

		expect(writePostLoginIntent).toHaveBeenCalledWith({ kind: 'bucket-add', itemType: 'track', trackId: 'track-1', title: 'So What' })
	})

	it('a snapshot has no resume, so the sheet does not promise one', () => {
		render(<AddToBucketMenu item={{ itemType: 'snapshot', snapshot: {} as never, title: '분석' }} />)
		fireEvent.click(screen.getByRole('button', { name: '버킷에 담기' }))

		expect(screen.getByRole('dialog', { name: '로그인하고 담기' }).textContent).not.toContain('돌아와')
		fireEvent.click(screen.getByRole('button', { name: '이메일로 계속하기' }))
		expect(writePostLoginIntent).not.toHaveBeenCalled()
		expect(goLogin).toHaveBeenCalledWith(false, undefined)
	})

	it.each([
		['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
		['✕', () => fireEvent.click(screen.getByRole('button', { name: '닫기' }))],
		['scrim', () => fireEvent.click(screen.getByRole('dialog').parentElement!)],
	])('%s dismisses it and leaves no intent behind', (_name, dismiss) => {
		render(<CatalogAlbumCardAdapter data={CARD} layout="grid" />)
		fireEvent.click(screen.getByRole('button', { name: 'Kind of Blue 버킷에 담기' }))
		dismiss()

		expect(screen.queryByRole('dialog')).toBeNull()
		expect(writePostLoginIntent).not.toHaveBeenCalled()
		expect(goLogin).not.toHaveBeenCalled()
	})
})

describe('catalog card drag follows the session', () => {
	it('is not draggable when logged out, but keeps the ＋', () => {
		const { container } = render(<CatalogAlbumCardAdapter data={CARD} layout="grid" />)

		expect(container.querySelector('[draggable="true"]')).toBeNull()
		expect(screen.getByRole('button', { name: 'Kind of Blue 버킷에 담기' })).toBeTruthy()
	})

	it('becomes draggable when a login lands, without a remount', () => {
		const { container } = render(<CatalogAlbumCardAdapter data={CARD} layout="grid" />)
		expect(container.querySelector('article[draggable="true"]')).toBeNull()

		act(() => {
			auth.loggedIn = true
			localStorage.setItem('id_token', idToken('member-1'))
			syncAuthIdentity()
		})

		expect(container.querySelector('article[draggable="true"]')).not.toBeNull()
	})
})
