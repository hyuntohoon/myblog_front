/**
 * Latest Reviews module (FEAT-home-redesign, Work C — "최신 평론").
 * Mirrors the Claude Design grid variant (latest-feed-options.jsx · VariantGrid):
 * an editorial 3-col card feed, date-desc, that auto-reflows to 2 / 1 col on
 * narrow widths. Stars only — the numeric rating is NEVER rendered (the design's
 * 0–10 `score` only fed star fill; here we pass the real 0–5 `rating` straight to
 * <Stars>). No fake filler: at 1–2 published reviews the grid simply renders that
 * many cards (empty cells stay empty). Capped at LATEST_CAP newest reviews.
 *
 * Hover (cover lift + title accent) is wired via a scoped <style> block so the
 * module is self-contained — the prototype kept those rules in its own inline
 * <style>, not the ported global.css. Honors prefers-reduced-motion.
 */
import type { CSSProperties } from 'react'
import type { ReviewCard } from '@lib/reviews'
import { Cover, SectionTitle, Stars } from './ui'

/** Newest reviews shown on the home feed; the rest live on /reviews. */
const LATEST_CAP = 6

/** "Best New" is an editorial designation, not a metric — never a number. */
function BestNewTag() {
	return (
		<span
			className="mono"
			style={{
				position: 'absolute',
				top: 0,
				left: 0,
				zIndex: 2,
				fontSize: 9.5,
				fontWeight: 600,
				letterSpacing: '.12em',
				textTransform: 'uppercase',
				color: '#fff',
				background: 'var(--color-accent)',
				padding: '4px 8px',
				whiteSpace: 'nowrap',
				lineHeight: 1,
			}}
		>
			★ Best New
		</span>
	)
}

/** "YYYY-MM-DD" ISO → "MM.DD" for the compact card date. */
function shortDate(iso: string) {
	const d = new Date(iso)
	if (Number.isNaN(d.getTime()))
		return ''
	const mm = String(d.getMonth() + 1).padStart(2, '0')
	const dd = String(d.getDate()).padStart(2, '0')
	return `${mm}.${dd}`
}

function FeedCard({ a }: { a: ReviewCard }) {
	return (
		<a href={`/blog/${a.slug}`} className="lr-card" style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
			<div style={{ position: 'relative' }}>
				{a.bestNew && <BestNewTag />}
				<div className="lr-cover-wrap" style={{ overflow: 'hidden', borderRadius: 4 }}>
					<Cover label={a.album} src={a.cover} square radius={4} />
				</div>
			</div>
			<div style={{ display: 'flex', flexDirection: 'column', gap: 9, minWidth: 0 }}>
				<div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
					<span className="mono" style={{ fontSize: 11, fontWeight: 500, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--color-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.artist}</span>
					<span className="mono" style={{ fontSize: 10.5, letterSpacing: '.04em', color: 'var(--color-faded)', flexShrink: 0 }}>{shortDate(a.date)}</span>
				</div>
				<h3 className="serif italic lr-album" style={{ fontSize: 23, fontWeight: 500, lineHeight: 1.1, letterSpacing: '-.015em', margin: 0 }}>{a.album}</h3>
				<Stars rating={a.rating} size={16} />
				{a.excerpt && (
					<p className="serif" style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--color-subtle)', margin: '2px 0 0', textWrap: 'pretty', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as CSSProperties}>{a.excerpt}</p>
				)}
			</div>
		</a>
	)
}

export default function LatestReviews({ reviews }: { reviews: ReviewCard[] }) {
	if (!reviews || reviews.length === 0)
		return null
	const items = reviews.slice(0, LATEST_CAP)
	return (
		<section>
			<style>
				{`
				.lr-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 44px 34px; list-style: none; margin: 0; padding: 0; }
				@media (max-width: 860px) { .lr-grid { grid-template-columns: repeat(2, 1fr); } }
				@media (max-width: 560px) { .lr-grid { grid-template-columns: 1fr; } }
				.lr-card { text-decoration: none; color: inherit; }
				.lr-cover-wrap .cover { transition: transform .3s cubic-bezier(.2,.7,.2,1); }
				.lr-album { transition: color .16s; }
				.lr-card:hover .lr-cover-wrap .cover { transform: scale(1.04); }
				.lr-card:hover .lr-album { color: var(--color-accent); }
				@media (prefers-reduced-motion: reduce) { .lr-cover-wrap .cover { transition: none; } }
				`}
			</style>
			<SectionTitle
				kicker="REVIEWS · 최신순"
				title="최신 평론"
				size={30}
				right={(
					<a className="mono" href="/reviews" style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-faded)', whiteSpace: 'nowrap', textDecoration: 'none' }}>모두 보기 →</a>
				)}
			/>
			<ul className="lr-grid">
				{items.map(a => (
					<li key={a.slug}><FeedCard a={a} /></li>
				))}
			</ul>
		</section>
	)
}
