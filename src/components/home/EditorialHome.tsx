/**
 * Editorial home — Variant B "Refined Editorial" (Pitchfork-grade), from the
 * Claude Design handoff (홈 방향 비교 / buckit-home-b). Reader-first + fully
 * public: the only author-facing affordance is the header 글쓰기 link (layout
 * chrome) — no writer strip / personal pipeline on the home.
 *
 * Sections (top→bottom): BEST NEW MUSIC feature hero → 최신 평론 (type-forward
 * list with hairline dividers) → 장르로 디깅 → 숫자로 보는. Header/Footer come
 * from layout.astro. Stars-only; serif headlines + mono kickers + hairline rules.
 *
 * "Bucket"-as-curated-collection sections (이번 주 버킷 / 추천 버킷) from the B
 * mock are deferred until curated public-bucket / new-release data feeds the
 * home — the main stays clear/general (owner direction 2026-06-16). See
 * docs/rfcs/FEAT-bucket-identity.md + FEAT-home-redesign-v2.
 */
import type { ReviewCard } from '@lib/reviews'
import type { CSSProperties, ReactNode } from 'react'
import { reviewHref } from '@lib/entityLinks'
import BrowseGenres from './BrowseGenres'
import ByTheNumbers from './ByTheNumbers'
import { Cover, SectionTitle, Stars } from './ui'

/** Best New Music pick (built in index.astro from the review collection). */
interface BnmPick {
	slug: string
	album: string
	artist: string
	excerpt: string
	rating: number | null
	genre: string
	year: number
	cover: string | null
	dateLabel: string
	agoLabel: string
}

interface Stats {
	reviews: number
	albums: number
	genres: number
	lastUpdated: string
}

interface Props {
	bnm: BnmPick[]
	reviews: ReviewCard[]
	stats: Stats
	/** Passed by index.astro; unused on the reader-first home. */
	draftCount?: number
}

function pad(n: number) {
	return String(n).padStart(2, '0')
}
function fmtDate(iso: string) {
	const d = new Date(iso)
	return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`
}

interface Feature {
	slug: string
	album: string
	artist: string
	pull: string
	score: number | null
	genre: string
	year: number
	cover: string | null
	date: string
}

/** The hero feature: the top Best New Music pick, else the latest review. */
function toFeature(bnm: BnmPick[], reviews: ReviewCard[]): Feature | null {
	const b = bnm[0]
	if (b)
		return { slug: b.slug, album: b.album, artist: b.artist, pull: b.excerpt, score: b.rating, genre: b.genre, year: b.year, cover: b.cover, date: b.dateLabel }
	const r = reviews[0]
	if (r)
		return { slug: r.slug, album: r.album, artist: r.artist, pull: r.excerpt, score: r.rating, genre: r.genres[0] ?? '', year: r.year, cover: r.cover, date: fmtDate(r.date) }
	return null
}

function Measure({ children, style }: { children: ReactNode, style?: CSSProperties }) {
	return <div style={{ maxWidth: 'var(--home-measure)', margin: '0 auto', padding: '0 clamp(16px, 4vw, 30px)', ...style }}>{children}</div>
}

/* ── HERO — 금주의 선정 / BEST NEW MUSIC feature ───────────────── */
function Hero({ feature }: { feature: Feature }) {
	return (
		<section>
			<Measure style={{ paddingTop: 52, paddingBottom: 36 }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 26, flexWrap: 'wrap' }}>
					<span className="mono" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>★ Best New Music</span>
					<span className="meta">금주의 선정</span>
				</div>
				<a href={reviewHref(feature.slug)} className="bk-heroB">
					<div className="bk-lift"><Cover label={feature.album} src={feature.cover} square radius={4} /></div>
					<div style={{ minWidth: 0 }}>
						<div className="mono" style={{ fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--color-subtle)', marginBottom: 12 }}>{feature.artist}</div>
						<h1 className="serif italic bk-album" style={{ fontSize: 'clamp(34px, 3.8vw, 54px)', fontWeight: 500, lineHeight: 0.98, letterSpacing: '-.02em', margin: 0, textWrap: 'balance', overflowWrap: 'anywhere', minWidth: 0 }}>{feature.album}</h1>
						<p className="serif" style={{ fontSize: 18, lineHeight: 1.55, color: 'var(--color-subtle)', margin: '18px 0 22px', maxWidth: '46ch', textWrap: 'pretty' }}>{feature.pull}</p>
						<div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
							<Stars rating={feature.score} size={26} />
							{(feature.genre || feature.year != null) && (
								<span className="meta" style={{ paddingLeft: 18, borderLeft: '1px solid var(--color-border)' }}>{[feature.genre, feature.year].filter(Boolean).join(' · ')}</span>
							)}
						</div>
						{feature.date && <div className="mono" style={{ fontSize: 11, color: 'var(--color-faded)', marginTop: 16, letterSpacing: '.04em' }}>{`평론 · ${feature.date}`}</div>}
					</div>
				</a>
			</Measure>
			<Measure><hr className="rule-strong" /></Measure>
		</section>
	)
}

/* ── cold start (no reviews yet) — a single editorial card ─────── */
function ColdStart() {
	return (
		<section>
			<Measure style={{ paddingTop: 72, paddingBottom: 48 }}>
				<div className="mono" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--color-accent)', marginBottom: 16 }}>첫 평론을 준비 중</div>
				<h1 className="serif italic" style={{ fontSize: 'clamp(30px, 4vw, 50px)', fontWeight: 500, lineHeight: 1.02, letterSpacing: '-.02em', margin: 0 }}>첫 평론이 이 자리에 실립니다</h1>
				<p className="serif" style={{ fontSize: 18, lineHeight: 1.6, color: 'var(--color-subtle)', margin: '20px 0 0', maxWidth: '42ch' }}>한 장의 앨범을 끝까지 듣고, 한 편을 씁니다.</p>
			</Measure>
			<Measure><hr className="rule-strong" /></Measure>
		</section>
	)
}

/* ── 최신 평론 — type-forward list with hairline dividers ──────── */
function Latest({ reviews, excludeSlug }: { reviews: ReviewCard[], excludeSlug?: string }) {
	// Drop the album already shown in the hero so it isn't featured twice in one
	// viewport (audit L16). With a single review the list collapses entirely.
	const items = reviews.filter(r => r.slug !== excludeSlug).slice(0, 12)
	if (items.length === 0)
		return null
	return (
		<section>
			<Measure style={{ paddingTop: 56 }}>
				<SectionTitle kicker="LATEST · 평론" title="최신 평론" right={<a href="/reviews" className="btn">{`모두 보기 · ${reviews.length}편`}</a>} />
				<div>
					{items.map(r => (
						<a key={r.slug} href={reviewHref(r.slug)} className="bk-revrow">
							<div className="bk-lift" style={{ width: '100%' }}><Cover label={r.album} src={r.cover} square radius={3} /></div>
							<div style={{ minWidth: 0 }}>
								<div className="mono" style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[r.artist, r.genres[0], r.year].filter(Boolean).join(' · ')}</div>
								<h3 className="serif italic bk-album" style={{ fontSize: 21, fontWeight: 500, lineHeight: 1.12, margin: '2px 0 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.album}</h3>
								<p className="serif" style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--color-subtle)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.excerpt}</p>
							</div>
							<div className="bk-revrow-aside">
								<Stars rating={r.rating} size={18} />
								<span className="meta">{fmtDate(r.date)}</span>
							</div>
						</a>
					))}
				</div>
			</Measure>
		</section>
	)
}

export default function EditorialHome({ bnm, reviews, stats }: Props) {
	const feature = toFeature(bnm, reviews)
	return (
		<div className="bk-page">
			{feature ? <Hero feature={feature} /> : <ColdStart />}
			<Latest reviews={reviews} excludeSlug={feature?.slug} />
			<Measure style={{ paddingTop: 56 }}><BrowseGenres /></Measure>
			<Measure style={{ paddingTop: 56, paddingBottom: 40 }}><ByTheNumbers stats={stats} /></Measure>
		</div>
	)
}
