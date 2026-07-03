/**
 * Canon (명반 전당) page island — FEAT-home-redesign, Work G (new route /canon).
 *
 * The canon set is computed at BUILD time (canon.astro): albums the author rated
 * ★4.0+ (0–5 scale), passed in already date-desc. This module re-sorts them by
 * album title (alphabetical) so the grid reads as a hall, NOT a ranking — there
 * are NO numbers, NO ranking order, NO numeric score (stars only, owner decision
 * 2026-06-14). When the canon is empty (current reality: 0 posts) a graceful
 * dashed empty state stands in. The "올해의 앨범" block is a deliberate placeholder
 * — the year-end pick is a hand-written editorial later, not auto-curation.
 */
import type { ReviewCard } from '@lib/reviews'
import { Cover, SectionTitle, Stars } from '@components/home/ui'
import { reviewHref } from '@lib/entityLinks'

const THRESHOLD = 4.0

function CanonCard({ item }: { item: ReviewCard }) {
	return (
		<a href={reviewHref(item.slug)} className="canon-card" style={{ display: 'block' }}>
			<div className="canon-cover">
				<Cover label={item.album} src={item.cover} square radius={4} />
			</div>
			<div style={{ marginTop: 13, minWidth: 0 }}>
				{item.artist && (
					<div className="sans" style={{ fontSize: 12.5, color: 'var(--color-subtle)', letterSpacing: '.01em', overflowWrap: 'anywhere' }}>{item.artist}</div>
				)}
				<h3 className="serif canon-title" style={{ fontSize: 19, fontWeight: 500, letterSpacing: '-.012em', lineHeight: 1.18, margin: '2px 0 0' }}>{item.album}</h3>
				<div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 9, flexWrap: 'wrap' }}>
					<Stars rating={item.rating} size={16} />
					<span className="meta" style={{ fontSize: 10 }}>{[item.year, item.genres[0]].filter(Boolean).join(' · ')}</span>
				</div>
				{item.excerpt && <p className="serif italic canon-verdict">{item.excerpt}</p>}
			</div>
		</a>
	)
}

function CanonEmpty() {
	return (
		<div className="panel" style={{ padding: 'clamp(40px,7vw,72px) 28px', textAlign: 'center', background: 'var(--color-paper)', borderStyle: 'dashed', borderColor: 'var(--color-border)' }}>
			<div className="canon-empty-mark" aria-hidden="true">★</div>
			<h2 className="serif" style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-.01em', marginTop: 18 }}>아직 명반이 없습니다</h2>
			<p className="serif" style={{ fontSize: 15, color: 'var(--color-subtle)', maxWidth: 420, margin: '10px auto 0', lineHeight: 1.65, textWrap: 'pretty' }}>
				앨범에
				{' '}
				<span style={{ color: 'var(--color-accent)' }}>
					★
					{THRESHOLD.toFixed(1)}
					{' '}
					이상
				</span>
				의 별점을 주면 이곳에 자동으로 모입니다. 아직 그만큼 마음에 든 앨범을 만나지 못했군요.
			</p>
			<a href="/reviews" className="btn" style={{ marginTop: 22 }}>평론 둘러보기 →</a>
		</div>
	)
}

function AlbumOfTheYear() {
	return (
		<section style={{ marginTop: 'clamp(60px,8vw,100px)' }}>
			<SectionTitle kicker="Album of the Year" title="올해의 앨범" />
			<div className="canon-aoty">
				<div className="canon-aoty-stripe" aria-hidden="true" />
				<div style={{ padding: 'clamp(26px,4vw,40px) clamp(22px,3vw,34px)', flex: 1 }}>
					<span className="mono" style={{ fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--color-faded)', border: '1px solid var(--color-border)', padding: '4px 9px', borderRadius: 999 }}>준비 중</span>
					<h3 className="serif" style={{ fontSize: 'clamp(22px,3vw,30px)', fontWeight: 500, letterSpacing: '-.015em', margin: '16px 0 0' }}>
						올해의 앨범
						{' '}
						<span className="italic" style={{ color: 'var(--color-faded)' }}>· 준비 중</span>
					</h3>
					<p className="serif" style={{ fontSize: 15, color: 'var(--color-subtle)', maxWidth: 460, lineHeight: 1.65, margin: '10px 0 0', textWrap: 'pretty' }}>
						연말마다 명반 가운데 한 장을 손으로 고릅니다. 자동 큐레이션이 아니라 직접 쓰는 한 편의 글이 될 예정이라, 이 자리는 아직 비워둡니다.
					</p>
				</div>
			</div>
		</section>
	)
}

export default function CanonPage({ albums }: { albums: ReviewCard[] }) {
	// Alphabetical by album — a hall, not a leaderboard. No ranking numbers.
	const list = [...albums].sort((a, b) => a.album.localeCompare(b.album, 'ko'))
	return (
		<div className="rise">
			{/* Title block */}
			<div style={{ borderBottom: '2px solid var(--color-text)', paddingBottom: 'clamp(20px,3vw,30px)', marginBottom: 'clamp(30px,4vw,46px)' }}>
				<span className="kicker" style={{ color: 'var(--color-accent)' }}>The Canon · 명반 전당</span>
				<div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginTop: 14 }}>
					<h1 className="serif" style={{ fontSize: 'clamp(54px,9vw,108px)', fontWeight: 500, letterSpacing: '-.03em', lineHeight: 0.9, margin: 0, whiteSpace: 'nowrap' }}>명반</h1>
					<p className="serif italic" style={{ fontSize: 'clamp(15px,1.7vw,20px)', color: 'var(--color-subtle)', maxWidth: 360, lineHeight: 1.55, margin: '0 0 6px', textWrap: 'pretty' }}>
						★
						{THRESHOLD.toFixed(1)}
						{' '}
						이상을 준 앨범이 스스로 이곳에 모입니다. 순서·순위는 무관합니다.
					</p>
				</div>
			</div>

			{/* Grid / empty state */}
			{list.length === 0 ?
				<CanonEmpty /> :
				(
					<>
						<div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 22 }}>
							<span className="meta" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
								{list.length}
								장의 명반
							</span>
							<span style={{ flex: 1, alignSelf: 'center', height: 1, background: 'var(--color-border)' }} />
						</div>
						<div className="canon-grid">
							{list.map(item => <CanonCard key={item.slug} item={item} />)}
						</div>
					</>
				)}

			<AlbumOfTheYear />
		</div>
	)
}
