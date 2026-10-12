// FEAT-automation-admin Step 2c — the owner's read-only automation page.
//
// Renders `GET /api/admin/automation` (backend 2b) and nothing else: no job is
// started, paused or retried from here (controls are Step 3, separately
// approved). The 다시 읽기 button only re-issues the same GET.
//
// The honesty rules live in ./automationView.ts. What this file adds:
// - Only `fresh` gets a filled mark. `unknown` is a hollow mark labelled
//   증거 없음 and is never painted or worded as healthy. The inventory's
//   `declared_state` is printed as the inventory's claim, beside the evidence,
//   never as the evidence.
// - `heartbeats[].details` and `last_outcome` are written by local agents.
//   They are rendered as React text children only — never through
//   dangerouslySetInnerHTML or any markdown/HTML renderer (2b security-review).
import type { AutomationHeartbeat, AutomationJob, AutomationQueue, AutomationSnapshot, AutomationSource, SnapshotResult } from './automation.api'
import type { LivenessStatus } from './automationView'
import { useCallback, useEffect, useRef, useState } from 'react'
import { isLoggedIn } from '@lib/auth'
import { fetchAutomationSnapshot } from './automation.api'
import {
	DECLARED_LABEL,
	detailsText,
	groupJobsByLocation,
	kst,
	LIVENESS_HINT,
	LIVENESS_LABEL,
	livenessTally,
	LOCATION_LABEL,
	queueLabels,
	readQueue,
	relativeAge,
	SOURCE_LABEL,
	SOURCE_STATUS_LABEL,
} from './automationView'

type LoadState = { kind: 'loading' } | SnapshotResult

export default function AutomationBoard() {
	const [state, setState] = useState<LoadState>({ kind: 'loading' })
	const [reloading, setReloading] = useState(false)
	const inflight = useRef<AbortController | null>(null)

	const load = useCallback(async () => {
		// The page guard owns the logged-out redirect. Fetching here as well would
		// start a second goLogin() (two pkce/state writes racing), so stop instead.
		if (!isLoggedIn())
			return
		inflight.current?.abort()
		const ctl = new AbortController()
		inflight.current = ctl
		setReloading(true)
		const result = await fetchAutomationSnapshot(ctl.signal)
		if (ctl.signal.aborted)
			return
		setReloading(false)
		setState(result)
	}, [])

	useEffect(() => {
		void load()
		return () => inflight.current?.abort()
	}, [load])

	if (state.kind === 'loading') {
		return (
			<div className="auto">
				<h1 className="auto-title">자동화 현황</h1>
				<p className="auto-status" role="status">불러오는 중…</p>
			</div>
		)
	}

	if (state.kind === 'forbidden') {
		return (
			<div className="auto">
				<h1 className="auto-title">자동화 현황</h1>
				<p className="auto-status" role="alert">
					이 페이지는 오너 계정만 볼 수 있습니다. 지금 로그인한 계정에는 권한이 없습니다(403).
				</p>
				<a className="auto-link" href="/">홈으로 가기</a>
			</div>
		)
	}

	if (state.kind === 'error') {
		return (
			<div className="auto">
				<h1 className="auto-title">자동화 현황</h1>
				<p className="auto-status" role="alert">
					{state.status == null ?
						'서버가 응답하지 않아 현황을 불러오지 못했습니다.' :
						`현황을 불러오지 못했습니다 (HTTP ${state.status}).`}
					{' '}
					화면에 보이는 것이 없다는 것은 작업이 없다는 뜻이 아닙니다.
				</p>
				<button type="button" className="auto-button" onClick={() => void load()} disabled={reloading}>
					{reloading ? '읽는 중…' : '다시 읽기'}
				</button>
			</div>
		)
	}

	return <Snapshot snapshot={state.snapshot} reloading={reloading} onReload={() => void load()} />
}

function Snapshot({ snapshot, reloading, onReload }: { snapshot: AutomationSnapshot, reloading: boolean, onReload: () => void }) {
	const tally = livenessTally(snapshot.jobs)
	const groups = groupJobsByLocation(snapshot.jobs)
	const labels = queueLabels(snapshot)
	const now = Date.parse(snapshot.generated_at) || Date.now()

	return (
		<div className="auto">
			<header className="auto-head">
				<h1 className="auto-title">자동화 현황</h1>
				<p className="auto-verdict">
					작업
					{' '}
					{snapshot.jobs.length}
					개 가운데 실행 신호가 확인된 작업은
					{' '}
					<strong>
						{tally.fresh}
						개
					</strong>
					입니다.
				</p>
				<p className="auto-tally">
					<LivenessMark status="fresh" />
					{' '}
					{LIVENESS_LABEL.fresh}
					{' '}
					{tally.fresh}
					<span className="auto-sep" aria-hidden="true" />
					<LivenessMark status="stale" />
					{' '}
					{LIVENESS_LABEL.stale}
					{' '}
					{tally.stale}
					<span className="auto-sep" aria-hidden="true" />
					<LivenessMark status="unknown" />
					{' '}
					{LIVENESS_LABEL.unknown}
					{' '}
					{tally.unknown}
				</p>
				<p className="auto-meta">
					<span>
						스냅샷
						{' '}
						<time dateTime={snapshot.generated_at}>{kst(snapshot.generated_at)}</time>
						{' '}
						KST
					</span>
					<span>
						인벤토리 기준일
						{' '}
						{snapshot.catalog_as_of}
					</span>
					<button type="button" className="auto-button" onClick={onReload} disabled={reloading}>
						{reloading ? '읽는 중…' : '다시 읽기'}
					</button>
				</p>
			</header>

			<section className="auto-section" aria-labelledby="auto-sources">
				<h2 id="auto-sources" className="auto-h2">어디서 읽었나</h2>
				<p className="auto-lede">연결되지 않은 출처의 작업은 정상이 아니라 &lsquo;증거 없음&rsquo;으로 표시됩니다.</p>
				<ul className="auto-sources">
					{snapshot.sources.map(s => <SourceItem key={s.key} source={s} />)}
				</ul>
			</section>

			<section className="auto-section" aria-labelledby="auto-queues">
				<h2 id="auto-queues" className="auto-h2">DB 대기열</h2>
				<p className="auto-lede">
					대기 중은 작업자가 가져갈 수 있는 행만 셉니다. 처리 불가는 작업자 필터가 절대 고르지 않는 행이라 대기에 넣지 않습니다.
				</p>
				<div className="auto-queues" role="table" aria-label="DB 대기열">
					<div className="auto-qrow auto-qhead" role="row">
						<span role="columnheader">대기열</span>
						<span role="columnheader">대기 중</span>
						<span role="columnheader">가장 오래 기다린 행</span>
						<span role="columnheader">리스 만료</span>
						<span role="columnheader">다른 상태</span>
						<span role="columnheader">마지막 변경</span>
					</div>
					{snapshot.queues.map(q => <QueueRow key={q.key} queue={q} now={now} />)}
				</div>
			</section>

			<section className="auto-section" aria-labelledby="auto-jobs">
				<h2 id="auto-jobs" className="auto-h2">작업</h2>
				<p className="auto-lede">
					오른쪽 칸의 인벤토리 상태는
					{' '}
					{snapshot.catalog_as_of}
					{' '}
					조사 결과입니다. 지금 돌고 있다는 증거는 왼쪽 표시뿐입니다.
				</p>
				{groups.map(g => (
					<div key={g.location} className="auto-loc">
						<h3 className="auto-h3">
							{LOCATION_LABEL[g.location] ?? g.location}
							<span className="auto-count">{g.jobs.length}</span>
						</h3>
						<ul className="auto-jobs">
							{g.jobs.map(j => <JobRow key={j.key} job={j} queueLabels={labels} now={now} />)}
						</ul>
					</div>
				))}
			</section>

			<section className="auto-section" aria-labelledby="auto-heartbeats">
				<h2 id="auto-heartbeats" className="auto-h2">로컬 하트비트</h2>
				{snapshot.heartbeats.length === 0 ?
						(
							<p className="auto-lede">
								아직 하트비트를 기록한 로컬 에이전트가 없습니다. 그래서 오너 Mac의 작업은 모두 &lsquo;증거 없음&rsquo;입니다.
							</p>
						) :
						(
							<ul className="auto-beats">
								{snapshot.heartbeats.map(h => <HeartbeatRow key={h.agent_key} beat={h} now={now} />)}
							</ul>
						)}
			</section>
		</div>
	)
}

function LivenessMark({ status }: { status: LivenessStatus }) {
	return <span className={`auto-mark auto-mark--${status}`} aria-hidden="true" />
}

function SourceItem({ source }: { source: AutomationSource }) {
	return (
		<li className={`auto-source auto-source--${source.status}`}>
			<span className="auto-source-name">{SOURCE_LABEL[source.key] ?? source.key}</span>
			<span className="auto-source-status">{SOURCE_STATUS_LABEL[source.status] ?? source.status}</span>
			{source.detail && <span className="auto-source-detail">{source.detail}</span>}
		</li>
	)
}

function QueueRow({ queue, now }: { queue: AutomationQueue, now: number }) {
	const reading = readQueue(queue)
	const oldestAge = relativeAge(queue.oldest_waiting_at, now)
	const lastAge = relativeAge(queue.last_update_at, now)
	return (
		<div className="auto-qrow" role="row" id={`queue-${queue.key}`} data-reading={reading.kind}>
			<span role="cell" className="auto-qname">
				<span className="auto-qlabel">{queue.label}</span>
				{queue.frozen && <span className="auto-tag">동결</span>}
				<code className="auto-qkey">{queue.key}</code>
			</span>
			{reading.kind === 'unknown' && (
				<span role="cell" className="auto-qunknown">읽기 실패 — 건수를 알 수 없습니다</span>
			)}
			{reading.kind === 'empty' && (
				<span role="cell" className="auto-qempty">행 없음</span>
			)}
			{reading.kind === 'counted' && (
				<span role="cell" className="auto-qnum" data-label="대기 중">
					{reading.waiting.toLocaleString('ko-KR')}
				</span>
			)}
			{reading.kind === 'counted' && (
				<>
					<span role="cell" data-label="가장 오래 기다린 행">
						{oldestAge ?
								<time dateTime={queue.oldest_waiting_at ?? undefined} title={`${kst(queue.oldest_waiting_at)} KST`}>{oldestAge}</time> :
							'—'}
					</span>
					<span role="cell" data-label="리스 만료" className={queue.stale_running ? 'auto-qwarn' : undefined}>
						{queue.stale_running == null ? '—' : queue.stale_running.toLocaleString('ko-KR')}
					</span>
					<span role="cell" data-label="다른 상태" className="auto-qstates">
						{reading.ineligible.map(s => (
							<span key={s.state} className="auto-state auto-state--ineligible" title="작업자 필터가 고르지 않는 행 — 대기가 아닙니다">
								처리 불가
								{' '}
								{s.n.toLocaleString('ko-KR')}
							</span>
						))}
						{reading.other.map(s => (
							<span key={s.state} className="auto-state">
								{s.state}
								{' '}
								{s.n.toLocaleString('ko-KR')}
							</span>
						))}
					</span>
				</>
			)}
			<span role="cell" data-label="마지막 변경">
				{lastAge ? <time dateTime={queue.last_update_at ?? undefined} title={`${kst(queue.last_update_at)} KST`}>{lastAge}</time> : '—'}
			</span>
		</div>
	)
}

function JobRow({ job, queueLabels, now }: { job: AutomationJob, queueLabels: Map<string, string>, now: number }) {
	const status = job.liveness.status
	const seen = relativeAge(job.liveness.observed_at, now)
	return (
		<li className={`auto-job auto-job--${status}`} data-job={job.key}>
			<div className="auto-live">
				<span className="auto-live-label">
					<LivenessMark status={status} />
					{' '}
					{LIVENESS_LABEL[status] ?? LIVENESS_LABEL.unknown}
				</span>
				{seen && (
					<time className="auto-live-seen" dateTime={job.liveness.observed_at ?? undefined} title={`${kst(job.liveness.observed_at)} KST`}>
						{seen}
					</time>
				)}
				<span className="auto-live-reason" title={LIVENESS_HINT[status]}>{job.liveness.reason}</span>
			</div>
			<div className="auto-job-body">
				<p className="auto-job-name">{job.name}</p>
				<p className="auto-job-purpose">{job.purpose}</p>
				<p className="auto-job-trigger">
					<code>{job.trigger}</code>
					{job.timezone && (
						<>
							{' '}
							<span className="auto-faded">
								(
								{job.timezone}
								)
							</span>
						</>
					)}
				</p>
				<p className="auto-job-exec">
					실행:
					{' '}
					{job.executor}
					{job.ai_provider && (
						<>
							{' '}
							<span className="auto-faded">
								/ AI:
								{' '}
								{job.ai_provider}
							</span>
						</>
					)}
				</p>
				{(job.queue_keys?.length ?? 0) > 0 && (
					<p className="auto-job-queues">
						대기열:
						{' '}
						{job.queue_keys!.map((k, i) => (
							<span key={k}>
								{i > 0 && ', '}
								<a href={`#queue-${k}`}>{queueLabels.get(k) ?? k}</a>
							</span>
						))}
					</p>
				)}
				{job.note && <p className="auto-job-note">{job.note}</p>}
			</div>
			<div className="auto-declared">
				<span className="auto-declared-label">인벤토리</span>
				<span className={`auto-declared-state auto-declared--${job.declared_state}`}>
					{DECLARED_LABEL[job.declared_state] ?? job.declared_state}
				</span>
			</div>
		</li>
	)
}

function HeartbeatRow({ beat, now }: { beat: AutomationHeartbeat, now: number }) {
	const details = detailsText(beat.details)
	return (
		<li className="auto-beat">
			<p className="auto-beat-head">
				<code>{beat.agent_key}</code>
				{' '}
				<time dateTime={beat.observed_at} title={`${kst(beat.observed_at)} KST`}>{relativeAge(beat.observed_at, now) ?? beat.observed_at}</time>
				{beat.enabled === false && <span className="auto-tag">꺼짐 보고</span>}
				{!beat.catalogued && <span className="auto-tag auto-tag--warn">카탈로그에 없음</span>}
			</p>
			{beat.last_outcome && <p className="auto-beat-outcome">{beat.last_outcome}</p>}
			{details && <pre className="auto-beat-details">{details}</pre>}
		</li>
	)
}
