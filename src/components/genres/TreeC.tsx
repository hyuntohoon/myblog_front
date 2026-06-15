// FEAT-genre-subgenres Step 4 — Layout C: tidy horizontal tree diagram.
// Global layer = containment dendrogram only (no cross-links). A sub-genre with
// two parents simply appears under each branch. Opening a node docks its EGO
// VIEW (relationships) on the right. Pan by dragging; ⌘/Ctrl+scroll to zoom.
// FEAT-genre-deepen: N-tier — each column is one depth, any node with children
// expands into the next column (was a fixed root→top→tier-1 3-column layout).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GmDoc, GmNode } from './gm-model'
import { gmChildren, gmCount, gmNode, gmOtherParents, gmPrimaryParent, gmShare, gmShareLabel, gmTopList, gmTotal } from './gm-model'
import { Chevron, EgoBody, gmClamp, ResizeHandle, ShareBar, useStoredWidth } from './gm-shared'

const TC = {
	rootX: 28,
	rootW: 132,
	rootH: 52,
	gap1: 104,
	colW: 178,
	colGap: 60,
	nodeH: 42,
	rowH: 50,
	blockGap: 10,
	padY: 30,
}

function tcLink(x1: number, y1: number, x2: number, y2: number): string {
	const mx = (x1 + x2) / 2
	return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`
}

// Ancestors of a node up the primary-parent chain (auto-open a deep-linked node).
function ancestorIds(doc: GmDoc, id: string | null): string[] {
	const out: string[] = []
	let node = gmNode(doc, id)
	let guard = 0
	while (node && node.tier > 0 && node.parents.length && guard < 12) {
		const pid = node.parents[0]
		out.push(pid)
		node = gmNode(doc, pid)
		guard++
	}
	return out
}

interface View { zoom: number, x: number, y: number }
interface PlacedNode { key: string, node: GmNode, parentId: string | null, depth: number, x: number, y: number, w: number, h: number }

function Detail({ doc, node, parent, total, onNavigate, onClose }: { doc: GmDoc, node: GmNode | null, parent: GmNode | null, total: number, onNavigate: (id: string) => void, onClose: () => void }) {
	if (!node) {
		return (
			<div className="gm-c-detail empty">
				<div className="gm-c-detail-emptymark mono">↜</div>
				<p>가지의 노드를 선택하면 여기에 관계 보기가 열립니다.</p>
			</div>
		)
	}
	const pct = gmShare(node.count, total)
	return (
		<div className="gm-c-detail">
			<div className="gm-c-detail-top">
				<div className="gm-b-crumb mono">
					{parent ?
						(
							<>
								<span>{parent.label}</span>
								<span className="gm-b-crumb-sep">/</span>
							</>
						) :
						<span>Genre Map</span>}
					<span className="cur">{node.label}</span>
				</div>
				<button type="button" className="gm-c-detail-x" onClick={onClose} title="닫기">✕</button>
			</div>

			<h2 className="gm-b-detailname">{node.label}</h2>

			<div className="gm-b-detailstats">
				<span>
					<strong>{gmCount(node.count)}</strong>
					{' '}
					<span className="mono">장</span>
				</span>
				<span className="gm-b-statdot">·</span>
				<span>
					<strong>{gmShareLabel(pct)}</strong>
					{' '}
					<span className="mono">{parent ? `of ${parent.label}` : '전체'}</span>
				</span>
			</div>
			<div className="gm-b-detailmeter"><ShareBar pct={pct} max={100} accent /></div>

			<EgoBody doc={doc} node={node} onNavigate={onNavigate} />
		</div>
	)
}

export default function TreeC({ doc, selId, onSelect, onNavigate }: { doc: GmDoc, selId: string | null, onSelect: (id: string | null) => void, onNavigate: (id: string) => void }) {
	const total = gmTotal(doc)
	const tops = gmTopList(doc)
	const maxPct = Math.max(...tops.map(g => gmShare(g.count, total)), 1)
	const [dockW, setDockW] = useStoredWidth('lfq-genremap-cw', 360)

	const [expanded, setExpanded] = useState<Set<string>>(() => new Set(ancestorIds(doc, selId)))
	const [sel, setSel] = useState<string | null>(selId)
	useEffect(() => {
		if (selId) {
			setSel(selId)
			setExpanded(s => new Set([...s, ...ancestorIds(doc, selId)]))
		}
	}, [selId, doc])

	const toggleExpand = (id: string, e: React.MouseEvent) => {
		e.stopPropagation()
		setExpanded((s) => {
			const n = new Set(s)
			if (n.has(id))
				n.delete(id)
			else
				n.add(id)
			return n
		})
	}
	const pick = (id: string) => {
		setSel(id)
		onSelect(id)
	}

	// ── pan / zoom ──────────────────────────────────────────────────────────
	const stageRef = useRef<HTMLDivElement | null>(null)
	const [view, setView] = useState<View>(() => {
		try {
			const v = JSON.parse(localStorage.getItem('lfq-genremap-cview') ?? 'null')
			if (v && typeof v.zoom === 'number')
				return v
		}
		catch {}
		return { zoom: 1, x: 0, y: 0 }
	})
	const viewRef = useRef(view)
	viewRef.current = view
	useEffect(() => {
		try {
			localStorage.setItem('lfq-genremap-cview', JSON.stringify(view))
		}
		catch {}
	}, [view])
	const [panning, setPanning] = useState(false)

	const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
		setView((v) => {
			const nz = gmClamp(v.zoom * factor, 0.4, 2.4)
			const ratio = nz / v.zoom
			return { zoom: nz, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio }
		})
	}, [])
	useEffect(() => {
		const el = stageRef.current
		if (!el)
			return
		const onWheel = (e: WheelEvent) => {
			if (!(e.ctrlKey || e.metaKey))
				return
			e.preventDefault()
			const r = el.getBoundingClientRect()
			zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0016))
		}
		el.addEventListener('wheel', onWheel, { passive: false })
		return () => el.removeEventListener('wheel', onWheel)
	}, [zoomAt])

	const onPanStart = (e: React.PointerEvent) => {
		if (e.pointerType === 'mouse' && e.button !== 0)
			return
		const target = e.target as HTMLElement
		if (target.closest('.gm-c-node') || target.closest('.gm-c-zoomctl'))
			return
		const sx = e.clientX
		const sy = e.clientY
		const bx = viewRef.current.x
		const by = viewRef.current.y
		setPanning(true)
		const move = (ev: PointerEvent) => setView(v => ({ ...v, x: bx + (ev.clientX - sx), y: by + (ev.clientY - sy) }))
		const up = () => {
			setPanning(false)
			window.removeEventListener('pointermove', move)
			window.removeEventListener('pointerup', up)
		}
		window.addEventListener('pointermove', move)
		window.addEventListener('pointerup', up)
	}
	const zoomBtn = (f: number) => {
		const el = stageRef.current
		if (!el)
			return
		const r = el.getBoundingClientRect()
		zoomAt(r.width / 2, r.height / 2, f)
	}

	const layout = useMemo(() => {
		const baseX = TC.rootX + TC.rootW + TC.gap1
		const colStep = TC.colW + TC.colGap
		const nodes: PlacedNode[] = []
		const links: { d: string }[] = []
		let y = TC.padY
		let maxDepth = 0

		// Recursive tidy-tree placement: leaves stack top-to-bottom (rowH), an
		// open internal node centres on its children. Each depth is one column.
		function place(node: GmNode, parentId: string | null, depth: number): number {
			if (depth > maxDepth)
				maxDepth = depth
			const x = baseX + depth * colStep
			const kids = gmChildren(doc, node.id)
			const isOpen = expanded.has(node.id) && kids.length > 0
			let cy: number
			if (isOpen) {
				const cys = kids.map(c => place(c, node.id, depth + 1))
				cy = (cys[0] + cys[cys.length - 1]) / 2
				const childX = baseX + (depth + 1) * colStep
				cys.forEach(c => links.push({ d: tcLink(x + TC.colW, cy, childX, c) }))
			}
			else {
				cy = y + TC.rowH / 2
				y += TC.rowH
			}
			nodes.push({ key: `${parentId ?? 'root'}:${node.id}`, node, parentId, depth, x, y: cy, w: TC.colW, h: TC.nodeH })
			return cy
		}

		const genreYs = tops.map((g) => {
			const gy = place(g, null, 0)
			y += TC.blockGap
			return gy
		})

		const rootY = genreYs.length ? (genreYs[0] + genreYs[genreYs.length - 1]) / 2 : TC.padY
		const rootLinks = genreYs.map(gy => ({ d: tcLink(TC.rootX + TC.rootW, rootY, baseX, gy) }))
		const width = baseX + (maxDepth + 1) * colStep + 36
		const height = y - TC.blockGap + TC.padY
		return { nodes, links, rootLinks, rootY, width, height, maxDepth }
	}, [doc, expanded, tops])

	const detailNode = gmNode(doc, sel)
	const detailParent = detailNode && detailNode.tier >= 1 ? gmPrimaryParent(doc, detailNode) : null
	const canvasH = Math.max(layout.height, 200)

	const fitView = () => {
		const el = stageRef.current
		if (!el)
			return
		const r = el.getBoundingClientRect()
		const pad = 56
		const z = gmClamp(Math.min((r.width - pad) / layout.width, (r.height - pad) / canvasH), 0.4, 2.4)
		setView({ zoom: z, x: (r.width - layout.width * z) / 2, y: (r.height - canvasH * z) / 2 })
	}

	return (
		<div className="gm-c-wrap">
			<div className={`gm-c-stage${panning ? ' panning' : ''}`} ref={stageRef} onPointerDown={onPanStart}>
				<div className="gm-c-viewport" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, transformOrigin: '0 0' }}>
					<div className="gm-c-canvas" style={{ width: layout.width, height: canvasH }}>
						<svg className="gm-c-links" width={layout.width} height={canvasH}>
							{layout.rootLinks.map((l, i) => <path key={`r${i}`} d={l.d} className="gm-c-link root" fill="none" />)}
							{layout.links.map((l, i) => <path key={`c${i}`} d={l.d} className="gm-c-link child" fill="none" />)}
						</svg>

						<div className="gm-c-node root" style={{ left: TC.rootX, top: layout.rootY - TC.rootH / 2, width: TC.rootW, minHeight: TC.rootH }}>
							<span className="gm-c-root-title serif">Genre Map</span>
							<span className="mono gm-c-root-sub">{`${tops.length} 장르 · ${gmCount(total)}장`}</span>
						</div>

						{layout.nodes.map((nd) => {
							const g = nd.node
							const isTop = nd.depth === 0
							const pct = gmShare(g.count, total)
							const kids = gmChildren(doc, g.id)
							const hasKids = kids.length > 0
							const open = expanded.has(g.id)
							const others = !isTop ? gmOtherParents(doc, g, nd.parentId) : []
							return (
								<div
									key={nd.key}
									className={`gm-c-node ${isTop ? 'genre' : 'child'}${sel === g.id ? ' active' : ''}`}
									style={{ left: nd.x, top: nd.y - nd.h / 2, width: nd.w, minHeight: nd.h }}
									role="button"
									tabIndex={0}
									onClick={() => pick(g.id)}
									onKeyDown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault()
											pick(g.id)
										}
									}}
								>
									{isTop ?
										(
											<>
												<span className="mono gm-c-num">{String(tops.indexOf(g) + 1).padStart(2, '0')}</span>
												<span className="gm-c-nodemain">
													<span className="gm-c-label">{g.label}</span>
													<span className="gm-c-sub">
														<span className="gm-c-meter"><ShareBar pct={pct} max={maxPct} accent thin /></span>
														<span className="mono gm-c-share">{gmShareLabel(pct)}</span>
													</span>
												</span>
											</>
										) :
										(
											<>
												<span className="gm-c-childdot" data-shared={others.length ? '1' : '0'} />
												<span className="gm-c-nodemain">
													<span className="gm-c-label child">{g.label}</span>
													{others.length ? <span className="gm-c-shared mono">{`⇄ 또한 ${others.map(o => o.label).join('·')}`}</span> : null}
												</span>
												<span className="mono gm-c-childcount">{gmCount(g.count)}</span>
											</>
										)}
									{hasKids ?
										(
											<button type="button" className={`gm-c-expand${open ? ' open' : ''}`} title={open ? '접기' : '펼치기'} onClick={e => toggleExpand(g.id, e)}>
												<span className="gm-c-expand-n mono">{kids.length}</span>
												<Chevron open={open} size={11} />
											</button>
										) :
										null}
								</div>
							)
						})}
					</div>
				</div>

				<div className="gm-c-zoomctl">
					<button type="button" className="gm-c-zoombtn" title="확대" onClick={() => zoomBtn(1.25)} aria-label="확대">＋</button>
					<button type="button" className="gm-c-zoompct" title="100%로" onClick={() => zoomBtn(1 / viewRef.current.zoom)}>{`${Math.round(view.zoom * 100)}%`}</button>
					<button type="button" className="gm-c-zoombtn" title="축소" onClick={() => zoomBtn(0.8)} aria-label="축소">－</button>
					<button type="button" className="gm-c-zoombtn gm-c-fitbtn" title="전체 맞춤" onClick={fitView} aria-label="전체 맞춤">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" /></svg>
					</button>
				</div>
				<div className="gm-c-panhint mono">드래그하여 이동 · ⌘/Ctrl+스크롤 확대</div>
			</div>

			<ResizeHandle className="gm-c-resizer" getBase={() => dockW} onResize={(b, dx) => setDockW(gmClamp(b - dx, 300, 680))} />
			<div className="gm-c-dockwrap" style={{ flex: `0 0 ${dockW}px` }}>
				<Detail
					doc={doc}
					node={detailNode}
					parent={detailParent}
					total={total}
					onNavigate={onNavigate}
					onClose={() => {
						setSel(null)
						onSelect(null)
					}}
				/>
			</div>
		</div>
	)
}
