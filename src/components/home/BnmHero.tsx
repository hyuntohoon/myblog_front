/**
 * Best New Music hero module (FEAT-home-redesign, Work B).
 * Stars only — never a numeric score. The 30-day rolling window is applied at
 * BUILD time (index.astro): `picks` are already the posts flagged `bestNew` AND
 * published within 30 days, newest first, capped at 3. When empty the module
 * self-hides (returns null) so "Latest" rises in its place (owner decision
 * 2026-06-14; a daily rebuild keeps the window fresh).
 */
import { MEMBER_IDENTITY } from '@lib/member'
import { Cover, Stars } from './ui'

export interface BnmPick {
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

const ROLL_DAYS = 30

function BNMBadge({ corner = false }: { corner?: boolean }) {
	return (
		<span
			className="mono"
			style={{
				display: 'inline-flex',
				alignItems: 'center',
				gap: 7,
				fontSize: 11,
				fontWeight: 600,
				letterSpacing: '.16em',
				textTransform: 'uppercase',
				color: '#fff',
				background: 'var(--color-accent)',
				padding: '6px 12px',
				whiteSpace: 'nowrap',
				...(corner ?
					{ position: 'absolute', top: 0, left: 0, zIndex: 2, boxShadow: '0 6px 18px -8px rgba(0,0,0,.5)' } :
					{}),
			}}
		>
			<span className="serif" style={{ fontSize: 13, lineHeight: 1 }}>★</span>
			Best New Music
		</span>
	)
}

function FeatureHero({ a }: { a: BnmPick }) {
	return (
		<a
			href={`/blog/${a.slug}`}
			className="bnm-feature"
			style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 380px) 1fr', gap: 38, alignItems: 'center', paddingBottom: 30, borderBottom: '2px solid var(--color-text)' }}
		>
			<div style={{ position: 'relative' }}>
				<BNMBadge corner />
				<Cover label={a.album} src={a.cover} square radius={4} />
			</div>
			<div style={{ minWidth: 0 }}>
				<div className="mono" style={{ fontSize: 12, fontWeight: 500, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--color-subtle)', marginBottom: 10 }}>{a.artist}</div>
				<h2 className="serif italic" style={{ fontSize: 'clamp(34px, 4vw, 54px)', fontWeight: 500, lineHeight: 0.98, letterSpacing: '-.02em', margin: 0, textWrap: 'balance' }}>{a.album}</h2>
				{a.excerpt && (
					<p className="serif" style={{ fontSize: 'clamp(16px, 1.4vw, 19px)', lineHeight: 1.55, color: 'var(--color-subtle)', margin: '18px 0 22px', textWrap: 'pretty', maxWidth: '46ch' }}>{a.excerpt}</p>
				)}
				<div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', marginTop: a.excerpt ? 0 : 18 }}>
					<Stars rating={a.rating} size={26} />
					<span className="meta" style={{ paddingLeft: 18, borderLeft: '1px solid var(--color-border)' }}>
						{[a.genre, a.year].filter(Boolean).join(' · ')}
					</span>
				</div>
				<div className="mono" style={{ fontSize: 11, color: 'var(--color-faded)', marginTop: 16, letterSpacing: '.04em' }}>
					{MEMBER_IDENTITY.name}
{' '}
평론 ·
{a.dateLabel}
{' '}
·
{a.agoLabel}
				</div>
			</div>
		</a>
	)
}

function SupportCard({ a }: { a: BnmPick }) {
	return (
		<a href={`/blog/${a.slug}`} className="bnm-support" style={{ display: 'flex', gap: 16 }}>
			<Cover label={a.album} src={a.cover} size={104} radius={3} />
			<div style={{ minWidth: 0, flex: 1 }}>
				<div className="mono" style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-subtle)', marginBottom: 4 }}>{a.artist}</div>
				<h3 className="serif italic" style={{ fontSize: 21, fontWeight: 500, lineHeight: 1.08, letterSpacing: '-.01em', margin: 0 }}>{a.album}</h3>
				{a.excerpt && (
					<p className="serif" style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--color-subtle)', margin: '7px 0 9px', textWrap: 'pretty', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{a.excerpt}</p>
				)}
				<div style={{ marginTop: a.excerpt ? 0 : 9 }}><Stars rating={a.rating} size={15} /></div>
			</div>
		</a>
	)
}

export default function BnmHero({ picks }: { picks: BnmPick[] }) {
	if (!picks || picks.length === 0)
		return null
	const [feature, ...rest] = picks
	const support = rest.slice(0, 2)
	return (
		<section>
			<div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 18, flexWrap: 'wrap' }}>
				<span className="kicker" style={{ color: 'var(--color-accent)', letterSpacing: '.2em' }}>Best New Music</span>
				<span className="meta">
금주의 선정 · 최근
{ROLL_DAYS}
일
    </span>
				<span className="meta" style={{ marginLeft: 'auto' }}>
{picks.length}
편 선정
    </span>
			</div>
			<FeatureHero a={feature} />
			{support.length > 0 && (
				<div className="bnm-support-row" style={{ display: 'grid', gridTemplateColumns: `repeat(${support.length}, 1fr)`, gap: 28, marginTop: 28 }}>
					{support.map(a => <SupportCard key={a.slug} a={a} />)}
				</div>
			)}
		</section>
	)
}
