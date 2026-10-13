// FEAT-automation-admin 2c — the owner's automation page, rendered.
//
// What these pin: every load outcome has its own screen (403 is real — the
// server is the boundary, not the guard), unknown is never worded as healthy,
// a failed queue read never looks like an empty one, and agent-written text is
// text (2b security-review).
import type { QueueDetailResult, SnapshotResult } from './automation.api'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { awsSnapshot, realDetails, realSnapshot } from './automation.fixture'

const api = vi.hoisted(() => ({ fetchAutomationSnapshot: vi.fn(), fetchQueueDetail: vi.fn() }))
const auth = vi.hoisted(() => ({ isLoggedIn: vi.fn(() => true) }))

vi.mock('./automation.api', () => api)
vi.mock('@lib/auth', () => auth)

const { default: AutomationBoard } = await import('./AutomationBoard')

function serve(result: SnapshotResult) {
	api.fetchAutomationSnapshot.mockResolvedValue(result)
}

function serveDetails(details = realDetails()) {
	api.fetchQueueDetail.mockImplementation(async (key: string): Promise<QueueDetailResult> =>
		details[key] ? { kind: 'ok', detail: details[key] } : { kind: 'error', status: 404 })
}

beforeEach(() => {
	vi.clearAllMocks()
	auth.isLoggedIn.mockReturnValue(true)
	serveDetails()
})

describe('load outcomes', () => {
	it('shows a 403 state for a signed-in non-owner, with no snapshot content', async () => {
		serve({ kind: 'forbidden' })
		render(<AutomationBoard />)
		expect(await screen.findByRole('alert')).toHaveTextContent('오너 계정만')
		expect(screen.queryByText('DB 대기열')).toBeNull()
	})

	it('shows the HTTP status on an error, and says empty is not "no jobs"', async () => {
		serve({ kind: 'error', status: 502 })
		render(<AutomationBoard />)
		const alert = await screen.findByRole('alert')
		expect(alert).toHaveTextContent('HTTP 502')
		expect(alert).toHaveTextContent('작업이 없다는 뜻이 아닙니다')
		expect(screen.getByRole('button', { name: '다시 읽기' })).toBeTruthy()
	})

	it('does not fetch when logged out (the page guard owns the login redirect)', async () => {
		auth.isLoggedIn.mockReturnValue(false)
		serve({ kind: 'ok', snapshot: realSnapshot() })
		render(<AutomationBoard />)
		await Promise.resolve()
		expect(api.fetchAutomationSnapshot).not.toHaveBeenCalled()
	})
})

describe('the snapshot', () => {
	beforeEach(() => {
		try {
			localStorage.clear()
		}
		catch { /* jsdom without storage */ }
	})

	it('summarises the queues by verdict and states how many jobs have evidence', async () => {
		serve({ kind: 'ok', snapshot: realSnapshot() })
		const { container } = render(<AutomationBoard />)
		expect(await screen.findByText(/^대기열 5개/)).toHaveTextContent('대기열 5개: 손볼 것 1 · 지켜볼 것 2 · 볼 수 없음 1 · 문제 없음 1')
		expect(screen.getByText(/실행 신호가 확인된 작업은/)).toHaveTextContent('작업 4개 가운데 실행 신호가 확인된 작업은 0개입니다.')
		expect(container.textContent).not.toMatch(/정상 작동|healthy|막힘|stuck/i)
	})

	it('opens on the most urgent queue: the legacy claude queue with 70 expired leases', async () => {
		serve({ kind: 'ok', snapshot: realSnapshot() })
		const { container } = render(<AutomationBoard />)
		await screen.findByText(/^대기열 5개/)
		const detail = container.querySelector('[data-detail]')!
		expect(detail.getAttribute('data-detail')).toBe('lyrics_translation_work:claude.sonnet/v2')
		expect(detail).toHaveTextContent('멈춘 실행 70')
		expect(detail).toHaveTextContent('동결')
		expect(container.querySelector('button[data-queue="lyrics_translation_work:claude.sonnet/v2"]')!.getAttribute('aria-current')).toBe('true')
	})

	it('a flow node opens that queue in the detail panel', async () => {
		serve({ kind: 'ok', snapshot: realSnapshot() })
		const { container } = render(<AutomationBoard />)
		await screen.findByText(/^대기열 5개/)
		const node = container.querySelector<HTMLButtonElement>('button[data-queue="lyrics_album_jobs"]')!
		expect(node).toHaveTextContent('854')
		expect(node).toHaveTextContent('1일 넘게 대기')
		fireEvent.click(node)
		const detail = container.querySelector('[data-detail]')!
		expect(detail.getAttribute('data-detail')).toBe('lyrics_album_jobs')
		expect(detail).toHaveTextContent('왜 기다리는지와 최근 24시간 흐름은 상세에서 봅니다')
		expect(node.getAttribute('aria-current')).toBe('true')
	})

	it('the table view lists every queue, and a row opens the same detail panel', async () => {
		serve({ kind: 'ok', snapshot: realSnapshot() })
		const { container } = render(<AutomationBoard />)
		await screen.findByText(/^대기열 5개/)
		fireEvent.click(screen.getByRole('button', { name: '표' }))
		expect(screen.getByRole('button', { name: '표' }).getAttribute('aria-pressed')).toBe('true')
		const rows = container.querySelectorAll('tbody tr[data-queue]')
		expect([...rows].map(r => r.getAttribute('data-queue'))).toEqual(realSnapshot().queues.map(q => q.key))
		fireEvent.click(within(rows[2] as HTMLElement).getByRole('button'))
		expect(container.querySelector('[data-detail]')!.getAttribute('data-detail')).toBe('lyrics_translation_work:chatgpt/lyrics-ko-v1')
	})

	it('renders a failed queue read as 읽기 실패 and an empty table as 행 없음 — not alike', async () => {
		const snap = realSnapshot()
		snap.queues[0] = { ...snap.queues[0], counts: null, status: 'unknown' }
		serve({ kind: 'ok', snapshot: snap })
		const { container } = render(<AutomationBoard />)
		await screen.findByText(/^대기열 5개/)
		const failed = container.querySelector('button[data-queue="lyrics_album_jobs"]')!
		const empty = container.querySelector('button[data-queue="lyrics_translation_work:chatgpt/genius-ko-v1"]')!
		expect(failed).toHaveTextContent('읽기 실패')
		expect(failed).not.toHaveTextContent('행 없음')
		expect(empty).toHaveTextContent('행 없음')
		expect(empty).not.toHaveTextContent('읽기 실패')
	})

	it('keeps ineligible rows out of the waiting count, and names them in the detail', async () => {
		serve({ kind: 'ok', snapshot: realSnapshot() })
		const { container } = render(<AutomationBoard />)
		await screen.findByText(/^대기열 5개/)
		const node = container.querySelector<HTMLButtonElement>('button[data-queue="track_genius_annotations"]')!
		expect(node.querySelector('.auto-node-big')).toHaveTextContent('0')
		fireEvent.click(node)
		expect(container.querySelector('[data-detail]')).toHaveTextContent('pending_ineligible (처리 불가)12')
	})

	it('shows a queue the flows do not know under 그 밖의 대기열', async () => {
		const snap = realSnapshot()
		snap.queues.push({ ...snap.queues[2], key: 'brand_new_queue', label: 'Brand new queue' })
		serve({ kind: 'ok', snapshot: snap })
		render(<AutomationBoard />)
		const section = await screen.findByRole('region', { name: '그 밖의 대기열' })
		expect(section).toHaveTextContent('Brand new queue')
	})

	it('job rows keep liveness and the inventory apart, and their queue link opens the detail', async () => {
		serve({ kind: 'ok', snapshot: realSnapshot() })
		const { container } = render(<AutomationBoard />)
		await screen.findByText(/^대기열 5개/)
		const rows = container.querySelectorAll('.auto-job')
		expect(rows).toHaveLength(4)
		for (const row of rows) {
			expect(row.className).toContain('auto-job--unknown')
			expect(row.querySelector('.auto-live-label')).toHaveTextContent('증거 없음')
		}
		const gpt = container.querySelector('[data-job="gpt-translate-poller"]')!
		expect(gpt.querySelector('.auto-declared')).toHaveTextContent('인벤토리가동')
		expect(gpt.querySelector('.auto-live')).toHaveTextContent('증거 없음')
		fireEvent.click(within(gpt as HTMLElement).getByRole('button', { name: 'GPT lyrics translation' }))
		expect(container.querySelector('[data-detail]')!.getAttribute('data-detail')).toBe('lyrics_translation_work:chatgpt/lyrics-ko-v1')
	})

	it('groups jobs by where they run', async () => {
		serve({ kind: 'ok', snapshot: realSnapshot() })
		render(<AutomationBoard />)
		await screen.findByText(/^대기열 5개/)
		const headings = screen.getAllByRole('heading', { level: 3 }).filter(h => h.classList.contains('auto-h3')).map(h => h.textContent)
		expect(headings).toEqual(['AWS2', '오너 Mac1', 'GitHub1'])
	})

	it('says AWS is not wired yet', async () => {
		serve({ kind: 'ok', snapshot: realSnapshot() })
		render(<AutomationBoard />)
		expect(await screen.findByText('아직 연결 안 됨')).toBeTruthy()
	})

	it('explains an empty heartbeat table instead of rendering nothing', async () => {
		serve({ kind: 'ok', snapshot: realSnapshot() })
		render(<AutomationBoard />)
		expect(await screen.findByText(/아직 하트비트를 기록한 로컬 에이전트가 없습니다/)).toBeTruthy()
	})
})

describe('aws evidence (2d)', () => {
	beforeEach(() => {
		try {
			localStorage.clear()
		}
		catch { /* jsdom without storage */ }
	})

	it('says plainly when no AWS reader is wired, instead of an empty panel', async () => {
		serve({ kind: 'ok', snapshot: realSnapshot() })
		render(<AutomationBoard />)
		expect(await screen.findByText(/AWS를 읽는 경로가 연결되지 않았습니다/)).toBeTruthy()
	})

	it('renders queue depth, Lambda counts and the alarm summary AWS reported', async () => {
		serve({ kind: 'ok', snapshot: awsSnapshot() })
		const { container } = render(<AutomationBoard />)
		await screen.findByRole('heading', { name: 'AWS 상태' })
		expect(container.querySelector('[data-aws-queue="blogSQS"]')).toHaveTextContent('대기 0 · 처리 중 0 · 지연 0')
		expect(container.querySelector('[data-aws-queue="worker-cron-dlq"]')).toHaveTextContent('DLQ')
		expect(container.querySelector('[data-aws-function="blogWorkerLambda"]')).toHaveTextContent('호출 590 · 오류 0 · 스로틀 0')
		expect(container.querySelector('[data-aws-alarms]')).toHaveTextContent('OK 3 · 경보 0')
	})

	it('shows an unread queue as ? and 읽지 못함, never as 0', async () => {
		const snap = awsSnapshot()
		snap.aws!.queues[0] = { ...snap.aws!.queues[0], status: 'unknown', observed_at: null, visible: null, in_flight: null, delayed: null }
		serve({ kind: 'ok', snapshot: snap })
		const { container } = render(<AutomationBoard />)
		await screen.findByRole('heading', { name: 'AWS 상태' })
		const row = container.querySelector('[data-aws-queue="blogSQS"]')!
		expect(row).toHaveTextContent('대기 ? · 처리 중 ? · 지연 ?')
		expect(row).toHaveTextContent('읽지 못함')
		expect(row.classList.contains('auto-aws-item--unknown')).toBe(true)
	})

	it('names a firing alarm and counts unread alarms apart from OK', async () => {
		const snap = awsSnapshot()
		snap.aws!.alarms[1] = { ...snap.aws!.alarms[1], state: 'ALARM' }
		snap.aws!.alarms[2] = { ...snap.aws!.alarms[2], status: 'unknown', observed_at: null, state: null }
		serve({ kind: 'ok', snapshot: snap })
		const { container } = render(<AutomationBoard />)
		await screen.findByRole('heading', { name: 'AWS 상태' })
		expect(container.querySelector('[data-aws-alarms]')).toHaveTextContent('OK 1 · 경보 1 · 읽지 못함 1')
		expect(screen.getByText('blogWorkerLambda-errors')).toBeTruthy()
	})

	it('labels a failing rule and leads the tally with it', async () => {
		const snap = awsSnapshot()
		snap.jobs = snap.jobs.map(j => j.key === 'lyrics_demand_source' ? { ...j, liveness: { status: 'failing', observed_at: null, age_seconds: null, reason: 'AWS reports failed deliveries: 95 delivered, 1 failed in 24 h; alarm OK.' } } : j)
		serve({ kind: 'ok', snapshot: snap })
		const { container } = render(<AutomationBoard />)
		await screen.findByRole('heading', { name: 'AWS 상태' })
		expect(container.querySelector('.auto-tally-line')).toHaveTextContent('실패 보고 1 · 증거 없음 3')
		const row = container.querySelector('[data-job="lyrics_demand_source"]')!
		expect(row).toHaveTextContent('실패 보고')
		expect(row.classList.contains('auto-job--failing')).toBe(true)
	})

	it('counts a fresh AWS rule as evidence in the header', async () => {
		serve({ kind: 'ok', snapshot: awsSnapshot() })
		render(<AutomationBoard />)
		expect(await screen.findByText(/실행 신호가 확인된 작업은/)).toHaveTextContent('작업 4개 가운데 실행 신호가 확인된 작업은 1개입니다. 최근 확인 1 · 증거 없음 3')
	})
})

describe('queue detail (2f)', () => {
	const CLAUDE = 'lyrics_translation_work:claude.sonnet/v2'

	async function open(container: HTMLElement, key: string) {
		await screen.findByText(/^대기열 5개/)
		fireEvent.click(container.querySelector<HTMLButtonElement>(`button[data-queue="${key}"]`)!)
		return container.querySelector('[data-detail]')! as HTMLElement
	}

	it('fetches the selected queue and shows why its rows wait, by reason code', async () => {
		serve({ kind: 'ok', snapshot: realSnapshot() })
		const { container } = render(<AutomationBoard />)
		await screen.findByText(/^대기열 5개/)
		await waitFor(() => expect(api.fetchQueueDetail).toHaveBeenCalledWith(CLAUDE, expect.any(AbortSignal)))
		const detail = container.querySelector('[data-detail]')! as HTMLElement
		const reasons = await within(detail).findByText('기다리는 이유')
		const sec = reasons.parentElement!
		// Waiting states only up top; the running rows' reason sits under 다른 상태.
		const top = sec.querySelector(':scope > .auto-reasons')!
		expect(top.querySelectorAll('li')).toHaveLength(1)
		expect(top).toHaveTextContent('엔진 검증 실패engine_validationretryable_error169')
		expect(sec.querySelector('.auto-reasons-other')).toHaveTextContent('running')
		// The oldest rows carry title, attempts and an overdue next attempt.
		expect(detail).toHaveTextContent('limelight')
		expect(detail).toHaveTextContent('시도 17회')
		expect(detail).toHaveTextContent('다음 시도 지남')
		expect(container.querySelector('.auto-d-next')).toBeNull()
	})

	it('says when every waiting row is backing off, and which way the queue moves', async () => {
		serve({ kind: 'ok', snapshot: realSnapshot() })
		const { container } = render(<AutomationBoard />)
		const detail = await open(container, 'lyrics_album_jobs')
		expect(await within(detail).findAllByText('카탈로그에 없는 앨범')).not.toHaveLength(0)
		expect(detail).toHaveTextContent('모두 재시도 시각 전')
		expect(detail).toHaveTextContent('나간 행이 들어온 행보다 많습니다. 이 기준으로는 줄고 있습니다.')
		expect(detail).toHaveTextContent('Approximate:')
		// No title → the provider id is the label; next attempt is in the future.
		expect(detail).toHaveTextContent('0f3AAclv8NgV0jXxYz1234')
		expect(detail).toHaveTextContent(/다음 시도 \d+시간 뒤/)
	})

	it('renders an unmeasurable flow as 측정 불가, never 0', async () => {
		const details = realDetails()
		details.lyrics_album_jobs = { ...details.lyrics_album_jobs, flow: { ...details.lyrics_album_jobs.flow!, entered: null } }
		serveDetails(details)
		serve({ kind: 'ok', snapshot: realSnapshot() })
		const { container } = render(<AutomationBoard />)
		const detail = await open(container, 'lyrics_album_jobs')
		await within(detail).findAllByText('카탈로그에 없는 앨범')
		const kv = [...detail.querySelectorAll('.auto-kv')].at(-1)!
		expect(kv).toHaveTextContent('들어옴측정 불가')
		expect(kv).toHaveTextContent('나감19')
		expect(detail).toHaveTextContent('줄고 있는지는 판단하지 않습니다')
	})

	it('a table with no reason codes says so, instead of an empty reason list', async () => {
		serve({ kind: 'ok', snapshot: realSnapshot() })
		const { container } = render(<AutomationBoard />)
		const detail = await open(container, 'track_genius_annotations')
		expect(await within(detail).findByText(/사유 코드를 남기지 않습니다/)).toBeTruthy()
		expect(detail).toHaveTextContent('This table has no reason column.')
	})

	it('a failed detail read is an alert, and the snapshot numbers stay', async () => {
		api.fetchQueueDetail.mockResolvedValue({ kind: 'error', status: 502 })
		serve({ kind: 'ok', snapshot: realSnapshot() })
		const { container } = render(<AutomationBoard />)
		await screen.findByText(/^대기열 5개/)
		const detail = container.querySelector('[data-detail]')! as HTMLElement
		expect(await within(detail).findByRole('alert')).toHaveTextContent('HTTP 502')
		expect(detail).toHaveTextContent('리스 만료70')
	})

	it('a detail the server could not read says so — not an empty queue', async () => {
		const details = realDetails()
		details[CLAUDE] = { ...details[CLAUDE], status: 'unknown', reasons: null, flow: null, oldest_waiting: null }
		serveDetails(details)
		serve({ kind: 'ok', snapshot: realSnapshot() })
		const { container } = render(<AutomationBoard />)
		await screen.findByText(/^대기열 5개/)
		const detail = container.querySelector('[data-detail]')! as HTMLElement
		expect(await within(detail).findByRole('alert')).toHaveTextContent('상세 읽기에 실패했습니다')
		expect(detail).not.toHaveTextContent('기다리는 행이 없습니다')
	})

	it('drops a late answer for a queue no longer selected', async () => {
		const details = realDetails()
		let releaseClaude!: (v: QueueDetailResult) => void
		api.fetchQueueDetail.mockImplementation((key: string) => key === CLAUDE ?
			new Promise<QueueDetailResult>((r) => { releaseClaude = r }) :
			Promise.resolve({ kind: 'ok', detail: details[key] }))
		serve({ kind: 'ok', snapshot: realSnapshot() })
		const { container } = render(<AutomationBoard />)
		const detail = await open(container, 'lyrics_album_jobs')
		await within(detail).findAllByText('카탈로그에 없는 앨범')
		await act(async () => releaseClaude({ kind: 'ok', detail: details[CLAUDE] }))
		expect(detail.getAttribute('data-detail')).toBe('lyrics_album_jobs')
		expect(detail).not.toHaveTextContent('limelight')
		expect(detail).toHaveTextContent('카탈로그에 없는 앨범')
	})

	it('never shows the previous queue\'s detail under a newly picked queue', async () => {
		const details = realDetails()
		api.fetchQueueDetail.mockImplementation((key: string) => key === CLAUDE ?
			Promise.resolve({ kind: 'ok', detail: details[CLAUDE] }) :
			new Promise<QueueDetailResult>(() => {}))
		serve({ kind: 'ok', snapshot: realSnapshot() })
		const { container } = render(<AutomationBoard />)
		await screen.findByText(/^대기열 5개/)
		expect(await screen.findByText('limelight')).toBeTruthy()
		const detail = await open(container, 'lyrics_album_jobs')
		expect(detail.getAttribute('data-detail')).toBe('lyrics_album_jobs')
		expect(detail).not.toHaveTextContent('limelight')
		expect(within(detail).getByRole('status')).toHaveTextContent('사유와 흐름을 불러오는 중')
	})

	it('renders a hostile title as text', async () => {
		const details = realDetails()
		const payload = '<img src=x onerror="window.__pwned=1">'
		details[CLAUDE].oldest_waiting![0] = { ...details[CLAUDE].oldest_waiting![0], title: payload }
		serveDetails(details)
		serve({ kind: 'ok', snapshot: realSnapshot() })
		const { container } = render(<AutomationBoard />)
		await screen.findByText(payload)
		expect(container.querySelector('.auto-oldest img')).toBeNull()
	})
})

describe('agent-written heartbeat text', () => {
	it('renders last_outcome and details as text, never as markup', async () => {
		const snap = realSnapshot()
		const payload = '<img src=x onerror="window.__pwned=1"><b>bold</b>'
		snap.heartbeats = [{
			agent_key: 'gpt-translate-poller',
			observed_at: '2026-10-12T10:30:00Z',
			age_seconds: 93,
			catalogued: true,
			enabled: true,
			last_outcome: payload,
			details: { note: payload },
		}]
		serve({ kind: 'ok', snapshot: snap })
		const { container } = render(<AutomationBoard />)
		const beat = await screen.findByText(payload)
		expect(beat.tagName).toBe('P')
		const section = container.querySelector('.auto-beats')!
		expect(section.querySelector('img')).toBeNull()
		expect(section.querySelector('b')).toBeNull()
		expect(within(section as HTMLElement).getByText(/"note":/).textContent).toContain('<img src=x')
	})

	it('marks a heartbeat from an agent the catalog does not know', async () => {
		const snap = realSnapshot()
		snap.heartbeats = [{ agent_key: 'mystery', observed_at: '2026-10-12T10:30:00Z', age_seconds: 93, catalogued: false }]
		serve({ kind: 'ok', snapshot: snap })
		render(<AutomationBoard />)
		expect(await screen.findByText('카탈로그에 없음')).toBeTruthy()
	})
})
