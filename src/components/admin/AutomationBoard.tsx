// FEAT-automation-admin Step 2c — the owner's read-only automation page.
//
// Renders `GET /api/admin/automation` (backend 2b) and, for the selected queue,
// `GET /api/admin/automation/queue-detail` (2f). The one mutation is 3b's
// pause / resume (./AutomationControl.tsx), offered only on jobs whose catalog
// row lists the `pause` control; nothing is started or retried from here. The
// 다시 읽기 button only re-issues the same GETs.
//
// Layout (owner's pick 2026-10-12, B+C): a 흐름 / 표 switch over the DB queues,
// and one detail panel both views open. The full job catalog sits folded below.
//
// The honesty rules live in ./automationView.ts. What this file adds:
// - Queue verdicts come from DB queue evidence only (judgeQueue) and say what
//   they cannot see yet. Job liveness keeps its own marks: only `fresh` gets a
//   filled mark, `unknown` is 증거 없음 and never worded as healthy, and the
//   inventory's `declared_state` is printed as the inventory's claim.
// - The 2f detail shows reason CODES (the server never returns stored error
//   text), 24 h flow where the table can measure it (null is 측정 불가, never 0),
//   and the oldest waiting rows. Titles are catalog text, rendered as text.
// - `heartbeats[].details` and `last_outcome` are written by local agents.
//   They are rendered as React text children only — never through
//   dangerouslySetInnerHTML or any markdown/HTML renderer (2b security-review).
import type { AutomationAws, AutomationHeartbeat, AutomationJob, AutomationQueue, AutomationSnapshot, AutomationSource, ControlState, QueueDetail as QueueDetailData, QueueDetailResult, ReasonCount, RunState, SnapshotResult } from './automation.api'
import type { Flow, LivenessStatus, QueueVerdict, Tone } from './automationView'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isLoggedIn } from '@lib/auth'
import { fetchAutomationSnapshot, fetchQueueDetail } from './automation.api'
import { effectiveControl, JobControl } from './AutomationControl'
import type { PostedControls } from './AutomationControl'
import { effectiveRun, JobRun } from './AutomationRun'
import type { PostedRuns } from './AutomationRun'
import {
	buildFlows,
	consumersOf,
	countText,
	DECLARED_LABEL,
	detailsText,
	flowSentence,
	groupJobsByLocation,
	isIneligibleState,
	judgeQueue,
	kst,
	LIVENESS_HINT,
	LIVENESS_LABEL,
	livenessTally,
	LOCATION_LABEL,
	pausedJobs,
	queueLabels,
	readQueue,
	reasonName,
	relativeAge,
	SOURCE_LABEL,
	SOURCE_STATUS_LABEL,
	summarizeAlarms,
	tallyLine,
	TONE_LABEL,
	TONE_ORDER,
	toneTally,
	untilText,
	waitedFor,
	worstTone,
} from './automationView'

type LoadState = { kind: 'loading' } | SnapshotResult
type DetailState = { kind: 'loading' } | QueueDetailResult

/**
 * The selected queue's 2f detail. Re-read when the queue or the snapshot
 * changes (다시 읽기), and an answer for a queue no longer selected is dropped.
 */
function useQueueDetail(key: string | null, snapshotAt: string): DetailState | null {
	const [state, setState] = useState<{ key: string, at: string, value: DetailState } | null>(null)
	useEffect(() => {
		if (!key)
			return
		const ctl = new AbortController()
		setState({ key, at: snapshotAt, value: { kind: 'loading' } })
		void fetchQueueDetail(key, ctl.signal).then((value) => {
			if (!ctl.signal.aborted)
				setState({ key, at: snapshotAt, value })
		})
		return () => ctl.abort()
	}, [key, snapshotAt])
	if (!key || !state || state.key !== key || state.at !== snapshotAt)
		return key ? { kind: 'loading' } : null
	return state.value
}
type View = 'flow' | 'table'

interface ControlProps {
	posted: PostedControls
	onPosted: (key: string, control: ControlState, basis: AutomationJob['control']) => void
	/** 3c: the run-now POST's answer per job_key, until the re-read snapshot replaces it. */
	postedRuns: PostedRuns
	onRunPosted: (key: string, run: RunState, basis: AutomationJob['run']) => void
	onChanged: () => void
}

const VIEW_KEY = 'automation-view'

function readView(): View {
	try {
		return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'flow'
	}
	catch {
		return 'flow'
	}
}

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
	const now = Date.parse(snapshot.generated_at) || Date.now()
	const verdicts = useMemo(
		() => new Map(snapshot.queues.map(q => [q.key, judgeQueue(q, snapshot.jobs, now)])),
		[snapshot, now],
	)
	const flows = useMemo(() => buildFlows(snapshot), [snapshot])
	const tones = toneTally([...verdicts.values()])
	const jobTally = livenessTally(snapshot.jobs)
	const groups = groupJobsByLocation(snapshot.jobs)
	const labels = queueLabels(snapshot)
	const beats = useMemo(() => new Map(snapshot.heartbeats.map(h => [h.agent_key, h])), [snapshot])
	// 3b: a POST's answer per job_key, until the re-read snapshot replaces it.
	// One map for the whole page, so both copies of a job's control and the
	// header line show the same state.
	const [posted, setPosted] = useState<PostedControls>(() => new Map())
	const onPosted = useCallback((key: string, control: ControlState, basis: AutomationJob['control']) => {
		setPosted(m => new Map(m).set(key, { control, basis }))
	}, [])
	const [postedRuns, setPostedRuns] = useState<PostedRuns>(() => new Map())
	const onRunPosted = useCallback((key: string, run: RunState, basis: AutomationJob['run']) => {
		setPostedRuns(m => new Map(m).set(key, { run, basis }))
	}, [])
	const ctl = { posted, onPosted, postedRuns, onRunPosted, onChanged: onReload }
	const paused = pausedJobs(snapshot.jobs.map(j => ({ ...j, control: effectiveControl(j, posted) })))

	// Open on the most urgent queue, so the first thing in the detail panel is
	// the thing worth reading.
	const firstKey = useMemo(() => {
		for (const t of TONE_ORDER) {
			const q = snapshot.queues.find(x => verdicts.get(x.key)?.tone === t)
			if (q)
				return q.key
		}
		return null
	}, [snapshot, verdicts])
	const [selected, setSelected] = useState<string | null>(firstKey)
	const [view, setView] = useState<View>(readView)
	const detailRef = useRef<HTMLElement | null>(null)
	const current = snapshot.queues.find(q => q.key === selected) ?? snapshot.queues.find(q => q.key === firstKey) ?? null
	const detail = useQueueDetail(current?.key ?? null, snapshot.generated_at)

	const switchView = (v: View) => {
		setView(v)
		try {
			localStorage.setItem(VIEW_KEY, v)
		}
		catch { /* per-viewer convenience only */ }
	}

	const pick = (key: string, reveal = false) => {
		setSelected(key)
		// One column on narrow screens: the panel is below the list, so bring it up.
		const mq = (q: string) => typeof window.matchMedia === 'function' && window.matchMedia(q).matches
		if (reveal || mq('(max-width: 900px)')) {
			const behavior: ScrollBehavior = mq('(prefers-reduced-motion: reduce)') ? 'auto' : 'smooth'
			requestAnimationFrame(() => detailRef.current?.scrollIntoView?.({ block: 'start', behavior }))
		}
	}

	const summary = TONE_ORDER.filter(t => tones[t] > 0).map(t => `${TONE_LABEL[t]} ${tones[t]}`)

	return (
		<div className="auto">
			<header className="auto-head">
				<h1 className="auto-title">자동화 현황</h1>
				<p className="auto-verdict">
					대기열
					{' '}
					{snapshot.queues.length}
					개:
					{' '}
					{summary.join(' · ')}
				</p>
				<p className="auto-tally">
					작업
					{' '}
					{snapshot.jobs.length}
					개 가운데 실행 신호가 확인된 작업은
					{' '}
					{jobTally.fresh}
					개입니다.
					{' '}
					<span className="auto-tally-line">{tallyLine(jobTally)}</span>
					{jobTally.unknown > 0 && ' — 증거 없음은 볼 수 없다는 뜻이지 정상이라는 뜻이 아닙니다.'}
				</p>
				{paused.length > 0 && (
					<p className="auto-paused" data-paused="">
						일시정지 중
						{' '}
						{paused.length}
						개:
						{' '}
						{paused.map(p => (p.unconfirmed ? `${p.job.name} (확인 전)` : p.job.name)).join(', ')}
					</p>
				)}
				<div className="auto-meta">
					<span>
						스냅샷
						{' '}
						<time dateTime={snapshot.generated_at}>{kst(snapshot.generated_at)}</time>
						{' '}
						KST
					</span>
					<button type="button" className="auto-button" onClick={onReload} disabled={reloading}>
						{reloading ? '읽는 중…' : '다시 읽기'}
					</button>
					<div className="auto-seg" role="group" aria-label="보기 전환">
						<button type="button" aria-pressed={view === 'flow'} onClick={() => switchView('flow')}>흐름</button>
						<button type="button" aria-pressed={view === 'table'} onClick={() => switchView('table')}>표</button>
					</div>
				</div>
			</header>

			<div className="auto-grid">
				<div className="auto-main">
					{view === 'flow' ?
							<FlowView flows={flows} verdicts={verdicts} selected={current?.key ?? null} now={now} onPick={pick} /> :
							<TableView snapshot={snapshot} flows={flows} verdicts={verdicts} selected={current?.key ?? null} now={now} onPick={pick} />}
				</div>
				<aside className="auto-detail" ref={detailRef} aria-label="대기열 상세">
					{current ?
							<QueueDetail queue={current} verdict={verdicts.get(current.key)!} jobs={snapshot.jobs} beats={beats} now={now} detail={detail} ctl={ctl} /> :
							<p className="auto-lede">대기열이 없습니다.</p>}
				</aside>
			</div>

			<details className="auto-section auto-fold">
				<summary className="auto-h2">
					전체 작업
					{' '}
					{snapshot.jobs.length}
					개
				</summary>
				<p className="auto-lede">
					왼쪽은 실행 증거, 오른쪽은
					{' '}
					{snapshot.catalog_as_of}
					{' '}
					인벤토리 조사 결과입니다. 지금 돌고 있다는 증거는 왼쪽 표시뿐입니다.
				</p>
				{groups.map(g => (
					<div key={g.location} className="auto-loc">
						<h3 className="auto-h3">
							{LOCATION_LABEL[g.location] ?? g.location}
							<span className="auto-count">{g.jobs.length}</span>
						</h3>
						<ul className="auto-jobs">
							{g.jobs.map(j => <JobRow key={j.key} job={j} beat={j.heartbeat_key ? beats.get(j.heartbeat_key) : null} queueLabels={labels} now={now} onPick={k => pick(k, true)} ctl={ctl} />)}
						</ul>
					</div>
				))}
			</details>

			<section className="auto-section" aria-labelledby="auto-sources">
				<h2 id="auto-sources" className="auto-h2">어디서 읽었나</h2>
				<p className="auto-lede">연결되지 않은 출처의 작업은 정상이 아니라 &lsquo;증거 없음&rsquo;으로 표시됩니다.</p>
				<ul className="auto-sources">
					{snapshot.sources.map(s => <SourceItem key={s.key} source={s} />)}
				</ul>
			</section>

			<AwsSection aws={snapshot.aws ?? null} now={now} />

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

function Seen({ at, now }: { at: string | null | undefined, now: number }) {
	const seen = relativeAge(at, now)
	if (!seen)
		return <span className="auto-faded">읽지 못함</span>
	return <time className="auto-faded" dateTime={at ?? undefined} title={`${kst(at)} KST`}>{seen}</time>
}

// 2d: what AWS itself reports — queue depth, Lambda errors, alarm states. The
// EventBridge rules show up as job rows above (their liveness), not here.
function AwsSection({ aws, now }: { aws: AutomationAws | null, now: number }) {
	if (aws == null) {
		return (
			<section className="auto-section" aria-labelledby="auto-aws">
				<h2 id="auto-aws" className="auto-h2">AWS 상태</h2>
				<p className="auto-lede">AWS를 읽는 경로가 연결되지 않았습니다. AWS 작업은 모두 &lsquo;증거 없음&rsquo;입니다.</p>
			</section>
		)
	}
	const alarms = summarizeAlarms(aws.alarms)
	return (
		<section className="auto-section" aria-labelledby="auto-aws">
			<h2 id="auto-aws" className="auto-h2">AWS 상태</h2>
			<p className="auto-lede">
				AWS가 직접 보고한 값입니다. 각 칸의 시각은 그 값을 읽은 때이고, 읽지 못한 칸은 0이 아니라 &lsquo;?&rsquo;로 표시됩니다.
				EventBridge 규칙은 위 작업 목록에서 전달 기록으로 판정합니다(전달만 확인, 처리 성공은 아래 오류·DLQ로 봅니다).
			</p>
			<div className="auto-aws">
				<div className="auto-aws-block">
					<h3 className="auto-aws-h">SQS 대기열</h3>
					<ul className="auto-aws-list">
						{aws.queues.map(q => (
							<li key={q.name} className={`auto-aws-item auto-aws-item--${q.status}`} data-aws-queue={q.name}>
								<span className="auto-aws-name">
									<code>{q.name}</code>
									{q.role === 'dead_letter' && <span className="auto-tag">DLQ</span>}
								</span>
								<span className="auto-aws-label">{q.label}</span>
								<span className="auto-aws-nums">
									대기
									{' '}
									<b>{countText(q.visible)}</b>
									{' · 처리 중 '}
									<b>{countText(q.in_flight)}</b>
									{' · 지연 '}
									<b>{countText(q.delayed)}</b>
								</span>
								<Seen at={q.observed_at} now={now} />
							</li>
						))}
					</ul>
				</div>
				<div className="auto-aws-block">
					<h3 className="auto-aws-h">Lambda (최근 24시간)</h3>
					<ul className="auto-aws-list">
						{aws.functions.map(f => (
							<li key={f.name} className={`auto-aws-item auto-aws-item--${f.status}`} data-aws-function={f.name}>
								<span className="auto-aws-name"><code>{f.name}</code></span>
								<span className="auto-aws-label">{f.label}</span>
								<span className="auto-aws-nums">
									호출
									{' '}
									<b>{countText(f.invocations_24h)}</b>
									{' · 오류 '}
									<b className={(f.errors_24h ?? 0) > 0 ? 'auto-aws-bad' : undefined}>{countText(f.errors_24h)}</b>
									{' · 스로틀 '}
									<b className={(f.throttles_24h ?? 0) > 0 ? 'auto-aws-bad' : undefined}>{countText(f.throttles_24h)}</b>
								</span>
								<Seen at={f.observed_at} now={now} />
							</li>
						))}
					</ul>
				</div>
				<div className="auto-aws-block">
					<h3 className="auto-aws-h">
						CloudWatch 알람
						{' '}
						<span className="auto-count">{aws.alarms.length}</span>
					</h3>
					<p className="auto-aws-alarms" data-aws-alarms="">
						OK
						{' '}
						<b>{alarms.ok}</b>
						{' · 경보 '}
						<b className={alarms.firing.length > 0 ? 'auto-aws-bad' : undefined}>{alarms.firing.length}</b>
						{alarms.other.length > 0 && ` · 데이터 부족 등 ${alarms.other.length}`}
						{alarms.unread > 0 && ` · 읽지 못함 ${alarms.unread}`}
					</p>
					{(alarms.firing.length > 0 || alarms.other.length > 0) && (
						<ul className="auto-aws-list">
							{alarms.firing.map(n => (
								<li key={n} className="auto-aws-item">
<code>{n}</code>
<span className="auto-aws-bad">ALARM</span>
        </li>
							))}
							{alarms.other.map(a => (
								<li key={a.name} className="auto-aws-item">
<code>{a.name}</code>
<span className="auto-faded">{a.state}</span>
        </li>
							))}
						</ul>
					)}
				</div>
			</div>
		</section>
	)
}

function TonePill({ tone, label }: { tone: Tone, label: string }) {
	return <span className={`auto-pill auto-pill--${tone}`}>{label}</span>
}

function LivenessMark({ status }: { status: LivenessStatus }) {
	return <span className={`auto-mark auto-mark--${status}`} aria-hidden="true" />
}

/** "854" / "—" plus the line under it, shared by both views. */
function waitingText(queue: AutomationQueue, now: number): { big: string, sub: string } {
	const r = readQueue(queue)
	if (r.kind === 'unknown')
		return { big: '?', sub: '읽기 실패' }
	if (r.kind === 'empty')
		return { big: '—', sub: '행 없음' }
	if (r.waiting === 0)
		return { big: '0', sub: '대기 없음' }
	const w = waitedFor(queue.oldest_waiting_at, now)
	return { big: r.waiting.toLocaleString('ko-KR'), sub: w ? `가장 오래 ${w}째` : '대기 중' }
}

interface PickProps { verdicts: Map<string, QueueVerdict>, selected: string | null, now: number, onPick: (key: string) => void }

function FlowView({ flows, verdicts, selected, now, onPick }: { flows: Flow[] } & PickProps) {
	return (
		<div className="auto-flows">
			{flows.map((f) => {
				const tone = worstTone(f.steps.flatMap(s => (s.kind === 'queue' ? [verdicts.get(s.queue.key)!.tone] : [])))
				return (
					<section key={f.title} className="auto-flow" aria-label={f.title}>
						<div className="auto-flow-head">
							<h2 className="auto-flow-title">{f.title}</h2>
							<TonePill tone={tone} label={TONE_LABEL[tone]} />
						</div>
						<div className="auto-lane">
							{f.steps.map((s, i) => (
								<div key={s.kind === 'queue' ? `q:${s.queue.key}` : `j:${s.job.key}:${i}`} className="auto-step">
									{i > 0 && <span className="auto-arrow" aria-hidden="true">→</span>}
									{s.kind === 'queue' ?
											<QueueNode queue={s.queue} verdict={verdicts.get(s.queue.key)!} active={selected === s.queue.key} now={now} onPick={onPick} /> :
											<JobNode job={s.job} />}
								</div>
							))}
						</div>
					</section>
				)
			})}
		</div>
	)
}

function QueueNode({ queue, verdict, active, now, onPick }: { queue: AutomationQueue, verdict: QueueVerdict, active: boolean, now: number, onPick: (key: string) => void }) {
	const w = waitingText(queue, now)
	return (
		<button type="button" className="auto-node" data-queue={queue.key} aria-current={active} onClick={() => onPick(queue.key)}>
			<span className="auto-node-kind">대기열</span>
			<span className="auto-node-name">{queue.label}</span>
			<span className="auto-node-big">{w.big}</span>
			{/* "대기 없음" / "행 없음" would just repeat the verdict pill. */}
			{w.sub !== verdict.label && <span className="auto-node-sub">{w.sub}</span>}
			<TonePill tone={verdict.tone} label={verdict.label} />
		</button>
	)
}

function JobNode({ job }: { job: AutomationJob }) {
	const status = job.liveness.status
	return (
		<div className={`auto-node auto-node--job${job.declared_state === 'active' ? '' : ' auto-node--off'}`} data-job-node={job.key}>
			<span className="auto-node-kind">{LOCATION_LABEL[job.location] ?? job.location}</span>
			<span className="auto-node-name">{job.name}</span>
			<span className="auto-live-label">
				<LivenessMark status={status} />
				{' '}
				{LIVENESS_LABEL[status] ?? LIVENESS_LABEL.unknown}
			</span>
			<span className="auto-node-sub">
				인벤토리:
				{' '}
				{DECLARED_LABEL[job.declared_state] ?? job.declared_state}
			</span>
		</div>
	)
}

function TableView({ snapshot, flows, verdicts, selected, now, onPick }: { snapshot: AutomationSnapshot, flows: Flow[] } & PickProps) {
	const flowOf = new Map<string, string>()
	for (const f of flows) {
		for (const s of f.steps) {
			if (s.kind === 'queue' && !flowOf.has(s.queue.key))
				flowOf.set(s.queue.key, f.title)
		}
	}
	return (
		<div className="auto-tablewrap">
			<table className="auto-table">
				<thead>
					<tr>
						<th scope="col">대기열</th>
						<th scope="col">상태 분포</th>
						<th scope="col" className="r">대기</th>
						<th scope="col" className="r">가장 오래</th>
						<th scope="col" className="r">리스 만료</th>
						<th scope="col" className="r">마지막 변경</th>
						<th scope="col">판정</th>
					</tr>
				</thead>
				<tbody>
					{snapshot.queues.map((q) => {
						const r = readQueue(q)
						const v = verdicts.get(q.key)!
						return (
							<tr key={q.key} data-queue={q.key} aria-current={selected === q.key} onClick={() => onPick(q.key)}>
								<td>
									{/* The row handles the click; the button is the keyboard target. */}
									<button type="button" className="auto-rowpick">{q.label}</button>
									<span className="auto-row-flow">{flowOf.get(q.key) ?? ''}</span>
								</td>
								<td>{r.kind === 'counted' ? <StateBar queue={q} /> : <span className="auto-faded">{r.kind === 'empty' ? '행 없음' : '읽기 실패'}</span>}</td>
								<td className="r">{r.kind === 'counted' ? r.waiting.toLocaleString('ko-KR') : '—'}</td>
								<td className="r">{r.kind === 'counted' && r.waiting > 0 ? (waitedFor(q.oldest_waiting_at, now) ?? '—') : '—'}</td>
								<td className={`r${q.stale_running ? ' auto-hot' : ''}`}>{q.stale_running == null ? '—' : q.stale_running.toLocaleString('ko-KR')}</td>
								<td className="r">{relativeAge(q.last_update_at, now) ?? '—'}</td>
								<td><TonePill tone={v.tone} label={v.label} /></td>
							</tr>
						)
					})}
				</tbody>
			</table>
		</div>
	)
}

const DONE_STATES = new Set(['done', 'complete', 'finished', 'linked', 'not_required'])
const RUN_STATES = new Set(['running', 'claimed'])
const FAIL_STATES = new Set(['failed'])

function stateKind(queue: AutomationQueue, state: string): 'wait' | 'run' | 'done' | 'fail' | 'other' {
	if (queue.waiting_states.includes(state))
		return 'wait'
	if (RUN_STATES.has(state))
		return 'run'
	if (DONE_STATES.has(state))
		return 'done'
	if (FAIL_STATES.has(state))
		return 'fail'
	return 'other'
}

function StateBar({ queue }: { queue: AutomationQueue }) {
	const entries = Object.entries(queue.counts ?? {})
	const total = entries.reduce((a, [, v]) => a + v, 0) || 1
	return (
		<span className="auto-bar" aria-hidden="true">
			{entries.map(([s, v]) => <span key={s} className={`auto-bar-${stateKind(queue, s)}`} style={{ width: `${(v / total) * 100}%` }} />)}
		</span>
	)
}

function QueueDetail({ queue, verdict, jobs, beats, now, detail, ctl }: { queue: AutomationQueue, verdict: QueueVerdict, jobs: AutomationJob[], beats: Map<string, AutomationHeartbeat>, now: number, detail: DetailState | null, ctl: ControlProps }) {
	const r = readQueue(queue)
	const consumers = consumersOf(queue.key, jobs)
	const states = Object.entries(queue.counts ?? {}).sort((a, b) => b[1] - a[1])
	return (
		<div className="auto-d" data-detail={queue.key}>
			<div className="auto-d-head">
				<div className="auto-d-pills">
					<TonePill tone={verdict.tone} label={verdict.label} />
					{queue.frozen && verdict.tone !== 'frozen' && <TonePill tone="frozen" label="동결" />}
				</div>
				<h2 className="auto-d-title">{queue.label}</h2>
				<code className="auto-d-key">{queue.key}</code>
				<p className="auto-d-say">{verdict.say}</p>
			</div>

			<div className="auto-d-sec">
				<h3 className="auto-d-h">지금 숫자</h3>
				{r.kind === 'counted' ?
						(
							<>
								<dl className="auto-kv">
									<div>
										<dt>대기</dt>
										<dd>{r.waiting.toLocaleString('ko-KR')}</dd>
									</div>
									<div>
										<dt>가장 오래 기다린 행</dt>
										<dd>
											{queue.oldest_waiting_at ?
													<time dateTime={queue.oldest_waiting_at} title={`${kst(queue.oldest_waiting_at)} KST`}>{`${waitedFor(queue.oldest_waiting_at, now)}째`}</time> :
												'—'}
										</dd>
									</div>
									<div>
										<dt>리스 만료</dt>
										<dd className={queue.stale_running ? 'auto-hot' : undefined}>{queue.stale_running == null ? '—' : queue.stale_running.toLocaleString('ko-KR')}</dd>
									</div>
									<div>
										<dt>마지막 변경</dt>
										<dd>
											{queue.last_update_at ?
													<time dateTime={queue.last_update_at} title={`${kst(queue.last_update_at)} KST`}>{relativeAge(queue.last_update_at, now)}</time> :
												'—'}
										</dd>
									</div>
								</dl>
								<StateBar queue={queue} />
								<ul className="auto-states">
									{states.map(([s, v]) => (
										<li key={s} className={`auto-states-${isIneligibleState(s) ? 'ineligible' : stateKind(queue, s)}`}>
											<span className="auto-states-dot" aria-hidden="true" />
											{isIneligibleState(s) ? `${s} (처리 불가)` : s}
											<span className="auto-states-n">{v.toLocaleString('ko-KR')}</span>
										</li>
									))}
								</ul>
							</>
						) :
						<p className="auto-lede">{r.kind === 'empty' ? '행 없음 — 읽기는 성공했습니다.' : '읽기 실패 — 건수를 알 수 없습니다.'}</p>}
			</div>

			<div className="auto-d-sec">
				<h3 className="auto-d-h">처리하는 작업</h3>
				{consumers.length === 0 ?
						<p className="auto-lede">카탈로그에 이 대기열을 처리하는 작업이 적혀 있지 않습니다.</p> :
						(
							<ul className="auto-consumers">
								{consumers.map(j => (
									<li key={j.key}>
										<span className="auto-consumer-name">{j.name}</span>
										<span className="auto-live-label">
											<LivenessMark status={j.liveness.status} />
											{' '}
											{LIVENESS_LABEL[j.liveness.status] ?? LIVENESS_LABEL.unknown}
										</span>
										<span className="auto-faded">
											인벤토리:
											{' '}
											{DECLARED_LABEL[j.declared_state] ?? j.declared_state}
										</span>
										<JobControl job={j} control={effectiveControl(j, ctl.posted)} beat={j.heartbeat_key ? beats.get(j.heartbeat_key) : null} now={now} onPosted={ctl.onPosted} onChanged={ctl.onChanged} />
										<JobRun job={j} run={effectiveRun(j, ctl.postedRuns)} paused={effectiveControl(j, ctl.posted)?.paused ?? null} now={now} onPosted={ctl.onRunPosted} onChanged={ctl.onChanged} />
									</li>
								))}
							</ul>
						)}
			</div>

			<DetailSections detail={detail} />
		</div>
	)
}

function DetailSections({ detail }: { detail: DetailState | null }) {
	if (!detail || detail.kind === 'loading')
		return <p className="auto-lede" role="status">사유와 흐름을 불러오는 중…</p>
	if (detail.kind === 'forbidden')
		return <p className="auto-lede" role="alert">상세는 오너 계정만 볼 수 있습니다(403).</p>
	if (detail.kind === 'error') {
		return (
			<p className="auto-lede" role="alert">
				{detail.status == null ? '서버가 응답하지 않아 상세를 불러오지 못했습니다.' : `상세를 불러오지 못했습니다 (HTTP ${detail.status}).`}
			</p>
		)
	}
	const d = detail.detail
	if (d.status !== 'ok')
		return <p className="auto-lede" role="alert">상세 읽기에 실패했습니다. 사유와 흐름을 알 수 없습니다.</p>
	const at = Date.parse(d.observed_at ?? '') || Date.now()
	return (
		<>
			<Reasons detail={d} />
			<FlowSection detail={d} />
			<OldestSection detail={d} now={at} />
		</>
	)
}

function ReasonList({ rows, waiting }: { rows: ReasonCount[], waiting: boolean }) {
	return (
		<ul className="auto-reasons">
			{rows.map(r => (
				<li key={`${r.state}|${r.reason ?? ''}`}>
					<span className="auto-reason-name">
						{reasonName(r.reason)}
						{r.reason != null && <code className="auto-reason-code">{r.reason}</code>}
					</span>
					<span className="auto-reason-state">{r.state}</span>
					<span className="auto-reason-n">{r.count.toLocaleString('ko-KR')}</span>
					{waiting && r.deferred != null && r.deferred > 0 && (
						<span className="auto-reason-deferred">
							{r.deferred === r.count ? '모두' : `${r.deferred.toLocaleString('ko-KR')}건`}
							{' '}
							재시도 시각 전
						</span>
					)}
				</li>
			))}
		</ul>
	)
}

function Reasons({ detail }: { detail: QueueDetailData }) {
	const rows = detail.reasons ?? []
	const waitingStates = new Set(detail.waiting_states)
	const waiting = rows.filter(r => waitingStates.has(r.state))
	const other = rows.filter(r => !waitingStates.has(r.state) && r.reason != null)
	return (
		<div className="auto-d-sec">
			<h3 className="auto-d-h">기다리는 이유</h3>
			{detail.reasons_note && (
				<p className="auto-lede">
					이 대기열은 사유 코드를 남기지 않습니다.
					{' '}
					<span className="auto-faded">{detail.reasons_note}</span>
				</p>
			)}
			{waiting.length === 0 ?
					<p className="auto-lede">기다리는 행이 없습니다.</p> :
					<ReasonList rows={waiting} waiting />}
			{other.length > 0 && (
				<details className="auto-reasons-other">
					<summary>다른 상태의 사유</summary>
					<ReasonList rows={other} waiting={false} />
				</details>
			)}
		</div>
	)
}

function FlowSection({ detail }: { detail: QueueDetailData }) {
	const f = detail.flow
	if (!f)
		return null
	const cell = (v: number | null | undefined) => (v == null ? '측정 불가' : v.toLocaleString('ko-KR'))
	return (
		<div className="auto-d-sec">
			<h3 className="auto-d-h">
				최근
				{' '}
				{f.window_hours}
				시간
			</h3>
			<dl className="auto-kv">
				<div>
					<dt>들어옴</dt>
					<dd title={f.entered_basis}>{cell(f.entered)}</dd>
				</div>
				<div>
					<dt>나감</dt>
					<dd title={f.left_basis}>{cell(f.left)}</dd>
				</div>
			</dl>
			<p className="auto-lede">{flowSentence(f.entered, f.left)}</p>
			<ul className="auto-basis">
				<li>
					들어옴:
					{' '}
					{f.entered_basis}
				</li>
				<li>
					나감:
					{' '}
					{f.left_basis}
				</li>
			</ul>
		</div>
	)
}

function OldestSection({ detail, now }: { detail: QueueDetailData, now: number }) {
	const rows = detail.oldest_waiting ?? []
	return (
		<div className="auto-d-sec">
			<h3 className="auto-d-h">
				가장 오래 기다린
				{' '}
				{detail.oldest_limit}
				개
			</h3>
			{rows.length === 0 ?
					<p className="auto-lede">기다리는 행이 없습니다.</p> :
					(
						<ol className="auto-oldest">
							{rows.map(r => (
								<li key={r.id}>
									<span className="auto-oldest-title">{r.title ?? <code>{r.id}</code>}</span>
									<span className="auto-oldest-meta">
										{waitedFor(r.waiting_since, now) && `${waitedFor(r.waiting_since, now)}째`}
										{r.reason != null && ` · ${reasonName(r.reason)}`}
										{r.attempts != null && ` · 시도 ${r.attempts}회`}
										{r.next_attempt_at && ` · 다음 시도 ${untilText(r.next_attempt_at, now)}`}
									</span>
									{r.title != null && <code className="auto-oldest-id">{r.id}</code>}
								</li>
							))}
						</ol>
					)}
			<p className="auto-faded">
				기다린 시간 기준:
				{' '}
				{detail.wait_basis}
			</p>
		</div>
	)
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

function JobRow({ job, beat, queueLabels, now, onPick, ctl }: { job: AutomationJob, beat: AutomationHeartbeat | null | undefined, queueLabels: Map<string, string>, now: number, onPick: (key: string) => void, ctl: ControlProps }) {
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
								<button type="button" className="auto-linkbtn" onClick={() => onPick(k)}>{queueLabels.get(k) ?? k}</button>
							</span>
						))}
					</p>
				)}
				{job.note && <p className="auto-job-note">{job.note}</p>}
				<JobControl job={job} control={effectiveControl(job, ctl.posted)} beat={beat} now={now} onPosted={ctl.onPosted} onChanged={ctl.onChanged} />
				<JobRun job={job} run={effectiveRun(job, ctl.postedRuns)} paused={effectiveControl(job, ctl.posted)?.paused ?? null} now={now} onPosted={ctl.onRunPosted} onChanged={ctl.onChanged} />
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
