// FEAT-automation-admin Step 2c — pure read-model helpers for the owner's
// automation page. No React here, so the honesty rules are unit-testable on
// their own:
//
// - `liveness.status` is the ONLY runtime claim a job row makes. Unknown is
//   "no evidence", never healthy, and is never folded into fresh.
// - `declared_state` is the Step 1 inventory as of `catalog_as_of`. It is shown
//   as what the inventory said, and never feeds a health judgement.
// - `counts: null` means the DB read failed (unknown); `{}` means it worked and
//   found no rows. They must not render alike.
// - `*_ineligible` rows are rows the worker's filter can never pick up. They
//   are not waiting, and are not added to the waiting total.
import type { AutomationAwsAlarm, AutomationJob, AutomationQueue, AutomationSnapshot, AutomationSource, Liveness } from './automation.api'

export type LivenessStatus = Liveness['status']
export type Location = AutomationJob['location']
export type DeclaredState = AutomationJob['declared_state']

export const LIVENESS_LABEL: Record<LivenessStatus, string> = {
	fresh: '최근 확인',
	stale: '멈춤',
	failing: '실패 보고',
	unknown: '증거 없음',
}

export const LIVENESS_HINT: Record<LivenessStatus, string> = {
	fresh: '허용 간격 안에 실행 신호가 들어왔습니다.',
	stale: '신호가 들어온 적은 있지만 허용 간격을 넘겼습니다.',
	failing: 'AWS가 이 규칙의 전달 실패를 보고했습니다(최근 시도 실패, 허용 간격 안의 실패, 또는 알람).',
	unknown: '실행 여부를 보여줄 신호가 아직 없습니다. 정상이라는 뜻이 아닙니다.',
}

export const LOCATION_LABEL: Record<Location, string> = {
	aws: 'AWS',
	mac: '오너 Mac',
	github: 'GitHub',
}

/** Display order: where the site's own work runs first. */
export const LOCATION_ORDER: Location[] = ['aws', 'mac', 'github']

export const DECLARED_LABEL: Record<DeclaredState, string> = {
	active: '가동',
	disabled: '꺼짐',
	obsolete: '폐기',
	manual_only: '수동 전용',
	consumer_only: '소비자만 있음',
	dropped: '버려짐',
}

export const SOURCE_LABEL: Record<AutomationSource['key'], string> = {
	catalog: '카탈로그',
	db: 'DB 대기열',
	heartbeat: '로컬 하트비트',
	aws: 'AWS 지표',
}

export const SOURCE_STATUS_LABEL: Record<AutomationSource['status'], string> = {
	ok: '읽음',
	unavailable: '읽기 실패',
	not_wired: '아직 연결 안 됨',
}

export interface LocationGroup {
	location: Location
	jobs: AutomationJob[]
}

/** Jobs grouped by where they run, in LOCATION_ORDER, catalog order kept inside a group. */
export function groupJobsByLocation(jobs: AutomationJob[]): LocationGroup[] {
	const by = new Map<Location, AutomationJob[]>()
	for (const job of jobs) {
		const list = by.get(job.location) ?? []
		list.push(job)
		by.set(job.location, list)
	}
	const known = LOCATION_ORDER.filter(l => by.has(l)).map(location => ({ location, jobs: by.get(location)! }))
	// A location the page has not heard of is still shown, never dropped.
	const extra = [...by.keys()].filter(l => !LOCATION_ORDER.includes(l)).map(location => ({ location, jobs: by.get(location)! }))
	return [...known, ...extra]
}

export function livenessTally(jobs: AutomationJob[]): Record<LivenessStatus, number> {
	const tally: Record<LivenessStatus, number> = { fresh: 0, stale: 0, failing: 0, unknown: 0 }
	for (const job of jobs) {
		// Anything the page cannot name counts as unknown — never as fresh.
		const s = job.liveness.status in tally ? job.liveness.status : 'unknown'
		tally[s] += 1
	}
	return tally
}

export function isIneligibleState(state: string): boolean {
	return state.endsWith('_ineligible')
}

export type QueueReading =
	/** The DB read failed: counts are unknown. */
	| { kind: 'unknown' } |
	/** The read worked and the table has no rows. */
	{ kind: 'empty' } |
	{
		kind: 'counted'
		waiting: number
		ineligible: { state: string, n: number }[]
		other: { state: string, n: number }[]
	}

export function readQueue(queue: AutomationQueue): QueueReading {
	const counts = queue.counts
	if (queue.status !== 'ok' || counts == null)
		return { kind: 'unknown' }
	const entries = Object.entries(counts)
	if (entries.length === 0)
		return { kind: 'empty' }
	const waitingStates = new Set(queue.waiting_states)
	let waiting = 0
	const ineligible: { state: string, n: number }[] = []
	const other: { state: string, n: number }[] = []
	for (const [state, n] of entries) {
		if (waitingStates.has(state))
			waiting += n
		else if (isIneligibleState(state))
			ineligible.push({ state, n })
		else
			other.push({ state, n })
	}
	other.sort((a, b) => b.n - a.n)
	return { kind: 'counted', waiting, ineligible, other }
}

/** Queue label by key, for linking a job to the queues it drains. */
export function queueLabels(snapshot: AutomationSnapshot): Map<string, string> {
	return new Map(snapshot.queues.map(q => [q.key, q.label]))
}

/** "3분 전" / "2시간 전" / "32일 전". Future timestamps read as "방금" rather than a negative age. */
export function relativeAge(iso: string | null | undefined, now: number = Date.now()): string | null {
	if (!iso)
		return null
	const t = Date.parse(iso)
	if (Number.isNaN(t))
		return null
	const sec = Math.max(0, Math.round((now - t) / 1000))
	if (sec < 60)
		return '방금'
	const min = Math.floor(sec / 60)
	if (min < 60)
		return `${min}분 전`
	const hr = Math.floor(min / 60)
	if (hr < 48)
		return `${hr}시간 전`
	return `${Math.floor(hr / 24)}일 전`
}

/** Absolute KST timestamp, e.g. "2026. 10. 12. 19:31". The owner reads Seoul time. */
export function kst(iso: string | null | undefined): string | null {
	if (!iso)
		return null
	const d = new Date(iso)
	if (Number.isNaN(d.getTime()))
		return null
	return d.toLocaleString('ko-KR', {
		timeZone: 'Asia/Seoul',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	})
}

/** "12분" / "3시간" / "31일": how long something has been waiting. */
export function waitedFor(iso: string | null | undefined, now: number = Date.now()): string | null {
	if (!iso)
		return null
	const t = Date.parse(iso)
	if (Number.isNaN(t))
		return null
	const min = Math.max(0, Math.floor((now - t) / 60000))
	if (min < 60)
		return `${min}분`
	const hr = Math.floor(min / 60)
	if (hr < 48)
		return `${hr}시간`
	return `${Math.floor(hr / 24)}일`
}

// ── Queue verdicts (owner feedback 2026-10-12: "is it working, what is wrong,
// what is waiting?") ─────────────────────────────────────────────────────────
//
// Judged from DB queue evidence only — counts, oldest waiting row, expired
// leases — which the snapshot already carries. Deliberately conservative: the
// page cannot yet see WHY rows wait (`last_reason`) or how fast they drain, so
// a long wait is "1일 넘게 대기", never "막힘". Measured on prod the same day,
// 848 of 854 "waiting" album jobs were waiting on the catalog and the queue was
// shrinking — a verdict that said "stuck" would have been confidently wrong.
// The 2f detail API shows reasons and 24 h flow in the panel; the verdicts
// stay snapshot-only, because several flow columns are approximate or null.
//
// `declared_state` is used in ONE direction only: to warn that a queue's
// consumers are switched off in the inventory. It never makes anything look
// healthy.

export type Tone = 'bad' | 'warn' | 'frozen' | 'none' | 'ok'

/** Most urgent first. Drives the summary order and the default selection. */
export const TONE_ORDER: Tone[] = ['bad', 'warn', 'frozen', 'none', 'ok']

export const TONE_LABEL: Record<Tone, string> = {
	bad: '손볼 것',
	warn: '지켜볼 것',
	frozen: '동결',
	none: '볼 수 없음',
	ok: '문제 없음',
}

export interface QueueVerdict {
	tone: Tone
	label: string
	say: string
}

const OFF_STATES: ReadonlySet<DeclaredState> = new Set<DeclaredState>(['disabled', 'obsolete', 'dropped'])
const LONG_WAIT_MS = 24 * 60 * 60 * 1000

/** Jobs that drain this queue, per the catalog's `queue_keys`. */
export function consumersOf(queueKey: string, jobs: AutomationJob[]): AutomationJob[] {
	return jobs.filter(j => (j.queue_keys ?? []).includes(queueKey))
}

function n(v: number): string {
	return v.toLocaleString('ko-KR')
}

export function judgeQueue(queue: AutomationQueue, jobs: AutomationJob[], now: number = Date.now()): QueueVerdict {
	const reading = readQueue(queue)
	if (reading.kind === 'unknown')
		return { tone: 'none', label: '읽기 실패', say: '이 대기열을 읽지 못했습니다. 건수를 모르므로 비어 있다고 볼 수 없습니다.' }
	if (reading.kind === 'empty')
		return { tone: 'none', label: '행 없음', say: '읽기는 성공했고, 이 대기열에는 아직 행이 하나도 없습니다.' }

	const consumers = consumersOf(queue.key, jobs)
	const consumersOff = consumers.length > 0 && consumers.every(j => OFF_STATES.has(j.declared_state))
	const ineligible = reading.ineligible.reduce((a, s) => a + s.n, 0)
	const ineligibleNote = ineligible > 0 ? ` 처리 불가 ${n(ineligible)}건은 작업자가 고를 수 없는 행이라 대기로 세지 않습니다.` : ''
	const waited = waitedFor(queue.oldest_waiting_at, now)
	const stale = queue.stale_running ?? 0

	if (stale > 0) {
		return {
			tone: 'bad',
			label: `멈춘 실행 ${n(stale)}`,
			say: `리스가 끝났는데 "실행 중"으로 남은 행이 ${n(stale)}건 있습니다. 누가 정리하지 않으면 그대로 남습니다.${queue.frozen ? ' 이 대기열은 동결돼 있어 새로 처리되지 않습니다.' : ''}`,
		}
	}
	if (queue.frozen) {
		return {
			tone: 'frozen',
			label: '동결',
			say: `의도적으로 멈춘 대기열입니다.${reading.waiting > 0 ? ` 남은 대기 ${n(reading.waiting)}건은 처리되지 않습니다.` : ''}`,
		}
	}
	if (reading.waiting > 0 && consumersOff) {
		return {
			tone: 'warn',
			label: '처리기 꺼짐',
			say: `대기 ${n(reading.waiting)}건이 있지만, 이 대기열을 처리하는 작업이 인벤토리상 꺼져 있습니다.${ineligibleNote}`,
		}
	}
	const oldestT = queue.oldest_waiting_at ? Date.parse(queue.oldest_waiting_at) : Number.NaN
	if (reading.waiting > 0 && !Number.isNaN(oldestT) && now - oldestT > LONG_WAIT_MS) {
		return {
			tone: 'warn',
			label: '1일 넘게 대기',
			say: `대기 ${n(reading.waiting)}건, 가장 오래된 것은 ${waited}째입니다. 왜 기다리는지와 최근 24시간 흐름은 상세에서 봅니다.${ineligibleNote}`,
		}
	}
	if (reading.waiting > 0) {
		return {
			tone: 'ok',
			label: '대기 짧음',
			say: `대기 ${n(reading.waiting)}건, 가장 오래된 것도 ${waited ?? '하루'}째로 하루가 안 됐습니다.${ineligibleNote}`,
		}
	}
	return {
		tone: 'ok',
		label: '대기 없음',
		say: `기다리는 행이 없습니다.${ineligibleNote}${consumersOff ? ' 처리하는 작업이 인벤토리상 꺼져 있어, 새 요청이 들어오면 처리되지 않습니다.' : ''}`,
	}
}

export function toneTally(verdicts: QueueVerdict[]): Record<Tone, number> {
	const t: Record<Tone, number> = { bad: 0, warn: 0, frozen: 0, none: 0, ok: 0 }
	for (const v of verdicts)
		t[v.tone] += 1
	return t
}

export function worstTone(tones: Tone[]): Tone {
	for (const t of TONE_ORDER) {
		if (tones.includes(t))
			return t
	}
	return 'none'
}

// ── Flows ──────────────────────────────────────────────────────────────────
//
// Presentation grouping only: which queues and jobs read as one pipeline, in
// order. It is NOT runtime state and adds no claim; a key missing from the
// snapshot is skipped, and every queue the flows do not name is still shown,
// under 그 밖의 대기열 — the page must not hide a queue because this list has
// not heard of it.

type StepRef = { queue: string } | { job: string }

const FLOW_DEFS: { title: string, steps: StepRef[] }[] = [
	{
		title: '회원 수요 가사',
		steps: [
			{ job: 'lyrics_demand_source' },
			{ queue: 'lyrics_album_jobs' },
			{ queue: 'lyrics_album_tracks' },
			{ job: 'gpt-translate-poller' },
			{ queue: 'lyrics_translation_work:chatgpt/lyrics-ko-v1' },
		],
	},
	{
		title: '수동 요청 · Genius 번역',
		steps: [
			{ queue: 'track_lyrics_translations' },
			{ queue: 'track_genius_annotations' },
			{ job: 'gpt-translate-poller' },
			{ queue: 'lyrics_translation_work:chatgpt/genius-ko-v1' },
		],
	},
	{
		title: '디스코그래피 열거',
		steps: [
			{ job: 'sqs_lyrics_discography_enumerate' },
			{ queue: 'lyrics_artist_discographies' },
		],
	},
	{
		title: '요청형 (사이트 버튼 → Mac 폴러)',
		steps: [
			{ queue: 'album_research' },
			{ job: 'research-poller' },
			{ queue: 'genre_backfill_requests' },
			{ job: 'genre-heal-poller' },
		],
	},
	{
		title: '구버전 Claude 번역',
		steps: [
			{ job: 'lyrics-translate-poller' },
			{ queue: 'lyrics_translation_work:claude.sonnet/v2' },
		],
	},
]

export type FlowStep = { kind: 'queue', queue: AutomationQueue } | { kind: 'job', job: AutomationJob }

export interface Flow {
	title: string
	steps: FlowStep[]
}

export function buildFlows(snapshot: AutomationSnapshot): Flow[] {
	const queues = new Map(snapshot.queues.map(q => [q.key, q]))
	const jobs = new Map(snapshot.jobs.map(j => [j.key, j]))
	const placed = new Set<string>()
	const flows: Flow[] = []
	for (const def of FLOW_DEFS) {
		const steps: FlowStep[] = []
		for (const ref of def.steps) {
			if ('queue' in ref) {
				const q = queues.get(ref.queue)
				if (q) {
					steps.push({ kind: 'queue', queue: q })
					placed.add(q.key)
				}
			}
			else {
				const j = jobs.get(ref.job)
				if (j)
					steps.push({ kind: 'job', job: j })
			}
		}
		if (steps.some(s => s.kind === 'queue'))
			flows.push({ title: def.title, steps })
	}
	const rest = snapshot.queues.filter(q => !placed.has(q.key))
	if (rest.length > 0)
		flows.push({ title: '그 밖의 대기열', steps: rest.map(queue => ({ kind: 'queue' as const, queue })) })
	return flows
}

/** Heartbeat `details` as display text. Never markup: agents write it (2b security-review). */
export function detailsText(details: Record<string, unknown> | undefined): string | null {
	if (!details || Object.keys(details).length === 0)
		return null
	try {
		return JSON.stringify(details, null, 2)
	}
	catch {
		return null
	}
}

// ── 2f: queue detail ──────────────────────────────────────────────────────────

/**
 * Korean names for the reason codes measured on prod (2026-10-12). The code is
 * always shown next to the name; a code not listed here is shown as-is.
 */
export const REASON_LABEL: Record<string, string> = {
	album_not_in_catalog: '카탈로그에 없는 앨범',
	album_partially_ingested: '앨범 일부만 수집됨',
	album_has_no_tracks: '트랙이 없는 앨범',
	not_found: '가사 소스를 못 찾음',
	review_required: '검토 필요',
	already_translated: '이미 번역됨',
	korean_source: '원문이 한국어',
	already_korean: '이미 한국어',
	no_lyrics: '가사 없음',
	temporary_error: '일시 오류',
	output_limit: '출력 한도 초과',
	engine_validation: '엔진 검증 실패',
	unrecognized: '형식 밖 사유(본문은 표시하지 않음)',
}

export function reasonName(code: string | null | undefined): string {
	if (code == null)
		return '사유 기록 없음'
	return REASON_LABEL[code] ?? code
}

/** "3시간 뒤" for a future timestamp, "지남" once it has passed. */
export function untilText(iso: string | null | undefined, now: number = Date.now()): string | null {
	if (!iso)
		return null
	const t = Date.parse(iso)
	if (Number.isNaN(t))
		return null
	if (t <= now)
		return '지남'
	const min = Math.ceil((t - now) / 60000)
	if (min < 60)
		return `${min}분 뒤`
	const hr = Math.floor(min / 60)
	if (hr < 48)
		return `${hr}시간 뒤`
	return `${Math.floor(hr / 24)}일 뒤`
}

/**
 * One sentence on direction, only when both sides were measured. Several
 * "left" columns are approximate (their basis says so), hence "이 기준으로는".
 */
export function flowSentence(entered: number | null | undefined, left: number | null | undefined): string {
	if (entered == null || left == null)
		return '들어옴과 나감 중 잴 수 없는 쪽이 있어 줄고 있는지는 판단하지 않습니다.'
	if (entered === 0 && left === 0)
		return '최근 24시간 동안 들어오거나 나간 행이 없습니다.'
	if (left > entered)
		return '나간 행이 들어온 행보다 많습니다. 이 기준으로는 줄고 있습니다.'
	if (left < entered)
		return '들어온 행이 나간 행보다 많습니다. 이 기준으로는 늘고 있습니다.'
	return '들어온 만큼 나갔습니다.'
}

// ── 2d: AWS evidence ──────────────────────────────────────────────────────────
// Each item carries its own status; `unknown` items have null numbers and must
// read as "읽지 못함", never as 0.

/** Display order of the tally line: what needs attention first. */
export const LIVENESS_ORDER: LivenessStatus[] = ['failing', 'stale', 'fresh', 'unknown']

export function tallyLine(t: Record<LivenessStatus, number>): string {
	return LIVENESS_ORDER.filter(s => t[s] > 0).map(s => `${LIVENESS_LABEL[s]} ${t[s]}`).join(' · ')
}

export interface AlarmSummary {
	ok: number
	/** Names of alarms in ALARM — the ones worth reading. */
	firing: string[]
	/** INSUFFICIENT_DATA or a state the page has not heard of. */
	other: { name: string, state: string }[]
	/** Not read: never folded into ok. */
	unread: number
}

export function summarizeAlarms(alarms: AutomationAwsAlarm[]): AlarmSummary {
	const out: AlarmSummary = { ok: 0, firing: [], other: [], unread: 0 }
	for (const a of alarms) {
		if (a.status !== 'ok' || a.state == null)
			out.unread += 1
		else if (a.state === 'OK')
			out.ok += 1
		else if (a.state === 'ALARM')
			out.firing.push(a.name)
		else
			out.other.push({ name: a.name, state: a.state })
	}
	return out
}

/** "0" stays "0"; null (not read) is "?", never 0. */
export function countText(n: number | null | undefined): string {
	return n == null ? '?' : n.toLocaleString('ko-KR')
}
