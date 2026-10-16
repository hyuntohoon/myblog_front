// FEAT-automation-admin 3c — "지금 실행", rendered.
//
// What these pin: a confirmation before anything is sent; one fresh request_id
// per confirmation and the SAME id on the only retry (after an unknown outcome);
// no button while paused, unread or cooling down; a 409 is final and worded by
// its code; the worker's stamps read in order, and a stalled run is never
// "running"; the POST's answer shows in every copy until the snapshot catches up.
import type { AutomationJob, RunResult, RunState } from './automation.api'
import type { PostedRuns } from './AutomationRun'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { job } from './automation.fixture'
import { runStatus } from './automationView'

const api = vi.hoisted(() => ({ postAutomationRun: vi.fn(), postAutomationControl: vi.fn() }))
vi.mock('./automation.api', () => api)

const { JobRun, effectiveRun, runFailure } = await import('./AutomationRun')

const NOW = Date.parse('2026-10-16T05:00:00Z')
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const NEVER: RunState = { status: 'ok', last: null, cooldown_until: null, stalled: false }

function cron(run: RunState | null = NEVER, over: Partial<AutomationJob> = {}): AutomationJob {
	return job({ key: 'album_ingest', name: 'Album catalog ingest', controls: ['pause', 'run'], run, ...over })
}

function last(over: Partial<NonNullable<RunState['last']>> = {}, state: Partial<RunState> = {}): RunState {
	return {
		status: 'ok',
		stalled: false,
		cooldown_until: null,
		last: { request_id: 'r', outcome: 'invoked', requested_at: ago(3), ...over },
		...state,
	}
}

function ok(outcome: 'invoked' | 'invoke_failed' = 'invoked', replayed = false): RunResult {
	return {
		kind: 'ok',
		result: {
			request_id: 'x',
job_key: 'album_ingest',
outcome,
replayed,
			run: last({ request_id: 'x', outcome, requested_at: new Date(NOW).toISOString() }, { cooldown_until: outcome === 'invoked' ? new Date(NOW + 600_000).toISOString() : null }),
		},
	}
}

function Harness({ job: j, paused = false, copies = 1, onChanged = () => {} }: { job: AutomationJob, paused?: boolean | null, copies?: number, onChanged?: () => void }) {
	const [posted, setPosted] = useState<PostedRuns>(() => new Map())
	const onPosted = (key: string, run: RunState, basis: AutomationJob['run']) => setPosted(m => new Map(m).set(key, { run, basis }))
	return (
		<>
			{Array.from({ length: copies }, (_, i) => (
				<div key={i} data-copy={i}>
					<JobRun job={j} run={effectiveRun(j, posted)} paused={paused} now={NOW} onPosted={onPosted} onChanged={onChanged} />
				</div>
			))}
		</>
	)
}

beforeEach(() => {
	vi.clearAllMocks()
})

function click(name: string) {
	fireEvent.click(screen.getByRole('button', { name }))
}

describe('jobRun', () => {
	it('renders nothing for a job without the run control', () => {
		const { container } = render(<Harness job={job({ key: 'gpt-translate-poller', controls: ['pause'] })} />)
		expect(container.innerHTML).toBe('<div data-copy="0"></div>')
	})

	it('confirms before sending, posts once with a fresh uuid, and re-reads', async () => {
		const onChanged = vi.fn()
		api.postAutomationRun.mockResolvedValue(ok())
		render(<Harness job={cron()} onChanged={onChanged} />)
		click('지금 실행')
		expect(api.postAutomationRun).not.toHaveBeenCalled()
		expect(screen.getByText(/10분 동안은 다시 누를 수 없습니다/)).toBeTruthy()
		click('지금 실행 확인')
		expect(await screen.findByRole('status')).toHaveTextContent('실행을 시작했습니다.')
		expect(api.postAutomationRun).toHaveBeenCalledTimes(1)
		const [key, id] = api.postAutomationRun.mock.calls[0]
		expect(key).toBe('album_ingest')
		expect(id).toMatch(UUID)
		expect(onChanged).toHaveBeenCalledTimes(1)
	})

	it('cancel sends nothing', () => {
		render(<Harness job={cron()} />)
		click('지금 실행')
		click('취소')
		expect(api.postAutomationRun).not.toHaveBeenCalled()
		expect(screen.getByRole('button', { name: '지금 실행' })).toBeTruthy()
	})

	it('shows the POST answer in every copy, so the button disappears for the cooldown everywhere', async () => {
		api.postAutomationRun.mockResolvedValue(ok())
		render(<Harness job={cron()} copies={2} />)
		fireEvent.click(screen.getAllByRole('button', { name: '지금 실행' })[0])
		click('지금 실행 확인')
		await screen.findByRole('status')
		expect(screen.queryAllByRole('button', { name: '지금 실행' })).toHaveLength(0)
		expect(screen.getAllByText(/10분에 한 번만/)).toHaveLength(2)
	})

	it('an unknown outcome offers one retry with the SAME id; each confirmation mints a new one', async () => {
		api.postAutomationRun.mockResolvedValueOnce({ kind: 'error', status: 503 }).mockResolvedValueOnce(ok(undefined, true))
		render(<Harness job={cron()} />)
		click('지금 실행')
		click('지금 실행 확인')
		expect(await screen.findByRole('alert')).toHaveTextContent('두 번 실행되지 않습니다')
		click('같은 요청(지금 실행) 다시 보내기')
		expect(await screen.findByRole('status')).toHaveTextContent('이미 처리돼')
		const [[, first], [, second]] = api.postAutomationRun.mock.calls
		expect(second).toBe(first)
	})

	it('a fresh confirmation after closing a failure gets a new id', async () => {
		api.postAutomationRun.mockResolvedValue({ kind: 'error', status: null })
		render(<Harness job={cron()} />)
		click('지금 실행')
		click('지금 실행 확인')
		await screen.findByRole('alert')
		click('닫고 현황 다시 읽기')
		click('지금 실행')
		click('지금 실행 확인')
		await screen.findByRole('alert')
		const [[, a], [, b]] = api.postAutomationRun.mock.calls
		expect(a).not.toBe(b)
	})

	it.each([
		[{ kind: 'rejected', rejection: { code: 'job_paused' } }, '먼저 재개하세요'],
		[{ kind: 'rejected', rejection: { code: 'cooldown', cooldown_until: '2026-10-16T05:07:00Z', retry_after_seconds: 420 } }, '14:07 이후'],
		[{ kind: 'rejected', rejection: { code: 'request_id_conflict' } }, '다른 동작에 쓰였습니다'],
		[{ kind: 'forbidden' }, '오너 계정만'],
		[{ kind: 'unknown_job' }, '지금 실행 기능이 없습니다'],
		[{ kind: 'error', status: 401 }, '실행되지 않았습니다'],
	] as const)('a refusal is final and never offered as retryable: %o', async (r, text) => {
		api.postAutomationRun.mockResolvedValue(r)
		render(<Harness job={cron()} />)
		click('지금 실행')
		click('지금 실행 확인')
		expect(await screen.findByRole('alert')).toHaveTextContent(text)
		expect(screen.queryByRole('button', { name: /같은 요청/ })).toBeNull()
		expect(runFailure(r as Exclude<RunResult, { kind: 'ok' }>).resend).toBe(false)
	})

	it('a failed invoke is reported and the button stays available', async () => {
		api.postAutomationRun.mockResolvedValue(ok('invoke_failed'))
		render(<Harness job={cron()} />)
		click('지금 실행')
		click('지금 실행 확인')
		expect(await screen.findByRole('status')).toHaveTextContent('시작되지 않았습니다. 다시 눌러도 됩니다.')
		expect(screen.getByRole('button', { name: '지금 실행' })).toBeTruthy()
	})

	it.each([
		[true, '일시정지 중에는'],
		[null, '일시정지 상태를 읽지 못해'],
	])('no button when paused=%s', (paused, text) => {
		render(<Harness job={cron()} paused={paused} />)
		expect(screen.queryByRole('button', { name: '지금 실행' })).toBeNull()
		expect(screen.getByText(new RegExp(text))).toBeTruthy()
	})

	it('no button while cooling down, with when it frees up', () => {
		render(<Harness job={cron(last({}, { cooldown_until: new Date(NOW + 7 * 60_000).toISOString() }))} />)
		expect(screen.queryByRole('button', { name: '지금 실행' })).toBeNull()
		expect(screen.getByText(/7분 뒤 가능/)).toBeTruthy()
	})

	it('the success note goes once a newer run is the last one shown', async () => {
		// Found in the real-browser clickthrough: "호출 실패" sat beside a later "실행 중".
		api.postAutomationRun.mockResolvedValue(ok('invoke_failed'))
		const { rerender } = render(<Harness job={cron()} />)
		click('지금 실행')
		click('지금 실행 확인')
		expect(await screen.findByRole('status')).toHaveTextContent('시작되지 않았습니다')
		// The re-read snapshot still has our row as the last one: the note stays.
		rerender(<Harness job={cron(last({ request_id: 'x', outcome: 'invoke_failed' }))} />)
		expect(screen.getByRole('status')).toHaveTextContent('시작되지 않았습니다')
		// A newer run arrives: the note answers a request that is no longer the last.
		rerender(<Harness job={cron(last({ request_id: 'newer', started_at: ago(0) }))} />)
		expect(screen.queryByRole('status')).toBeNull()
		expect(screen.getByText(/실행 중/)).toBeTruthy()
	})

	it('a stale failure panel goes when a newer snapshot arrives', async () => {
		api.postAutomationRun.mockResolvedValue({ kind: 'error', status: 502 })
		const { rerender } = render(<Harness job={cron()} />)
		click('지금 실행')
		click('지금 실행 확인')
		await screen.findByRole('alert')
		rerender(<Harness job={cron(last())} />)
		expect(screen.queryByRole('alert')).toBeNull()
	})
})

describe('runStatus', () => {
	it.each<[string, RunState, RegExp, string]>([
		['never run', NEVER, /^$/, 'none'],
		['requested only', last({ outcome: 'requested' }), /호출 결과를 모릅니다/, 'warn'],
		['invoked, not started', last(), /워커가 아직 시작하지 않았습니다/, 'warn'],
		['invoke failed', last({ outcome: 'invoke_failed' }), /호출 실패/, 'bad'],
		['running', last({ started_at: ago(2) }), /실행 중/, 'warn'],
		['stalled', last({ started_at: ago(30) }, { stalled: true }), /시간 초과 가능/, 'bad'],
		['done', last({ started_at: ago(2), finished_at: ago(1), run_outcome: 'ok' }), /완료/, 'ok'],
		['error', last({ started_at: ago(2), finished_at: ago(1), run_outcome: 'error' }), /오류로 끝남/, 'bad'],
		['skipped', last({ started_at: ago(2), finished_at: ago(2), run_outcome: 'skipped_paused' }), /건너뜀/, 'warn'],
	])('%s', (_, run, text, tone) => {
		const s = runStatus(run, false, NOW)
		expect(s.text ?? '').toMatch(text)
		expect(s.tone).toBe(tone)
	})

	it('a stalled run never reads as running', () => {
		expect(runStatus(last({ started_at: ago(30) }, { stalled: true }), false, NOW).text).not.toMatch(/실행 중/)
	})

	it('an unread run state blocks the button and is not "never run"', () => {
		const s = runStatus({ status: 'unknown', last: null, cooldown_until: null, stalled: false }, false, NOW)
		expect(s.blocked).toBeTruthy()
		expect(s.text).toMatch(/읽지 못했습니다/)
		expect(runStatus(null, false, NOW).blocked).toBeTruthy()
	})

	it('a past cooldown does not block', () => {
		expect(runStatus(last({}, { cooldown_until: ago(1) }), false, NOW).blocked).toBeNull()
	})
})
