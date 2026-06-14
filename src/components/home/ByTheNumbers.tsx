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
	const cells = [
		{ value: String(stats.reviews), unit: '편', label: '평론', accent: true },
		{ value: String(stats.albums), unit: '장', label: '다룬 앨범', accent: false },
		{ value: String(stats.genres), unit: '개', label: '장르', accent: false },
		{ value: stats.lastUpdated, unit: '', label: '최근 업데이트', accent: false },
	]
	return (
		<section>
			<SectionTitle kicker="BY THE NUMBERS · 정직한 카운트" title="숫자로 보는 평론지" />
			<div className="lf-numbers" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: 'var(--color-border)', border: '1px solid var(--color-border)' }}>
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
				{`@media (max-width:640px){.lf-numbers{grid-template-columns:repeat(2,1fr) !important}}`}
			</style>
		</section>
	)
}
