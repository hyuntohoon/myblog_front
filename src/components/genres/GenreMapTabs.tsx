import { lazy, Suspense, useEffect, useState } from 'react'

/**
 * /genres design-variant switcher. Each variant lazy-loads so the page only
 * pays for the renderer it shows. Active tab syncs to the URL hash.
 */

const PlateVariant = lazy(() => import('./GenreGraphSample'))
const ConstellationVariant = lazy(() => import('./GenreConstellation'))
const ClusterVariant = lazy(() => import('./GenreClusterMap'))

type VariantKey = 'plate' | 'constellation' | 'cluster'

const VARIANTS: { key: VariantKey, no: string, ko: string, en: string, desc: string }[] = [
  { key: 'plate', no: '①', ko: '도판', en: 'PLATE', desc: 'React Flow — 연대축 계보 도판. 편집 데모(추가·연결·삭제)는 이 탭에 있습니다.' },
  { key: 'constellation', no: '②', ko: '성좌', en: 'CONSTELLATION', desc: 'react-force-graph — 물리 시뮬레이션, 빛나는 별 노드, 엣지를 흐르는 입자. 별을 드래그해 보세요.' },
  { key: 'cluster', no: '③', ko: '군집', en: 'CLUSTER', desc: 'Cytoscape fCoSE — 패밀리 군집 헐과 유기적 스프링 레이아웃. 다시 배치로 레이아웃이 살아 움직입니다.' },
]

function initialVariant(): VariantKey {
  if (typeof window !== 'undefined') {
    const h = window.location.hash.replace('#', '')
    if (h === 'plate' || h === 'constellation' || h === 'cluster')
      return h
  }
  return 'plate'
}

export default function GenreMapTabs() {
  const [active, setActive] = useState<VariantKey>(initialVariant)

  useEffect(() => {
    window.history.replaceState(null, '', `#${active}`)
  }, [active])

  const meta = VARIANTS.find(v => v.key === active)!

  return (
    <div className="genre-tabs-wrap">
      <nav className="genre-tabs" aria-label="디자인 변형 선택">
        {VARIANTS.map(v => (
          <button
	key={v.key}
	type="button"
	className={`genre-tab${active === v.key ? ' is-active' : ''}`}
	aria-pressed={active === v.key}
	onClick={() => setActive(v.key)}
          >
            <span className="genre-tab-no">{v.no}</span>
            {v.ko}
            <span className="genre-tab-en">{v.en}</span>
          </button>
        ))}
      </nav>
      <p className="genre-tab-desc">{meta.desc}</p>

      <Suspense fallback={<div className="genre-loading">LOADING…</div>}>
        {active === 'plate' && <PlateVariant />}
        {active === 'constellation' && <ConstellationVariant />}
        {active === 'cluster' && <ClusterVariant />}
      </Suspense>
    </div>
  )
}
