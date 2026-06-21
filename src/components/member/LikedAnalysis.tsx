// 분석 버킷 → 좋아요한 트랙 — analysis panel. FEAT-liked-tracks-workbench Step 2.
// Ported from the prototype (liked-analysis.jsx `LikedAnalysis`), adapted to real
// data. 장르·아티스트 distribution come from the SERVER distribution endpoints
// (accurate over the WHOLE set, not the loaded page) with a 좋아요/재생 source
// toggle (charts only); 연대 분포 + 좋아요 흐름 are computed client-side from the
// loaded rows. The 미분류 affordance (분류하기 / 장르 채우기) reuses StatsTab's
// classify/fill logic + messages (enqueue-only — rule #9).
import type { LikedRowVM } from './LikedBoard'
import type { ChartStyle } from './charts'
import type { Distribution } from './analysis.api'
import type { DistItem } from '@lib/member'
import { useEffect, useState } from 'react'
import {
	classifySavedTracks,
	fillGenres,
	getPlayedArtistDistribution,
	getPlayedGenreDistribution,
	getSavedArtistDistribution,
	getSavedGenreDistribution,
} from './analysis.api'
import { DistChart } from './charts'
import { Seg } from './ui'

type Source = 'liked' | 'played'

const SOURCES: { v: Source, label: string }[] = [
	{ v: 'liked', label: '좋아요' },
	{ v: 'played', label: '재생' },
]
const STYLES: { v: ChartStyle, label: string }[] = [
	{ v: 'bar', label: '막대' },
	{ v: 'donut', label: '도넛' },
	{ v: 'treemap', label: '트리맵' },
	{ v: 'tag', label: '태그' },
	{ v: 'list', label: '리스트' },
]

function toChartItems(dist: Distribution | null): DistItem[] {
	if (!dist)
		return []
	return (dist.items ?? []).map(it => ({ name: it.label, value: it.count }))
}

/** A bordered chart panel shell (matches the prototype's LkPanel). */
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

/** Parse a row's added_at (ISO) safely to ms; NaN when unparseable. */
function addedMs(row: LikedRowVM): number {
	return new Date(row.addedAtRaw).getTime()
}

/** Weekly likes-over-time bars (client-side from the loaded rows). */
function LikedFlow({ rows }: { rows: LikedRowVM[] }) {
	const dates = rows.map(addedMs).filter(t => !Number.isNaN(t))
	if (!dates.length)
		return <div className="lf-meta">데이터 없음</div>
	const wk = 7 * 864e5
	const start = new Date(Math.min(...dates))
	start.setHours(0, 0, 0, 0)
	const maxT = Math.max(...dates)
	const buckets: { start: Date, count: number }[] = []
	for (let t = start.getTime(); t <= maxT + wk; t += wk) {
		const a = t
		const b = t + wk
		const count = dates.filter(d => d >= a && d < b).length
		buckets.push({ start: new Date(t), count })
	}
	const maxC = Math.max(1, ...buckets.map(b => b.count))
	const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`
	const last = buckets.length - 1
	return (
		<div>
			<div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 92 }}>
				{buckets.map((b, i) => (
					<div key={b.start.getTime()} title={`${fmt(b.start)} 주 · ${b.count}곡`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
						<span className="lf-mono" style={{ fontSize: 9, color: 'var(--color-faded)' }}>{b.count || ''}</span>
						<div style={{ width: '100%', maxWidth: 26, height: `${(b.count / maxC) * 100}%`, minHeight: b.count ? 4 : 0, background: i === last ? 'var(--color-accent)' : 'var(--color-text)', opacity: i === last ? 1 : 0.34 }} />
					</div>
				))}
			</div>
			<div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, borderTop: '1px solid var(--color-border-soft)', paddingTop: 8 }}>
				<span className="lf-meta">{fmt(buckets[0].start)}</span>
				<span className="lf-meta">주 단위 · 좋아요 수</span>
				<span className="lf-meta">{fmt(buckets[last].start)}</span>
			</div>
		</div>
	)
}

/** Decade distribution (client-side; uncatalogued rows with no year excluded). */
function DecadeMini({ rows }: { rows: LikedRowVM[] }) {
	const m = new Map<string, number>()
	for (const r of rows) {
		if (r.decade)
			m.set(r.decade, (m.get(r.decade) ?? 0) + 1)
	}
	const data = [...m.entries()]
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.name.localeCompare(a.name))
	if (!data.length)
		return <div className="lf-meta">연대 정보 없음</div>
	const max = Math.max(1, ...data.map(d => d.count))
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
			{data.map((d, i) => (
				<div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
					<span className="lf-serif lf-italic" style={{ fontSize: 14, width: 64, flex: '0 0 auto', color: i === 0 ? 'var(--color-accent)' : 'var(--color-text)' }}>{d.name}</span>
					<div style={{ flex: 1, height: 4, background: 'var(--color-border-soft)', overflow: 'hidden' }}>
						<div style={{ width: `${(d.count / max) * 100}%`, height: '100%', background: i === 0 ? 'var(--color-accent)' : 'var(--color-text)', opacity: i === 0 ? 1 : 0.4 }} />
					</div>
					<span className="lf-mono" style={{ fontSize: 11, color: 'var(--color-faded)', width: 26, textAlign: 'right' }}>{d.count}</span>
				</div>
			))}
		</div>
	)
}

/**
 * The 미분류 panel — one 분류하기 fires catalog sync + genre backfill together
 * (Promise.allSettled), mirroring StatsTab's unified action (#186, liked source).
 */
function UnclassifiedPanel({ dist }: { dist: Distribution | null }) {
	const [classifying, setClassifying] = useState(false)
	const [classifyMsg, setClassifyMsg] = useState<string | null>(null)

	const unclassified = dist?.unclassified_count ?? 0
	const total = dist?.total ?? 0
	const breakdown = dist?.unclassified_breakdown ?? null
	if (unclassified <= 0)
		return null

	// 미분류엔 두 원인(카탈로그 미등록 / 장르 대기)이 있어 한 버튼이 둘 다 트리거:
	// classify = catalog-absent 앨범 카탈로그 싱크, fillGenres = 카탈로그-있는-무장르 장르 백필.
	// 하나가 실패해도 다른 하나는 진행(allSettled).
	const onClassify = () => {
		setClassifying(true)
		setClassifyMsg(null)
		Promise.allSettled([classifySavedTracks(), fillGenres()])
			.then(([c, g]) => {
				const enq = c.status === 'fulfilled' ? (c.value.enqueued ?? 0) : 0
				const genreOk = g.status === 'fulfilled'
				const failed = c.status === 'rejected' || g.status === 'rejected'
				const parts: string[] = []
				if (enq > 0)
					parts.push(`${enq}개 앨범 카탈로그 동기화`)
				if (genreOk)
					parts.push('장르 채우기')
				setClassifyMsg(
					parts.length > 0 ?
						`${parts.join(' + ')}를 요청했어요. 잠시 후 미분류가 줄어듭니다.${failed ? ' (일부 요청 실패)' : ''}` :
						failed ?
							'요청에 실패했어요. 잠시 후 다시 시도해 주세요.' :
							'정리할 미분류가 없어요.',
				)
			})
			.finally(() => setClassifying(false))
	}

	return (
		<div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
			<div className="lf-panel" style={{ padding: '14px 18px', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
				<div className="lf-meta" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
					<span>
						<strong style={{ color: 'var(--color-text)' }}>
							미분류
							{' '}
							{unclassified.toLocaleString()}
							곡
						</strong>
						{' '}
						<span style={{ color: 'var(--color-faded)' }}>
							/ 전체
							{' '}
							{total.toLocaleString()}
							곡
						</span>
					</span>
					{breakdown && (breakdown.uncatalogued > 0 || breakdown.ungenred > 0) && (
						<span style={{ color: 'var(--color-faded)', fontSize: 11 }}>
							카탈로그 미등록
							{' '}
							{breakdown.uncatalogued.toLocaleString()}
							{' · 장르 대기 '}
							{breakdown.ungenred.toLocaleString()}
						</span>
					)}
				</div>
				<button type="button" className="lf-btn lf-btn-solid" disabled={classifying} onClick={onClassify} style={{ opacity: classifying ? 0.6 : 1 }}>
					{classifying ? '요청 중…' : '분류하기'}
				</button>
			</div>
			{classifyMsg && <div className="lf-meta" style={{ color: 'var(--color-subtle)' }}>{classifyMsg}</div>}
		</div>
	)
}

/**
 * The analysis panel. `rows` = the current liked view (filtered+sorted) used for
 * the client-side decade + likes-flow widgets. The genre/artist charts read the
 * server distributions (whole-set accurate) under a 좋아요/재생 source toggle.
 */
export function LikedAnalysis({ rows }: { rows: LikedRowVM[] }) {
	const [source, setSource] = useState<Source>('liked')
	const [chartStyle, setChartStyle] = useState<ChartStyle>('bar')
	const [dists, setDists] = useState<Record<string, Distribution>>({})
	const [error, setError] = useState(false)

	useEffect(() => {
		let on = true
		Promise.all([
			getSavedGenreDistribution(),
			getSavedArtistDistribution(),
			getPlayedGenreDistribution(),
			getPlayedArtistDistribution(),
		])
			.then(([sg, sa, pg, pa]) => {
				if (on)
					setDists({ 'liked:genre': sg, 'liked:artist': sa, 'played:genre': pg, 'played:artist': pa })
			})
			.catch(() => on && setError(true))
		return () => {
			on = false
		}
	}, [])

	const loaded = Object.keys(dists).length > 0
	const genreDist = dists[`${source}:genre`] ?? null
	const artistDist = dists[`${source}:artist`] ?? null
	const genreItems = toChartItems(genreDist)
	const artistItems = toChartItems(artistDist).slice(0, 8)
	const unit = source === 'played' ? '회' : '곡'

	return (
		<div style={{ marginBottom: 26 }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14, justifyContent: 'space-between' }}>
				<Seg value={source} onChange={v => setSource(v as Source)} options={SOURCES} />
				<Seg value={chartStyle} onChange={v => setChartStyle(v as ChartStyle)} options={STYLES} />
			</div>

			<div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
				<Panel title="장르 분포">
					{error ?
						<div className="lf-meta">불러오지 못했어요.</div> :
						!loaded ?
								<div className="lf-meta" style={{ color: 'var(--color-faded)' }}>불러오는 중…</div> :
								genreItems.length === 0 ?
										<div className="lf-meta">표시할 장르가 없어요.</div> :
										<DistChart style={chartStyle} items={genreItems} unit={unit} />}
				</Panel>
				<Panel title="아티스트 분포">
					{error ?
						<div className="lf-meta">불러오지 못했어요.</div> :
						!loaded ?
								<div className="lf-meta" style={{ color: 'var(--color-faded)' }}>불러오는 중…</div> :
								artistItems.length === 0 ?
										<div className="lf-meta">표시할 아티스트가 없어요.</div> :
										<DistChart style={chartStyle} items={artistItems} unit={unit} />}
				</Panel>
			</div>

			<div className="lk-flow-grid" style={{ display: 'grid', gap: 16, gridTemplateColumns: '1.5fr 1fr', marginTop: 16 }}>
				<Panel title="좋아요 흐름"><LikedFlow rows={rows} /></Panel>
				<Panel title="연대 분포"><DecadeMini rows={rows} /></Panel>
			</div>

			{/* 미분류 affordance always reads the 좋아요 (saved) genre distribution. */}
			<UnclassifiedPanel dist={dists['liked:genre'] ?? null} />
		</div>
	)
}
