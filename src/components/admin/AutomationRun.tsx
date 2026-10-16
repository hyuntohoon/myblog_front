// FEAT-automation-admin 3c — "지금 실행" for one worker cron.
//
// What this pins (same shape as AutomationControl.tsx, 3b):
// - One request_id per confirmation. Only no answer or a 5xx leaves the outcome
//   unknown, and the only retry offered resends the SAME id: the server replays
//   the stored row and never invokes twice. Any other answer is final.
// - A 200 says whether the run was STARTED, not whether it succeeded. The
//   worker stamps start/end on the audit row; later snapshots carry them.
// - `invoke_failed` is a 200, final for that id, and starts no cooldown: the
//   owner may simply confirm again (a new id).
// - The button is offered only when the server would accept it: not while the
//   job is paused (409 job_paused), not inside the 10-minute cooldown, and not
//   when either state is unread. The server still enforces all three.
// - After a success the POST's own `run` is shown until the re-read snapshot
//   arrives, per job_key in the board (`run` / `onPosted`), like 3b's controls.
// - The success note answers one request_id, and goes once a newer run is the
//   last one shown (found in the real-browser clickthrough: a stale "호출 실패"
//   sat beside a later run's "실행 중").
import type { AutomationJob, RunResult, RunState } from './automation.api'
import { useState } from 'react'
import { postAutomationRun } from './automation.api'
import { newRequestId } from './AutomationControl'
import { kst, runStatus } from './automationView'

type Basis = AutomationJob['run']

type Phase =
	| { kind: 'idle', done?: { requestId: string, note: string } } |
	{ kind: 'confirm', requestId: string } |
	{ kind: 'sending', requestId: string } |
	{ kind: 'failed', requestId: string, message: string, resend: boolean, basis: Basis }

export const RUN_CONFIRM_TEXT =
	'예약 실행과 같은 작업을 지금 한 번 시작합니다. 버튼은 시작 요청만 보내고, 결과는 실행이 끝난 뒤 이 줄에 나타납니다. 시작한 뒤 10분 동안은 다시 누를 수 없습니다.'

export type PostedRuns = ReadonlyMap<string, { run: RunState, basis: Basis }>

/** The run state to show: the POST's answer while its snapshot is still on screen. */
export function effectiveRun(job: AutomationJob, posted: PostedRuns): RunState | null {
	const p = posted.get(job.key)
	return p && p.basis === job.run ? p.run : (job.run ?? null)
}

function outcomeNote(r: Extract<RunResult, { kind: 'ok' }>['result']): string {
	const base = r.outcome === 'invoked' ?
		'실행을 시작했습니다. 끝나면 결과가 여기에 표시됩니다.' :
			(r.outcome === 'invoke_failed' ?
				'워커 호출에 실패해 시작되지 않았습니다. 다시 눌러도 됩니다.' :
				'요청은 기록됐지만 호출 결과를 확인하지 못했습니다.')
	return r.replayed ? `${base} (같은 요청이 이미 처리돼 그 결과를 다시 받았습니다.)` : base
}

export function runFailure(r: Exclude<RunResult, { kind: 'ok' }>): { message: string, resend: boolean } {
	if (r.kind === 'forbidden')
		return { message: '오너 계정만 실행할 수 있습니다(403).', resend: false }
	if (r.kind === 'unknown_job')
		return { message: '이 작업에는 지금 실행 기능이 없습니다(404).', resend: false }
	if (r.kind === 'rejected') {
		const x = r.rejection
		if (x.code === 'job_paused')
			return { message: '일시정지 중이라 실행하지 않았습니다(409). 먼저 재개하세요.', resend: false }
		if (x.code === 'cooldown') {
			const at = kst(x.cooldown_until)
			return { message: `방금 실행한 작업이라 실행하지 않았습니다(409).${at ? ` ${at} 이후 다시 실행할 수 있습니다.` : ''}`, resend: false }
		}
		return { message: '이 요청 번호가 이미 다른 동작에 쓰였습니다(409). 닫고 다시 시도해 주세요.', resend: false }
	}
	if (r.status != null && r.status < 500)
		return { message: `요청이 거절됐습니다(HTTP ${r.status}). 실행되지 않았습니다.`, resend: false }
	const why = r.status == null ? '응답이 없어' : `HTTP ${r.status}로`
	return {
		message: `${why} 결과를 알 수 없습니다. 이미 시작됐을 수도 있습니다. 같은 요청으로 다시 보내면 두 번 실행되지 않습니다.`,
		resend: true,
	}
}

export function JobRun({ job, run, paused, now, onPosted, onChanged }: {
	job: AutomationJob
	/** From effectiveRun(), kept by the board per job_key. */
	run: RunState | null
	/** From effectiveControl(): true / false / null (unread). */
	paused: boolean | null
	now: number
	onPosted: (jobKey: string, run: RunState, basis: Basis) => void
	onChanged: () => void
}) {
	const [state, setPhase] = useState<Phase>({ kind: 'idle' })
	if (!job.controls?.includes('run'))
		return null
	const status = runStatus(run, paused, now)
	let phase: Phase = state
	// A failure panel belongs to the snapshot it failed against.
	if (phase.kind === 'failed' && phase.basis !== job.run)
		phase = { kind: 'idle' }
	// The note answers ONE request: once a newer run is the last one on screen, it
	// would sit next to a status it contradicts ("호출 실패" beside "실행 중").
	if (phase.kind === 'idle' && phase.done && run?.last?.request_id !== phase.done.requestId)
		phase = { kind: 'idle' }

	const send = async (requestId: string) => {
		const basis = job.run
		setPhase({ kind: 'sending', requestId })
		const r = await postAutomationRun(job.key, requestId)
		if (r.kind === 'ok') {
			onPosted(job.key, r.result.run, basis)
			setPhase({ kind: 'idle', done: { requestId: r.result.request_id, note: outcomeNote(r.result) } })
			onChanged()
			return
		}
		setPhase({ kind: 'failed', requestId, basis, ...runFailure(r) })
	}

	return (
		<div className="auto-ctl" data-run={job.key}>
			{status.text && <p className={`auto-ctl-status auto-ctl-status--${status.tone}`}>{status.text}</p>}
			{phase.kind === 'idle' && (
				<>
					{phase.done && <p className="auto-ctl-note" role="status">{phase.done.note}</p>}
					{status.blocked ?
							<p className="auto-faded">{status.blocked}</p> :
							(
								<button
									type="button"
									className="auto-button"
									onClick={() => setPhase({ kind: 'confirm', requestId: newRequestId() })}
								>
									지금 실행
								</button>
							)}
				</>
			)}
			{(phase.kind === 'confirm' || phase.kind === 'sending') && (
				<div className="auto-ctl-confirm" role="group" aria-label={`${job.name} 지금 실행 확인`}>
					<p className="auto-ctl-say">{RUN_CONFIRM_TEXT}</p>
					<div className="auto-ctl-buttons">
						<button
							type="button"
							className="auto-button auto-button--strong"
							disabled={phase.kind === 'sending'}
							onClick={() => void send(phase.requestId)}
						>
							{phase.kind === 'sending' ? '보내는 중…' : '지금 실행 확인'}
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
							<button type="button" className="auto-button auto-button--strong" onClick={() => void send(phase.requestId)}>
								같은 요청(지금 실행) 다시 보내기
							</button>
						)}
						<button
							type="button"
							className="auto-button"
							onClick={() => {
								setPhase({ kind: 'idle' })
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
