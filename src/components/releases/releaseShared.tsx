/**
 * Shared release display core — used by BOTH the public 발매 캘린더
 * (/releases, ReleaseCalendar.tsx) and the personal 발매 레이더
 * (/radar, ReleaseRadar.tsx).
 *
 * Owner decision (FEAT-personal-release-tracking Step 5, 2026-07-18): the two
 * pages share one visual system — an edit to anything in this module changes
 * both pages together; page-specific looks live in each island's own extra CSS
 * and assembly components, layered ON TOP of this base.
 *
 * Contents: the rcal-* scoped stylesheet, date/label helpers, the released →
 * album-overlay plumbing (resolve spotify id → DB id, warm caches, open), and
 * the event-level display components (EventMeta / EventRow / EventCard /
 * TodayRule / LedgerDay). Month/grid assembly stays in ReleaseCalendar; feed
 * assembly stays in ReleaseRadar.
 */
import { prefetchAlbumDetail } from '@lib/albumDetail'
import { artistHref, openAlbum } from '@lib/entityLinks'
import { resolveDbAlbumId } from '@lib/spotifyCatalog'

/**
 * Structural event shape both data sources satisfy: the public calendar's
 * Music_ReleaseCalendarEvent (carries `sources`, no `trust`) and the personal
 * feed's Backend_ReleaseFeedItem (carries `trust`, no `sources`). Components
 * here render whichever facets are present.
 */
export interface ReleaseEventLike {
	artist_id: string
	artist_name: string
	title: string
	release_date: string
	release_type?: string | null
	status: string
	spotify_album_id?: string | null
	sources?: string[]
	/** 3-badge trust grade (확정/예정/불확실) — personal feed only. */
	trust?: string | null
}

/** One ledger day: a date plus its events (calendar day or feed date-group). */
export interface ReleaseDayGroup {
	date: string
	events: ReleaseEventLike[]
}

export const DOW_KO = ['일', '월', '화', '수', '목', '금', '토']
export const DOW_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
export const MONTH_EN = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']

// Ported from the approved calendar mockup (calendar-mockup-a.html), colors
// mapped to the site tokens (light/dark follow the theme automatically).
// `.trust` renders the personal feed's exceptional badges (예정 dashed-accent,
// 불확실 dashed-faded) — the 확정 state stays the calendar's ★ mark.
export const RELEASE_BASE_CSS = `
.rcal-wrap{max-width:800px;margin:0 auto;padding:48px clamp(16px,4vw,30px) 120px}
.rcal-wrap a{color:inherit;text-decoration:none}
.rcal-wrap button{font:inherit;color:inherit}
.rcal-wrap a:focus-visible,.rcal-wrap button:focus-visible{outline:2px solid var(--color-accent);outline-offset:2px;border-radius:2px}
.rcal-kicker{font-size:10.5px;letter-spacing:.14em;color:var(--color-accent);text-transform:uppercase}
.rcal-h1{font-size:clamp(34px,5vw,48px);font-weight:500;line-height:1.05;margin:10px 0 14px;color:var(--color-text)}
.rcal-lede{font-size:11px;color:var(--color-faded);letter-spacing:.03em;line-height:1.7}
.rcal-lede a{color:var(--color-subtle);border-bottom:1px dotted var(--color-border)}
.rcal-lede a:hover{color:var(--color-text);border-bottom-color:var(--color-text)}
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
.rcal-wrap .trust{font-size:9.5px;letter-spacing:.1em;border-radius:999px;padding:2px 8px;border:1px dashed var(--color-border)}
.rcal-wrap .trust.soon{color:var(--color-accent);border-color:var(--color-accent)}
.rcal-wrap .trust.shaky{color:var(--color-faded)}
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
.rcal-card .c-date{display:block;font-size:10px;letter-spacing:.1em;color:var(--color-subtle);margin-bottom:7px}
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

export function pad(n: number) {
	return String(n).padStart(2, '0')
}

/** Local "today" as YYYY-MM-DD (both pages are local-date ledgers). */
export function todayIso(): string {
	const d = new Date()
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function dowIndex(iso: string): number {
	return new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))).getDay()
}

export function typeLabel(t: string | null | undefined): string | null {
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

export const SOURCE_LABEL: Record<string, string> = { musicbrainz: 'MB', itunes: 'iTunes', spotify: 'SP' }

export function sourcesLabel(sources: string[] | undefined): string {
	return (sources ?? []).map(s => SOURCE_LABEL[s] ?? s).join(' · ')
}

// ── released → album overlay ────────────────────────────────────────────────
// The event carries a spotify_album_id; the overlay's detail fetch is DB-id
// based (lib/albumDetail), so resolve via /albums/by-spotify first (same
// pattern as TodaySongPicker; resolver shared via @lib/spotifyCatalog since
// member-player Step 3). On resolve failure we still open the overlay with the
// display identity — it degrades to a header-only window.

export function isOpenable(ev: ReleaseEventLike): boolean {
	return ev.status === 'released' && !!ev.spotify_album_id
}

/** Confirmation is a trust/display fact, not the same as overlay capability. */
export function isConfirmed(ev: ReleaseEventLike): boolean {
	return ev.trust === '확정' || ev.status === 'released' || !!ev.spotify_album_id
}

export function warmReleased(ev: ReleaseEventLike): void {
	if (!isOpenable(ev))
		return
	void resolveDbAlbumId(ev.spotify_album_id!).then(id => prefetchAlbumDetail(id))
}

export async function openReleased(ev: ReleaseEventLike): Promise<void> {
	if (!isOpenable(ev))
		return
	const dbId = await resolveDbAlbumId(ev.spotify_album_id!)
	const year = Number(ev.release_date.slice(0, 4)) || null
	openAlbum({ albumId: dbId ?? ev.spotify_album_id!, title: ev.title, artist: ev.artist_name, year })
}

// ── shared row/card pieces ──────────────────────────────────────────────────

/**
 * Personal-feed trust badge — rendered only for the exceptional grades
 * (예정/불확실, owner rebuttal round 2026-07-08); 확정 stays the ★ mark.
 */
function TrustBadge({ trust }: { trust: string | null | undefined }) {
	if (trust !== '예정' && trust !== '불확실')
		return null
	return <span className={`trust mono ${trust === '예정' ? 'soon' : 'shaky'}`}>{trust}</span>
}

export function EventMeta({ ev }: { ev: ReleaseEventLike }) {
	const tag = typeLabel(ev.release_type)
	const src = sourcesLabel(ev.sources)
	return (
		<>
			{isConfirmed(ev) && <span className="confirmed mono">★ 확정</span>}
			<TrustBadge trust={ev.trust} />
			{tag && <span className={`tag mono${ev.release_type === 'album' ? ' album' : ''}`}>{tag}</span>}
			{src && <span className="src mono">{src}</span>}
		</>
	)
}

export function EventRow({ ev }: { ev: ReleaseEventLike }) {
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
			<a className="ev-artist mono" href={artistHref(ev.artist_id)} title={`${ev.artist_name} 아티스트`}>
				{ev.trust ? `추적: ${ev.artist_name}` : ev.artist_name}
			</a>
			<span className="ev-meta"><EventMeta ev={ev} /></span>
		</div>
	)
}

export function EventCard({ ev, showDate = false }: { ev: ReleaseEventLike, showDate?: boolean }) {
	// showDate: the calendar renders cards under a day panel (date is context);
	// the radar's upcoming strip has no such context, so the card carries it.
	const dow = dowIndex(ev.release_date)
	return (
		<article className="rcal-card">
			{showDate && (
				<span className="c-date mono">
					{`${Number(ev.release_date.slice(5, 7))}월 ${Number(ev.release_date.slice(8, 10))}일 `}
					<span className={dow === 5 ? 'fri' : undefined}>{DOW_KO[dow]}</span>
				</span>
			)}
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
			<a className="c-artist mono" href={artistHref(ev.artist_id)} title={`${ev.artist_name} 아티스트`}>
				{ev.trust ? `추적: ${ev.artist_name}` : ev.artist_name}
			</a>
			<div className="c-meta"><EventMeta ev={ev} /></div>
		</article>
	)
}

// ── ledger pieces ───────────────────────────────────────────────────────────

export function TodayRule({ today }: { today: string }) {
	const m = Number(today.slice(5, 7))
	const d = Number(today.slice(8, 10))
	return (
		<div className="rcal-today mono" role="separator" aria-label={`오늘 ${m}월 ${d}일`}>
			<span>{`오늘 · ${m}월 ${d}일`}</span>
		</div>
	)
}

export function LedgerDay({ day, past }: { day: ReleaseDayGroup, past: boolean }) {
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
				{day.events.map(ev => <EventRow key={`${ev.artist_id}:${ev.title}`} ev={ev} />)}
			</div>
		</div>
	)
}
