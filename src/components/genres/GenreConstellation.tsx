import type { ForceGraphMethods, LinkObject, NodeObject } from 'react-force-graph-2d'
import ForceGraph2D from 'react-force-graph-2d'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RelationType } from '@lib/genres-sample'
import { FAMILY_META, GENRES, RELATIONS } from '@lib/genres-sample'
import GenreDetailPanel from './GenreDetailPanel'

/**
 * Variant ② 성좌 (constellation) — react-force-graph-2d.
 * Live d3-force physics, glowing family-colored stars sized by connection
 * count, directional particles flowing along influence/fusion edges,
 * Korean-scene genres ringed in the site accent. View-only prototype.
 */

interface StarDatum {
  id: string
  nameKo: string
  nameEn: string
  color: string
  kr: boolean
  degree: number
}

type StarNode = NodeObject<StarDatum>
type StarLink = LinkObject<StarDatum, { type: RelationType }>

const ACCENT = '#df524a'
const INK = '#ebe7df'

const LINK_COLOR: Record<RelationType, string> = {
  subgenre_of: 'rgba(235, 231, 223, 0.30)',
  influenced_by: 'rgba(235, 231, 223, 0.16)',
  fusion_of: 'rgba(223, 82, 74, 0.75)',
}

declare global {
  interface Window {
    __buckitFG?: ForceGraphMethods<StarNode, StarLink>
    __buckitFGData?: { nodes: StarNode[], links: StarLink[] }
  }
}

export default function GenreConstellation() {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [size, setSize] = useState({ w: 600, h: 520 })
  const boxRef = useRef<HTMLDivElement>(null)
  const fgRef = useRef<ForceGraphMethods<StarNode, StarLink>>(undefined)

  useEffect(() => {
    const el = boxRef.current
    if (!el)
      return
    const ro = new ResizeObserver(([e]) => {
      setSize({ w: e.contentRect.width, h: e.contentRect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const data = useMemo(() => {
    const degree = new Map<string, number>()
    for (const r of RELATIONS) {
      degree.set(r.source, (degree.get(r.source) ?? 0) + 1)
      degree.set(r.target, (degree.get(r.target) ?? 0) + 1)
    }
    return {
      nodes: GENRES.map(g => ({
        id: g.slug,
        nameKo: g.nameKo,
        nameEn: g.nameEn,
        color: FAMILY_META[g.family ?? 'pop'].color,
        kr: g.kr === true,
        degree: degree.get(g.slug) ?? 0,
      })),
      links: RELATIONS.map(r => ({ source: r.source, target: r.target, type: r.type })),
    }
  }, [])

  useEffect(() => {
    // smoke-test hooks (sample page only)
    window.__buckitFG = fgRef.current
    window.__buckitFGData = data
    return () => {
      delete window.__buckitFG
      delete window.__buckitFGData
    }
  })

  const neighbors = useMemo(() => {
    if (!selectedSlug)
      return null
    const set = new Set([selectedSlug])
    for (const r of RELATIONS) {
      if (r.source === selectedSlug)
        set.add(r.target)
      if (r.target === selectedSlug)
        set.add(r.source)
    }
    return set
  }, [selectedSlug])

  useEffect(() => {
    const fg = fgRef.current
    if (!fg)
      return
    fg.d3Force('charge')?.strength(-170)
    fg.d3Force('link')?.distance(62)
  }, [])

  const radiusOf = (n: StarNode) => 3.5 + n.degree * 0.9

  const paintNode = useCallback((n: StarNode, ctx: CanvasRenderingContext2D, scale: number) => {
    const x = n.x ?? 0
    const y = n.y ?? 0
    const r = radiusOf(n)
    const dim = neighbors !== null && !neighbors.has(String(n.id))
    ctx.globalAlpha = dim ? 0.18 : 1

    ctx.shadowColor = n.color
    ctx.shadowBlur = dim ? 0 : 14
    ctx.fillStyle = n.color
    ctx.beginPath()
    ctx.arc(x, y, r, 0, 2 * Math.PI)
    ctx.fill()
    ctx.shadowBlur = 0

    if (n.kr) {
      ctx.strokeStyle = ACCENT
      ctx.lineWidth = 1.4 / scale
      ctx.beginPath()
      ctx.arc(x, y, r + 2.4 / scale, 0, 2 * Math.PI)
      ctx.stroke()
    }
    if (String(n.id) === selectedSlug) {
      ctx.strokeStyle = INK
      ctx.lineWidth = 1.2 / scale
      ctx.beginPath()
      ctx.arc(x, y, r + 5 / scale, 0, 2 * Math.PI)
      ctx.stroke()
    }

    if (scale > 1.05 || String(n.id) === selectedSlug || (neighbors?.has(String(n.id)) ?? false)) {
      ctx.font = `${Math.max(11 / scale, 3)}px 'Noto Serif KR', serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = dim ? 'rgba(235, 231, 223, 0.25)' : INK
      ctx.fillText(n.nameKo, x, y + r + 3 / scale)
    }
    ctx.globalAlpha = 1
  }, [neighbors, selectedSlug])

  const paintPointer = useCallback((n: StarNode, color: string, ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(n.x ?? 0, n.y ?? 0, radiusOf(n) + 5, 0, 2 * Math.PI)
    ctx.fill()
  }, [])

  const linkTouches = useCallback((l: StarLink) => {
    if (!selectedSlug)
      return true
    const s = typeof l.source === 'object' ? String(l.source.id) : String(l.source)
    const t = typeof l.target === 'object' ? String(l.target.id) : String(l.target)
    return s === selectedSlug || t === selectedSlug
  }, [selectedSlug])

  return (
    <div className="genre-graph-wrap">
      <div className="genre-constellation" ref={boxRef}>
        <ForceGraph2D<StarDatum, { type: RelationType }>
	ref={fgRef}
	width={size.w}
	height={size.h}
	graphData={data}
	backgroundColor="#141312"
	nodeCanvasObject={paintNode}
	nodePointerAreaPaint={paintPointer}
	nodeLabel={() => ''}
	linkColor={l => (linkTouches(l) ? LINK_COLOR[l.type] : 'rgba(235, 231, 223, 0.05)')}
	linkWidth={l => (l.type === 'fusion_of' ? 1.8 : 1)}
	linkLineDash={l => (l.type === 'influenced_by' ? [3, 3] : null)}
	linkDirectionalParticles={l => (!linkTouches(l) ? 0 : l.type === 'fusion_of' ? 4 : l.type === 'influenced_by' ? 2 : 0)}
	linkDirectionalParticleSpeed={l => (l.type === 'fusion_of' ? 0.008 : 0.004)}
	linkDirectionalParticleWidth={2.4}
	linkDirectionalParticleColor={l => (l.type === 'fusion_of' ? ACCENT : 'rgba(235, 231, 223, 0.85)')}
	warmupTicks={80}
	onNodeClick={n => setSelectedSlug(prev => (prev === String(n.id) ? null : String(n.id)))}
	onBackgroundClick={() => setSelectedSlug(null)}
        />
        <div className="genre-constellation-foot">
          {GENRES.length}
          {' GENRES · '}
          {RELATIONS.length}
          {' RELATIONS · 별을 클릭해 보세요'}
        </div>
      </div>

      <aside className="genre-panel" aria-live="polite">
        <GenreDetailPanel
	selectedSlug={selectedSlug}
	onPick={setSelectedSlug}
	emptyHint="물리 시뮬레이션 위의 장르 성좌입니다. 별의 크기는 관계 수, 색은 패밀리, 붉은 테두리는 한국 신. 점선 위를 흐르는 입자가 영향의 방향입니다. 별을 드래그해 보세요."
        />
      </aside>
    </div>
  )
}
