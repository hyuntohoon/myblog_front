// FEAT-automation-admin 3b — pause / resume for one job.
//
// What this pins:
// - Pause means "stop starting new runs at the executor's next boundary";
//   nothing in flight is cancelled. The confirmation says so, per executor.
// - One request_id per confirmation. A 503 or no answer leaves the outcome
//   unknown (the COMMIT may have landed), so the only retry offered resends the
//   SAME id: the server applies it once or replays the stored result.
// - The status line is the server's word. `confirmed` means the executor
//   stamped a skip after this pause; before one schedule interval has passed,
//   "not yet confirmed" is expected and is not worded as a fault.
// - After a success the POST's own `control` is shown until the re-read
//   snapshot arrives (it carries AWS reads and can take seconds); otherwise the
//   page would say "재개했습니다" next to a stale "일시정지됨" and a 재개 button.
//   The board keeps that per job_key (`control` / `onPosted`), so the two places
//   a job's control appears — and the header — never disagree.
// - A failure panel belongs to the snapshot it failed against. When a newer
//   snapshot arrives, the server's state is the answer and the panel goes, so
//   an old request can't be resent after the owner has acted again.
// - An unread control state (`paused` null) is never shown as running, and
//   offers no action: the button would have to guess which way to flip.
import type { AutomationHeartbeat, AutomationJob, ControlAction, ControlResult, ControlState } from './automation.api'
import type { ControlStatus } from './automationView'
import { useState } from 'react'
import { postAutomationControl } from './automation.api'
import { controlStatus } from './automationView'

type Basis = AutomationJob['control']

type Phase =
	| { kind: 'idle', done?: { action: ControlAction, note: string } } |
	{ kind: 'confirm', action: ControlAction, requestId: string } |
	{ kind: 'sending', action: ControlAction, requestId: string } |
	{ kind: 'failed', action: ControlAction, requestId: string, message: string, resend: boolean, basis: Basis }

export function newRequestId(): string {
	const c = globalThis.crypto
	if (typeof c?.randomUUID === 'function')
		return c.randomUUID()
	// RFC 4122 v4 from getRandomValues, for runtimes without randomUUID.
	const b = c.getRandomValues(new Uint8Array(16))
	b[6] = (b[6] & 0x0F) | 0x40
	b[8] = (b[8] & 0x3F) | 0x80
	const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** What happens after the click, in the executor's own terms (3b design). */
export function confirmText(job: AutomationJob, action: ControlAction): string {
	if (action === 'resume') {
		return job.group === 'local_agent' ?
				'다음 확인 때부터 새 작업을 다시 시작합니다.' :
				'다음 예약 실행부터 다시 돕니다. 건너뛴 회차를 따로 몰아서 실행하지는 않습니다.'
	}
	if (job.group === 'local_agent')
		return '다음 확인 때(최대 5초) 새 작업을 시작하지 않습니다. 이미 진행 중인 건은 끝까지 저장됩니다.'
	if (job.key === 'lyrics_incremental')
		return '다음 예약 실행부터 건너뜁니다. 앨범 동기화 뒤 자동으로 들어오는 실행도 건너뜁니다. 지금 도는 실행은 끝까지 갑니다.'
	return '다음 예약 실행부터 건너뜁니다. 지금 도는 실행은 끝까지 갑니다. 사용자가 누른 요청(SQS 메시지)은 멈추지 않습니다.'
}

const VERB: Record<ControlAction, string> = { pause: '일시정지', resume: '재개' }

function outcomeNote(r: Extract<ControlResult, { kind: 'ok' }>['result']): string {
	const base = r.outcome === 'applied' ?
		`${VERB[r.action]}했습니다.` :
		(r.action === 'pause' ? '이미 일시정지 상태였습니다.' : '이미 일시정지가 아니었습니다.')
	return r.replayed ? `${base} (같은 요청이 이미 처리돼 그 결과를 다시 받았습니다.)` : base
}

function failure(r: Exclude<ControlResult, { kind: 'ok' }>): { message: string, resend: boolean } {
	if (r.kind === 'forbidden')
		return { message: '오너 계정만 바꿀 수 있습니다(403).', resend: false }
	if (r.kind === 'rejected') {
		return r.status === 404 ?
				{ message: '이 작업에는 일시정지 기능이 없습니다(404).', resend: false } :
				{ message: '이 요청 번호가 이미 다른 동작에 쓰였습니다(409). 닫고 다시 시도해 주세요.', resend: false }
	}
	// Only no answer or a 5xx leaves the outcome unknown (the COMMIT may have
	// landed). Any other 4xx — a 401 from the API Gateway authorizer, a 422 —
	// never reached a commit, and resending it would only fail the same way.
	if (r.status != null && r.status < 500)
		return { message: `요청이 거절됐습니다(HTTP ${r.status}). 적용되지 않았습니다.`, resend: false }
	const why = r.status == null ? '응답이 없어' : `HTTP ${r.status}로`
	return {
		message: `${why} 결과를 알 수 없습니다. 이미 적용됐을 수도 있습니다. 같은 요청으로 다시 보내면 한 번만 적용됩니다.`,
		resend: true,
	}
}

/**
 * The control to show for a job: the POST's answer while the snapshot it
 * answered against is still on screen, otherwise the snapshot's.
 */
export function effectiveControl(job: AutomationJob, posted: PostedControls): ControlState | null {
	const p = posted.get(job.key)
	return p && p.basis === job.control ? p.control : (job.control ?? null)
}

export type PostedControls = ReadonlyMap<string, { control: ControlState, basis: Basis }>

export function JobControl({ job, control, beat, now, onPosted, onChanged }: {
	job: AutomationJob
	/** From effectiveControl(), kept by the board per job_key. */
	control: ControlState | null
	beat?: AutomationHeartbeat | null
	now: number
	/** Record the POST's answer against the snapshot it was sent from. */
	onPosted: (jobKey: string, control: ControlState, basis: Basis) => void
	onChanged: () => void
}) {
	const [state, setPhase] = useState<Phase>({ kind: 'idle' })
	if (!job.controls?.includes('pause'))
		return null
	const status: ControlStatus = controlStatus(control, now, beat ?? null)
	// Derived, not stored: a stale failure panel or a note the state now
	// contradicts simply stops rendering.
	let phase: Phase = state
	if (phase.kind === 'failed' && phase.basis !== job.control)
		phase = { kind: 'idle' }
	if (phase.kind === 'idle' && phase.done && status.paused !== (phase.done.action === 'pause'))
		phase = { kind: 'idle' }

	const send = async (action: ControlAction, requestId: string) => {
		const basis = job.control
		setPhase({ kind: 'sending', action, requestId })
		const r = await postAutomationControl(job.key, action, requestId)
		if (r.kind === 'ok') {
			onPosted(job.key, r.result.control, basis)
			setPhase({ kind: 'idle', done: { action: r.result.action, note: outcomeNote(r.result) } })
			onChanged()
			return
		}
		setPhase({ kind: 'failed', action, requestId, basis, ...failure(r) })
	}

	const action: ControlAction | null = status.paused == null ? null : (status.paused ? 'resume' : 'pause')

	return (
		<div className="auto-ctl" data-control={job.key}>
			<p className={`auto-ctl-status auto-ctl-status--${status.tone}`}>{status.text}</p>
			{phase.kind === 'idle' && (
				<>
					{phase.done && <p className="auto-ctl-note" role="status">{phase.done.note}</p>}
					{action && (
						<button
							type="button"
							className="auto-button"
							onClick={() => setPhase({ kind: 'confirm', action, requestId: newRequestId() })}
						>
							{VERB[action]}
						</button>
					)}
				</>
			)}
			{(phase.kind === 'confirm' || phase.kind === 'sending') && (
				<div className="auto-ctl-confirm" role="group" aria-label={`${job.name} ${VERB[phase.action]} 확인`}>
					<p className="auto-ctl-say">{confirmText(job, phase.action)}</p>
					<div className="auto-ctl-buttons">
						<button
							type="button"
							className="auto-button auto-button--strong"
							disabled={phase.kind === 'sending'}
							onClick={() => void send(phase.action, phase.requestId)}
						>
							{phase.kind === 'sending' ? '보내는 중…' : `${VERB[phase.action]} 확인`}
						</button>
						<button
							type="button"
							className="auto-button"
							disabled={phase.kind === 'sending'}
							onClick={() => setPhase({ kind: 'idle' })}
						>
							취소
						</button>
					</div>
				</div>
			)}
			{phase.kind === 'failed' && (
				<div className="auto-ctl-confirm" role="alert">
					<p className="auto-ctl-say">{phase.message}</p>
					<div className="auto-ctl-buttons">
						{phase.resend && (
							<button type="button" className="auto-button auto-button--strong" onClick={() => void send(phase.action, phase.requestId)}>
								{`같은 요청(${VERB[phase.action]}) 다시 보내기`}
							</button>
						)}
						<button
							type="button"
							className="auto-button"
							onClick={() => {
								setPhase({ kind: 'idle' })
								// The outcome may be unknown: re-read the server's state rather than guess.
								onChanged()
							}}
						>
							닫고 현황 다시 읽기
						</button>
					</div>
				</div>
			)}
		</div>
	)
}
