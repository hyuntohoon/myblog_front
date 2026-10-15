// FEAT-automation-admin 3b — pause / resume, rendered.
//
// What these pin: a retry after an unknown outcome resends the SAME
// request_id (the server's replay is what makes it safe), each confirmation
// mints a fresh one, an unread state offers no action and is never worded as
// running, and a refusal (403/404/409) is not offered as retryable.
import type { AutomationJob, ControlResult } from './automation.api'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { job } from './automation.fixture'
import { controlStatus } from './automationView'

const api = vi.hoisted(() => ({ postAutomationControl: vi.fn() }))
vi.mock('./automation.api', () => api)

const { JobControl, confirmText } = await import('./AutomationControl')

const NOW = Date.parse('2026-10-16T00:00:00Z')
function cron(over: Partial<AutomationJob> = {}) {
  return job({ key: 'release_upcoming_poll', name: 'Upcoming releases', controls: ['pause'], control: { paused: false, confirmed: false, confirmation_overdue: false }, ...over })
}

function ok(action: 'pause' | 'resume', outcome: 'applied' | 'no_change' = 'applied', replayed = false): ControlResult {
	return { kind: 'ok', result: { job_key: 'release_upcoming_poll', action, outcome, replayed, request_id: 'x', control: { paused: action === 'pause', confirmed: false, confirmation_overdue: false } } }
}

beforeEach(() => {
	vi.clearAllMocks()
})

function open(name: string) {
	fireEvent.click(screen.getByRole('button', { name }))
}

describe('jobControl', () => {
	it('renders nothing for a job without the pause control', () => {
		const { container } = render(<JobControl job={job({ key: 'verifier_drift' })} now={NOW} onChanged={() => {}} />)
		expect(container.innerHTML).toBe('')
	})

	it('confirms before acting, then posts once and re-reads', async () => {
		const onChanged = vi.fn()
		api.postAutomationControl.mockResolvedValue(ok('pause'))
		render(<JobControl job={cron()} now={NOW} onChanged={onChanged} />)
		expect(screen.getByText('일시정지 안 함')).toBeTruthy()
		open('일시정지')
		expect(api.postAutomationControl).not.toHaveBeenCalled()
		expect(screen.getByText(/SQS 메시지\)은 멈추지 않습니다/)).toBeTruthy()
		open('일시정지 확인')
		expect(await screen.findByRole('status')).toHaveTextContent('일시정지했습니다.')
		expect(api.postAutomationControl).toHaveBeenCalledTimes(1)
		const [key, action, id] = api.postAutomationControl.mock.calls[0]
		expect([key, action]).toEqual(['release_upcoming_poll', 'pause'])
		expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
		expect(onChanged).toHaveBeenCalledTimes(1)
	})

	it('resends the SAME request_id after an unknown outcome', async () => {
		api.postAutomationControl.mockResolvedValueOnce({ kind: 'error', status: 503 }).mockResolvedValueOnce(ok('pause', 'applied', true))
		render(<JobControl job={cron()} now={NOW} onChanged={() => {}} />)
		open('일시정지')
		open('일시정지 확인')
		expect(await screen.findByRole('alert')).toHaveTextContent('이미 적용됐을 수도 있습니다')
		open('같은 요청 다시 보내기')
		expect(await screen.findByRole('status')).toHaveTextContent('이미 처리돼')
		const ids = api.postAutomationControl.mock.calls.map(c => c[2])
		expect(ids).toHaveLength(2)
		expect(ids[1]).toBe(ids[0])
	})

	it('mints a new request_id for each confirmation', async () => {
		api.postAutomationControl.mockResolvedValue(ok('pause'))
		render(<JobControl job={cron()} now={NOW} onChanged={() => {}} />)
		open('일시정지')
		open('일시정지 확인')
		await screen.findByRole('status')
		open('재개')
		open('재개 확인')
		await waitFor(() => expect(api.postAutomationControl).toHaveBeenCalledTimes(2))
		const [a, b] = api.postAutomationControl.mock.calls.map(c => c[2])
		expect(a).not.toBe(b)
	})

	it('shows the POST result until the re-read snapshot arrives, then the snapshot wins', async () => {
		api.postAutomationControl.mockResolvedValue(ok('pause'))
		const { rerender } = render(<JobControl job={cron()} now={NOW} onChanged={() => {}} />)
		open('일시정지')
		open('일시정지 확인')
		await screen.findByRole('status')
		// Same snapshot still on screen: the POST's control is shown, so no stale 일시정지 button.
		expect(screen.getByText(/일시정지됨/)).toBeTruthy()
		expect(screen.getByRole('button', { name: '재개' })).toBeTruthy()
		// A new snapshot (new control object) replaces it, whatever it says.
		rerender(<JobControl job={cron({ control: { paused: false, confirmed: false, confirmation_overdue: false } })} now={NOW} onChanged={() => {}} />)
		expect(screen.getByText('일시정지 안 함')).toBeTruthy()
	})

	it('cancel sends nothing', () => {
		render(<JobControl job={cron()} now={NOW} onChanged={() => {}} />)
		open('일시정지')
		open('취소')
		expect(api.postAutomationControl).not.toHaveBeenCalled()
		expect(screen.getByRole('button', { name: '일시정지' })).toBeTruthy()
	})

	it.each([
		[{ kind: 'forbidden' } as ControlResult, '403'],
		[{ kind: 'rejected', status: 404 } as ControlResult, '404'],
		[{ kind: 'rejected', status: 409 } as ControlResult, '409'],
	])('a refusal is not offered as retryable (%#)', async (result, code) => {
		api.postAutomationControl.mockResolvedValue(result)
		render(<JobControl job={cron()} now={NOW} onChanged={() => {}} />)
		open('일시정지')
		open('일시정지 확인')
		expect(await screen.findByRole('alert')).toHaveTextContent(code)
		expect(screen.queryByRole('button', { name: '같은 요청 다시 보내기' })).toBeNull()
	})

	it('offers no action when the state was not read', () => {
		render(<JobControl job={cron({ control: { paused: null, confirmed: false, confirmation_overdue: false } })} now={NOW} onChanged={() => {}} />)
		expect(screen.getByText(/읽지 못했습니다/)).toBeTruthy()
		expect(screen.queryByRole('button')).toBeNull()
	})

	it('a paused job offers resume', () => {
		render(<JobControl job={cron({ control: { paused: true, changed_at: '2026-10-15T23:00:00Z', honored_at: '2026-10-15T23:50:00Z', confirmed: true, confirmation_overdue: false } })} now={NOW} onChanged={() => {}} />)
		expect(screen.getByText(/실행기가 확인함 \(마지막 건너뜀 10분 전\)/)).toBeTruthy()
		expect(screen.getByRole('button', { name: '재개' })).toBeTruthy()
	})
})

describe('confirmText', () => {
	it('says what each executor does', () => {
		expect(confirmText(job({ key: 'gpt-translate-poller', group: 'local_agent' }), 'pause')).toMatch(/진행 중인 건은 끝까지 저장/)
		// lyrics_incremental's self-enqueued SQS run honours the pause too (3b design).
		expect(confirmText(job({ key: 'lyrics_incremental' }), 'pause')).toMatch(/자동으로 들어오는 실행도 건너뜁니다/)
		expect(confirmText(job({ key: 'lyrics_incremental' }), 'pause')).not.toMatch(/멈추지 않습니다/)
		expect(confirmText(cron(), 'resume')).toMatch(/다시 돕니다/)
	})
})

describe('controlStatus', () => {
	const paused = { paused: true, changed_at: '2026-10-15T23:30:00Z', honored_at: null, confirmed: false, confirmation_overdue: false }
	it('not yet confirmed within the interval is expected, not a fault', () => {
		expect(controlStatus(paused, NOW, null)).toMatchObject({ tone: 'warn', paused: true })
	})
	it('overdue confirmation is bad', () => {
		expect(controlStatus({ ...paused, confirmation_overdue: true }, NOW, null)).toMatchObject({ tone: 'bad' })
	})
	it('a local agent with its switch off can never confirm, and says why', () => {
		const beat = { agent_key: 'gpt-translate-poller', age_seconds: 1, catalogued: true, enabled: false, observed_at: '2026-10-15T23:59:00Z' }
		expect(controlStatus({ ...paused, confirmation_overdue: true }, NOW, beat).text).toMatch(/로컬 스위치가 꺼져/)
	})
	it('an unread state is unknown, never running', () => {
		expect(controlStatus(null, NOW, null)).toMatchObject({ paused: null, tone: 'none' })
		expect(controlStatus({ paused: null, confirmed: false, confirmation_overdue: false }, NOW, null).text).toMatch(/실행 중이라는 뜻이 아닙니다/)
	})
})
