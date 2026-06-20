// Member dashboard — 통계 tab. Real genre/artist distribution + listening
// activity are built in FEAT-genre-artist-distribution (the 분석 버킷, accepted
// 2026-06-21). Until that lands this tab shows a 준비 중 placeholder instead of
// fabricated sample data — showing fake counts next to the owner's real stats
// read as their data and broke trust (UI/UX audit H2, 2026-06-21).
import { SectionTitle } from './ui'

export function StatsTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <SectionTitle kicker="LISTENING STATS" title="통계" />
      <div
	className="lf-panel"
	style={{ padding: '48px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}
      >
        <div className="lf-serif lf-italic" style={{ fontSize: 22, color: 'var(--color-text)' }}>준비 중</div>
        <p className="lf-meta" style={{ maxWidth: 380, lineHeight: 1.6 }}>
          장르·아티스트 분포와 감상 활동을 실제 듣기 기록으로 집계하는 분석 버킷을 준비하고 있어요.
        </p>
      </div>
    </div>
  )
}
