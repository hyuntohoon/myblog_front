// FEAT-automation-admin 2c — the page's honesty rules, as pure functions.
import { describe, expect, it } from 'vitest'
import { job, realSnapshot } from './automation.fixture'
import { buildFlows, detailsText, flowSentence, groupJobsByLocation, judgeQueue, livenessTally, readQueue, reasonName, relativeAge, toneTally, untilText, waitedFor, worstTone } from './automationView'

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

describe('waitedFor', () => {
	const now = Date.parse('2026-10-12T10:31:33Z')
	it('reads minutes, hours and days, without "전"', () => {
		expect(waitedFor('2026-10-12T10:28:33Z', now)).toBe('3분')
		expect(waitedFor('2026-10-10T10:31:34Z', now)).toBe('47시간')
		expect(waitedFor('2026-09-10T23:54:03Z', now)).toBe('31일')
		expect(waitedFor(null, now)).toBeNull()
		expect(waitedFor('nope', now)).toBeNull()
	})
})

describe('judgeQueue', () => {
	const snap = realSnapshot()
	const now = Date.parse(snap.generated_at)
	const judge = (q: ReturnType<typeof queue>, jobs = snap.jobs) => judgeQueue(q, jobs, now)

	it('a failed read is 읽기 실패, an empty table is 행 없음 — both "can\'t see", never ok', () => {
		expect(judge({ ...queue('lyrics_album_jobs'), counts: null })).toMatchObject({ tone: 'none', label: '읽기 실패' })
		expect(judge(queue('lyrics_translation_work:chatgpt/genius-ko-v1'))).toMatchObject({ tone: 'none', label: '행 없음' })
	})

	it('expired leases outrank frozen: the legacy queue is 손볼 것, and still says it is frozen', () => {
		const v = judge(queue('lyrics_translation_work:claude.sonnet/v2'))
		expect(v).toMatchObject({ tone: 'bad', label: '멈춘 실행 70' })
		expect(v.say).toContain('동결')
	})

	it('frozen without expired leases is 동결', () => {
		const q = { ...queue('lyrics_translation_work:claude.sonnet/v2'), stale_running: 0 }
		expect(judge(q)).toMatchObject({ tone: 'frozen', label: '동결' })
	})

	it('waiting rows whose every consumer is switched off in the inventory warn 처리기 꺼짐', () => {
		const q = queue('lyrics_translation_work:chatgpt/lyrics-ko-v1')
		const jobs = snap.jobs.map(j => (j.key === 'gpt-translate-poller' ? { ...j, declared_state: 'disabled' as const } : j))
		expect(judge(q, jobs)).toMatchObject({ tone: 'warn', label: '처리기 꺼짐' })
	})

	it('one active consumer is enough not to say 처리기 꺼짐', () => {
		const q = queue('lyrics_translation_work:chatgpt/lyrics-ko-v1')
		const jobs = [...snap.jobs, { ...snap.jobs[2], key: 'second', declared_state: 'disabled' as const }]
		expect(judge(q, jobs).label).not.toBe('처리기 꺼짐')
	})

	it('a wait over one day is 1일 넘게 대기 — and never claims it is stuck', () => {
		const v = judge(queue('lyrics_album_jobs'))
		expect(v).toMatchObject({ tone: 'warn', label: '1일 넘게 대기' })
		expect(v.say).toContain('31일째')
		expect(v.say).toContain('상세에서 봅니다')
		expect(`${v.label}${v.say}`).not.toMatch(/막힘|막혔|stuck/i)
	})

	it('a wait under one day is 대기 짧음', () => {
		const q = { ...queue('lyrics_album_jobs'), oldest_waiting_at: '2026-10-11T11:00:00Z' }
		expect(judge(q)).toMatchObject({ tone: 'ok', label: '대기 짧음' })
	})

	it('no waiting rows is 대기 없음, and ineligible rows are named but not counted as waiting', () => {
		const v = judge(queue('track_genius_annotations'))
		expect(v).toMatchObject({ tone: 'ok', label: '대기 없음' })
		expect(v.say).toContain('처리 불가 12건')
	})

	it('the real snapshot tallies 손볼 것 1 · 지켜볼 것 2 · 볼 수 없음 1 · 문제 없음 1', () => {
		const t = toneTally(snap.queues.map(q => judge(q)))
		expect(t).toEqual({ bad: 1, warn: 2, frozen: 0, none: 1, ok: 1 })
	})

	it('worstTone picks the most urgent tone', () => {
		expect(worstTone(['ok', 'none', 'warn'])).toBe('warn')
		expect(worstTone(['ok', 'bad'])).toBe('bad')
		expect(worstTone([])).toBe('none')
	})
})

describe('buildFlows', () => {
	it('skips keys the snapshot does not carry, and drops a flow with no queue left', () => {
		const flows = buildFlows(realSnapshot())
		const demand = flows.find(f => f.title === '회원 수요 가사')!
		// lyrics_album_tracks is not in the trimmed fixture.
		expect(demand.steps.map(s => (s.kind === 'queue' ? s.queue.key : s.job.key))).toEqual([
			'lyrics_demand_source',
			'lyrics_album_jobs',
			'gpt-translate-poller',
			'lyrics_translation_work:chatgpt/lyrics-ko-v1',
		])
		expect(flows.map(f => f.title)).not.toContain('디스코그래피 열거')
		expect(flows.map(f => f.title)).not.toContain('요청형 (사이트 버튼 → Mac 폴러)')
	})

	it('shows a queue no flow names under 그 밖의 대기열 instead of hiding it', () => {
		const snap = realSnapshot()
		snap.queues.push({ ...snap.queues[0], key: 'brand_new_queue', label: 'Brand new' })
		const flows = buildFlows(snap)
		const rest = flows.at(-1)!
		expect(rest.title).toBe('그 밖의 대기열')
		expect(rest.steps.map(s => s.kind === 'queue' && s.queue.key)).toEqual(['brand_new_queue'])
	})

	it('places every snapshot queue in some flow', () => {
		const snap = realSnapshot()
		const placed = buildFlows(snap).flatMap(f => f.steps.flatMap(s => (s.kind === 'queue' ? [s.queue.key] : [])))
		expect(new Set(placed)).toEqual(new Set(snap.queues.map(q => q.key)))
	})
})

describe('2f detail helpers', () => {
	const now = Date.parse('2026-10-12T14:20:00Z')

	it('untilText: future spans, and 지남 once passed', () => {
		expect(untilText('2026-10-12T14:50:00Z', now)).toBe('30분 뒤')
		expect(untilText('2026-10-12T22:37:25Z', now)).toBe('8시간 뒤')
		expect(untilText('2026-10-16T14:20:00Z', now)).toBe('4일 뒤')
		expect(untilText('2026-10-05T04:02:02Z', now)).toBe('지남')
		expect(untilText(null, now)).toBeNull()
		expect(untilText('garbage', now)).toBeNull()
	})

	it('flowSentence: no direction claimed when either side is unmeasured', () => {
		expect(flowSentence(null, 285)).toContain('판단하지 않습니다')
		expect(flowSentence(14, null)).toContain('판단하지 않습니다')
		expect(flowSentence(0, 0)).toContain('없습니다')
		expect(flowSentence(14, 19)).toContain('줄고 있습니다')
		expect(flowSentence(19, 14)).toContain('늘고 있습니다')
		expect(flowSentence(5, 5)).toBe('들어온 만큼 나갔습니다.')
	})

	it('reasonName: Korean for known codes, the code itself otherwise, and null is said aloud', () => {
		expect(reasonName('album_not_in_catalog')).toBe('카탈로그에 없는 앨범')
		expect(reasonName('brand_new_code')).toBe('brand_new_code')
		expect(reasonName('unrecognized')).toContain('본문은 표시하지 않음')
		expect(reasonName(null)).toBe('사유 기록 없음')
	})
})
