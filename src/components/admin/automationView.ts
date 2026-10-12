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
import type { AutomationJob, AutomationQueue, AutomationSnapshot, AutomationSource, Liveness } from './automation.api'

export type LivenessStatus = Liveness['status']
export type Location = AutomationJob['location']
export type DeclaredState = AutomationJob['declared_state']

export const LIVENESS_LABEL: Record<LivenessStatus, string> = {
	fresh: '최근 확인',
	stale: '멈춤',
	unknown: '증거 없음',
}

export const LIVENESS_HINT: Record<LivenessStatus, string> = {
	fresh: '허용 간격 안에 실행 신호가 들어왔습니다.',
	stale: '신호가 들어온 적은 있지만 허용 간격을 넘겼습니다.',
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
	const tally: Record<LivenessStatus, number> = { fresh: 0, stale: 0, unknown: 0 }
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
