// FEAT-automation-admin 2c — the page's honesty rules, as pure functions.
import { describe, expect, it } from 'vitest'
import { job, realSnapshot } from './automation.fixture'
import { detailsText, groupJobsByLocation, livenessTally, readQueue, relativeAge } from './automationView'

function queue(key: string) {
	const q = realSnapshot().queues.find(x => x.key === key)
	if (!q)
		throw new Error(key)
	return q
}

describe('readQueue', () => {
	it('tells a failed read (counts: null) apart from an empty table (counts: {})', () => {
		const failed = { ...queue('lyrics_album_jobs'), counts: null }
		expect(readQueue(failed)).toEqual({ kind: 'unknown' })
		expect(readQueue(queue('lyrics_translation_work:chatgpt/genius-ko-v1'))).toEqual({ kind: 'empty' })
	})

	it('treats a queue whose status is unknown as unknown even if counts slipped through', () => {
		expect(readQueue({ ...queue('lyrics_album_jobs'), status: 'unknown' })).toEqual({ kind: 'unknown' })
	})

	it('sums only the waiting states', () => {
		const r = readQueue(queue('lyrics_translation_work:chatgpt/lyrics-ko-v1'))
		expect(r.kind === 'counted' && r.waiting).toBe(26)
		const legacy = readQueue(queue('lyrics_translation_work:claude.sonnet/v2'))
		// ready + retryable_error = 0 + 169; running/done/cancelled are not waiting.
		expect(legacy.kind === 'counted' && legacy.waiting).toBe(169)
	})

	it('keeps *_ineligible out of the waiting total (12 pending Genius annotations on prod)', () => {
		const r = readQueue(queue('track_genius_annotations'))
		expect(r).toMatchObject({ kind: 'counted', waiting: 0, ineligible: [{ state: 'pending_ineligible', n: 12 }] })
		expect(r.kind === 'counted' && r.other.map(s => s.state)).toEqual(['done', 'failed'])
	})
})

describe('livenessTally', () => {
	it('never counts an unknown row as fresh', () => {
		const t = livenessTally(realSnapshot().jobs)
		expect(t).toEqual({ fresh: 0, stale: 0, unknown: 4 })
	})

	it('counts an unrecognised status as unknown', () => {
		const odd = job({ key: 'x', liveness: { status: 'healthy' as never, reason: '' } })
		expect(livenessTally([odd])).toEqual({ fresh: 0, stale: 0, unknown: 1 })
	})

	it('counts fresh and stale from liveness only, ignoring declared_state', () => {
		const t = livenessTally([
			job({ key: 'a', declared_state: 'obsolete', liveness: { status: 'fresh', reason: '' } }),
			job({ key: 'b', declared_state: 'active', liveness: { status: 'stale', reason: '' } }),
			job({ key: 'c', declared_state: 'active' }),
		])
		expect(t).toEqual({ fresh: 1, stale: 1, unknown: 1 })
	})
})

describe('groupJobsByLocation', () => {
	it('orders AWS, Mac, GitHub and keeps catalog order inside a group', () => {
		const g = groupJobsByLocation(realSnapshot().jobs)
		expect(g.map(x => x.location)).toEqual(['aws', 'mac', 'github'])
		expect(g[0].jobs.map(j => j.key)).toEqual(['lyrics_demand_source', 'scheduler_start_blog_db'])
	})

	it('keeps a location it has not heard of instead of dropping its jobs', () => {
		const g = groupJobsByLocation([job({ key: 'z', location: 'mars' as never })])
		expect(g).toHaveLength(1)
		expect(g[0].jobs[0].key).toBe('z')
	})
})

describe('relativeAge', () => {
	const now = Date.parse('2026-10-12T10:31:33Z')
	it('reads minutes, hours and days', () => {
		expect(relativeAge('2026-10-12T10:28:33Z', now)).toBe('3분 전')
		expect(relativeAge('2026-10-12T08:09:04Z', now)).toBe('2시간 전')
		expect(relativeAge('2026-09-10T23:54:03Z', now)).toBe('31일 전')
	})
	it('clamps a future timestamp and rejects garbage', () => {
		expect(relativeAge('2026-10-12T11:00:00Z', now)).toBe('방금')
		expect(relativeAge('nope', now)).toBeNull()
		expect(relativeAge(null, now)).toBeNull()
	})
})

describe('detailsText', () => {
	it('returns null for no details and JSON text otherwise', () => {
		expect(detailsText(undefined)).toBeNull()
		expect(detailsText({})).toBeNull()
		expect(detailsText({ saved: 41 })).toBe('{\n  "saved": 41\n}')
	})
})
