// 분석 버킷 → 임포트(평생) source — FEAT-listening-history-import Step 6 (final).
// The imported Spotify Extended Streaming History: true LIFETIME play counts AND
// listening time (ms), which no Spotify API exposes. This is the post-import PRIMARY
// "favorite" signal (좋아요 = secondary intent). Every panel carries the import horizon
// (as_of) so a stale export can't be misread as live, and the GATED album/genre/era
// panels surface their residual 미분류 rather than hiding it. All edge_guard GET reads.
import type { ChartStyle } from './charts'
import type { Retrospective, StreamAlbumRank, StreamMetric, StreamRank } from './analysis.api'
import type { DistItem } from '@lib/member'
import { useEffect, useState } from 'react'
import {
	getStreamEraDistribution,
	getStreamGenreDistribution,
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

/** A bordered chart panel shell — matches LikedAnalysis's Panel (one visual system). */
function Panel({ title, right, children }: { title: string, right?: React.ReactNode, children: React.ReactNode }) {
	return (
		<div className="lf-panel" style={{ padding: 18, display: 'flex', flexDirection: 'column' }}>
			<div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16 }}>
				<span className="lf-mono" style={{ fontSize: 11.5, fontWeight: 500, letterSpacing: '.1em', textTransform: 'uppercase' }}>{title}</span>
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

/** StreamRank items → chart items in the active metric (count = plays, time = minutes). */
function rankToItems(rank: StreamRank | null, metric: StreamMetric): DistItem[] {
	if (!rank)
		return []
	const toVal = metric === 'time' ? (v: number) => Math.round(v / 60000) : (v: number) => v
	return (rank.items ?? []).map(it => ({ name: it.label, value: toVal(it.value) }))
}

interface MetricData {
	tracks: StreamRank
	artists: StreamRank
	albums: StreamAlbumRank
	genre: StreamRank
	era: StreamRank
}

/**
 * The lifetime hero — the thesis of the import source: total listening TIME (no
 * Spotify API gives this) + total plays, stamped with the import horizon so its
 * staleness is visible, not hidden.
 */
function LifetimeHero({ totals }: { totals: StreamRank }) {
	const horizon = fmtDate(totals.as_of)
	return (
		<div className="lf-panel" style={{ padding: '22px 20px', display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 28px', marginBottom: 16 }}>
			<div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
				<span className="lf-serif" style={{ fontSize: 38, lineHeight: 1, color: 'var(--color-accent)' }}>{(totals.total_ms / 3.6e6).toFixed(0)}</span>
				<span className="lf-mono" style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--color-faded)' }}>시간 청취</span>
			</div>
			<div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
				<span className="lf-serif" style={{ fontSize: 38, lineHeight: 1 }}>{totals.total_streams.toLocaleString()}</span>
				<span className="lf-mono" style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--color-faded)' }}>회 재생</span>
			</div>
			<span className="lf-meta" style={{ marginLeft: 'auto', color: 'var(--color-faded)' }}>
				{horizon ? `평생 기록 · ${horizon}까지 임포트` : '평생 기록'}
			</span>
		</div>
	)
}

/** Top albums — covers + title + value (albums carry art, so a list beats a bare bar). */
function AlbumList({ albums, metric }: { albums: StreamAlbumRank, metric: StreamMetric }) {
	const items = albums.items ?? []
	if (!items.length)
		return <div className="lf-meta">표시할 앨범이 없어요.</div>
	const fmtVal = (v: number) => (metric === 'time' ? fmtDur(v) : `${v.toLocaleString()}회`)
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
			{items.map((it, i) => (
				<div key={it.album.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
					<span className="lf-mono" style={{ fontSize: 11, width: 18, flex: '0 0 auto', textAlign: 'right', color: i === 0 ? 'var(--color-accent)' : 'var(--color-faded)' }}>{i + 1}</span>
					{it.album.cover_url ?
						<img src={it.album.cover_url} alt="" width={40} height={40} style={{ flex: '0 0 auto', objectFit: 'cover', borderRadius: 2 }} /> :
						<div style={{ width: 40, height: 40, flex: '0 0 auto', background: 'var(--color-border-soft)' }} />}
					<div style={{ minWidth: 0, flex: 1 }}>
						<div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.album.title}</div>
						<div className="lf-meta" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-faded)' }}>{(it.album.artist_names ?? []).join(', ')}</div>
					</div>
					<span className="lf-mono" style={{ fontSize: 11, flex: '0 0 auto', color: 'var(--color-subtle)' }}>{fmtVal(it.value)}</span>
				</div>
			))}
		</div>
	)
}

/** Era histogram — server-aggregated decades (chronological), editorial serif labels. */
function EraHistogram({ era, metric }: { era: StreamRank, metric: StreamMetric }) {
	const items = era.items ?? []
	if (!items.length)
		return <div className="lf-meta">연대 정보 없어요.</div>
	const max = Math.max(1, ...items.map(it => it.value))
	const top = items.reduce((a, b) => (b.value > a.value ? b : a), items[0])
	const fmtVal = (v: number) => (metric === 'time' ? fmtDur(v) : `${v.toLocaleString()}회`)
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
			{items.map((it) => {
				const hot = it.label === top.label
				return (
					<div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
						<span className="lf-serif lf-italic" style={{ fontSize: 14, width: 64, flex: '0 0 auto', color: hot ? 'var(--color-accent)' : 'var(--color-text)' }}>{it.label}</span>
						<div style={{ flex: 1, height: 4, background: 'var(--color-border-soft)', overflow: 'hidden' }}>
							<div style={{ width: `${(it.value / max) * 100}%`, height: '100%', background: hot ? 'var(--color-accent)' : 'var(--color-text)', opacity: hot ? 1 : 0.4 }} />
						</div>
						<span className="lf-mono" style={{ fontSize: 11, color: 'var(--color-faded)', minWidth: 48, textAlign: 'right' }}>{fmtVal(it.value)}</span>
					</div>
				)
			})}
		</div>
	)
}

/** 회고 — per-year recap bars + an "on this day" strip across past years. */
function RetroPanel({ retro, metric }: { retro: Retrospective, metric: StreamMetric }) {
	const years = retro.per_year ?? []
	const val = (y: { plays: number, ms_played: number }) => (metric === 'time' ? y.ms_played : y.plays)
	const max = Math.max(1, ...years.map(val))
	const fmtVal = (v: number) => (metric === 'time' ? fmtDur(v) : `${v.toLocaleString()}회`)
	const otd = retro.on_this_day ?? []
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
			<div>
				<div className="lf-meta" style={{ marginBottom: 10, color: 'var(--color-faded)' }}>연도별</div>
				{years.length === 0 ?
					<div className="lf-meta">기록 없어요.</div> :
					(
						<div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
							{years.map((y) => {
								const hot = val(y) === max
								return (
									<div key={y.year} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
										<span className="lf-mono" style={{ fontSize: 12, width: 42, flex: '0 0 auto', color: hot ? 'var(--color-accent)' : 'var(--color-text)' }}>{y.year}</span>
										<div style={{ flex: 1, height: 4, background: 'var(--color-border-soft)', overflow: 'hidden' }}>
											<div style={{ width: `${(val(y) / max) * 100}%`, height: '100%', background: hot ? 'var(--color-accent)' : 'var(--color-text)', opacity: hot ? 1 : 0.4 }} />
										</div>
										<span className="lf-mono" style={{ fontSize: 11, color: 'var(--color-faded)', minWidth: 48, textAlign: 'right' }}>{fmtVal(val(y))}</span>
									</div>
								)
							})}
						</div>
					)}
			</div>
			<div>
				<div className="lf-meta" style={{ marginBottom: 10, color: 'var(--color-faded)' }}>
					오늘 이날 (
{retro.today_kst}
)
				</div>
				{otd.length === 0 ?
					<div className="lf-meta">예전 오늘 들은 기록이 아직 없어요.</div> :
					(
						<div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
							{otd.map((it, i) => (
								<div key={`${it.year}-${it.track_name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
									<span className="lf-serif lf-italic" style={{ fontSize: 13, width: 42, flex: '0 0 auto', color: 'var(--color-accent)' }}>{it.year}</span>
									<div style={{ minWidth: 0, flex: 1 }}>
										<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{it.track_name ?? '(알 수 없음)'}</span>
										<span className="lf-meta" style={{ color: 'var(--color-faded)' }}>{it.artist_name ?? ''}</span>
									</div>
									<span className="lf-mono" style={{ fontSize: 11, flex: '0 0 auto', color: 'var(--color-subtle)' }}>
{it.plays}
회
         </span>
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
 * attribute, in the SAME unit as the active metric (count→회, time→listening duration);
 * `shown` and `total` are the backend's metric-unit weights (ms when time).
 */
function GateNote({ shown, total, label, metric }: { shown: number, total: number, label: string, metric: StreamMetric }) {
	if (shown <= 0)
		return null
	const fmt = metric === 'time' ? fmtDur : (v: number) => `${v.toLocaleString()}회`
	return (
		<span className="lf-meta" style={{ color: 'var(--color-faded)' }}>{`${label} ${fmt(shown)} / 전체 ${fmt(total)}`}</span>
	)
}

/**
 * The 임포트(평생) analysis view. Primary "favorite" signal post-import (lifetime play +
 * time). `chartStyle` is shared with the sibling 좋아요/재생 view so the chart language is
 * consistent across sources. A count↔time toggle is unique to this source (only the
 * import carries ms_played).
 */
export function ImportAnalysis({ chartStyle }: { chartStyle: ChartStyle }) {
	const [metric, setMetric] = useState<StreamMetric>('count')
	const [data, setData] = useState<MetricData | null>(null)
	const [retro, setRetro] = useState<Retrospective | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState(false)

	useEffect(() => {
		let on = true
		getStreamRetrospective().then(r => on && setRetro(r)).catch(() => {})
		return () => {
			on = false
		}
	}, [])

	useEffect(() => {
		let on = true
		setLoading(true)
		Promise.all([
			getStreamTopTracks(metric),
			getStreamTopArtists(metric),
			getStreamTopAlbums(metric),
			getStreamGenreDistribution(metric),
			getStreamEraDistribution(metric),
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
	}, [metric])

	if (error)
		return <div className="lf-meta" style={{ marginBottom: 26 }}>불러오지 못했어요. 잠시 후 다시 시도해 주세요.</div>
	if (!data)
		return <div className="lf-meta" style={{ marginBottom: 26, color: 'var(--color-faded)' }}>불러오는 중…</div>

	// No import yet → an empty state that points at the action, not a blank panel.
	if (data.tracks.total_streams === 0) {
		return (
			<div className="lf-panel" style={{ padding: 22, marginBottom: 26 }}>
				<div className="lf-meta" style={{ lineHeight: 1.6 }}>
					아직 임포트한 스트리밍 기록이 없어요. Spotify에서 받은 확장 스트리밍 기록(GDPR)을 임포트하면 평생 재생·청취 시간 분석이 여기 표시됩니다.
				</div>
			</div>
		)
	}

	const totals = data.tracks // total_streams/total_ms/as_of are identical across the stream endpoints
	const unit = metric === 'time' ? '분' : '회'
	const trackItems = rankToItems(data.tracks, metric)
	const artistItems = rankToItems(data.artists, metric)
	const genreItems = rankToItems(data.genre, metric)

	// Gate denominator = the in-scope population in the metric's own unit (plays or ms),
	// so unclassified/unresolved (also metric-unit) read against the same scale.
	const gateTotal = metric === 'time' ? totals.total_ms : totals.total_streams

	return (
		<div style={{ marginBottom: 26 }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
				<Seg value={metric} onChange={v => setMetric(v as StreamMetric)} options={METRICS} />
				<span className="lf-meta" style={{ color: 'var(--color-faded)' }}>
					{metric === 'time' ? '오래 들은 순' : '많이 들은 순'}
					{' · '}
					{loading ? '갱신 중…' : '평생 집계'}
				</span>
			</div>

			<LifetimeHero totals={totals} />

			<div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
				<Panel
					title="트랙"
					right={(
<span className="lf-meta" style={{ color: 'var(--color-faded)' }}>
상위
{trackItems.length}
</span>
)}
				>
					{trackItems.length === 0 ? <div className="lf-meta">표시할 트랙이 없어요.</div> : <DistChart style={chartStyle} items={trackItems} unit={unit} />}
				</Panel>
				<Panel
					title="아티스트"
					right={(
<span className="lf-meta" style={{ color: 'var(--color-faded)' }}>
상위
{artistItems.length}
</span>
)}
				>
					{artistItems.length === 0 ? <div className="lf-meta">표시할 아티스트가 없어요.</div> : <DistChart style={chartStyle} items={artistItems} unit={unit} />}
				</Panel>
			</div>

			<div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', marginTop: 16 }}>
				<Panel title="앨범" right={<GateNote shown={data.albums.unresolved ?? 0} total={gateTotal} label="미수록" metric={metric} />}>
					<AlbumList albums={data.albums} metric={metric} />
				</Panel>
				<Panel title="장르 분포" right={<GateNote shown={data.genre.unclassified ?? 0} total={gateTotal} label="미분류" metric={metric} />}>
					{genreItems.length === 0 ? <div className="lf-meta">표시할 장르가 없어요.</div> : <DistChart style={chartStyle} items={genreItems} unit={unit} />}
				</Panel>
			</div>

			<div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr', marginTop: 16 }} className="lk-flow-grid">
				<Panel title="연대">
					<EraHistogram era={data.era} metric={metric} />
				</Panel>
				<Panel title="회고">
					{retro ? <RetroPanel retro={retro} metric={metric} /> : <div className="lf-meta" style={{ color: 'var(--color-faded)' }}>불러오는 중…</div>}
				</Panel>
			</div>
		</div>
	)
}
