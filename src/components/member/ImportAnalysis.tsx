// 분석 버킷 → 임포트(평생+라이브) source — FEAT-listening-history-import Step 6 +
// FEAT-listening-live-merge Step 2 + FEAT-analysis-explore. The imported Spotify Extended
// Streaming History (true LIFETIME play counts AND listening time (ms), which no Spotify API
// exposes), unioned with the live recently-played tail past its as_of horizon. The post-import
// PRIMARY "favorite" signal (좋아요 = secondary intent). FEAT-analysis-explore makes it
// EXPLORABLE: a time-period selector (전체/올해/작년/이번달 + data-derived 연도·시대) re-scopes
// every panel + hero; any chart item (트랙/아티스트/앨범) drills into a private slide-over with
// that entity's count/time/first-last/per-year (+ an artist's top tracks/albums); a listening
// clock shows the hour×weekday pattern (KST). The live tail's time is ESTIMATED (duration_sec ×
// plays) so the time total is marked 추정 once live > 0. All edge_guard GET reads (rule #9).
import type { ChartDatum, ChartStyle } from './charts'
import type { DrillType, Range, Retrospective, StreamAlbumRank, StreamClock, StreamClockCell, StreamItemDetail, StreamMetric, StreamRank } from './analysis.api'
import { useEffect, useState } from 'react'
import { AddToBucketMenu } from './pocket/AddToBucketMenu'
import {
	getStreamClock,
	getStreamEraDistribution,
	getStreamGenreDistribution,
	getStreamItem,
	getStreamRetrospective,
	getStreamTopAlbums,
	getStreamTopArtists,
	getStreamTopTracks,
} from './analysis.api'
import { DistChart } from './charts'
import { Seg } from './ui'

const METRICS: { v: StreamMetric, label: string }[] = [
	{ v: 'count', label: '재생수' },
	{ v: 'time', label: '시간' },
]

// ── time period (FEAT-analysis-explore) ─────────────────────────────────────────────
// The range applies to the IMPORT source only (lean #5 — 좋아요 has only added_at). Presets
// + data-derived 연도/시대 dropdowns map to a half-open [from, to) the backend filters on
// event_ts. KST = UTC+9 (no DST), so a KST wall-clock boundary is a fixed UTC instant.

type Period =
	| { kind: 'all' } |
	{ kind: 'thisYear' } |
	{ kind: 'lastYear' } |
	{ kind: 'thisMonth' } |
	{ kind: 'year', year: number } |
	{ kind: 'decade', decade: number }

const PRESET_KINDS = ['all', 'thisYear', 'lastYear', 'thisMonth']
const PERIOD_PRESETS: { v: string, label: string }[] = [
	{ v: 'all', label: '전체' },
	{ v: 'thisYear', label: '올해' },
	{ v: 'lastYear', label: '작년' },
	{ v: 'thisMonth', label: '이번 달' },
]

/** Current instant shifted so its UTC fields read as KST wall-clock (robust to browser TZ). */
function kstNow(): Date {
	return new Date(Date.now() + 9 * 3600 * 1000)
}

/** A KST wall-clock moment (y, m0, d, h) as its UTC instant — an ISO `…Z` string (no offset char). */
function kstInstant(y: number, m0: number, d: number, h = 0): string {
	return new Date(Date.UTC(y, m0, d, h) - 9 * 3600 * 1000).toISOString()
}

/** Map a period → the half-open [from, to) range the backend filters event_ts on. */
function periodRange(p: Period): Range {
	const k = kstNow()
	const y = k.getUTCFullYear()
	const m = k.getUTCMonth()
	switch (p.kind) {
		case 'thisYear': return { from: kstInstant(y, 0, 1), to: null }
		case 'lastYear': return { from: kstInstant(y - 1, 0, 1), to: kstInstant(y, 0, 1) }
		case 'thisMonth': return { from: kstInstant(y, m, 1), to: null }
		case 'year': return { from: kstInstant(p.year, 0, 1), to: kstInstant(p.year + 1, 0, 1) }
		case 'decade': return { from: kstInstant(p.decade, 0, 1), to: kstInstant(p.decade + 10, 0, 1) }
		default: return { from: null, to: null }
	}
}

/** A short human caption for the active period. */
function periodLabel(p: Period): string {
	switch (p.kind) {
		case 'thisYear': return '올해'
		case 'lastYear': return '작년'
		case 'thisMonth': return '이번 달'
		case 'year': return `${p.year}년`
		case 'decade': return `${p.decade}년대`
		default: return '전체'
	}
}

const selectStyle: React.CSSProperties = {
	fontSize: 11.5,
	padding: '5px 8px',
	background: 'var(--color-bg)',
	border: '1px solid var(--color-border-soft)',
	borderRadius: 4,
	color: 'var(--color-text)',
	cursor: 'pointer',
	letterSpacing: '.02em',
}

/** A bordered chart panel shell — matches LikedAnalysis's Panel (one visual system). */
function Panel({ title, right, children }: { title: string, right?: React.ReactNode, children: React.ReactNode }) {
	return (
		<div className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column' }}>
			<div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16 }}>
				<span className="mono" style={{ fontSize: 11.5, fontWeight: 500, letterSpacing: '.1em', textTransform: 'uppercase' }}>{title}</span>
				{right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
			</div>
			<div style={{ flex: 1 }}>{children}</div>
		</div>
	)
}

/** ISO → `YYYY.MM.DD`; '' when missing/unparseable. */
function fmtDate(iso: string | null | undefined): string {
	if (!iso)
		return ''
	const d = new Date(iso)
	if (Number.isNaN(d.getTime()))
		return ''
	return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

/** ms → a compact "Xh"/"Xm" listening-time string. */
function fmtDur(ms: number): string {
	const min = Math.round(ms / 60000)
	if (min < 60)
		return `${min}분`
	const h = Math.floor(min / 60)
	const r = min % 60
	return r ? `${h}시간 ${r}분` : `${h}시간`
}

/** StreamRank items → chart items in the active metric, carrying the drill-down id (uri | artist name). */
function rankToItems(rank: StreamRank | null, metric: StreamMetric): ChartDatum[] {
	if (!rank)
		return []
	const toVal = metric === 'time' ? (v: number) => Math.round(v / 60000) : (v: number) => v
	return (rank.items ?? []).map(it => ({ name: it.label, value: toVal(it.value), id: it.spotify_track_uri ?? it.label }))
}

interface MetricData {
	tracks: StreamRank
	artists: StreamRank
	albums: StreamAlbumRank
	genre: StreamRank
	era: StreamRank
}

/**
 * The hero — total listening TIME (no Spotify API gives this) + total plays for the active
 * scope, stamped with the import horizon (lifetime) or the active period so staleness/scope
 * is visible. Time is marked 추정 once the (estimated-time) live tail is in scope.
 */
function LifetimeHero({ totals, period }: { totals: StreamRank, period: Period }) {
	const horizon = fmtDate(totals.as_of)
	const live = totals.live_streams ?? 0
	const estimated = live > 0
	const ranged = period.kind !== 'all'
	const scope = ranged ? periodLabel(period) : (live > 0 ? '평생 + 라이브' : '평생 기록')
	const tail = ranged ?
		(live > 0 ? ` · 라이브 ${live.toLocaleString()}회 포함` : '') :
		(horizon ? ` · ${horizon}까지 임포트${live > 0 ? ` · 이후 ${live.toLocaleString()}회 라이브` : ''}` : '')
	return (
		<div className="panel" style={{ padding: '22px 20px', display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 28px', marginBottom: 16 }}>
			<div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
				<span className="serif" style={{ fontSize: 38, lineHeight: 1, color: 'var(--color-accent)' }}>{`${estimated ? '≈' : ''}${(totals.total_ms / 3.6e6).toFixed(0)}`}</span>
				<span className="mono" style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--color-faded)' }}>{estimated ? '시간 청취 (추정)' : '시간 청취'}</span>
			</div>
			<div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
				<span className="serif" style={{ fontSize: 38, lineHeight: 1 }}>{totals.total_streams.toLocaleString()}</span>
				<span className="mono" style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--color-faded)' }}>회 재생</span>
			</div>
			<span className="meta" style={{ marginLeft: 'auto', color: 'var(--color-faded)' }}>{`${scope}${tail}`}</span>
		</div>
	)
}

/** Top albums — covers + title + value; rows drill into the album detail when onSelect is given. */
function AlbumList({ items, metric, onSelect }: { items: StreamAlbumRank['items'], metric: StreamMetric, onSelect?: (a: { id: string, title: string }) => void }) {
	const list = items ?? []
	if (!list.length)
		return <div className="meta">표시할 앨범이 없어요.</div>
	const fmtVal = (v: number) => (metric === 'time' ? fmtDur(v) : `${v.toLocaleString()}회`)
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
			{list.map((it, i) => {
				const drill = onSelect ?
					{
							'data-chart-click': '',
							'role': 'button',
							'tabIndex': 0,
							'aria-label': `${it.album.title} 상세`,
							'onClick': () => onSelect({ id: it.album.id, title: it.album.title }),
							'onKeyDown': (e: React.KeyboardEvent) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault()
									onSelect({ id: it.album.id, title: it.album.title })
								}
							},
						} :
					{}
				return (
					<div key={it.album.id} {...drill} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
						<span className="mono" style={{ fontSize: 11, width: 18, flex: '0 0 auto', textAlign: 'right', color: i === 0 ? 'var(--color-accent)' : 'var(--color-faded)' }}>{i + 1}</span>
						{it.album.cover_url ?
							<img src={it.album.cover_url} alt="" width={40} height={40} style={{ flex: '0 0 auto', objectFit: 'cover', borderRadius: 2 }} /> :
							<div style={{ width: 40, height: 40, flex: '0 0 auto', background: 'var(--color-border-soft)' }} />}
						<div style={{ minWidth: 0, flex: 1 }}>
							<div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.album.title}</div>
							<div className="meta" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-faded)' }}>{(it.album.artist_names ?? []).join(', ')}</div>
						</div>
						<span className="mono" style={{ fontSize: 11, flex: '0 0 auto', color: 'var(--color-subtle)' }}>{fmtVal(it.value)}</span>
					</div>
				)
			})}
		</div>
	)
}

/** Era histogram — server-aggregated decades (chronological), editorial serif labels. */
function EraHistogram({ era, metric }: { era: StreamRank, metric: StreamMetric }) {
	const items = era.items ?? []
	if (!items.length)
		return <div className="meta">연대 정보 없어요.</div>
	const max = Math.max(1, ...items.map(it => it.value))
	const top = items.reduce((a, b) => (b.value > a.value ? b : a), items[0])
	const fmtVal = (v: number) => (metric === 'time' ? fmtDur(v) : `${v.toLocaleString()}회`)
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
			{items.map((it) => {
				const hot = it.label === top.label
				return (
					<div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
						<span className="serif italic" style={{ fontSize: 14, width: 64, flex: '0 0 auto', color: hot ? 'var(--color-accent)' : 'var(--color-text)' }}>{it.label}</span>
						<div style={{ flex: 1, height: 4, background: 'var(--color-border-soft)', overflow: 'hidden' }}>
							<div style={{ width: `${(it.value / max) * 100}%`, height: '100%', background: hot ? 'var(--color-accent)' : 'var(--color-text)', opacity: hot ? 1 : 0.4 }} />
						</div>
						<span className="mono" style={{ fontSize: 11, color: 'var(--color-faded)', minWidth: 48, textAlign: 'right' }}>{fmtVal(it.value)}</span>
					</div>
				)
			})}
		</div>
	)
}

/** 회고 — per-year recap bars + an "on this day" strip across past years (always lifetime). */
function RetroPanel({ retro, metric }: { retro: Retrospective, metric: StreamMetric }) {
	const years = retro.per_year ?? []
	const val = (y: { plays: number, ms_played: number }) => (metric === 'time' ? y.ms_played : y.plays)
	const max = Math.max(1, ...years.map(val))
	const fmtVal = (v: number) => (metric === 'time' ? fmtDur(v) : `${v.toLocaleString()}회`)
	const otd = retro.on_this_day ?? []
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
			<div>
				<div className="meta" style={{ marginBottom: 10, color: 'var(--color-faded)' }}>연도별</div>
				{years.length === 0 ?
					<div className="meta">기록 없어요.</div> :
					(
							<div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
								{years.map((y) => {
									const hot = val(y) === max
									return (
										<div key={y.year} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
											<span className="mono" style={{ fontSize: 12, width: 42, flex: '0 0 auto', color: hot ? 'var(--color-accent)' : 'var(--color-text)' }}>{y.year}</span>
											<div style={{ flex: 1, height: 4, background: 'var(--color-border-soft)', overflow: 'hidden' }}>
												<div style={{ width: `${(val(y) / max) * 100}%`, height: '100%', background: hot ? 'var(--color-accent)' : 'var(--color-text)', opacity: hot ? 1 : 0.4 }} />
											</div>
											<span className="mono" style={{ fontSize: 11, color: 'var(--color-faded)', minWidth: 48, textAlign: 'right' }}>{fmtVal(val(y))}</span>
										</div>
									)
								})}
							</div>
						)}
			</div>
			<div>
				<div className="meta" style={{ marginBottom: 10, color: 'var(--color-faded)' }}>{`오늘 이날 (${retro.today_kst})`}</div>
				{otd.length === 0 ?
					<div className="meta">예전 오늘 들은 기록이 아직 없어요.</div> :
					(
							<div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
								{otd.map((it, i) => (
									<div key={`${it.year}-${it.track_name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
										<span className="serif italic" style={{ fontSize: 13, width: 42, flex: '0 0 auto', color: 'var(--color-accent)' }}>{it.year}</span>
										<div style={{ minWidth: 0, flex: 1 }}>
											<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{it.track_name ?? '(알 수 없음)'}</span>
											<span className="meta" style={{ color: 'var(--color-faded)' }}>{it.artist_name ?? ''}</span>
										</div>
										<span className="mono" style={{ fontSize: 11, flex: '0 0 auto', color: 'var(--color-subtle)' }}>{`${it.plays}회`}</span>
									</div>
								))}
							</div>
						)}
			</div>
		</div>
	)
}

/**
 * 미분류 / unresolved caption for a gated panel — names how much the panel can't yet
 * attribute, in the SAME unit as the active metric (count→회, time→listening duration).
 */
function GateNote({ shown, total, label, metric }: { shown: number, total: number, label: string, metric: StreamMetric }) {
	if (shown <= 0)
		return null
	const fmt = metric === 'time' ? fmtDur : (v: number) => `${v.toLocaleString()}회`
	return (
		<span className="meta" style={{ color: 'var(--color-faded)' }}>{`${label} ${fmt(shown)} / 전체 ${fmt(total)}`}</span>
	)
}

// ── listening clock (FEAT-analysis-explore) ─────────────────────────────────────────
// hour×weekday heatmap in KST. Rows ordered 월→일 (Korean week start); the backend's
// weekday is Postgres extract(dow) (0=Sun…6=Sat). Cells coloured by the active metric.

const CLOCK_WEEKDAYS: { d: number, l: string }[] = [
	{ d: 1, l: '월' },
{ d: 2, l: '화' },
{ d: 3, l: '수' },
{ d: 4, l: '목' },
	{ d: 5, l: '금' },
{ d: 6, l: '토' },
{ d: 0, l: '일' },
]

function ClockPanel({ clock, metric }: { clock: StreamClock | null, metric: StreamMetric }) {
	if (!clock)
		return <div className="meta" style={{ color: 'var(--color-faded)' }}>불러오는 중…</div>
	const cells = clock.cells ?? []
	if (!cells.length)
		return <div className="meta">표시할 기록이 없어요.</div>
	const val = (c: StreamClockCell) => (metric === 'time' ? c.ms_played : c.plays)
	const grid = new Map<string, number>()
	let max = 1
	let peak: StreamClockCell | null = null
	for (const c of cells) {
		const v = val(c)
		grid.set(`${c.weekday}-${c.hour}`, v)
		if (v > max)
			max = v
		if (!peak || v > val(peak))
			peak = c
	}
	const fmtVal = (v: number) => (metric === 'time' ? fmtDur(v) : `${v.toLocaleString()}회`)
	const peakLabel = peak ? `${CLOCK_WEEKDAYS.find(w => w.d === peak!.weekday)?.l ?? ''}요일 ${String(peak.hour).padStart(2, '0')}시` : ''
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
			{CLOCK_WEEKDAYS.map(w => (
				<div key={w.d} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
					<span className="mono" style={{ fontSize: 10, width: 16, flex: '0 0 auto', color: 'var(--color-faded)' }}>{w.l}</span>
					<div style={{ display: 'flex', gap: 2, flex: 1 }}>
						{Array.from({ length: 24 }, (_, h) => {
							const v = grid.get(`${w.d}-${h}`) ?? 0
							const intensity = Math.round((0.14 + (v / max) * 0.86) * 100)
							return (
								<div
									key={h}
									title={v > 0 ? `${w.l}요일 ${String(h).padStart(2, '0')}시 · ${fmtVal(v)}` : ''}
									style={{ flex: 1, aspectRatio: '1 / 1', minWidth: 0, borderRadius: 2, background: v > 0 ? `color-mix(in srgb, var(--color-accent) ${intensity}%, var(--color-border-soft))` : 'var(--color-border-soft)', opacity: v > 0 ? 1 : 0.45 }}
								/>
							)
						})}
					</div>
				</div>
			))}
			<div style={{ display: 'flex', gap: 2, paddingLeft: 22 }}>
				{Array.from({ length: 24 }, (_, h) => (
					<span key={h} className="mono" style={{ flex: 1, textAlign: 'center', fontSize: 8.5, color: 'var(--color-faded)' }}>{h % 6 === 0 ? h : ''}</span>
				))}
			</div>
			{peak && <div className="meta" style={{ marginTop: 4, color: 'var(--color-faded)' }}>{`가장 많이 들은 시간 · ${peakLabel}`}</div>}
		</div>
	)
}

// ── item drill-down slide-over (FEAT-analysis-explore) ──────────────────────────────
// Private (owner-only) per-entity detail — reuses the OverviewDash scrim/slideover
// pattern (the public /artist/[id] route has no per-user listening data). Honours the active
// metric + period.

function Stat({ value, unit, accent }: { value: string, unit: string, accent?: boolean }) {
	return (
		<div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
			<span className="serif" style={{ fontSize: 28, lineHeight: 1, color: accent ? 'var(--color-accent)' : 'var(--color-text)' }}>{value}</span>
			<span className="mono" style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-faded)' }}>{unit}</span>
		</div>
	)
}

function MiniYears({ years, metric }: { years: NonNullable<StreamItemDetail['per_year']>, metric: StreamMetric }) {
	const val = (y: { plays: number, ms_played: number }) => (metric === 'time' ? y.ms_played : y.plays)
	const max = Math.max(1, ...years.map(val))
	const fmtVal = (v: number) => (metric === 'time' ? fmtDur(v) : `${v.toLocaleString()}회`)
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
			{years.map(y => (
				<div key={y.year} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
					<span className="mono" style={{ fontSize: 11, width: 42, flex: '0 0 auto', color: 'var(--color-text)' }}>{y.year}</span>
					<div style={{ flex: 1, height: 4, background: 'var(--color-border-soft)', overflow: 'hidden' }}>
						<div style={{ width: `${(val(y) / max) * 100}%`, height: '100%', background: 'var(--color-accent)' }} />
					</div>
					<span className="mono" style={{ fontSize: 10.5, color: 'var(--color-faded)', minWidth: 44, textAlign: 'right' }}>{fmtVal(val(y))}</span>
				</div>
			))}
		</div>
	)
}

function MiniTrackList({ items, metric }: { items: NonNullable<StreamItemDetail['top_tracks']>, metric: StreamMetric }) {
	const fmtVal = (v: number) => (metric === 'time' ? fmtDur(v) : `${v.toLocaleString()}회`)
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
			{items.map((t, i) => (
				<div key={t.spotify_track_uri ?? `${t.label}-${i}`} style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
					<span className="mono" style={{ fontSize: 11, width: 18, flex: '0 0 auto', textAlign: 'right', color: i === 0 ? 'var(--color-accent)' : 'var(--color-faded)' }}>{i + 1}</span>
					<span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.label}</span>
					<span className="mono" style={{ fontSize: 10.5, flex: '0 0 auto', color: 'var(--color-subtle)' }}>{fmtVal(t.value)}</span>
				</div>
			))}
		</div>
	)
}

function ItemDetailSlideover({ target, metric, period, onClose }: { target: { type: DrillType, id: string, label: string }, metric: StreamMetric, period: Period, onClose: () => void }) {
	const [detail, setDetail] = useState<StreamItemDetail | null>(null)
	const [err, setErr] = useState(false)

	useEffect(() => {
		let on = true
		setDetail(null)
		setErr(false)
		getStreamItem(target.type, target.id, metric, periodRange(period))
			.then(d => on && setDetail(d))
			.catch(() => on && setErr(true))
		return () => {
			on = false
		}
	}, [target.type, target.id, metric, period])

	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key === 'Escape')
				onClose()
		}
		window.addEventListener('keydown', h)
		return () => window.removeEventListener('keydown', h)
	}, [onClose])

	const typeLabel = target.type === 'artist' ? '아티스트' : target.type === 'album' ? '앨범' : '트랙'
	const estimated = (detail?.live_streams ?? 0) > 0
	const span = detail ? [fmtDate(detail.first_listen), fmtDate(detail.last_listen)].filter(Boolean).join(' – ') : ''

	return (
		<div className="scrim" onClick={onClose} role="presentation">
			<aside className="slideover" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`${target.label} 청취 상세`}>
				<button type="button" className="iconbtn" onClick={onClose} aria-label="닫기" style={{ position: 'absolute', top: 16, right: 16, width: 30, height: 30, borderColor: 'var(--color-border-soft)' }}>✕</button>

				<div style={{ marginBottom: 18, paddingRight: 36 }}>
					<div className="mono" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--color-faded)', marginBottom: 6 }}>{`${typeLabel}${period.kind !== 'all' ? ` · ${periodLabel(period)}` : ''}`}</div>
					<div className="serif" style={{ fontSize: 24, lineHeight: 1.15 }}>{detail?.label ?? target.label}</div>
					{detail?.artist && <div className="meta" style={{ color: 'var(--color-faded)', marginTop: 4 }}>{detail.artist}</div>}
					{/* FEAT-pocket-buckit Step 5 — add this album to a bucket (album reference
					    only; no listening stats copied, per the snapshot vs ordinary-add rule). */}
					{target.type === 'album' && (
						<div style={{ marginTop: 14 }}>
							<AddToBucketMenu item={{ albumId: target.id, title: detail?.label ?? target.label }} />
						</div>
					)}
				</div>

				{err ?
					<div className="meta">불러오지 못했어요.</div> :
					!detail ?
							<div className="meta" style={{ color: 'var(--color-faded)' }}>불러오는 중…</div> :
							detail.count === 0 ?
									<div className="meta">이 기간에는 재생 기록이 없어요.</div> :
									(
											<div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
												<div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 24px', alignItems: 'baseline' }}>
													<Stat value={detail.count.toLocaleString()} unit="회 재생" accent />
													<Stat value={`${estimated ? '≈' : ''}${fmtDur(detail.time_ms)}`} unit={estimated ? '청취 (추정)' : '청취'} />
												</div>
												{span && <div className="meta" style={{ color: 'var(--color-faded)' }}>{span}</div>}
												{detail.per_year && detail.per_year.length > 0 && (
													<div>
														<div className="meta" style={{ marginBottom: 8, color: 'var(--color-faded)' }}>연도별</div>
														<MiniYears years={detail.per_year} metric={metric} />
													</div>
												)}
												{detail.top_tracks && detail.top_tracks.length > 0 && (
													<div>
														<div className="meta" style={{ marginBottom: 8, color: 'var(--color-faded)' }}>대표 트랙</div>
														<MiniTrackList items={detail.top_tracks} metric={metric} />
													</div>
												)}
												{detail.top_albums && detail.top_albums.length > 0 && (
													<div>
														<div className="meta" style={{ marginBottom: 8, color: 'var(--color-faded)' }}>대표 앨범</div>
														<AlbumList items={detail.top_albums} metric={metric} />
													</div>
												)}
											</div>
										)}
			</aside>
		</div>
	)
}

/**
 * The 임포트(평생+라이브) analysis view. A time-period selector re-scopes every panel + hero;
 * chart items drill into a private slide-over; a listening clock shows the hour×weekday pattern.
 * `chartStyle` is shared with the sibling 좋아요 view so the chart language is consistent.
 */
export function ImportAnalysis({ chartStyle }: { chartStyle: ChartStyle }) {
	const [metric, setMetric] = useState<StreamMetric>('count')
	const [period, setPeriod] = useState<Period>({ kind: 'all' })
	const [data, setData] = useState<MetricData | null>(null)
	const [retro, setRetro] = useState<Retrospective | null>(null)
	const [clock, setClock] = useState<StreamClock | null>(null)
	const [drill, setDrill] = useState<{ type: DrillType, id: string, label: string } | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState(false)

	// Retrospective is lifetime — also the source of the available 연도/시대 options. Fetch once.
	useEffect(() => {
		let on = true
		getStreamRetrospective().then(r => on && setRetro(r)).catch(() => {})
		return () => {
			on = false
		}
	}, [])

	// Panels + hero re-fetch on metric or period (period ref is stable until the user changes it).
	useEffect(() => {
		let on = true
		setLoading(true)
		const range = periodRange(period)
		Promise.all([
			getStreamTopTracks(metric, range),
			getStreamTopArtists(metric, range),
			getStreamTopAlbums(metric, range),
			getStreamGenreDistribution(metric, range),
			getStreamEraDistribution(metric, range),
		])
			.then(([tracks, artists, albums, genre, era]) => {
				if (on) {
					setData({ tracks, artists, albums, genre, era })
					setLoading(false)
				}
			})
			.catch(() => {
				if (on) {
					setError(true)
					setLoading(false)
				}
			})
		return () => {
			on = false
		}
	}, [metric, period])

	// Clock — independent so its failure doesn't blank the panels.
	useEffect(() => {
		let on = true
		getStreamClock(metric, periodRange(period)).then(c => on && setClock(c)).catch(() => on && setClock(null))
		return () => {
			on = false
		}
	}, [metric, period])

	if (error)
		return <div className="meta" style={{ marginBottom: 26 }}>불러오지 못했어요. 잠시 후 다시 시도해 주세요.</div>
	if (!data)
		return <div className="meta" style={{ marginBottom: 26, color: 'var(--color-faded)' }}>불러오는 중…</div>

	// Genuinely no import (lifetime is empty) → point at the action, not a blank panel.
	if (period.kind === 'all' && data.tracks.total_streams === 0) {
		return (
			<div className="panel" style={{ padding: 22, marginBottom: 26 }}>
				<div className="meta" style={{ lineHeight: 1.6 }}>
					아직 임포트한 스트리밍 기록이 없어요. Spotify에서 받은 확장 스트리밍 기록(GDPR)을 임포트하면 평생 재생·청취 시간 분석이 여기 표시됩니다.
				</div>
			</div>
		)
	}

	const totals = data.tracks // total_streams/total_ms/as_of/live_streams identical across the stream endpoints
	const live = totals.live_streams ?? 0
	const unit = metric === 'time' ? '분' : '회'
	const empty = totals.total_streams === 0
	const trackItems = rankToItems(data.tracks, metric)
	const artistItems = rankToItems(data.artists, metric)
	const genreItems = rankToItems(data.genre, metric)

	// Gate denominator = the in-scope population in the metric's own unit (plays or ms).
	const gateTotal = metric === 'time' ? totals.total_ms : totals.total_streams

	// Period dropdown options derived from the real data (retrospective is lifetime).
	const kY = kstNow().getUTCFullYear()
	const dataYears = [...new Set((retro?.per_year ?? []).map(y => y.year))].sort((a, b) => b - a)
	const pastYears = dataYears.filter(y => y !== kY)
	const dataDecades = [...new Set(dataYears.map(y => Math.floor(y / 10) * 10))].sort((a, b) => b - a)
	const presetValue = PRESET_KINDS.includes(period.kind) ? period.kind : ''

	return (
		<div style={{ marginBottom: 26 }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
				<Seg value={presetValue} onChange={v => setPeriod({ kind: v } as Period)} options={PERIOD_PRESETS} />
				{pastYears.length > 0 && (
					<select
						className="mono"
						aria-label="연도 선택"
						style={selectStyle}
						value={period.kind === 'year' ? String(period.year) : ''}
						onChange={e => e.target.value && setPeriod({ kind: 'year', year: Number(e.target.value) })}
					>
						<option value="">연도</option>
						{pastYears.map(y => <option key={y} value={y}>{`${y}년`}</option>)}
					</select>
				)}
				{dataDecades.length > 1 && (
					<select
						className="mono"
						aria-label="시대 선택"
						style={selectStyle}
						value={period.kind === 'decade' ? String(period.decade) : ''}
						onChange={e => e.target.value && setPeriod({ kind: 'decade', decade: Number(e.target.value) })}
					>
						<option value="">시대</option>
						{dataDecades.map(d => <option key={d} value={d}>{`${d}년대`}</option>)}
					</select>
				)}
				<span className="meta" style={{ marginLeft: 'auto', color: 'var(--color-faded)' }}>{`${periodLabel(period)}${loading ? ' · 갱신 중…' : ''}`}</span>
			</div>

			<div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
				<Seg value={metric} onChange={v => setMetric(v as StreamMetric)} options={METRICS} />
				<span className="meta" style={{ color: 'var(--color-faded)' }}>
					{metric === 'time' ? '오래 들은 순' : '많이 들은 순'}
					{!loading && metric === 'time' && live > 0 ? ' · 라이브 시간 추정' : ''}
				</span>
			</div>

			{empty ?
				(
						<div className="panel" style={{ padding: 22 }}>
							<div className="meta" style={{ lineHeight: 1.6 }}>{`‘${periodLabel(period)}’ 기간에는 청취 기록이 없어요. 다른 기간을 선택해 보세요.`}</div>
						</div>
					) :
				(
						<>
							<LifetimeHero totals={totals} period={period} />

							<div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
								<Panel title="트랙" right={<span className="meta" style={{ color: 'var(--color-faded)' }}>{`상위 ${trackItems.length}`}</span>}>
									{trackItems.length === 0 ? <div className="meta">표시할 트랙이 없어요.</div> : <DistChart style={chartStyle} items={trackItems} unit={unit} onSelect={it => setDrill({ type: 'track', id: it.id ?? it.name, label: it.name })} />}
								</Panel>
								<Panel title="아티스트" right={<span className="meta" style={{ color: 'var(--color-faded)' }}>{`상위 ${artistItems.length}`}</span>}>
									{artistItems.length === 0 ? <div className="meta">표시할 아티스트가 없어요.</div> : <DistChart style={chartStyle} items={artistItems} unit={unit} onSelect={it => setDrill({ type: 'artist', id: it.id ?? it.name, label: it.name })} />}
								</Panel>
							</div>

							<div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', marginTop: 16 }}>
								<Panel title="앨범" right={<GateNote shown={data.albums.unresolved ?? 0} total={gateTotal} label="미수록" metric={metric} />}>
									<AlbumList items={data.albums.items} metric={metric} onSelect={a => setDrill({ type: 'album', id: a.id, label: a.title })} />
								</Panel>
								<Panel title="장르 분포" right={<GateNote shown={data.genre.unclassified ?? 0} total={gateTotal} label="미분류" metric={metric} />}>
									{genreItems.length === 0 ? <div className="meta">표시할 장르가 없어요.</div> : <DistChart style={chartStyle} items={genreItems} unit={unit} />}
								</Panel>
							</div>

							<div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr', marginTop: 16 }} className="lk-flow-grid">
								<Panel title="연대">
									<EraHistogram era={data.era} metric={metric} />
								</Panel>
								<Panel title="시간대 (KST)">
									<ClockPanel clock={clock} metric={metric} />
								</Panel>
							</div>

							<div style={{ marginTop: 16 }}>
								<Panel title="회고">
									{retro ? <RetroPanel retro={retro} metric={metric} /> : <div className="meta" style={{ color: 'var(--color-faded)' }}>불러오는 중…</div>}
								</Panel>
							</div>
						</>
					)}

			{drill && <ItemDetailSlideover target={drill} metric={metric} period={period} onClose={() => setDrill(null)} />}
		</div>
	)
}
