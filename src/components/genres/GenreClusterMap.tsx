import type { Core, LayoutOptions } from 'cytoscape'
import cytoscape from 'cytoscape'
import fcose from 'cytoscape-fcose'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FAMILY_META, GENRES, RELATIONS } from '@lib/genres-sample'
import GenreDetailPanel from './GenreDetailPanel'

/**
 * Variant ③ 군집 (cluster) — cytoscape.js + fCoSE compound layout.
 * Genre families become translucent compound hulls; the organic spring
 * layout re-runs (animated) on demand. View-only prototype.
 */

cytoscape.use(fcose)

declare global {
  interface Window { __buckitCy?: Core }
}

const FCOSE: LayoutOptions = {
  name: 'fcose',
  animate: true,
  animationDuration: 900,
  fit: true,
  padding: 36,
  idealEdgeLength: 95,
  nodeRepulsion: 14000,
  nestingFactor: 0.35,
  randomize: true,
} as unknown as LayoutOptions

export default function GenreClusterMap() {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)

  useEffect(() => {
    const el = boxRef.current
    if (!el)
      return

    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const ink = dark ? '#ebe7df' : '#1a1a1a'
    const subtle = dark ? '#a09a91' : '#5a5651'
    const accent = dark ? '#df524a' : '#c8332b'

    const degree = new Map<string, number>()
    for (const r of RELATIONS) {
      degree.set(r.source, (degree.get(r.source) ?? 0) + 1)
      degree.set(r.target, (degree.get(r.target) ?? 0) + 1)
    }

    const families = [...new Set(GENRES.map(g => g.family ?? 'pop'))]
    const cy = cytoscape({
      container: el,
      elements: [
        ...families.map(f => ({ data: { id: `fam-${f}`, label: FAMILY_META[f].label.toUpperCase(), color: FAMILY_META[f].color } })),
        ...GENRES.map(g => ({
          data: {
            id: g.slug,
            label: g.nameKo,
            parent: `fam-${g.family ?? 'pop'}`,
            color: FAMILY_META[g.family ?? 'pop'].color,
            size: 16 + (degree.get(g.slug) ?? 0) * 3,
            kr: g.kr === true ? 1 : 0,
          },
        })),
        ...RELATIONS.map(r => ({ data: { id: `${r.source}>${r.target}`, source: r.source, target: r.target, type: r.type } })),
      ],
      style: [
        {
          selector: ':parent',
          style: {
            'shape': 'round-rectangle',
            'background-color': 'data(color)',
            'background-opacity': 0.07,
            'border-width': 1,
            'border-style': 'dashed',
            'border-color': 'data(color)',
            'border-opacity': 0.55,
            'label': 'data(label)',
            'font-family': 'IBM Plex Mono, monospace',
            'font-size': 9,
            'color': subtle,
            'text-valign': 'top',
            'text-halign': 'center',
            'text-margin-y': -6,
            'padding': '18px',
          },
        },
        {
          selector: 'node:child',
          style: {
            'width': 'data(size)',
            'height': 'data(size)',
            'background-color': 'data(color)',
            'background-opacity': 0.9,
            'border-width': 0,
            'label': 'data(label)',
            'font-family': 'Noto Serif KR, serif',
            'font-size': 11,
            'font-weight': 700,
            'color': ink,
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 5,
          },
        },
        { selector: 'node:child[kr = 1]', style: { 'border-width': 2, 'border-color': accent } },
        { selector: 'node:child:selected', style: { 'border-width': 3, 'border-color': ink } },
        {
          selector: 'edge',
          style: {
            'curve-style': 'bezier',
            'width': 1.4,
            'line-color': subtle,
            'line-opacity': 0.5,
            'target-arrow-shape': 'triangle',
            'target-arrow-color': subtle,
            'arrow-scale': 0.7,
          },
        },
        { selector: 'edge[type = "influenced_by"]', style: { 'line-style': 'dashed', 'width': 1, 'line-opacity': 0.35 } },
        {
          selector: 'edge[type = "fusion_of"]',
          style: { 'width': 2.4, 'line-color': accent, 'line-opacity': 0.85, 'target-arrow-color': accent },
        },
      ],
      layout: FCOSE,
      wheelSensitivity: 0.3,
    })

    cy.on('tap', 'node:child', (e) => {
      const id = e.target.id()
      setSelectedSlug(prev => (prev === id ? null : id))
    })
    cy.on('tap', (e) => {
      if (e.target === cy)
        setSelectedSlug(null)
    })

    cyRef.current = cy
    window.__buckitCy = cy
    return () => {
      delete window.__buckitCy
      cy.destroy()
      cyRef.current = null
    }
  }, [])

  // panel drill-through → reflect into cytoscape's own selection state
  const pick = useCallback((slug: string) => {
    setSelectedSlug(slug)
    const cy = cyRef.current
    if (cy) {
      cy.$(':selected').unselect()
      const node = cy.$id(slug)
      node.select()
      cy.animate({ center: { eles: node }, duration: 500 })
    }
  }, [])

  return (
    <div className="genre-graph-wrap">
      <div className="genre-cluster">
        <div className="genre-cluster-canvas" ref={boxRef} />
        <button
	type="button"
	className="genre-btn genre-cluster-relayout"
	onClick={() => cyRef.current?.layout(FCOSE).run()}
        >
          ↺ 다시 배치
        </button>
      </div>

      <aside className="genre-panel" aria-live="polite">
        <GenreDetailPanel
	selectedSlug={selectedSlug}
	onPick={pick}
	emptyHint="패밀리 군집 지도입니다. 반투명 상자가 장르 패밀리, 원의 크기는 관계 수입니다. fCoSE 스프링 레이아웃이 매번 새 배치를 찾습니다 — '다시 배치'를 눌러 보세요."
        />
      </aside>
    </div>
  )
}
