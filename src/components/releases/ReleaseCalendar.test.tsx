// Audit #16 filters on /releases: type (전체 · 앨범·EP · 싱글) and status
// (전체 · ★ 확정 · 예고) chips narrow the fetched month in both views, carry
// faceted counts, and round-trip through the query string (defaults omitted).
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReleaseCalendar, { filterDays } from './ReleaseCalendar'

vi.mock('@lib/albumDetail', () => ({ prefetchAlbumDetail: vi.fn() }))
vi.mock('@lib/spotifyCatalog', () => ({ resolveDbAlbumId: vi.fn(() => Promise.resolve(null)) }))

const MONTH = '2026-03' // a past month: every row renders, no '오늘' rule mid-list

function ev(title: string, release_type: string, status: string, date = `${MONTH}-10`) {
  return {
	artist_id: `ar-${title}`,
	artist_name: `Artist ${title}`,
	artist_popularity: 60,
	release_date: date,
	release_type,
	sources: ['itunes'],
	spotify_album_id: null,
	status,
	title,
}
}

const DATA = {
	date_from: `${MONTH}-01`,
	date_to: `${MONTH}-31`,
	total: 5,
	days: [
		{ date: `${MONTH}-10`, events: [ev('LP One', 'album', 'released'), ev('Single One', 'single', 'released')] },
		{ date: `${MONTH}-17`, events: [ev('EP One', 'ep', 'announced', `${MONTH}-17`), ev('Single Two', 'single', 'announced', `${MONTH}-17`)] },
		{ date: `${MONTH}-24`, events: [ev('Odd One', 'other', 'announced', `${MONTH}-24`)] },
	],
}

function mount(query: string, data: unknown = DATA) {
	window.history.replaceState(null, '', `/releases/?month=${MONTH}${query}`)
	vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(data) })))
	render(<ReleaseCalendar />)
}

const typeGroup = () => screen.getByRole('group', { name: '유형 필터' })
const statusGroup = () => screen.getByRole('group', { name: '상태 필터' })
const chip = (group: HTMLElement, name: RegExp) => within(group).getByRole('button', { name })

beforeEach(() => {
	vi.unstubAllGlobals()
})

describe('filterDays', () => {
	it('groups album + ep, leaves other only under 전체, and drops emptied days', () => {
		const days = filterDays(DATA.days, 'album', 'all')
		expect(days.map(d => d.date)).toEqual([`${MONTH}-10`, `${MONTH}-17`])
		expect(days.flatMap(d => d.events?.map(e => e.title))).toEqual(['LP One', 'EP One'])
		expect(filterDays(DATA.days, 'single', 'announced').flatMap(d => d.events?.map(e => e.title))).toEqual(['Single Two'])
		expect(filterDays(DATA.days, 'all', 'all')).toBe(DATA.days)
	})
})

describe('releaseCalendar filters (audit #16)', () => {
	it('defaults to 전체/전체 with every event shown and faceted counts', async () => {
		mount('')
		expect(await screen.findByText('Odd One')).toBeInTheDocument()
		expect(chip(typeGroup(), /^전체/)).toHaveAttribute('aria-pressed', 'true')
		expect(chip(statusGroup(), /^전체/)).toHaveAttribute('aria-pressed', 'true')
		expect(chip(typeGroup(), /앨범·EP/)).toHaveTextContent('앨범·EP2')
		expect(chip(typeGroup(), /싱글/)).toHaveTextContent('싱글2')
		expect(chip(statusGroup(), /확정/)).toHaveTextContent('★ 확정2')
		expect(chip(statusGroup(), /예고/)).toHaveTextContent('예고3')
		expect(screen.getByText('MARCH · 5 RELEASES')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: '싱글 2건' })).toBeInTheDocument()
	})

	it('narrows the ledger, recounts the other row, and writes the query string', async () => {
		mount('')
		await screen.findByText('Odd One')
		fireEvent.click(chip(typeGroup(), /싱글/))
		expect(screen.getByText('Single One')).toBeInTheDocument()
		expect(screen.getByText('Single Two')).toBeInTheDocument()
		expect(screen.queryByText('LP One')).toBeNull()
		expect(screen.queryByText('Odd One')).toBeNull()
		expect(screen.getByText('MARCH · 2 / 5 RELEASES')).toBeInTheDocument()
		// status counts now reflect singles only
		expect(chip(statusGroup(), /확정/)).toHaveTextContent('★ 확정1')
		expect(chip(statusGroup(), /예고/)).toHaveTextContent('예고1')
		expect(new URLSearchParams(window.location.search).get('type')).toBe('single')

		fireEvent.click(chip(statusGroup(), /확정/))
		expect(screen.getByText('Single One')).toBeInTheDocument()
		expect(screen.queryByText('Single Two')).toBeNull()
		expect(new URLSearchParams(window.location.search).get('status')).toBe('released')
		// type counts now reflect 확정 only
		expect(chip(typeGroup(), /앨범·EP/)).toHaveTextContent('앨범·EP1')
		expect(chip(typeGroup(), /싱글/)).toHaveTextContent('싱글1')
		expect(chip(typeGroup(), /^전체/)).toHaveTextContent('전체2')

		fireEvent.click(chip(typeGroup(), /^전체/))
		fireEvent.click(chip(statusGroup(), /^전체/))
		const sp = new URLSearchParams(window.location.search)
		expect(sp.has('type')).toBe(false)
		expect(sp.has('status')).toBe(false)
	})

	it('restores filters from the URL', async () => {
		mount('&type=album&status=announced')
		expect(await screen.findByText('EP One')).toBeInTheDocument()
		expect(screen.queryByText('LP One')).toBeNull()
		expect(chip(typeGroup(), /앨범·EP/)).toHaveAttribute('aria-pressed', 'true')
		expect(chip(statusGroup(), /예고/)).toHaveAttribute('aria-pressed', 'true')
	})

	it('ignores unknown filter values', async () => {
		mount('&type=bogus&status=nope')
		expect(await screen.findByText('Odd One')).toBeInTheDocument()
		expect(chip(typeGroup(), /^전체/)).toHaveAttribute('aria-pressed', 'true')
	})

	it('applies to the grid view: only matching days are buttons', async () => {
		mount('&view=grid&type=album')
		expect(await screen.findByRole('button', { name: /3월 10일 .* 발매 1건/ })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /3월 17일 .* 발매 1건/ })).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: /3월 24일/ })).toBeNull()
	})

	it('says the filter, not the month, is empty', async () => {
		mount('&type=album', { ...DATA, days: [{ date: `${MONTH}-10`, events: [ev('Single One', 'single', 'released')] }] })
		expect(await screen.findByText('이 달엔 고른 조건에 맞는 발매가 없습니다.')).toBeInTheDocument()
		expect(screen.queryByText('이 달엔 알려진 발매가 없습니다.')).toBeNull()
		fireEvent.click(chip(typeGroup(), /^전체/))
		expect(screen.getByText('Single One')).toBeInTheDocument()
	})
})
