import type { Edge, Node, NodeProps, NodeTypes } from '@xyflow/react'
import { Background, Controls, Handle, MarkerType, Position, ReactFlow } from '@xyflow/react'
import { useCallback, useMemo, useState } from 'react'
import type { GenreSeed, RelationType } from '@lib/genres-sample'
import { GENRES, RELATION_LABEL, RELATIONS } from '@lib/genres-sample'
import '@xyflow/react/dist/style.css'

/**
 * /genres sample island — read-only ontology graph over hardcoded seed data.
 * Nodes are draggable for exploration but nothing persists; editing is a
 * later, writer-only feature. Edge color/dash encodes the relation type.
 */

type GenreNodeType = Node<{ genre: GenreSeed }, 'genre'>

const BY_SLUG = new Map(GENRES.map(g => [g.slug, g]))

const EDGE_STYLE: Record<RelationType, { stroke: string, strokeWidth: number, dash?: string }> = {
  subgenre_of: { stroke: 'var(--color-subtle)', strokeWidth: 1.6 },
  influenced_by: { stroke: 'var(--color-faded)', strokeWidth: 1.2, dash: '6 5' },
  fusion_of: { stroke: 'var(--color-accent)', strokeWidth: 2.2 },
}

function GenreNode({ data, selected }: NodeProps<GenreNodeType>) {
  const { genre } = data
  return (
    <div className={`genre-node${selected ? ' is-selected' : ''}`}>
      <Handle type="target" position={Position.Top} className="genre-handle" isConnectable={false} />
      <span className="genre-node-era">{genre.eraStart}</span>
      <span className="genre-node-ko">{genre.nameKo}</span>
      <span className="genre-node-en">{genre.nameEn}</span>
      <Handle type="source" position={Position.Bottom} className="genre-handle" isConnectable={false} />
    </div>
  )
}

const NODE_TYPES: NodeTypes = { genre: GenreNode }

export default function GenreGraphSample() {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)

  const nodes = useMemo<GenreNodeType[]>(() => GENRES.map(g => ({
    id: g.slug,
    type: 'genre',
    position: { x: g.x, y: g.y },
    data: { genre: g },
    selected: g.slug === selectedSlug,
  })), [selectedSlug])

  const edges = useMemo<Edge[]>(() => RELATIONS.map((r, i) => {
    const s = EDGE_STYLE[r.type]
    const touchesSelection = selectedSlug !== null && (r.source === selectedSlug || r.target === selectedSlug)
    const dimmed = selectedSlug !== null && !touchesSelection
    return {
      id: `e${i}-${r.source}-${r.target}`,
      source: r.source,
      target: r.target,
      style: {
        stroke: s.stroke,
        strokeWidth: touchesSelection ? s.strokeWidth + 0.8 : s.strokeWidth,
        strokeDasharray: s.dash,
        opacity: dimmed ? 0.18 : 1,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: s.stroke, width: 16, height: 16 },
    }
  }), [selectedSlug])

  const selected = selectedSlug ? BY_SLUG.get(selectedSlug) : undefined
  const origins = useMemo(() => selectedSlug ?
    RELATIONS.filter(r => r.target === selectedSlug) :
    [], [selectedSlug])
  const descendants = useMemo(() => selectedSlug ?
    RELATIONS.filter(r => r.source === selectedSlug) :
    [], [selectedSlug])

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    setSelectedSlug(prev => (prev === node.id ? null : node.id))
  }, [])

  return (
    <div className="genre-graph-wrap">
      <div className="genre-flow">
        <ReactFlow
	nodes={nodes}
	edges={edges}
	nodeTypes={NODE_TYPES}
	onNodeClick={onNodeClick}
	onPaneClick={() => setSelectedSlug(null)}
	colorMode="system"
	fitView
	minZoom={0.25}
	maxZoom={1.6}
	nodesConnectable={false}
	deleteKeyCode={null}
	edgesFocusable={false}
        >
          <Background gap={26} size={1.2} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <aside className="genre-panel" aria-live="polite">
        {selected ?
          (
              <>
                <header className="genre-panel-head">
                  <span className="genre-panel-era">{selected.eraStart}</span>
                  <h2 className="genre-panel-title">{selected.nameKo}</h2>
                  <span className="genre-panel-en">{selected.nameEn}</span>
                </header>
                <p className="genre-panel-short">{selected.shortDesc}</p>
                <h3 className="genre-panel-sub">연혁</h3>
                <p className="genre-panel-history">{selected.history}</p>

                {origins.length > 0 && (
                  <>
                    <h3 className="genre-panel-sub">기원 · 상위</h3>
                    <ul className="genre-rel-list">
                      {origins.map(r => (
                        <li key={`${r.source}-${r.type}`}>
                          <button type="button" className="genre-rel" onClick={() => setSelectedSlug(r.source)}>
                            <span className={`genre-rel-tag rel-${r.type}`}>{RELATION_LABEL[r.type]}</span>
                            {BY_SLUG.get(r.source)?.nameKo}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {descendants.length > 0 && (
                  <>
                    <h3 className="genre-panel-sub">파생</h3>
                    <ul className="genre-rel-list">
                      {descendants.map(r => (
                        <li key={`${r.target}-${r.type}`}>
                          <button type="button" className="genre-rel" onClick={() => setSelectedSlug(r.target)}>
                            <span className={`genre-rel-tag rel-${r.type}`}>{RELATION_LABEL[r.type]}</span>
                            {BY_SLUG.get(r.target)?.nameKo}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            ) :
          (
              <div className="genre-panel-empty">
                <p>노드를 클릭하면 장르의 설명·연혁·관계가 여기에 표시됩니다.</p>
                <ul className="genre-legend">
                  <li>
<span className="genre-legend-line legend-subgenre" />
하위장르
                  </li>
                  <li>
<span className="genre-legend-line legend-influence" />
영향
                  </li>
                  <li>
<span className="genre-legend-line legend-fusion" />
융합
                  </li>
                </ul>
                <p className="genre-panel-note">샘플 데이터입니다. 편집 기능은 추후 writer 전용으로 제공됩니다.</p>
              </div>
            )}
      </aside>
    </div>
  )
}
