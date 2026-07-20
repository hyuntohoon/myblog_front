/**
 * Browse-by-Genre home teaser (FEAT-home-redesign, Work D).
 *
 * The honest version of a "community trends" block: no trending artists, no
 * votes, no play counts — just the genre distribution of the catalog as
 * share-bars (bar length ∝ album_count), each row linking into the matching
 * review list. This is a COMPACT TEASER, not the full /genres Outliner: it
 * shows the top N genres by album_count and hands off to the real Genre Map
 * page (right-side "장르 맵 →") and its ego view per row.
 *
 * Data comes from the same source the /genres page uses — GET /api/genres/tree
 * via fetchGenreTree() — so there is one album_count source of truth. The
 * catalog can be larger than the published review set; that's expected and the
 * footer says so. Adapted from the Claude Design "장르로 탐색" share-bar module.
 *
 * Self-contained: static styling is inline (matching BnmHero), and the hover /
 * transition rules that inline styles can't express ride a single scoped
 * <style> keyed off `.bg-mod`. No global.css additions are required.
 */
import type { CSSProperties } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { fetchGenreTree, genreMapHref } from '@lib/genres'
import type { GenreNode } from '@lib/genres'
import { SectionTitle } from './ui'

const TOP_N = 6

interface GenreRow {
	slug: string
	label: string
	count: number
}

/**
 * Rank 0 = accent; the rest descend through ink tones derived from the text
 * color so the ramp is theme-safe (light + dark) without hard-coded greys.
 */
function barColor(i: number): string {
	if (i === 0)
		return 'var(--color-accent)'
	const ink = Math.max(28, 70 - i * 9)
	return `color-mix(in srgb, var(--color-text) ${ink}%, var(--color-bg))`
}

function shareLabel(pct: number): string {
	if (pct >= 9.95)
		return `${Math.round(pct)}%`
	if (pct >= 0.95)
		return `${pct.toFixed(1)}%`
	if (pct > 0)
		return '<1%'
	return '0%'
}

// Hover / transition states inline styles can't reach. Scoped to `.bg-mod`.
const SCOPED_CSS = `
.bg-mod .bg-row::before{content:"";position:absolute;inset:0 -6px;background:var(--color-text);opacity:0;border-radius:var(--radius-sm);transition:opacity .16s;pointer-events:none}
.bg-mod .bg-row:hover::before{opacity:.035}
[data-theme=dark] .bg-mod .bg-row:hover::before{opacity:.06}
.bg-mod .bg-row:hover .bg-fill{filter:brightness(1.06)}
[data-theme=dark] .bg-mod .bg-row:hover .bg-fill{filter:brightness(1.14)}
.bg-mod .bg-chev{opacity:0;transform:translateX(-3px);transition:opacity .16s,transform .16s,color .16s}
.bg-mod .bg-row:hover .bg-chev{opacity:1;transform:none;color:var(--color-text)}
.bg-mod .bg-row[data-rank="0"]:hover .bg-chev{color:var(--color-accent)}
@media (max-width:640px){
	.bg-mod .bg-row{grid-template-columns:1fr auto 14px;grid-template-areas:"name stat chev" "meter meter meter";row-gap:11px}
	.bg-mod .bg-name{grid-area:name}
	.bg-mod .bg-stat{grid-area:stat}
	.bg-mod .bg-chev{grid-area:chev;align-self:center}
	.bg-mod .bg-meter{grid-area:meter}
}
`

const rowStyle: CSSProperties = {
	display: 'grid',
	gridTemplateColumns: 'minmax(96px, 168px) 1fr auto 16px',
	alignItems: 'center',
	columnGap: 'clamp(14px, 2.2vw, 26px)',
	padding: '16px 6px 17px',
	borderTop: '1px solid var(--color-border-soft)',
	position: 'relative',
	transition: 'background .16s',
	textDecoration: 'none',
}

function Chevron() {
	return (
		<svg className="bg-chev" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-faded)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ justifySelf: 'end' }} aria-hidden="true">
			<path d="M9 6l6 6-6 6" />
		</svg>
	)
}

function ArrowLink() {
	return (
		<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M5 12h14M13 6l6 6-6 6" />
		</svg>
	)
}

/** Dim static placeholder bar — no shimmer, theme-safe via --color-border-soft. */
function Bone({ w, h }: { w: number, h: number }) {
	return <span style={{ display: 'inline-block', width: w, height: h, borderRadius: 3, background: 'var(--color-border-soft)' }} />
}

/**
 * Loading placeholder for one genre row. Mirrors Row's grid markup (same
 * classes so the mobile 2-row variant in SCOPED_CSS applies, same font sizes /
 * line heights / paddings) so the loading → ready swap causes no layout shift.
 * Not a link, not hoverable — inert bars only.
 */
function SkeletonRow({ i }: { i: number }) {
	return (
		<div className="bg-row" data-rank={i} style={{ ...rowStyle, pointerEvents: 'none', ...(i === 0 ? { borderTop: 0 } : null) }}>
			<span className="bg-name" style={{ fontSize: 'clamp(17px, 2vw, 21px)', lineHeight: 1.1, whiteSpace: 'nowrap' }}>
				<Bone w={i % 2 ? 96 : 72} h={12} />
			</span>
			<span className="bg-meter" style={{ display: 'block', height: 12, borderRadius: 2, background: 'var(--color-border-soft)', minWidth: 24 }} />
			<span className="bg-stat" style={{ display: 'flex', alignItems: 'center', gap: 9, justifySelf: 'end', whiteSpace: 'nowrap' }}>
				<span style={{ fontSize: 'clamp(18px, 2vw, 22px)', lineHeight: 1 }}><Bone w={44} h={13} /></span>
				<span style={{ width: 38, textAlign: 'right' }}><Bone w={26} h={9} /></span>
			</span>
			<span className="bg-chev" style={{ width: 15, height: 15, justifySelf: 'end' }} />
		</div>
	)
}

/**
 * Full loading skeleton: intro-line slot + TOP_N rows + footer-note slot, all
 * reserving the same vertical space as the loaded state (home CLS fix).
 */
function Skeleton() {
	return (
		<div aria-hidden="true" style={{ pointerEvents: 'none' }}>
			<p className="serif" style={{ fontSize: 13.5, lineHeight: 1.4, margin: '0 0 4px' }}>
				<Bone w={280} h={10} />
			</p>

			<div className="bg-rows" style={{ display: 'flex', flexDirection: 'column' }}>
				{Array.from({ length: TOP_N }, (_, i) => <SkeletonRow key={i} i={i} />)}
			</div>

			<div className="bg-foot" style={{ marginTop: 18, paddingTop: 15, borderTop: '1px solid var(--color-border-soft)', display: 'flex', alignItems: 'center', gap: 9 }}>
				<span style={{ width: 6, height: 6, borderRadius: 6, background: 'var(--color-border-soft)', flex: '0 0 auto' }} />
				<p style={{ margin: 0, fontSize: 13, lineHeight: 1.45 }}><Bone w={220} h={9} /></p>
			</div>
		</div>
	)
}

function Row({ g, i, max, total }: { g: GenreRow, i: number, max: number, total: number }) {
	const w = max ? Math.max(4, (g.count / max) * 100) : 0
	const pct = total ? (g.count / total) * 100 : 0
	const accent = i === 0
	return (
		<a
			className="bg-row"
			data-rank={i}
			href={genreMapHref(g.slug)}
			title={`${g.label} 장르 맵 보기`}
			style={{ ...rowStyle, ...(i === 0 ? { borderTop: 0 } : null) }}
		>
			<span
				className="bg-name serif italic"
				style={{ color: accent ? 'var(--color-accent)' : 'var(--color-text)', fontSize: 'clamp(17px, 2vw, 21px)', fontWeight: 500, letterSpacing: '-.01em', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
			>
				{g.label}
			</span>
			<span className="bg-meter" style={{ display: 'block', height: 12, borderRadius: 2, background: 'var(--color-border-soft)', overflow: 'hidden', minWidth: 24 }}>
				<span className="bg-fill" style={{ display: 'block', height: '100%', borderRadius: 2, width: `${w}%`, background: barColor(i), transition: 'filter .16s' }} />
			</span>
			<span className="bg-stat" style={{ display: 'flex', alignItems: 'baseline', gap: 9, justifySelf: 'end', whiteSpace: 'nowrap' }}>
				<span className="serif" style={{ fontWeight: 500, color: 'var(--color-text)', fontSize: 'clamp(18px, 2vw, 22px)', lineHeight: 1, letterSpacing: '-.01em' }}>
					{g.count.toLocaleString('en-US')}
					<i style={{ fontStyle: 'normal', fontSize: '.56em', color: 'var(--color-faded)', marginLeft: 2 }}>장</i>
				</span>
				<span className="mono" style={{ fontSize: 11.5, color: 'var(--color-faded)', width: 38, textAlign: 'right' }}>{shareLabel(pct)}</span>
			</span>
			<Chevron />
		</a>
	)
}

export default function BrowseGenres() {
	const [nodes, setNodes] = useState<GenreNode[]>([])
	const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

	useEffect(() => {
		let alive = true
		fetchGenreTree()
			.then((tree) => {
				if (!alive)
					return
				setNodes(tree)
				setStatus('ready')
			})
			.catch(() => {
				if (alive)
					setStatus('error')
			})
		return () => {
			alive = false
		}
	}, [])

	// Total is across ALL tier-0 genres (not just the shown top N) so the share %
	// stays honest; rows are the top N by album_count.
	const total = useMemo(() => nodes.reduce((s, n) => s + n.albumCount, 0), [nodes])
	const rows = useMemo<GenreRow[]>(() => {
		return nodes
			.filter(n => n.albumCount > 0)
			.map(n => ({ slug: n.slug, label: n.label, count: n.albumCount }))
			.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
			.slice(0, TOP_N)
	}, [nodes])
	const max = useMemo(() => Math.max(...rows.map(r => r.count), 1), [rows])

	const right = (
		<a className="btn" href="/genres" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
			장르 맵
			<ArrowLink />
		</a>
	)

	return (
		<section className="bg-mod">
			<style>{SCOPED_CSS}</style>
			<SectionTitle kicker="정직한 분포" title="장르로 탐색" right={right} />

			{status === 'loading' ?
				<Skeleton /> :
				status === 'error' ?
					<div className="meta" style={{ padding: '28px 4px', color: 'var(--color-faded)' }}>장르 분포를 불러오지 못했습니다.</div> :
					rows.length === 0 ?
						<div className="meta" style={{ padding: '28px 4px', color: 'var(--color-faded)' }}>아직 분류된 장르가 없습니다.</div> :
						(
								<>
									<p className="serif" style={{ color: 'var(--color-subtle)', fontSize: 13.5, lineHeight: 1.4, margin: '0 0 4px' }}>
										카탈로그
										{' '}
										<b style={{ color: 'var(--color-text)', fontWeight: 600, fontStyle: 'normal' }}>
											{total.toLocaleString('en-US')}
											장
										</b>
										의 장르 분포 · 막대 길이는 그 장르에서 다룬 앨범 수에 비례합니다.
									</p>

									<div className="bg-rows" style={{ display: 'flex', flexDirection: 'column' }}>
										{rows.map((g, i) => (
											<Row key={g.label} g={g} i={i} max={max} total={total} />
										))}
									</div>

									<div className="bg-foot" style={{ marginTop: 18, paddingTop: 15, borderTop: '1px solid var(--color-border-soft)', display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
										<span style={{ width: 6, height: 6, borderRadius: 6, background: 'var(--color-accent)', flex: '0 0 auto' }} />
										<p className="serif italic" style={{ margin: 0, fontSize: 13, color: 'var(--color-faded)', lineHeight: 1.45 }}>
											재생수·투표·트렌딩 없음. 카탈로그에서 직접 집계한 앨범 수입니다.
										</p>
									</div>
								</>
							)}
		</section>
	)
}
