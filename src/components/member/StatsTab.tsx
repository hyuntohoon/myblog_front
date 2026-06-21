// Member dashboard — 분석 버킷 (FEAT-genre-artist-distribution, accepted 2026-06-21).
// Two co-equal sources via a toggle: 좋아요(saved tracks) vs 재생(play history), each
// broken down by 장르 / 아티스트 through one shared DistChart (통일성). Genre resolves
// track_genres(override) → album_genres(inherit) → 미분류; the 미분류 chip's 분류하기
// enqueues the catalog-absent albums for catalog sync (worker → S1 genres). Replaces
// the earlier fabricated-sample 통계 tab (UI/UX audit H2, 2026-06-21).
import type { ChartStyle } from './charts'
import type { Distribution, SavedTrack } from './analysis.api'
import type { DistItem } from '@lib/member'
import { useEffect, useState } from 'react'
import {
	classifySavedTracks,
	fillGenres,
	getPlayedArtistDistribution,
	getPlayedGenreDistribution,
	getSavedArtistDistribution,
	getSavedGenreDistribution,
	listSavedTracks,
} from './analysis.api'
import { DistChart } from './charts'
import { SectionTitle } from './ui'

type Source = 'liked' | 'played'
type Dimension = 'genre' | 'artist'

const SOURCES: { v: Source, label: string }[] = [
	{ v: 'liked', label: '좋아요' },
	{ v: 'played', label: '재생' },
]
const DIMENSIONS: { v: Dimension, label: string }[] = [
	{ v: 'genre', label: '장르' },
	{ v: 'artist', label: '아티스트' },
]
const STYLES: { v: ChartStyle, label: string }[] = [
	{ v: 'bar', label: '막대' },
	{ v: 'donut', label: '도넛' },
	{ v: 'treemap', label: '트리맵' },
	{ v: 'tag', label: '태그' },
	{ v: 'list', label: '리스트' },
]

/** Small mono segmented control. */
function Seg<T extends string>({ value, options, onChange, ariaLabel }: { value: T, options: { v: T, label: string }[], onChange: (v: T) => void, ariaLabel: string }) {
	return (
		<div role="group" aria-label={ariaLabel} className="lf-mono" style={{ display: 'inline-flex', border: '1px solid var(--color-border)', borderRadius: 3, overflow: 'hidden' }}>
			{options.map((o, i) => (
				<button
					key={o.v}
					type="button"
					aria-pressed={value === o.v}
					onClick={() => onChange(o.v)}
					style={{
						border: 'none',
						borderLeft: i ? '1px solid var(--color-border)' : 'none',
						padding: '6px 12px',
						fontSize: 11,
						letterSpacing: '0.04em',
						cursor: 'pointer',
						background: value === o.v ? 'var(--color-text)' : 'transparent',
						color: value === o.v ? 'var(--color-bg)' : 'var(--color-text)',
						transition: 'background .14s, color .14s',
					}}
				>
					{o.label}
				</button>
			))}
		</div>
	)
}

function toChartItems(dist: Distribution | null): DistItem[] {
	if (!dist)
		return []
	return (dist.items ?? []).map(it => ({ name: it.label, value: it.count }))
}

function fmtSynced(iso: string | null | undefined): string | null {
	if (!iso)
		return null
	const d = new Date(iso)
	if (Number.isNaN(d.getTime()))
		return null
	return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function StatsTab() {
	const [source, setSource] = useState<Source>('liked')
	const [dimension, setDimension] = useState<Dimension>('genre')
	const [chartStyle, setChartStyle] = useState<ChartStyle>('bar')

	const [dists, setDists] = useState<Record<string, Distribution>>({})
	const [savedTracks, setSavedTracks] = useState<SavedTrack[] | null>(null)
	const [error, setError] = useState(false)
	const [classifying, setClassifying] = useState(false)
	const [classifyMsg, setClassifyMsg] = useState<string | null>(null)
	const [filling, setFilling] = useState(false)
	const [fillMsg, setFillMsg] = useState<string | null>(null)

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
		listSavedTracks(60).then(r => on && setSavedTracks(r.items)).catch(() => on && setSavedTracks([]))
		return () => {
			on = false
		}
	}, [])

	const loaded = Object.keys(dists).length > 0
	const dist: Distribution | null = dists[`${source}:${dimension}`] ?? null
	const chartItems = toChartItems(dist)
	const unit = source === 'played' ? '회' : '곡'
	const synced = fmtSynced(dist?.last_synced_at)
	const unclassified = dist?.unclassified_count ?? 0
	const total = dist?.total ?? 0
	const breakdown = dist?.unclassified_breakdown ?? null

	const onClassify = () => {
		setClassifying(true)
		setClassifyMsg(null)
		classifySavedTracks()
			.then((r) => {
				const enq = r.enqueued ?? 0
				const skip = r.skipped_needs_backfill ?? 0
				setClassifyMsg(
					enq > 0 ?
						`${enq}개 앨범 동기화를 요청했어요${skip ? ` · ${skip}곡은 장르 백필 대기` : ''}. 잠시 후 장르가 채워집니다.` :
						skip > 0 ?
							`동기화할 신규 앨범은 없어요 · ${skip}곡은 장르 백필이 필요합니다.` :
							'분류할 미분류 트랙이 없어요.',
				)
			})
			.catch(() => setClassifyMsg('분류 요청에 실패했어요. 잠시 후 다시 시도해 주세요.'))
			.finally(() => setClassifying(false))
	}

	const onFillGenres = () => {
		setFilling(true)
		setFillMsg(null)
		fillGenres()
			.then((r) => {
				setFillMsg(
					r.status === 'already_pending' ?
						'이미 장르 채우기 요청이 대기 중이에요.' :
						'장르 채우기를 요청했어요. 잠시 후(최대 5분) 카탈로그된 앨범의 장르가 채워집니다.',
				)
			})
			.catch(() => setFillMsg('장르 채우기 요청에 실패했어요. 잠시 후 다시 시도해 주세요.'))
			.finally(() => setFilling(false))
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
			<SectionTitle kicker="ANALYSIS" title="분석 버킷" />

			<div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
				<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
					<Seg value={source} options={SOURCES} onChange={setSource} ariaLabel="소스 선택" />
					<Seg value={dimension} options={DIMENSIONS} onChange={setDimension} ariaLabel="기준 선택" />
				</div>
				<Seg value={chartStyle} options={STYLES} onChange={setChartStyle} ariaLabel="차트 형식" />
			</div>

			<div className="lf-meta" style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
				<span>
					{source === 'liked' ? '좋아요한 트랙' : '재생 기록'}
					{' '}
					{source === 'played' ? '재생' : ''}
					{' '}
					{loaded ? `${total.toLocaleString()}${unit}` : '—'}
				</span>
				{synced && (
					<span style={{ color: 'var(--color-faded)' }}>
						동기화
						{' '}
						{synced}
					</span>
				)}
			</div>

			<div className="lf-panel" style={{ padding: '22px 22px 24px' }}>
				{error ?
					<div className="lf-meta" style={{ textAlign: 'center', padding: '32px 0' }}>분석 데이터를 불러오지 못했어요.</div> :
					!loaded ?
							<div className="lf-meta" style={{ textAlign: 'center', padding: '32px 0', color: 'var(--color-faded)' }}>불러오는 중…</div> :
							chartItems.length === 0 && unclassified === 0 ?
									(
											<div className="lf-meta" style={{ textAlign: 'center', padding: '32px 0' }}>
												{source === 'liked' ? '아직 좋아요한 트랙이 없어요.' : '아직 재생 기록이 없어요.'}
											</div>
										) :
									chartItems.length === 0 ?
										<div className="lf-meta" style={{ textAlign: 'center', padding: '28px 0' }}>분류된 항목이 아직 없어요 — 전부 미분류입니다.</div> :
										<DistChart style={chartStyle} items={chartItems} unit={unit} />}
			</div>

			{dimension === 'genre' && loaded && unclassified > 0 && (
				<div className="lf-panel" style={{ padding: '14px 18px', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
					<div className="lf-meta" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
						<span>
							<strong style={{ color: 'var(--color-text)' }}>
								미분류
								{' '}
								{unclassified.toLocaleString()}
								{unit}
							</strong>
							{' '}
							<span style={{ color: 'var(--color-faded)' }}>
								/ 전체
								{' '}
								{total.toLocaleString()}
								{unit}
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
					<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
						{source === 'liked' && (
							<button
								type="button"
								className="lf-btn lf-btn-solid"
								disabled={classifying}
								onClick={onClassify}
								style={{ opacity: classifying ? 0.6 : 1 }}
							>
								{classifying ? '요청 중…' : '분류하기'}
							</button>
						)}
						{(breakdown?.ungenred ?? 0) > 0 && (
							<button
								type="button"
								className="lf-btn"
								disabled={filling}
								onClick={onFillGenres}
								style={{ opacity: filling ? 0.6 : 1 }}
							>
								{filling ? '요청 중…' : '장르 채우기'}
							</button>
						)}
					</div>
				</div>
			)}

			{classifyMsg && (
				<div className="lf-meta" style={{ color: 'var(--color-subtle)' }}>{classifyMsg}</div>
			)}

			{fillMsg && (
				<div className="lf-meta" style={{ color: 'var(--color-subtle)' }}>{fillMsg}</div>
			)}

			{source === 'liked' && savedTracks && savedTracks.length > 0 && (
				<div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
					<div className="lf-kicker">최근 좋아요</div>
					<div className="lf-panel" style={{ padding: '6px 0' }}>
						{savedTracks.slice(0, 12).map(t => (
							<div key={t.spotify_track_id} style={{ display: 'flex', gap: 12, alignItems: 'baseline', padding: '8px 18px', borderBottom: '1px solid var(--color-border-soft)' }}>
								<span className="lf-sans" style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)', flex: '1 1 50%', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.track_name}</span>
								<span className="lf-meta" style={{ flex: '1 1 40%', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.artist_name ?? '—'}</span>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	)
}
