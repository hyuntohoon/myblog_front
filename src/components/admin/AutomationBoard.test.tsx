// FEAT-automation-admin 2c — the owner's automation page, rendered.
//
// What these pin: every load outcome has its own screen (403 is real — the
// server is the boundary, not the guard), unknown is never worded as healthy,
// a failed queue read never looks like an empty one, and agent-written text is
// text (2b security-review).
import type { SnapshotResult } from './automation.api'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { realSnapshot } from './automation.fixture'

const api = vi.hoisted(() => ({ fetchAutomationSnapshot: vi.fn() }))
const auth = vi.hoisted(() => ({ isLoggedIn: vi.fn(() => true) }))

vi.mock('./automation.api', () => api)
vi.mock('@lib/auth', () => auth)

const { default: AutomationBoard } = await import('./AutomationBoard')

function serve(result: SnapshotResult) {
	api.fetchAutomationSnapshot.mockResolvedValue(result)
}

beforeEach(() => {
	vi.clearAllMocks()
	auth.isLoggedIn.mockReturnValue(true)
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
		expect(detail).toHaveTextContent('왜 기다리는지와 줄고 있는지는 아직 이 화면에서 볼 수 없습니다')
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
