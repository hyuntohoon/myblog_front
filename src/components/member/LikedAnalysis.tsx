// 분석 버킷 → 좋아요한 트랙 — analysis panel. FEAT-liked-tracks-workbench Step 2.
// Ported from the prototype (liked-analysis.jsx `LikedAnalysis`), adapted to real
// data. 장르·아티스트 distribution come from the SERVER distribution endpoints
// (accurate over the WHOLE set, not the loaded page) for the 좋아요 source;
// 연대 분포 + 좋아요 흐름 are computed client-side from the
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
	getSavedArtistDistribution,
	getSavedGenreDistribution,
} from './analysis.api'
import { DistChart } from './charts'
import { ImportAnalysis } from './ImportAnalysis'
import { Seg } from './ui'

// 임포트(평생+라이브) is the post-import PRIMARY "favorite" signal: the GDPR import
// (true lifetime play + time) unioned with the live recently-played tail past its
// as_of horizon (FEAT-listening-live-merge — the separate 재생 toggle is gone).
// 좋아요 = intent is the secondary lens.
type Source = 'import' | 'liked'

const SOURCES: { v: Source, label: string }[] = [
	{ v: 'import', label: '임포트(평생+라이브)' },
	{ v: 'liked', label: '좋아요' },
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
	const y = d.getFullYear()
	const m = String(d.getMonth() + 1).padStart(2, '0')
	const day = String(d.getDate()).padStart(2, '0')
	return `${y}.${m}.${day}`
}

/**
 * One honest line under the source toggle: what the 좋아요 source MEANS (intent, not
 * listened), its denominator (liked-N), and its sync horizon — so a 좋아요 chart can't
 * be misread as a 들은-기록 chart. (The lifetime/live listening signal lives in the
 * sibling 임포트 source.) FEAT-analysis-source-clarity.
 */
function SourceNote({ dist }: { dist: Distribution | null }) {
	const synced = fmtDate(dist?.last_synced_at)
	const n = dist ? dist.total.toLocaleString() : '—'
	return (
		<div className="meta" style={{ marginBottom: 14, lineHeight: 1.5 }}>
			<strong style={{ color: 'var(--color-text)' }}>좋아요</strong>
			{` — 내가 담은 곡(의도). 전체 ${n}곡${synced ? ` · 동기화 ${synced}` : ''}`}
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
		return <div className="meta">데이터 없음</div>
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
						<span className="mono" style={{ fontSize: 9, color: 'var(--color-faded)' }}>{b.count || ''}</span>
						<div style={{ width: '100%', maxWidth: 26, height: `${(b.count / maxC) * 100}%`, minHeight: b.count ? 4 : 0, background: i === last ? 'var(--color-accent)' : 'var(--color-text)', opacity: i === last ? 1 : 0.34 }} />
					</div>
				))}
			</div>
			<div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, borderTop: '1px solid var(--color-border-soft)', paddingTop: 8 }}>
				<span className="meta">{fmt(buckets[0].start)}</span>
				<span className="meta">주 단위 · 좋아요 수</span>
				<span className="meta">{fmt(buckets[last].start)}</span>
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
		return <div className="meta">연대 정보 없음</div>
	const max = Math.max(1, ...data.map(d => d.count))
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
			{data.map((d, i) => (
				<div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
					<span className="serif italic" style={{ fontSize: 14, width: 64, flex: '0 0 auto', color: i === 0 ? 'var(--color-accent)' : 'var(--color-text)' }}>{d.name}</span>
					<div style={{ flex: 1, height: 4, background: 'var(--color-border-soft)', overflow: 'hidden' }}>
						<div style={{ width: `${(d.count / max) * 100}%`, height: '100%', background: i === 0 ? 'var(--color-accent)' : 'var(--color-text)', opacity: i === 0 ? 1 : 0.4 }} />
					</div>
					<span className="mono" style={{ fontSize: 11, color: 'var(--color-faded)', width: 26, textAlign: 'right' }}>{d.count}</span>
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
			<div className="panel" style={{ padding: '14px 18px', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
				<div className="meta" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
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
				<button type="button" className="btn btn-solid" disabled={classifying} onClick={onClassify} style={{ opacity: classifying ? 0.6 : 1 }}>
					{classifying ? '요청 중…' : '분류하기'}
				</button>
			</div>
			{classifyMsg && <div className="meta" style={{ color: 'var(--color-subtle)' }}>{classifyMsg}</div>}
		</div>
	)
}

/**
 * The analysis panel. `rows` = the current liked view (filtered+sorted) used for
 * the client-side decade + likes-flow widgets. The genre/artist charts read the
 * server 좋아요 distributions (whole-set accurate). The sibling 임포트 source renders
 * its own (lifetime + live) view.
 */
export function LikedAnalysis({ rows, loadedCount }: { rows: LikedRowVM[], loadedCount: number }) {
	const [source, setSource] = useState<Source>('import')
	const [chartStyle, setChartStyle] = useState<ChartStyle>('bar')
	const [dists, setDists] = useState<Record<string, Distribution>>({})
	const [error, setError] = useState(false)

	useEffect(() => {
		let on = true
		Promise.all([
			getSavedGenreDistribution(),
			getSavedArtistDistribution(),
		])
			.then(([sg, sa]) => {
				if (on)
					setDists({ 'liked:genre': sg, 'liked:artist': sa })
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
	// Artist tail is long (hundreds), so cap the chart — but say how many of how
	// many are shown so it doesn't read as "that's all there is".
	const ARTIST_CAP = 15
	const artistAll = toChartItems(artistDist)
	const artistItems = artistAll.slice(0, ARTIST_CAP)
	const unit = '곡'

	// Population basis, surfaced as panel captions so the server-whole charts and
	// the client-side (loaded-only) widgets can't be read against the same N.
	const serverBasis = <span className="meta" style={{ color: 'var(--color-faded)' }}>전체 집계</span>
	const artistBasis = artistAll.length > artistItems.length ?
		<span className="meta" style={{ color: 'var(--color-faded)' }}>{`상위 ${artistItems.length} · 전체 ${artistAll.length.toLocaleString()}`}</span> :
		serverBasis
	const viewBasis = <span className="meta" style={{ color: 'var(--color-faded)' }}>{`좋아요 ${rows.length.toLocaleString()}곡`}</span>
	const likedTotal = dists['liked:genre']?.total ?? 0
	const overCeiling = likedTotal > loadedCount

	return (
		<div style={{ marginBottom: 26 }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12, justifyContent: 'space-between' }}>
				<Seg value={source} onChange={v => setSource(v as Source)} options={SOURCES} />
				<Seg value={chartStyle} onChange={v => setChartStyle(v as ChartStyle)} options={STYLES} />
			</div>

			{source === 'import' && <ImportAnalysis chartStyle={chartStyle} />}
			{source !== 'import' && (
				<>
					<SourceNote dist={genreDist} />

			<div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
				<Panel title="장르 분포" right={serverBasis}>
					{error ?
						<div className="meta">불러오지 못했어요.</div> :
						!loaded ?
								<div className="meta" style={{ color: 'var(--color-faded)' }}>불러오는 중…</div> :
								genreItems.length === 0 ?
										<div className="meta">표시할 장르가 없어요.</div> :
										<DistChart style={chartStyle} items={genreItems} unit={unit} />}
				</Panel>
				<Panel title="아티스트 분포" right={artistBasis}>
					{error ?
						<div className="meta">불러오지 못했어요.</div> :
						!loaded ?
								<div className="meta" style={{ color: 'var(--color-faded)' }}>불러오는 중…</div> :
								artistItems.length === 0 ?
										<div className="meta">표시할 아티스트가 없어요.</div> :
										<DistChart style={chartStyle} items={artistItems} unit={unit} />}
				</Panel>
			</div>

			<div className="lk-flow-grid" style={{ display: 'grid', gap: 16, gridTemplateColumns: '1.5fr 1fr', marginTop: 16 }}>
				<Panel title="좋아요 흐름" right={viewBasis}><LikedFlow rows={rows} /></Panel>
				<Panel title="연대 분포" right={viewBasis}><DecadeMini rows={rows} /></Panel>
			</div>

			<div className="meta" style={{ marginTop: 10, color: 'var(--color-faded)' }}>
				{`‘좋아요 흐름·연대’는 화면에 적재된 좋아요만 집계해요${overCeiling ? ` — 전체 ${likedTotal.toLocaleString()}곡 중 ${loadedCount.toLocaleString()}곡 적재` : ''}.`}
			</div>

					{/* 미분류 affordance always reads the 좋아요 (saved) genre distribution. */}
					<UnclassifiedPanel dist={dists['liked:genre'] ?? null} />
				</>
			)}
		</div>
	)
}
