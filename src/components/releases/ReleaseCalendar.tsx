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
 * Unlike the home NewReleasesCard (render-nothing degradation), this is a
 * dedicated page: empty months and fetch failures get honest states.
 */
import type { components } from '@lib/api.gen'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { prefetchAlbumDetail } from '@lib/albumDetail'
import { artistHref, openAlbum } from '@lib/entityLinks'

type CalendarResult = components['schemas']['Music_ReleaseCalendarResult']
type CalendarDay = components['schemas']['Music_ReleaseCalendarDay']
type CalendarEvent = components['schemas']['Music_ReleaseCalendarEvent']

type View = 'ledger' | 'grid'

const DOW_KO = ['일', '월', '화', '수', '목', '금', '토']
const DOW_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MONTH_EN = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']

// Ported from the approved mockup (calendar-mockup-a.html), colors mapped to
// the site tokens (light/dark follow the theme automatically).
const SCOPED_CSS = `
.rcal-wrap{max-width:800px;margin:0 auto;padding:48px clamp(16px,4vw,30px) 120px}
.rcal-wrap a{color:inherit;text-decoration:none}
.rcal-wrap button{font:inherit;color:inherit}
.rcal-wrap a:focus-visible,.rcal-wrap button:focus-visible{outline:2px solid var(--color-accent);outline-offset:2px;border-radius:2px}
.rcal-kicker{font-size:10.5px;letter-spacing:.14em;color:var(--color-accent);text-transform:uppercase}
.rcal-h1{font-size:clamp(34px,5vw,48px);font-weight:500;line-height:1.05;margin:10px 0 14px;color:var(--color-text)}
.rcal-lede{font-size:11px;color:var(--color-faded);letter-spacing:.03em;line-height:1.7}
.rcal-controls{display:flex;align-items:center;justify-content:space-between;gap:12px 18px;flex-wrap:wrap;margin:30px 0 8px}
.rcal-range{display:flex;align-items:center;gap:18px;font-size:12px;letter-spacing:.05em}
.rcal-range button{background:none;border:1px solid var(--color-border);padding:4px 12px;border-radius:999px;cursor:pointer;transition:border-color .15s}
.rcal-range button:hover{border-color:var(--color-text)}
.rcal-cur{color:var(--color-subtle)}
.rcal-toggle{display:flex;border:1px solid var(--color-border);border-radius:999px;overflow:hidden}
.rcal-toggle button{background:none;border:0;font-size:11px;letter-spacing:.08em;padding:5px 14px;cursor:pointer;color:var(--color-faded);transition:color .15s}
.rcal-toggle button[aria-pressed=true]{background:var(--color-text);color:var(--color-bg)}
.rcal-toggle button:focus-visible{outline-offset:-2px}
.rcal-note{margin-top:44px;font-size:11px;color:var(--color-faded);letter-spacing:.04em;line-height:1.8}
.rcal-err{margin-top:44px;border:1px solid var(--color-border);padding:20px 22px}
.rcal-err p{font-size:11px;color:var(--color-subtle);letter-spacing:.04em;margin:0 0 12px}
.rcal-err button{background:none;border:1px solid var(--color-border);font-size:11px;letter-spacing:.08em;padding:5px 14px;border-radius:999px;cursor:pointer}
.rcal-err button:hover{border-color:var(--color-text)}
.rcal-month{margin-top:44px;display:flex;align-items:baseline;gap:14px;border-bottom:1px solid var(--color-border);padding-bottom:8px}
.rcal-month .m-num{font-size:26px;font-weight:500;color:var(--color-text)}
.rcal-month .m-meta{font-size:10.5px;color:var(--color-faded);letter-spacing:.08em}
.rcal-day{display:grid;grid-template-columns:92px 1fr;gap:0 26px;padding:26px 0;border-bottom:1px solid var(--color-border-soft)}
.rcal-day:last-of-type{border-bottom:0}
.rcal-day .d-num{font-size:44px;font-weight:400;line-height:.9;letter-spacing:-.02em;color:var(--color-text)}
.rcal-day .d-dow{font-size:10px;letter-spacing:.14em;color:var(--color-faded);margin-top:7px;text-transform:uppercase}
.rcal-wrap .fri{color:var(--color-accent)}
.rcal-day.past{opacity:.45}
.rcal-day.past .d-num{font-style:normal}
.rcal-ev{padding:7px 0;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px}
.rcal-ev + .rcal-ev{border-top:1px dotted var(--color-border-soft)}
.rcal-ev .ev-title{font-size:18px;font-weight:500;line-height:1.25;color:var(--color-text)}
.rcal-ev .ev-title.sm{font-size:15.5px}
.rcal-ev button.ev-title{background:none;border:0;padding:0;cursor:pointer;text-align:left;transition:color .15s}
.rcal-ev button.ev-title:hover{color:var(--color-accent)}
.rcal-ev .ev-artist{font-size:11.5px;color:var(--color-subtle);letter-spacing:.02em}
.rcal-ev a.ev-artist:hover{color:var(--color-text);text-decoration:underline}
.rcal-ev .ev-meta{margin-left:auto;display:flex;gap:8px;align-items:baseline;white-space:nowrap}
.rcal-wrap .tag{font-size:9.5px;letter-spacing:.1em;color:var(--color-faded);border:1px solid var(--color-border-soft);border-radius:999px;padding:2px 8px}
.rcal-wrap .tag.album{color:var(--color-text);border-color:var(--color-border)}
.rcal-wrap .src{font-size:9.5px;letter-spacing:.06em;color:var(--color-faded)}
.rcal-wrap .confirmed{color:var(--color-accent);font-size:9.5px;letter-spacing:.1em}
.rcal-today{display:flex;align-items:center;gap:12px;margin:6px 0;color:var(--color-accent)}
.rcal-today::before,.rcal-today::after{content:'';flex:1;height:1px;background:var(--color-accent)}
.rcal-today span{font-size:10px;letter-spacing:.18em}
.rcal-grid{margin-top:34px}
.rcal-grid .g-head{display:grid;grid-template-columns:repeat(7,1fr);font-size:10px;letter-spacing:.12em;color:var(--color-faded);text-align:center;padding-bottom:8px}
.rcal-grid .g-body{display:grid;grid-template-columns:repeat(7,1fr);border-top:1px solid var(--color-border);border-left:1px solid var(--color-border-soft)}
.rcal-cell{position:relative;min-height:74px;padding:8px 9px;border-right:1px solid var(--color-border-soft);border-bottom:1px solid var(--color-border-soft);display:flex;flex-direction:column;align-items:flex-start;gap:6px;background:none;border-top:0;border-left:0;text-align:left}
.rcal-cell .c-num{font-size:15px;font-weight:400;line-height:1;color:var(--color-text)}
.rcal-cell.blank .c-num{visibility:hidden}
.rcal-cell.past{opacity:.45}
.rcal-cell.past .c-num{font-style:normal}
button.rcal-cell{cursor:pointer;transition:background-color .15s}
button.rcal-cell:hover{background:var(--color-paper)}
button.rcal-cell[aria-pressed=true]{background:var(--color-paper)}
button.rcal-cell[aria-pressed=true] .c-num{color:var(--color-accent)}
button.rcal-cell:focus-visible{outline-offset:-2px}
.rcal-cell .c-dots{display:flex;flex-wrap:wrap;gap:3px;align-items:center}
.rcal-cell .c-dot{width:5px;height:5px;border-radius:50%;background:var(--color-accent)}
.rcal-cell .c-more{font-size:9px;letter-spacing:.04em;color:var(--color-faded)}
.rcal-cell.is-today{box-shadow:inset 0 0 0 1px var(--color-accent)}
.rcal-cell .c-today{font-size:8.5px;letter-spacing:.14em;color:var(--color-accent);position:absolute;top:9px;right:9px}
.rcal-daypanel{margin-top:22px;border-top:1px solid var(--color-border);padding-top:14px}
.rcal-daypanel .dp-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:11px;letter-spacing:.08em;color:var(--color-subtle);margin-bottom:14px}
.rcal-daypanel .dp-close{background:none;border:0;padding:0;cursor:pointer;font-size:10.5px;letter-spacing:.08em;color:var(--color-faded)}
.rcal-daypanel .dp-close:hover{color:var(--color-text)}
.rcal-daypanel .dp-cards{display:grid;gap:10px}
.rcal-card{background:var(--color-paper);border:1px solid var(--color-border-soft);border-radius:6px;padding:14px 16px}
.rcal-card .c-title{display:block;font-size:17px;font-weight:500;line-height:1.3;color:var(--color-text)}
.rcal-card button.c-title{background:none;border:0;padding:0;cursor:pointer;text-align:left;width:100%;transition:color .15s}
.rcal-card button.c-title:hover{color:var(--color-accent)}
.rcal-card .c-artist{display:inline-block;margin-top:4px;font-size:11.5px;color:var(--color-subtle);letter-spacing:.02em}
.rcal-card a.c-artist:hover{color:var(--color-text);text-decoration:underline}
.rcal-card .c-meta{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;margin-top:9px}
.rcal-foot{margin-top:60px;padding-top:14px;border-top:1px solid var(--color-border);font-size:10px;color:var(--color-faded);letter-spacing:.04em;line-height:1.9}
@media (max-width:640px){
  .rcal-day{grid-template-columns:1fr;gap:10px}
  .rcal-day .d-num{font-size:30px;display:inline}
  .rcal-day .d-line{display:flex;align-items:baseline;gap:10px}
  .rcal-day .d-dow{margin-top:0}
  .rcal-ev .ev-meta{margin-left:0;width:100%}
  .rcal-ev .ev-title{font-size:16.5px}
  .rcal-cell{min-height:58px;padding:6px 6px}
  .rcal-cell .c-num{font-size:13px}
  .rcal-cell .c-today{display:none}
}
@media (prefers-reduced-motion:reduce){
  .rcal-wrap *{transition:none!important}
}
`

function pad(n: number) {
	return String(n).padStart(2, '0')
}

/** Local "today" as YYYY-MM-DD (the calendar is a local-date ledger). */
function todayIso(): string {
	const d = new Date()
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
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

function dowIndex(iso: string): number {
	return new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))).getDay()
}

function typeLabel(t: string | null | undefined): string | null {
	if (t === 'album')
		return '정규'
	if (t === 'ep')
		return 'EP'
	if (t === 'single')
		return '싱글'
	if (t === 'other')
		return '기타'
	return null
}

const SOURCE_LABEL: Record<string, string> = { musicbrainz: 'MB', itunes: 'iTunes', spotify: 'SP' }

function sourcesLabel(sources: string[] | undefined): string {
	return (sources ?? []).map(s => SOURCE_LABEL[s] ?? s).join(' · ')
}

// ── released → album overlay ────────────────────────────────────────────────
// The calendar event carries a spotify_album_id; the overlay's detail fetch is
// DB-id based (lib/albumDetail), so resolve via /albums/by-spotify first (same
// pattern as TodaySongPicker). On resolve failure we still open the overlay
// with the display identity — it degrades to a header-only window.
const dbIdCache = new Map<string, Promise<string | null>>()

function resolveDbAlbumId(spotifyId: string): Promise<string | null> {
	const hit = dbIdCache.get(spotifyId)
	if (hit)
		return hit
	const base = import.meta.env.PUBLIC_API_URL as string
	const p = fetch(`${base}/api/music/albums/by-spotify/${encodeURIComponent(spotifyId)}`)
		.then(r => (r.ok ? r.json() as Promise<{ album?: { id?: string } }> : null))
		.then(j => j?.album?.id ?? null)
		.catch(() => null)
	dbIdCache.set(spotifyId, p)
	return p
}

function isOpenable(ev: CalendarEvent): boolean {
	return ev.status === 'released' && !!ev.spotify_album_id
}

function warmReleased(ev: CalendarEvent): void {
	if (!isOpenable(ev))
		return
	void resolveDbAlbumId(ev.spotify_album_id!).then(id => prefetchAlbumDetail(id))
}

async function openReleased(ev: CalendarEvent): Promise<void> {
	if (!isOpenable(ev))
		return
	const dbId = await resolveDbAlbumId(ev.spotify_album_id!)
	const year = Number(ev.release_date.slice(0, 4)) || null
	openAlbum({ albumId: dbId ?? ev.spotify_album_id!, title: ev.title, artist: ev.artist_name, year })
}

// ── shared row/card pieces ──────────────────────────────────────────────────

function EventMeta({ ev }: { ev: CalendarEvent }) {
	const tag = typeLabel(ev.release_type)
	const src = sourcesLabel(ev.sources)
	return (
		<>
			{isOpenable(ev) && <span className="confirmed mono">★ 확정</span>}
			{tag && <span className={`tag mono${ev.release_type === 'album' ? ' album' : ''}`}>{tag}</span>}
			{src && <span className="src mono">{src}</span>}
		</>
	)
}

function EventRow({ ev }: { ev: CalendarEvent }) {
	const sm = ev.release_type !== 'album'
	return (
		<div className="rcal-ev">
			{isOpenable(ev) ?
				(
					<button
						type="button"
						className={`ev-title serif italic${sm ? ' sm' : ''}`}
						title={`${ev.title} · 앨범 보기`}
						onPointerEnter={() => warmReleased(ev)}
						onFocus={() => warmReleased(ev)}
						onClick={() => void openReleased(ev)}
					>
						{ev.title}
					</button>
				) :
				<span className={`ev-title serif italic${sm ? ' sm' : ''}`}>{ev.title}</span>}
			<a className="ev-artist mono" href={artistHref(ev.artist_id)} title={`${ev.artist_name} 아티스트`}>{ev.artist_name}</a>
			<span className="ev-meta"><EventMeta ev={ev} /></span>
		</div>
	)
}

function EventCard({ ev }: { ev: CalendarEvent }) {
	return (
		<article className="rcal-card">
			{isOpenable(ev) ?
				(
					<button
						type="button"
						className="c-title serif italic"
						title={`${ev.title} · 앨범 보기`}
						onPointerEnter={() => warmReleased(ev)}
						onFocus={() => warmReleased(ev)}
						onClick={() => void openReleased(ev)}
					>
						{ev.title}
					</button>
				) :
				<span className="c-title serif italic">{ev.title}</span>}
			<a className="c-artist mono" href={artistHref(ev.artist_id)} title={`${ev.artist_name} 아티스트`}>{ev.artist_name}</a>
			<div className="c-meta"><EventMeta ev={ev} /></div>
		</article>
	)
}

function EmptyMonth() {
	return <p className="rcal-note mono">이 달엔 관측된 발매가 없습니다.</p>
}

// ── 장부 (ledger) view ──────────────────────────────────────────────────────

function TodayRule({ today }: { today: string }) {
	const m = Number(today.slice(5, 7))
	const d = Number(today.slice(8, 10))
	return (
		<div className="rcal-today mono" role="separator" aria-label={`오늘 ${m}월 ${d}일`}>
			<span>{`오늘 · ${m}월 ${d}일`}</span>
		</div>
	)
}

function LedgerDay({ day, past }: { day: CalendarDay, past: boolean }) {
	const dnum = Number(day.date.slice(8, 10))
	const dow = dowIndex(day.date)
	const dowLabel = `${DOW_KO[dow]} ${DOW_EN[dow]}`
	return (
		<div className={`rcal-day${past ? ' past' : ''}`}>
			<div className="d-line">
				<div className="d-num serif italic">{dnum}</div>
				<div className="d-dow mono">{dow === 5 ? <span className="fri">{dowLabel}</span> : dowLabel}</div>
			</div>
			<div>
				{(day.events ?? []).map(ev => <EventRow key={`${ev.artist_id}:${ev.title}`} ev={ev} />)}
			</div>
		</div>
	)
}

function LedgerView({ month, days, today }: { month: string, days: CalendarDay[], today: string }) {
	const total = days.reduce((n, d) => n + (d.events?.length ?? 0), 0)
	const m = Number(month.slice(5, 7))
	const inThisMonth = today.slice(0, 7) === month
	const rows: ReactNode[] = []
	let ruleShown = !inThisMonth
	for (const day of days) {
		if (!ruleShown && day.date >= today) {
			rows.push(<TodayRule key="today-rule" today={today} />)
			ruleShown = true
		}
		rows.push(<LedgerDay key={day.date} day={day} past={day.date < today} />)
	}
	if (!ruleShown)
		rows.push(<TodayRule key="today-rule" today={today} />)
	return (
		<section aria-label={`${m}월 발매 장부`}>
			<div className="rcal-month">
				<span className="m-num serif italic">{`${m}월`}</span>
				<span className="m-meta mono">{`${MONTH_EN[m - 1]} · ${total} RELEASES`}</span>
			</div>
			{total === 0 ? <EmptyMonth /> : rows}
		</section>
	)
}

// ── 달력 (grid) view ────────────────────────────────────────────────────────

const MAX_DOTS = 4

function GridView({ month, days, today, selected, onSelect }: {
	month: string
	days: CalendarDay[]
	today: string
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
	const total = days.reduce((n, d) => n + (d.events?.length ?? 0), 0)

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
			{total === 0 && <EmptyMonth />}
			{selected && selectedEvents && (
				<div className="rcal-daypanel" role="region" aria-label={`${m}월 ${Number(selected.slice(8, 10))}일 발매`}>
					<div className="dp-head mono">
						<span>{`${m}월 ${Number(selected.slice(8, 10))}일 ${DOW_KO[dowIndex(selected)]}요일 · ${selectedEvents.length}건`}</span>
						<button type="button" className="dp-close mono" onClick={() => onSelect(null)}>닫기 ×</button>
					</div>
					<div className="dp-cards">
						{selectedEvents.map(ev => <EventCard key={`${ev.artist_id}:${ev.title}`} ev={ev} />)}
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
	const [retryTick, setRetryTick] = useState(0)
	const cacheRef = useRef(new Map<string, CalendarResult>())

	// Init from the URL (?view=grid&month=YYYY-MM); defaults = ledger + current month.
	useEffect(() => {
		const sp = new URLSearchParams(window.location.search)
		setView(sp.get('view') === 'grid' ? 'grid' : 'ledger')
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
		const qs = sp.toString()
		window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
	}, [view, month])

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

	return (
		<div className="rcal-wrap">
			<style>{SCOPED_CSS}</style>
			<p className="rcal-kicker mono">Release Calendar · 관측 기반</p>
			<h1 className="rcal-h1 serif italic">발매 캘린더</h1>
			<p className="rcal-lede mono">
				MusicBrainz · iTunes에서 관측한 발매 예고와 Spotify로 확정된 발매를 한 곳에.
				<br />
				발매 전 정보는 예고 시점의 관측이며, 카탈로그 확인 후 ★ 확정으로 표시됩니다.
			</p>

			{view && month && (
				<div className="rcal-controls">
					<nav className="rcal-range mono" aria-label="월 이동">
						<button type="button" onClick={() => nav(-1)}>‹ 이전</button>
						<span className="rcal-cur" aria-live="polite">{`${y}년 ${m}월`}</span>
						<button type="button" onClick={() => nav(1)}>다음 ›</button>
					</nav>
					<div className="rcal-toggle mono" role="group" aria-label="보기 전환">
						<button type="button" aria-pressed={view === 'ledger'} onClick={() => setView('ledger')}>장부</button>
						<button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>달력</button>
					</div>
				</div>
			)}

			{status === 'loading' && <p className="rcal-note mono">불러오는 중…</p>}
			{status === 'error' && (
				<div className="rcal-err">
					<p className="mono">발매 장부를 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.</p>
					<button type="button" className="mono" onClick={() => setRetryTick(t => t + 1)}>다시 시도</button>
				</div>
			)}
			{status === 'ok' && data && view && month && (
				view === 'ledger' ?
					<LedgerView month={month} days={data.days ?? []} today={today} /> :
					<GridView month={month} days={data.days ?? []} today={today} selected={selectedDay} onSelect={setSelectedDay} />
			)}

			<p className="rcal-foot mono">
				관측 소스 — MB: MusicBrainz 릴리스 그룹 · iTunes: 프리오더 룩업 · SP: Spotify 카탈로그 확정.
				<br />
				★ 확정 항목은 앨범 상세로 열리고, 아티스트명은 아티스트 허브로 이동합니다.
			</p>
		</div>
	)
}
