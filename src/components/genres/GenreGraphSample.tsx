import type { Connection, Edge, Node, NodeProps, NodeTypes } from '@xyflow/react'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GenreRelationSeed, GenreSeed, RelationType } from '@lib/genres-sample'
import { ERA_OPTIONS, GENRES, RELATION_LABEL, RELATIONS } from '@lib/genres-sample'
import '@xyflow/react/dist/style.css'

/**
 * /genres island — archival genealogy plate over the genre ontology sample.
 *
 * View mode: read-only map with focus dimming + pan-to drill-through.
 * Edit mode (편집 모드): full client-side CRUD demo — add/edit/delete genres,
 * drag-to-connect relations with a type picker, edge retype/delete. The doc
 * persists to localStorage only; this is still a backend-less spike. The doc
 * shape mirrors the planned genres / genre_relations tables.
 */

const STORAGE_KEY = 'buckit-genres-sample-v1'

interface GraphDoc {
  genres: GenreSeed[]
  relations: GenreRelationSeed[]
}

const SEED: GraphDoc = { genres: GENRES, relations: RELATIONS }

function loadDoc(): GraphDoc {
  if (typeof window === 'undefined')
    return SEED
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw)
      return SEED
    const doc = JSON.parse(raw)
    if (Array.isArray(doc?.genres) && Array.isArray(doc?.relations))
      return doc
  }
  catch { /* corrupted doc → fall back to seed */ }
  return SEED
}

function slugify(en: string, ko: string, taken: Set<string>) {
  const base = (en || ko).toLowerCase().replace(/[^a-z0-9\p{Script=Hangul}]+/gu, '-').replace(/^-+|-+$/g, '') || 'genre'
  let slug = base
  let n = 2
  while (taken.has(slug))
    slug = `${base}-${n++}`
  return slug
}

const EDGE_STYLE: Record<RelationType, { stroke: string, strokeWidth: number, dash?: string }> = {
  subgenre_of: { stroke: 'var(--color-subtle)', strokeWidth: 1.6 },
  influenced_by: { stroke: 'var(--color-faded)', strokeWidth: 1.2, dash: '6 5' },
  fusion_of: { stroke: 'var(--color-accent)', strokeWidth: 2.2 },
}

interface FormState {
  nameKo: string
  nameEn: string
  eraStart: string
  shortDesc: string
  history: string
}

const EMPTY_FORM: FormState = { nameKo: '', nameEn: '', eraStart: '2020s', shortDesc: '', history: '' }

/* ── nodes ── */

type GenreNodeType = Node<{ genre: GenreSeed, idx: number, dim: boolean, edit: boolean }, 'genre'>
type EraNodeType = Node<{ label: string }, 'era'>

function GenreNode({ data, selected }: NodeProps<GenreNodeType>) {
  const { genre, idx, dim, edit } = data
  return (
    <div
	className={`genre-node${selected ? ' is-selected' : ''}${dim ? ' is-dim' : ''}${edit ? ' is-edit' : ''}`}
	style={{ '--d': `${idx * 35}ms` } as React.CSSProperties}
    >
      <Handle type="target" position={Position.Top} className="genre-handle" isConnectable={edit} />
      <span className="genre-node-idx">{String(idx + 1).padStart(3, '0')}</span>
      <span className="genre-node-era">{genre.eraStart}</span>
      <span className="genre-node-ko">{genre.nameKo}</span>
      <span className="genre-node-en">{genre.nameEn}</span>
      <Handle type="source" position={Position.Bottom} className="genre-handle" isConnectable={edit} />
    </div>
  )
}

function EraNode({ data }: NodeProps<EraNodeType>) {
  return (
    <div className="genre-era-line">
      <span>{data.label}</span>
    </div>
  )
}

const NODE_TYPES: NodeTypes = { genre: GenreNode, era: EraNode }

/* ── island ── */

function GenreGraphInner() {
  const [doc, setDoc] = useState<GraphDoc>(loadDoc)
  const [editMode, setEditMode] = useState(false)
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [pendingConn, setPendingConn] = useState<{ source: string, target: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const flow = useReactFlow()

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(doc))
    }
    catch { /* storage full/blocked — sample keeps working in-memory */ }
  }, [doc])

  const say = useCallback((msg: string) => {
    setNotice(msg)
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 2600)
  }, [])

  const bySlug = useMemo(() => new Map(doc.genres.map(g => [g.slug, g])), [doc.genres])

  const neighbors = useMemo(() => {
    if (!selectedSlug)
      return null
    const set = new Set([selectedSlug])
    for (const r of doc.relations) {
      if (r.source === selectedSlug)
        set.add(r.target)
      if (r.target === selectedSlug)
        set.add(r.source)
    }
    return set
  }, [doc.relations, selectedSlug])

  const eraLines = useMemo<EraNodeType[]>(() => {
    const minY = new Map<string, number>()
    for (const g of doc.genres) {
      const y = minY.get(g.eraStart)
      if (y === undefined || g.y < y)
        minY.set(g.eraStart, g.y)
    }
    return [...minY.entries()].map(([era, y]) => ({
      id: `era:${era}`,
      type: 'era',
      position: { x: -150, y: y - 32 },
      data: { label: era },
      draggable: false,
      selectable: false,
      focusable: false,
    }))
  }, [doc.genres])

  const nodes = useMemo<(GenreNodeType | EraNodeType)[]>(() => [
    ...eraLines,
    ...doc.genres.map((g, i) => ({
      id: g.slug,
      type: 'genre' as const,
      position: { x: g.x, y: g.y },
      data: { genre: g, idx: i, dim: neighbors !== null && !neighbors.has(g.slug), edit: editMode },
      selected: g.slug === selectedSlug,
    })),
  ], [doc.genres, eraLines, neighbors, selectedSlug, editMode])

  const edges = useMemo<Edge[]>(() => doc.relations.map((r) => {
    const s = EDGE_STYLE[r.type]
    const id = `${r.source}>${r.target}`
    const touches = selectedSlug !== null && (r.source === selectedSlug || r.target === selectedSlug)
    const dimmed = (selectedSlug !== null && !touches) || (selectedEdgeId !== null && selectedEdgeId !== id)
    return {
      id,
      source: r.source,
      target: r.target,
      className: `rel-${r.type}${selectedEdgeId === id ? ' is-picked' : ''}`,
      style: {
        stroke: s.stroke,
        strokeWidth: touches || selectedEdgeId === id ? s.strokeWidth + 0.9 : s.strokeWidth,
        strokeDasharray: s.dash,
        opacity: dimmed ? 0.14 : 1,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: s.stroke, width: 15, height: 15 },
    }
  }), [doc.relations, selectedSlug, selectedEdgeId])

  const selected = selectedSlug ? bySlug.get(selectedSlug) : undefined
  const selectedRelation = useMemo(() => {
    if (!selectedEdgeId)
      return null
    const [source, target] = selectedEdgeId.split('>')
    return doc.relations.find(r => r.source === source && r.target === target) ?? null
  }, [doc.relations, selectedEdgeId])

  const origins = useMemo(() => doc.relations.filter(r => r.target === selectedSlug), [doc.relations, selectedSlug])
  const descendants = useMemo(() => doc.relations.filter(r => r.source === selectedSlug), [doc.relations, selectedSlug])

  /* ── selection ── */

  const pickGenre = useCallback((slug: string, pan = false) => {
    setSelectedEdgeId(null)
    setAdding(false)
    setSelectedSlug(slug)
    const g = bySlug.get(slug)
    if (g) {
      setForm({ nameKo: g.nameKo, nameEn: g.nameEn, eraStart: g.eraStart, shortDesc: g.shortDesc, history: g.history })
      if (pan)
        flow.setCenter(g.x + 80, g.y + 60, { duration: 650, zoom: Math.max(flow.getZoom(), 0.9) })
    }
  }, [bySlug, flow])

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    if (node.type !== 'genre')
      return
    setSelectedSlug(prev => (prev === node.id ? null : node.id))
    setSelectedEdgeId(null)
    setAdding(false)
    const g = bySlug.get(node.id)
    if (g)
      setForm({ nameKo: g.nameKo, nameEn: g.nameEn, eraStart: g.eraStart, shortDesc: g.shortDesc, history: g.history })
  }, [bySlug])

  const onEdgeClick = useCallback((_: unknown, edge: Edge) => {
    if (!editMode)
      return
    setSelectedSlug(null)
    setAdding(false)
    setSelectedEdgeId(prev => (prev === edge.id ? null : edge.id))
  }, [editMode])

  const clearSelection = useCallback(() => {
    setSelectedSlug(null)
    setSelectedEdgeId(null)
    setAdding(false)
    setPendingConn(null)
  }, [])

  /* ── mutations (functional setState throughout) ── */

  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    if (node.type !== 'genre')
      return
    setDoc(prev => ({
      ...prev,
      genres: prev.genres.map(g => (g.slug === node.id ? { ...g, x: Math.round(node.position.x), y: Math.round(node.position.y) } : g)),
    }))
  }, [])

  const onConnect = useCallback((conn: Connection) => {
    if (!conn.source || !conn.target || conn.source === conn.target)
      return
    const dup = doc.relations.some(r => r.source === conn.source && r.target === conn.target)
    if (dup) {
      say('이미 연결된 관계입니다 — 엣지를 클릭해 유형을 바꿔 보세요.')
      return
    }
    setPendingConn({ source: conn.source, target: conn.target })
  }, [doc.relations, say])

  const commitConnection = useCallback((type: RelationType) => {
    setPendingConn((conn) => {
      if (conn)
        setDoc(prev => ({ ...prev, relations: [...prev.relations, { ...conn, type }] }))
      return null
    })
  }, [])

  const startAdd = useCallback(() => {
    setSelectedSlug(null)
    setSelectedEdgeId(null)
    setForm(EMPTY_FORM)
    setAdding(true)
  }, [])

  const saveForm = useCallback(() => {
    if (!form.nameKo.trim()) {
      say('한글 이름은 필수입니다.')
      return
    }
    if (adding) {
      const rect = wrapRef.current?.getBoundingClientRect()
      const pos = rect ?
        flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2.5 }) :
        { x: 500, y: 360 }
      setDoc((prev) => {
        const slug = slugify(form.nameEn, form.nameKo, new Set(prev.genres.map(g => g.slug)))
        const g: GenreSeed = { slug, ...form, x: Math.round(pos.x), y: Math.round(pos.y) }
        setAdding(false)
        setSelectedSlug(slug)
        return { ...prev, genres: [...prev.genres, g] }
      })
      say('장르를 추가했습니다 — 핸들을 드래그해 관계를 연결해 보세요.')
    }
    else if (selectedSlug) {
      setDoc(prev => ({
        ...prev,
        genres: prev.genres.map(g => (g.slug === selectedSlug ? { ...g, ...form } : g)),
      }))
      say('수정했습니다.')
    }
  }, [adding, flow, form, say, selectedSlug])

  const deleteGenre = useCallback(() => {
    if (!selectedSlug)
      return
    setDoc(prev => ({
      genres: prev.genres.filter(g => g.slug !== selectedSlug),
      relations: prev.relations.filter(r => r.source !== selectedSlug && r.target !== selectedSlug),
    }))
    setSelectedSlug(null)
    say('삭제했습니다.')
  }, [say, selectedSlug])

  const retypeEdge = useCallback((type: RelationType) => {
    if (!selectedRelation)
      return
    setDoc(prev => ({
      ...prev,
      relations: prev.relations.map(r => (r.source === selectedRelation.source && r.target === selectedRelation.target ? { ...r, type } : r)),
    }))
  }, [selectedRelation])

  const deleteEdge = useCallback(() => {
    if (!selectedRelation)
      return
    setDoc(prev => ({
      ...prev,
      relations: prev.relations.filter(r => !(r.source === selectedRelation.source && r.target === selectedRelation.target)),
    }))
    setSelectedEdgeId(null)
    say('관계를 삭제했습니다.')
  }, [say, selectedRelation])

  const resetDoc = useCallback(() => {
    if (!confirmReset) {
      setConfirmReset(true)
      setTimeout(() => setConfirmReset(false), 3200)
      return
    }
    setDoc(SEED)
    clearSelection()
    setConfirmReset(false)
    say('시드 데이터로 초기화했습니다.')
  }, [clearSelection, confirmReset, say])

  /* ── render ── */

  const showNodeForm = editMode && (adding || (selectedSlug && selected))
  const formTitle = adding ? '새 장르' : selected?.nameKo

  return (
    <div className="genre-graph-wrap" ref={wrapRef}>
      <div className={`genre-flow${editMode ? ' is-edit' : ''}`}>
        <ReactFlow
	nodes={nodes}
	edges={edges}
	nodeTypes={NODE_TYPES}
	onNodeClick={onNodeClick}
	onEdgeClick={onEdgeClick}
	onPaneClick={clearSelection}
	onNodeDragStop={onNodeDragStop}
	onConnect={onConnect}
	connectionLineStyle={{ stroke: 'var(--color-accent)', strokeWidth: 1.6, strokeDasharray: '4 4' }}
	colorMode="system"
	fitView
	fitViewOptions={{ padding: 0.12 }}
	minZoom={0.25}
	maxZoom={1.8}
	nodesConnectable={editMode}
	deleteKeyCode={null}
	edgesFocusable={editMode}
        >
          <Background gap={26} size={1.1} />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap
	className="genre-minimap"
	pannable
	zoomable
	nodeColor={n => (n.type === 'era' ? 'transparent' : n.selected ? 'var(--color-accent)' : 'var(--color-faded)')}
	nodeStrokeWidth={2}
          />

          <Panel position="top-left" className="genre-chrome genre-legend-panel">
            <span className="genre-chrome-kicker">GENEALOGY OF GENRES</span>
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
          </Panel>

          <Panel position="top-right" className="genre-chrome genre-toolbar">
            <button
	type="button"
	className={`genre-btn genre-btn-toggle${editMode ? ' is-on' : ''}`}
	aria-pressed={editMode}
	onClick={() => {
                setEditMode((v) => {
                  if (v)
                    clearSelection()
                  return !v
                })
              }}
            >
              <span className="genre-btn-dot" />
              편집 모드
            </button>
            {editMode && (
              <>
                <button type="button" className="genre-btn" onClick={startAdd}>＋ 장르 추가</button>
                <button type="button" className={`genre-btn genre-btn-danger${confirmReset ? ' is-armed' : ''}`} onClick={resetDoc}>
                  {confirmReset ? '한 번 더 누르면 초기화' : '초기화'}
                </button>
              </>
            )}
          </Panel>

          <Panel position="bottom-center" className="genre-chrome genre-plate-foot">
            <span>
              {doc.genres.length}
              {' GENRES · '}
              {doc.relations.length}
              {' RELATIONS'}
              {editMode ? ' · 이 브라우저에만 저장되는 샘플입니다' : ''}
            </span>
          </Panel>

          {notice && (
            <Panel position="bottom-center" className="genre-chrome genre-toast">{notice}</Panel>
          )}
        </ReactFlow>

        {pendingConn && (
          <div className="genre-modal-veil" role="dialog" aria-label="관계 유형 선택">
            <div className="genre-modal">
              <p className="genre-modal-title">
                <strong>{bySlug.get(pendingConn.source)?.nameKo}</strong>
                {' → '}
                <strong>{bySlug.get(pendingConn.target)?.nameKo}</strong>
              </p>
              <p className="genre-modal-sub">두 장르의 관계 유형을 선택하세요</p>
              {(Object.keys(RELATION_LABEL) as RelationType[]).map(t => (
                <button key={t} type="button" className="genre-modal-opt" onClick={() => commitConnection(t)}>
                  <span className={`genre-legend-line legend-pick rel-pick-${t}`} />
                  {RELATION_LABEL[t]}
                  <em>{t}</em>
                </button>
              ))}
              <button type="button" className="genre-btn genre-modal-cancel" onClick={() => setPendingConn(null)}>취소</button>
            </div>
          </div>
        )}
      </div>

      <aside className="genre-panel" aria-live="polite">
        {showNodeForm ?
          (
              <div className="genre-panel-inner" key={`form-${selectedSlug ?? 'new'}`}>
                <span className="genre-chrome-kicker">{adding ? 'NEW ENTRY' : 'EDIT ENTRY'}</span>
                <h2 className="genre-panel-title">{formTitle || '새 장르'}</h2>
                <label className="genre-field">
                  <span>이름 (한글)</span>
                  <input value={form.nameKo} onChange={e => setForm(f => ({ ...f, nameKo: e.target.value }))} />
                </label>
                <label className="genre-field">
                  <span>이름 (영문)</span>
                  <input value={form.nameEn} onChange={e => setForm(f => ({ ...f, nameEn: e.target.value }))} />
                </label>
                <label className="genre-field">
                  <span>시대</span>
                  <select value={form.eraStart} onChange={e => setForm(f => ({ ...f, eraStart: e.target.value }))}>
                    {ERA_OPTIONS.map(era => <option key={era} value={era}>{era}</option>)}
                  </select>
                </label>
                <label className="genre-field">
                  <span>한 줄 설명</span>
                  <textarea rows={2} value={form.shortDesc} onChange={e => setForm(f => ({ ...f, shortDesc: e.target.value }))} />
                </label>
                <label className="genre-field">
                  <span>연혁</span>
                  <textarea rows={4} value={form.history} onChange={e => setForm(f => ({ ...f, history: e.target.value }))} />
                </label>
                <div className="genre-form-actions">
                  <button type="button" className="genre-btn genre-btn-primary" onClick={saveForm}>{adding ? '추가' : '저장'}</button>
                  {!adding && <button type="button" className="genre-btn genre-btn-danger" onClick={deleteGenre}>삭제</button>}
                  <button type="button" className="genre-btn" onClick={clearSelection}>닫기</button>
                </div>
              </div>
            ) :
          selectedRelation ?
            (
                <div className="genre-panel-inner" key={selectedEdgeId}>
                  <span className="genre-chrome-kicker">RELATION</span>
                  <h2 className="genre-panel-title genre-panel-title-sm">
                    {bySlug.get(selectedRelation.source)?.nameKo}
                    <span className="genre-rel-arrow"> → </span>
                    {bySlug.get(selectedRelation.target)?.nameKo}
                  </h2>
                  <h3 className="genre-panel-sub">관계 유형</h3>
                  <div className="genre-type-chips">
                    {(Object.keys(RELATION_LABEL) as RelationType[]).map(t => (
                      <button
	key={t}
	type="button"
	className={`genre-rel-tag rel-${t}${selectedRelation.type === t ? ' is-active' : ''}`}
	onClick={() => retypeEdge(t)}
                      >
                        {RELATION_LABEL[t]}
                      </button>
                    ))}
                  </div>
                  <div className="genre-form-actions">
                    <button type="button" className="genre-btn genre-btn-danger" onClick={deleteEdge}>관계 삭제</button>
                    <button type="button" className="genre-btn" onClick={clearSelection}>닫기</button>
                  </div>
                </div>
              ) :
            selected ?
              (
                  <div className="genre-panel-inner" key={selectedSlug}>
                    <span className="genre-panel-era">{selected.eraStart}</span>
                    <h2 className="genre-panel-title">{selected.nameKo}</h2>
                    <span className="genre-panel-en">{selected.nameEn}</span>
                    <p className="genre-panel-short">{selected.shortDesc}</p>
                    {selected.history && (
                      <>
                        <h3 className="genre-panel-sub">연혁</h3>
                        <p className="genre-panel-history">{selected.history}</p>
                      </>
                    )}
                    {origins.length > 0 && (
                      <>
                        <h3 className="genre-panel-sub">기원 · 상위</h3>
                        <ul className="genre-rel-list">
                          {origins.map(r => (
                            <li key={`${r.source}-${r.type}`}>
                              <button type="button" className="genre-rel" onClick={() => pickGenre(r.source, true)}>
                                <span className={`genre-rel-tag rel-${r.type}`}>{RELATION_LABEL[r.type]}</span>
                                {bySlug.get(r.source)?.nameKo}
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
                              <button type="button" className="genre-rel" onClick={() => pickGenre(r.target, true)}>
                                <span className={`genre-rel-tag rel-${r.type}`}>{RELATION_LABEL[r.type]}</span>
                                {bySlug.get(r.target)?.nameKo}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                ) :
              (
                  <div className="genre-panel-inner genre-panel-empty" key="empty">
                    <span className="genre-chrome-kicker">FIELD NOTES</span>
                    <p>노드를 클릭하면 장르의 설명·연혁·관계가 여기에 표시됩니다.</p>
                    <p>
                      <strong>편집 모드</strong>
                      를 켜면 장르를 추가·수정·삭제하고, 노드 위아래의 점을 드래그해 관계를 직접 연결할 수 있습니다. 엣지를 클릭하면 유형 변경·삭제가 가능합니다.
                    </p>
                    <p className="genre-panel-note">샘플 데이터 — 변경 사항은 이 브라우저에만 저장됩니다.</p>
                  </div>
                )}
      </aside>
    </div>
  )
}

export default function GenreGraphSample() {
  return (
    <ReactFlowProvider>
      <GenreGraphInner />
    </ReactFlowProvider>
  )
}
