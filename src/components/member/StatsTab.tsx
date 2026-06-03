// Member dashboard — 통계 tab. Genre/artist distribution + activity are SAMPLE
// (real aggregation depends on FEAT-genre-taxonomy + listening history; later
// RFC steps). Ported from app.jsx StatsTab.
import type { ChartStyle } from './charts'
import { useState } from 'react'
import { getActivity, getArtists, getGenres } from '@lib/member'
import { DistChart } from './charts'
import { SampleBadge, SectionTitle, Seg } from './ui'

const STYLES = [
  { v: 'bar', label: '막대' },
  { v: 'donut', label: '도넛' },
  { v: 'treemap', label: '트리맵' },
  { v: 'tag', label: '태그' },
  { v: 'list', label: '리스트' },
]
const ALL_STYLES: ChartStyle[] = ['bar', 'donut', 'treemap', 'tag', 'list']

function ActivitySpark({ data }: { data: number[] }) {
  const max = Math.max(...data)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 60 }}>
      {data.map((v, i) => <div key={i} title={`${v}장`} style={{ flex: 1, height: `${(v / max) * 100}%`, background: i === data.length - 1 ? 'var(--color-accent)' : 'var(--color-text)', opacity: i === data.length - 1 ? 1 : 0.32, minHeight: 3 }} />)}
    </div>
  )
}

export function StatsTab({ chartStyle, setChartStyle }: { chartStyle: ChartStyle, setChartStyle: (s: ChartStyle) => void }) {
  const [gallery, setGallery] = useState(false)
  const genres = getGenres()
  const artists = getArtists()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <SectionTitle
	kicker={(
<span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
LISTENING STATS
<SampleBadge />
</span>
)}
	title="통계"
	right={(
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {!gallery && <Seg value={chartStyle} onChange={v => setChartStyle(v as ChartStyle)} options={STYLES} />}
            <span className="lf-chip" data-on={gallery} onClick={() => setGallery(g => !g)}>모든 형식</span>
          </div>
        )}
      />
      <div className="lf-panel" style={{ padding: 20 }}>
        <div className="lf-meta" style={{ marginBottom: 14 }}>최근 12주 감상 활동 · 앨범 수</div>
        <ActivitySpark data={getActivity()} />
      </div>
      {gallery ?
        (
            ALL_STYLES.map(s => (
              <div key={s} className="lf-panel" style={{ padding: 20 }}>
                <div className="lf-meta" style={{ marginBottom: 16 }}>
장르 분포 —
{s}
                </div>
                <DistChart style={s} items={genres} />
              </div>
            ))
          ) :
        (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px,1fr))', gap: 16 }}>
              <div className="lf-panel" style={{ padding: 20 }}>
<div className="lf-meta" style={{ marginBottom: 16 }}>장르 분포</div>
<DistChart style={chartStyle} items={genres} />
              </div>
              <div className="lf-panel" style={{ padding: 20 }}>
<div className="lf-meta" style={{ marginBottom: 16 }}>아티스트 분포 · 재생 수</div>
<DistChart style={chartStyle} items={artists} />
              </div>
            </div>
          )}
    </div>
  )
}
