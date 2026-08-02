// FEAT-album-review-authoring Step 2 — the 평가 이력 summary on a member profile
// (RFC C5: 평가한 앨범 수 · 평균 평점 · 별점 분포).
//
// PUBLIC by rule (RFC 경계 3 — only the free-form draft and the editorial mark
// are author-private; ratings and the statistics over them are public). It
// therefore renders for every viewer, not only the profile's owner, and takes
// only the public feed as input.
//
// Renders nothing at zero ratings. That is a deliberate empty-state decision,
// not a missing case: an average of "—" over an empty histogram says nothing the
// list's own empty state does not already say better, and two empty boxes
// stacked read as breakage. The list owns the message; this owns the numbers.
import type { MemberRating } from '../album/reviews.api'
import { useMemo } from 'react'
import { computeRatingStats, RATING_BUCKETS } from '@lib/ratingStats'

function Figure({ label, value }: { label: string, value: string }) {
	return (
		<div>
			<div className="serif" style={{ fontSize: 30, fontWeight: 500, lineHeight: 1.05, letterSpacing: '-.02em' }}>{value}</div>
			<div className="mono" style={{ marginTop: 5, fontSize: 'var(--text-2xs)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-faded)' }}>{label}</div>
		</div>
	)
}

/**
 * The half-step histogram. Ten columns, heights relative to the tallest bucket
 * so the shape is readable at any volume; a bucket with rows never renders as
 * zero height (min 3px), or "one 5.0" would look identical to "no 5.0".
 */
function Distribution({ counts, peak }: { counts: number[], peak: number }) {
	return (
		<div aria-hidden="true" style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 64 }}>
			{RATING_BUCKETS.map((bucket, i) => {
				const n = counts[i]
				const isWhole = Number.isInteger(bucket)
				return (
					<div key={bucket} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 4, minWidth: 0 }}>
						<div
							title={`${bucket}점 · ${n}개`}
							style={{
								height: n === 0 ? 1 : Math.max(3, Math.round((n / peak) * 52)),
								background: n === 0 ? 'var(--color-border)' : 'var(--color-accent)',
								opacity: n === 0 ? 1 : 0.28 + 0.72 * (n / peak),
							}}
						/>
						{/* Only the whole stars get a label — ten numbers under 10 bars is
						    unreadable at 390px, and the half steps are implied between. */}
						<div className="mono" style={{ height: 10, fontSize: 9, textAlign: 'center', color: 'var(--color-faded)' }}>{isWhole ? bucket : ''}</div>
					</div>
				)
			})}
		</div>
	)
}

export function RatingStats({ ratings }: { ratings: readonly MemberRating[] }) {
	const stats = useMemo(() => computeRatingStats(ratings), [ratings])
	if (stats.count === 0)
		return null
	return (
		<section
			aria-label="평가 통계"
			style={{ marginTop: 30, display: 'flex', alignItems: 'flex-end', gap: 28, flexWrap: 'wrap', padding: '16px 18px', border: '1px solid var(--color-border-soft)', borderRadius: 6 }}
		>
			<div style={{ display: 'flex', gap: 28 }}>
				<Figure label="평가한 앨범" value={String(stats.count)} />
				<Figure label="평균" value={stats.average == null ? '—' : stats.average.toFixed(1)} />
			</div>
			<div style={{ flex: 1, minWidth: 200 }}>
				<Distribution counts={stats.distribution} peak={stats.peak} />
			</div>
		</section>
	)
}
