/**
 * 발매 캘린더 — FEAT-release-calendar Step 7 (owner mockup gate: "발매 장부"
 * ledger variant approved 2026-07-13, plus a month-grid 달력 view toggle).
 *
 * Public read of GET /api/music/releases/calendar (myblog_music, DB-only,
 * CloudFront-cached 60s). Fetched one month at a time (the API caps windows at
 * 93 days); months are cached in-memory for the session.
 *
 * Two views, URL-addressable (?view=grid&month=YYYY-MM; defaults — ledger +
 * current month — are omitted from the query string):
 *   · 장부 (default): month divider, big serif-italic date numerals + mono dow
 *     (금 FRI accented), ledger event rows, a red '오늘' hairline rule between
 *     past and future, past days faded.
 *   · 달력: 7-col month grid (일 first, KR convention); day cells with events
 *     are buttons that open that day's events as CARDS in an inline panel.
 *
 * Announced events have no album to open — the title is plain text and only
 * the artist links out (artistHref). Released events (★ 확정) resolve their
 * spotify_album_id → DB album id via /albums/by-spotify (the overlay's detail
 * fetch is DB-id based) and open the app-wide album overlay (openAlbum; host
 * mounted in layout.astro). Pointer intent warms the resolve + detail caches.
 *
 * Filters (audit #16 — ~80% of a month's events are singles; owner decision
 * 2026-10-20: type + status chips, default 전체): ?type=album|single and
 * ?status=released|announced, applied client-side to the fetched month in both
 * views. 앨범·EP groups album + ep; 'other' (≈1 a month) shows only under 전체.
 * Each chip's count is computed with the OTHER filter applied (faceted).
 *
 * Unlike the home NewReleasesCard (render-nothing degradation), this is a
 * dedicated page: empty months and fetch failures get honest states.
 *
 * The event-level display pieces + the rcal-* stylesheet live in
 * releaseShared.tsx, SHARED with the personal 발매 레이더 (/radar) — edits
 * there restyle both pages (owner decision, personal-release-tracking Step 5).
 */
import type { components } from '@lib/api.gen'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { ReleaseEventLike } from './releaseShared'
import {
	DOW_KO,
	dowIndex,
	EventCard,
	LedgerDay,
	MONTH_EN,
	pad,
	RELEASE_BASE_CSS,
	todayIso,
	TodayRule,
} from './releaseShared'

type CalendarResult = components['schemas']['Music_ReleaseCalendarResult']
type CalendarDay = components['schemas']['Music_ReleaseCalendarDay']
type CalendarEvent = components['schemas']['Music_ReleaseCalendarEvent']

type View = 'ledger' | 'grid'
type TypeFilter = 'all' | 'album' | 'single'
type StatusFilter = 'all' | 'released' | 'announced'

const TYPE_CHIPS: { key: TypeFilter, label: string }[] = [
	{ key: 'all', label: '전체' },
	{ key: 'album', label: '앨범·EP' },
	{ key: 'single', label: '싱글' },
]
const STATUS_CHIPS: { key: StatusFilter, label: string }[] = [
	{ key: 'all', label: '전체' },
	{ key: 'released', label: '★ 확정' },
	{ key: 'announced', label: '예고' },
]

function matchesType(ev: CalendarEvent, t: TypeFilter): boolean {
	if (t === 'all')
		return true
	return t === 'album' ? ev.release_type === 'album' || ev.release_type === 'ep' : ev.release_type === 'single'
}

function matchesStatus(ev: CalendarEvent, s: StatusFilter): boolean {
	return s === 'all' || ev.status === s
}

/** Days narrowed to the matching events; days left with none are dropped. */
export function filterDays(days: CalendarDay[], type: TypeFilter, status: StatusFilter): CalendarDay[] {
	if (type === 'all' && status === 'all')
		return days
	const out: CalendarDay[] = []
	for (const d of days) {
		const events = (d.events ?? []).filter(ev => matchesType(ev, type) && matchesStatus(ev, status))
		if (events.length)
			out.push({ ...d, events })
	}
	return out
}

function countEvents(days: CalendarDay[]): number {
	return days.reduce((n, d) => n + (d.events?.length ?? 0), 0)
}

function currentYm(): string {
	return todayIso().slice(0, 7)
}

function isYm(s: string | null): s is string {
	return !!s && /^\d{4}-\d{2}$/.test(s) && Number(s.slice(5, 7)) >= 1 && Number(s.slice(5, 7)) <= 12
}

function addMonths(ym: string, delta: number): string {
	const y = Number(ym.slice(0, 4))
	const m = Number(ym.slice(5, 7))
	const d = new Date(y, m - 1 + delta, 1)
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

/** First/last day of a month — always ≤31 days, well under the API's 93-day cap. */
function monthRange(ym: string): { from: string, to: string } {
	const y = Number(ym.slice(0, 4))
	const m = Number(ym.slice(5, 7))
	const last = new Date(y, m, 0).getDate()
	return { from: `${ym}-01`, to: `${ym}-${pad(last)}` }
}

function EmptyMonth({ filtered }: { filtered: boolean }) {
	return <p className="rcal-note mono">{filtered ? '이 달엔 고른 조건에 맞는 발매가 없습니다.' : '이 달엔 알려진 발매가 없습니다.'}</p>
}

// Calendar-only: the filter chip rows (same pill language as .rcal-toggle).
const FILTER_CSS = `
.rcal-filters{display:flex;flex-direction:column;gap:8px;margin:14px 0 4px}
.rcal-frow{display:flex;align-items:center;gap:6px 8px;flex-wrap:wrap;font-size:11px;letter-spacing:.06em}
.rcal-frow .f-label{color:var(--color-faded);min-width:30px}
.rcal-frow button{background:none;border:1px solid var(--color-border);border-radius:999px;padding:4px 12px;cursor:pointer;color:var(--color-faded);transition:color .15s,border-color .15s}
.rcal-frow button:hover{color:var(--color-text);border-color:var(--color-text)}
.rcal-frow button[aria-pressed=true]{background:var(--color-text);border-color:var(--color-text);color:var(--color-bg)}
.rcal-frow .f-n{margin-left:6px;opacity:.7}
@media (max-width:640px){
  .rcal-frow button{min-height:44px;padding:0 14px}
}
`

function FilterRow<K extends string>({ label, chips, value, counts, onChange }: {
	label: string
	chips: { key: K, label: string }[]
	value: K
	/** null while the month loads — chips stay put, counts wait. */
	counts: Record<K, number> | null
	onChange: (k: K) => void
}) {
	return (
		<div className="rcal-frow mono" role="group" aria-label={`${label} 필터`}>
			<span className="f-label" aria-hidden="true">{label}</span>
			{chips.map(c => (
				<button
					key={c.key}
					type="button"
					aria-pressed={value === c.key}
					aria-label={counts ? `${c.label} ${counts[c.key]}건` : c.label}
					onClick={() => onChange(c.key)}
				>
					{c.label}
					{counts && <span className="f-n" aria-hidden="true">{counts[c.key]}</span>}
				</button>
			))}
		</div>
	)
}

// ── 장부 (ledger) view ──────────────────────────────────────────────────────

function LedgerView({ month, days, today, unfiltered }: { month: string, days: CalendarDay[], today: string, unfiltered: number }) {
	const total = countEvents(days)
	const filtered = total !== unfiltered
	const m = Number(month.slice(5, 7))
	const inThisMonth = today.slice(0, 7) === month
	const rows: ReactNode[] = []
	let ruleShown = !inThisMonth
	for (const day of days) {
		if (!ruleShown && day.date >= today) {
			rows.push(<TodayRule key="today-rule" today={today} />)
			ruleShown = true
		}
		rows.push(<LedgerDay key={day.date} day={{ date: day.date, events: (day.events ?? []) as ReleaseEventLike[] }} past={day.date < today} />)
	}
	if (!ruleShown)
		rows.push(<TodayRule key="today-rule" today={today} />)
	return (
		<section aria-label={`${m}월 발매 목록`}>
			<div className="rcal-month">
				<span className="m-num serif italic">{`${m}월`}</span>
				<span className="m-meta mono">{`${MONTH_EN[m - 1]} · ${filtered ? `${total} / ${unfiltered}` : total} RELEASES`}</span>
			</div>
			{total === 0 ? <EmptyMonth filtered={unfiltered > 0} /> : rows}
		</section>
	)
}

// ── 달력 (grid) view ────────────────────────────────────────────────────────

const MAX_DOTS = 4

function GridView({ month, days, today, unfiltered, selected, onSelect }: {
	month: string
	days: CalendarDay[]
	today: string
	unfiltered: number
	selected: string | null
	onSelect: (date: string | null) => void
}) {
	const byDate = new Map<string, CalendarEvent[]>()
	for (const d of days) {
		if (d.events?.length)
			byDate.set(d.date, d.events)
	}
	const y = Number(month.slice(0, 4))
	const m = Number(month.slice(5, 7))
	const firstDow = new Date(y, m - 1, 1).getDay()
	const lastDay = new Date(y, m, 0).getDate()
	const total = countEvents(days)

	const cells: ReactNode[] = []
	for (let i = 0; i < firstDow; i++)
		cells.push(<div key={`blank-${i}`} className="rcal-cell blank" aria-hidden="true"><span className="c-num serif italic">0</span></div>)
	for (let d = 1; d <= lastDay; d++) {
		const iso = `${month}-${pad(d)}`
		const events = byDate.get(iso)
		const isToday = iso === today
		const past = iso < today
		const cls = `rcal-cell${past ? ' past' : ''}${isToday ? ' is-today' : ''}`
		const num = <span className="c-num serif italic">{d}</span>
		const todayMark = isToday && <span className="c-today mono" aria-hidden="true">오늘</span>
		if (events) {
			const n = events.length
			cells.push(
				<button
					key={iso}
					type="button"
					className={cls}
					aria-pressed={selected === iso}
					aria-label={`${m}월 ${d}일 ${DOW_KO[dowIndex(iso)]}요일 · 발매 ${n}건${isToday ? ' (오늘)' : ''}`}
					onClick={() => onSelect(selected === iso ? null : iso)}
				>
					{num}
					{todayMark}
					<span className="c-dots" aria-hidden="true">
						{Array.from({ length: Math.min(n, MAX_DOTS) }, (_, i) => <span key={i} className="c-dot" />)}
						{n > MAX_DOTS && <span className="c-more mono">{`+${n - MAX_DOTS}`}</span>}
					</span>
				</button>,
			)
		}
		else {
			cells.push(
				<div key={iso} className={cls}>
					{num}
					{todayMark}
				</div>,
			)
		}
	}

	const selectedEvents = selected ? byDate.get(selected) : undefined

	return (
		<section className="rcal-grid" aria-label={`${m}월 발매 달력`}>
			<div className="g-head mono" aria-hidden="true">
				{DOW_KO.map((k, i) => <span key={k} className={i === 5 ? 'fri' : undefined}>{k}</span>)}
			</div>
			<div className="g-body">{cells}</div>
			{total === 0 && <EmptyMonth filtered={unfiltered > 0} />}
			{selected && selectedEvents && (
				<div className="rcal-daypanel" role="region" aria-label={`${m}월 ${Number(selected.slice(8, 10))}일 발매`}>
					<div className="dp-head mono">
						<span>{`${m}월 ${Number(selected.slice(8, 10))}일 ${DOW_KO[dowIndex(selected)]}요일 · ${selectedEvents.length}건`}</span>
						<button type="button" className="dp-close mono" onClick={() => onSelect(null)}>닫기 ×</button>
					</div>
					<div className="dp-cards">
						{selectedEvents.map(ev => <EventCard key={`${ev.artist_id}:${ev.title}`} ev={ev as ReleaseEventLike} />)}
					</div>
				</div>
			)}
		</section>
	)
}

// ── page island ─────────────────────────────────────────────────────────────

export default function ReleaseCalendar() {
	// null until the client reads the URL — the build-time SSR pass renders the
	// static page chrome only (no date-dependent markup → no hydration drift).
	const [view, setView] = useState<View | null>(null)
	const [month, setMonth] = useState<string | null>(null)
	const [data, setData] = useState<CalendarResult | null>(null)
	const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')
	const [selectedDay, setSelectedDay] = useState<string | null>(null)
	const [typeF, setTypeF] = useState<TypeFilter>('all')
	const [statusF, setStatusF] = useState<StatusFilter>('all')
	const [retryTick, setRetryTick] = useState(0)
	const cacheRef = useRef(new Map<string, CalendarResult>())

	// Init from the URL (?view=grid&month=YYYY-MM&type=…&status=…); defaults =
	// ledger + current month + 전체/전체.
	useEffect(() => {
		const sp = new URLSearchParams(window.location.search)
		setView(sp.get('view') === 'grid' ? 'grid' : 'ledger')
		const t = sp.get('type')
		setTypeF(t === 'album' || t === 'single' ? t : 'all')
		const s = sp.get('status')
		setStatusF(s === 'released' || s === 'announced' ? s : 'all')
		const m = sp.get('month')
		setMonth(isYm(m) ? m : currentYm())
	}, [])

	// Reflect state back into the query string (defaults omitted → clean URLs).
	useEffect(() => {
		if (!view || !month)
			return
		const sp = new URLSearchParams(window.location.search)
		if (view === 'grid')
			sp.set('view', 'grid')
		else sp.delete('view')
		if (month !== currentYm())
			sp.set('month', month)
		else sp.delete('month')
		if (typeF !== 'all')
			sp.set('type', typeF)
		else sp.delete('type')
		if (statusF !== 'all')
			sp.set('status', statusF)
		else sp.delete('status')
		const qs = sp.toString()
		window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
	}, [view, month, typeF, statusF])

	// Fetch one month per navigation (well under the API's 93-day window cap).
	useEffect(() => {
		if (!month)
			return
		const cached = cacheRef.current.get(month)
		if (cached) {
			setData(cached)
			setStatus('ok')
			return
		}
		let alive = true
		setStatus('loading')
		const { from, to } = monthRange(month)
		const base = import.meta.env.PUBLIC_API_URL as string
		fetch(`${base}/api/music/releases/calendar?from=${from}&to=${to}`)
			.then(r => (r.ok ? r.json() as Promise<CalendarResult> : Promise.reject(new Error(`calendar ${r.status}`))))
			.then((j) => {
				if (!alive)
					return
				cacheRef.current.set(month, j)
				setData(j)
				setStatus('ok')
			})
			.catch(() => {
				if (alive)
					setStatus('error')
			})
		return () => {
			alive = false
		}
	}, [month, retryTick])

	const nav = (delta: number) => {
		if (!month)
			return
		setMonth(addMonths(month, delta))
		setSelectedDay(null)
	}

	const y = month ? Number(month.slice(0, 4)) : null
	const m = month ? Number(month.slice(5, 7)) : null
	const today = todayIso()

	const allDays = data?.days ?? []
	const shownDays = filterDays(allDays, typeF, statusF)
	const byStatus = filterDays(allDays, 'all', statusF)
	const byType = filterDays(allDays, typeF, 'all')
	const typeCounts = {
		all: countEvents(byStatus),
		album: countEvents(filterDays(byStatus, 'album', 'all')),
		single: countEvents(filterDays(byStatus, 'single', 'all')),
	}
	const statusCounts = {
		all: countEvents(byType),
		released: countEvents(filterDays(byType, 'all', 'released')),
		announced: countEvents(filterDays(byType, 'all', 'announced')),
	}
	const unfiltered = countEvents(allDays)

	return (
		<div className="rcal-wrap">
			<style>{RELEASE_BASE_CSS + FILTER_CSS}</style>
			<p className="rcal-kicker mono">Release Calendar</p>
			<h1 className="rcal-h1 serif italic">발매 캘린더</h1>
			<p className="rcal-lede mono">
				곧 나올 앨범 소식과 이미 나온 앨범을 한 곳에.
				<br />
				발매 전 정보는 예고 기준이라 바뀔 수 있어요. 발매가 확인되면 ★ 확정으로 표시합니다.
				<br />
				<a href="/radar/">내가 추적하는 아티스트만 보려면 → 발매 레이더</a>
			</p>

			{view && month && (
				<div className="rcal-controls">
					<nav className="rcal-range mono" aria-label="월 이동">
						<button type="button" onClick={() => nav(-1)}>‹ 이전</button>
						<span className="rcal-cur" aria-live="polite">{`${y}년 ${m}월`}</span>
						<button type="button" onClick={() => nav(1)}>다음 ›</button>
					</nav>
					<div className="rcal-toggle mono" role="group" aria-label="보기 전환">
						<button type="button" aria-pressed={view === 'ledger'} onClick={() => setView('ledger')}>목록</button>
						<button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>달력</button>
					</div>
				</div>
			)}

			{view && month && (
				<div className="rcal-filters">
					<FilterRow label="유형" chips={TYPE_CHIPS} value={typeF} counts={status === 'ok' ? typeCounts : null} onChange={setTypeF} />
					<FilterRow label="상태" chips={STATUS_CHIPS} value={statusF} counts={status === 'ok' ? statusCounts : null} onChange={setStatusF} />
				</div>
			)}

			{status === 'loading' && <p className="rcal-note mono">불러오는 중…</p>}
			{status === 'error' && (
				<div className="rcal-err">
					<p className="mono">발매 목록을 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.</p>
					<button type="button" className="mono" onClick={() => setRetryTick(t => t + 1)}>다시 시도</button>
				</div>
			)}
			{status === 'ok' && data && view && month && (
				view === 'ledger' ?
					<LedgerView month={month} days={shownDays} today={today} unfiltered={unfiltered} /> :
					<GridView month={month} days={shownDays} today={today} unfiltered={unfiltered} selected={selectedDay} onSelect={setSelectedDay} />
			)}

			<p className="rcal-foot mono">
				출처 — MusicBrainz · iTunes 예약 판매 · Spotify(발매 확정)
				<br />
				★ 확정은 카탈로그 확인 상태이며, 연결된 항목은 앨범 상세로 열립니다. 아티스트명은 아티스트 허브로 이동합니다.
			</p>
		</div>
	)
}
