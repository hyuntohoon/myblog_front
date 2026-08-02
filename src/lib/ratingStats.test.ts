import type { MemberRating } from '../components/album/reviews.api'
import { describe, expect, it } from 'vitest'
import { computeRatingStats, RATING_BUCKETS, sortRatings } from './ratingStats'

let seq = 0
function row(rating: number, over: Partial<MemberRating> = {}): MemberRating {
	seq += 1
	return {
		id: `r${seq}`,
		album_id: `a${seq}`,
		album_title: `Album ${seq}`,
		album_cover_url: null,
		artist_id: null,
		artist_name: null,
		rating,
		comment: null,
		created_at: '2026-08-01T00:00:00Z',
		updated_at: '2026-08-01T00:00:00Z',
		...over,
	}
}

describe('computeRatingStats', () => {
	it('reports nothing rather than zero for an empty history', () => {
		// The profile decides whether to render the block on `count`, and an
		// average of 0 over no ratings would both render and be a lie.
		const s = computeRatingStats([])
		expect(s.count).toBe(0)
		expect(s.average).toBeNull()
		expect(s.peak).toBe(0)
		expect(s.distribution).toEqual(RATING_BUCKETS.map(() => 0))
	})

	it('counts every rated album and rounds the average to one decimal', () => {
		const s = computeRatingStats([row(4), row(3.5), row(5)])
		expect(s.count).toBe(3)
		expect(s.average).toBe(4.2) // 12.5 / 3 = 4.1666…
	})

	it('places each half step in its own bucket', () => {
		const s = computeRatingStats([row(0.5), row(3), row(3), row(5)])
		expect(s.distribution[0]).toBe(1) // 0.5
		expect(s.distribution[5]).toBe(2) // 3.0
		expect(s.distribution[9]).toBe(1) // 5.0
		expect(s.peak).toBe(2)
	})

	it('tolerates a rating arriving as a string', () => {
		// The API serialises numerics as JSON numbers today, but the rest of the
		// profile already defends against a string here (Number(r.rating)) — a fold
		// that silently produced NaN would poison the whole average, not one row.
		const s = computeRatingStats([row('4.5' as unknown as number), row(3.5)])
		expect(s.count).toBe(2)
		expect(s.average).toBe(4)
	})
})

describe('sortRatings', () => {
	it('does not mutate the fetched feed', () => {
		const feed = [row(2), row(5)]
		const before = feed.map(r => r.id)
		sortRatings(feed, 'score')
		expect(feed.map(r => r.id)).toEqual(before)
	})

	it('orders 최신 by created_at, newest first', () => {
		const older = row(3, { id: 'older', created_at: '2026-07-01T00:00:00Z' })
		const newer = row(3, { id: 'newer', created_at: '2026-08-01T00:00:00Z' })
		expect(sortRatings([older, newer], 'recent').map(r => r.id)).toEqual(['newer', 'older'])
	})

	it('orders 별점 high to low and breaks ties by name, not by feed order', () => {
		const b = row(4.5, { id: 'b', album_title: 'Bandwagon' })
		const a = row(4.5, { id: 'a', album_title: 'Aureole' })
		const low = row(2, { id: 'low', album_title: 'Aardvark' })
		expect(sortRatings([b, low, a], 'score').map(r => r.id)).toEqual(['a', 'b', 'low'])
	})

	it('orders 이름 by album title, then by artist', () => {
		const x = row(3, { id: 'x', album_title: 'Same', artist_name: 'Zeta' })
		const y = row(3, { id: 'y', album_title: 'Same', artist_name: 'Alpha' })
		const z = row(3, { id: 'z', album_title: 'Another' })
		expect(sortRatings([x, y, z], 'name').map(r => r.id)).toEqual(['z', 'y', 'x'])
	})

	it('collates 한글 by 가나다, not by code point', () => {
		// The load-bearing part is 가 < 나 < 하; a code-point sort would scatter the
		// 한글 titles among themselves. ko-KR also groups 한글 ahead of Latin, which
		// is the collation's call and is pinned here so a locale change is visible.
		const titles = ['하늘', '가을', 'Zebra', '나무']
		const sorted = sortRatings(titles.map(t => row(3, { album_title: t })), 'name')
		expect(sorted.map(r => r.album_title)).toEqual(['가을', '나무', '하늘', 'Zebra'])
	})
})
