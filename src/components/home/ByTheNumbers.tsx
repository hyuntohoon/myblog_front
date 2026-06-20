/**
 * "By the numbers" home module (FEAT-home-redesign, Work E).
 * Honest counts only — replaces the source prototype's PulseStrip (which showed
 * fake members/votes). No community metrics. Build-time counts come from index.astro.
 */
import { SectionTitle } from './ui'

interface Stats {
	reviews: number
	albums: number
	genres: number
	lastUpdated: string
}

export default function ByTheNumbers({ stats }: { stats: Stats }) {
	// "다룬 앨범" was just stats.albums === stats.reviews (one album per review) —
	// a redundant duplicate of 평론, and its "장" unit collided with the
	// "카탈로그 N장" figure in BrowseGenres above (audit L16). Drop it; BrowseGenres
	// owns the catalog album count, this strip owns the honest review-derived ones.
	const cells = [
		{ value: String(stats.reviews), unit: '편', label: '평론', accent: true },
		{ value: String(stats.genres), unit: '개', label: '장르', accent: false },
		{ value: stats.lastUpdated, unit: '', label: '최근 업데이트', accent: false },
	]
	return (
		<section>
			<SectionTitle kicker="BY THE NUMBERS · 정직한 카운트" title="숫자로 보는 평론지" />
			<div className="lf-numbers" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: 'var(--color-border)', border: '1px solid var(--color-border)' }}>
				{cells.map(c => (
					<div key={c.label} style={{ background: 'var(--color-bg)', padding: '26px 22px', display: 'flex', flexDirection: 'column', gap: 8 }}>
						<span className="serif" style={{ fontSize: c.unit ? 40 : 26, fontWeight: 500, lineHeight: 0.95, letterSpacing: '-.02em', color: c.accent ? 'var(--color-accent)' : 'var(--color-text)' }}>
							{c.value}
							{c.unit && <span className="serif" style={{ fontSize: 16, fontWeight: 400, color: 'var(--color-faded)' }}>{c.unit}</span>}
						</span>
						<span className="meta">{c.label}</span>
					</div>
				))}
			</div>
			<style>
				{`@media (max-width:640px){.lf-numbers{grid-template-columns:1fr !important}}`}
			</style>
		</section>
	)
}
