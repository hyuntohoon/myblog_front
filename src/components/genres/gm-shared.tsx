// FEAT-genre-subgenres Step 4 — shared, read-only Genre Map pieces:
// tiny markdown, the share meter, the chevron, and the per-node EGO VIEW
// (relationship diagram + legend) reused by every layout and the peek modal.
//
// Global layer = containment only. Relationships are revealed ONLY inside a
// single node's ego view. Three types: parent (is-a, solid) · influence
// (directed arrow) · related (lateral, dotted). A small local neighbourhood,
// never a global web.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { GmDoc, GmNode, RelType } from './gm-model'
import {
	GM_RELS,
	gmChildren,
	gmCount,
	gmInbound,
	gmNode,
	gmPrimaryParent,
	gmRelList,
} from './gm-model'

// ── tiny markdown: paragraphs · **bold** · *italic* ─────────────────────────
function inlineMd(text: string): React.ReactNode[] {
	const out: React.ReactNode[] = []
	let rest = text
	let key = 0
	const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*)/
	let m = re.exec(rest)
	while (m) {
		if (m.index > 0)
			out.push(rest.slice(0, m.index))
		if (m[2] != null)
			out.push(<strong key={key++}>{m[2]}</strong>)
		else
			out.push(<em key={key++}>{m[3]}</em>)
		rest = rest.slice(m.index + m[0].length)
		m = re.exec(rest)
	}
	if (rest)
		out.push(rest)
	return out
}

export function Markdown({ text }: { text: string }) {
	const paras = String(text || '').trim().split(/\n{2,}/)
	return (
		<div className="gm-prose">
			{paras.map((p, i) => <p key={i}>{inlineMd(p)}</p>)}
		</div>
	)
}

// ── share meter ──────────────────────────────────────────────────────────────
export function ShareBar({ pct, max, accent, thin }: { pct: number, max: number, accent?: boolean, thin?: boolean }) {
	const w = max ? Math.max(1.5, (pct / max) * 100) : 0
	return (
		<div className={`gm-bar${thin ? ' gm-bar-thin' : ''}`}>
			<span className={`gm-bar-fill${accent ? ' accent' : ''}`} style={{ width: `${w}%` }} />
		</div>
	)
}

// ── width helpers (drag-resizable panels, layouts B & C) ─────────────────────
export function gmClamp(v: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, v))
}

export function useStoredWidth(key: string, initial: number): [number, (n: number) => void] {
	const [w, setW] = useState<number>(() => {
		if (typeof localStorage === 'undefined')
			return initial
		const v = Number.parseInt(localStorage.getItem(key) ?? '', 10)
		return Number.isFinite(v) ? v : initial
	})
	useEffect(() => {
		try {
			localStorage.setItem(key, String(w))
		}
		catch {}
	}, [key, w])
	return [w, setW]
}

/** A draggable vertical divider. onResize(baseWidth, deltaX); `sign` flips dx. */
export function ResizeHandle({ getBase, onResize, sign = 1, className, title = '너비 조절' }: {
	getBase: () => number
	onResize: (base: number, dx: number) => void
	sign?: number
	className?: string
	title?: string
}) {
	const base = useRef(0)
	const down = useCallback((e: React.PointerEvent) => {
		e.preventDefault()
		e.stopPropagation()
		base.current = getBase()
		const sx = e.clientX
		const move = (ev: PointerEvent) => onResize(base.current, sign * (ev.clientX - sx))
		const up = () => {
			window.removeEventListener('pointermove', move)
			window.removeEventListener('pointerup', up)
			document.body.style.cursor = ''
			document.body.style.userSelect = ''
		}
		window.addEventListener('pointermove', move)
		window.addEventListener('pointerup', up)
		document.body.style.cursor = 'col-resize'
		document.body.style.userSelect = 'none'
	}, [getBase, onResize, sign])
	return (
		<div className={`gm-resizer${className ? ` ${className}` : ''}`} onPointerDown={down} role="separator" aria-orientation="vertical" title={title}>
			<span className="gm-resizer-grip" />
		</div>
	)
}

// ── chevron ──────────────────────────────────────────────────────────────────
export function Chevron({ open, size = 11 }: { open: boolean, size?: number }) {
	return (
		<svg className={`gm-chev${open ? ' open' : ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M9 6l6 6-6 6" />
		</svg>
	)
}

// ── relationship legend ──────────────────────────────────────────────────────
function RelLegend() {
	return (
		<div className="gm-rellegend">
			<span className="gm-rellegend-item">
				<svg width="26" height="10" aria-hidden="true"><line x1="1" y1="5" x2="25" y2="5" className="gm-leg-solid" /></svg>
				상위(is-a)
			</span>
			<span className="gm-rellegend-item">
				<svg width="28" height="10" aria-hidden="true">
<line x1="1" y1="5" x2="20" y2="5" className="gm-leg-arrow" />
<path d="M19 1 L25 5 L19 9" className="gm-leg-arrowhead" />
    </svg>
				영향(influenced)
			</span>
			<span className="gm-rellegend-item">
				<svg width="26" height="10" aria-hidden="true"><line x1="1" y1="5" x2="25" y2="5" className="gm-leg-dotted" /></svg>
				관련(see-also)
			</span>
		</div>
	)
}

// ── the relationship diagram (radial when wide, list when narrow) ────────────
function gmEdgePoint(cx: number, cy: number, sx: number, sy: number, hw: number, hh: number): [number, number] {
	const ux = sx - cx
	const uy = sy - cy
	if (Math.abs(ux) < 1e-3 && Math.abs(uy) < 1e-3)
		return [cx, cy]
	const tx = Math.abs(ux) < 1e-3 ? Infinity : hw / Math.abs(ux)
	const ty = Math.abs(uy) < 1e-3 ? Infinity : hh / Math.abs(uy)
	const t = Math.min(tx, ty)
	return [cx + ux * t, cy + uy * t]
}

interface Sat { n: GmNode, x: number, y: number, rel: RelType }

function RelDiagram({ doc, nodeId, onNavigate }: { doc: GmDoc, nodeId: string, onNavigate: (id: string) => void }) {
	const node = gmNode(doc, nodeId)
	const wrapRef = useRef<HTMLDivElement | null>(null)
	const [w, setW] = useState(0)
	const uid = useId().replace(/:/g, '')

	useEffect(() => {
		const el = wrapRef.current
		if (!el)
			return
		const set = () => setW(el.clientWidth)
		set()
		if (typeof ResizeObserver !== 'undefined') {
			const ro = new ResizeObserver(set)
			ro.observe(el)
			return () => ro.disconnect()
		}
		window.addEventListener('resize', set)
		return () => window.removeEventListener('resize', set)
	}, [])

	if (!node)
		return null
	const parents = gmRelList(doc, node, 'parents')
	const influence = gmRelList(doc, node, 'influencedBy')
	const related = gmRelList(doc, node, 'related')
	const hasOut = parents.length + influence.length + related.length > 0
	const inbound = hasOut ? [] : gmInbound(doc, nodeId)

	// inbound-only (leaf node) — chips of what references this node
	if (!hasOut) {
		return (
			<div ref={wrapRef} className="gm-ego-diagram is-list">
				{inbound.length ?
					(
						<div className="gm-ego-group">
							<div className="mono gm-ego-grouplabel">참조됨 · referenced by</div>
							<div className="gm-ego-chips">
								{inbound.map(({ node: n, rel }) => (
									<button type="button" key={n.id} className="gm-ego-chip" data-rel={rel === 'child' ? 'parent' : rel} onClick={() => onNavigate(n.id)}>
										<span className="gm-ego-chipglyph">{rel === 'child' ? '▾' : rel === 'influence' ? '→' : '~'}</span>
										{n.label}
									</button>
								))}
							</div>
						</div>
					) :
					<div className="gm-ego-none mono">연결된 관계가 없습니다</div>}
			</div>
		)
	}

	const useRadial = w >= 460

	// list layout (narrow / mobile)
	if (!useRadial) {
		const groups: [RelType, string, string, GmNode[]][] = ([
			['parent', '상위 장르', 'is-a', parents],
			['influence', '영향받음', 'influenced by', influence],
			['related', '관련', 'see-also', related],
		] as [RelType, string, string, GmNode[]][]).filter(([, , , arr]) => arr.length)
		return (
			<div ref={wrapRef} className="gm-ego-diagram is-list">
				<div className="gm-ego-centerchip">
					{node.label}
					{node.tier === 1 ? <span className="mono">{`${gmCount(node.count)}장`}</span> : null}
				</div>
				{groups.map(([rel, ko, en, arr]) => (
					<div className="gm-ego-group" key={rel}>
						<div className="mono gm-ego-grouplabel" data-rel={rel}>
							{ko}
							{' '}
							<span className="gm-ego-grouplabel-en">{en}</span>
						</div>
						<div className="gm-ego-chips">
							{arr.map(n => (
								<button type="button" key={n.id} className="gm-ego-chip" data-rel={rel} onClick={() => onNavigate(n.id)}>
									<span className="gm-ego-chipglyph">{GM_RELS[rel].glyph}</span>
									{n.label}
								</button>
							))}
						</div>
					</div>
				))}
			</div>
		)
	}

	// radial diagram (wide)
	const upN = parents.length
	const leftN = influence.length
	const rightN = related.length
	const H = Math.max(244, Math.max(leftN, rightN, 1) * 60 + 132)
	const cx = w / 2
	const cy = H / 2
	const hw = 74
	const hh = 23

	const sats: Sat[] = []
	parents.forEach((n, i) => {
		const x = Math.max(100, Math.min(w - 100, cx + (i - (upN - 1) / 2) * Math.min(190, (w - 180) / Math.max(1, upN))))
		sats.push({ n, x, y: 44, rel: 'parent' })
	})
	influence.forEach((n, i) => {
		sats.push({ n, x: Math.max(82, w * 0.15), y: cy + (i - (leftN - 1) / 2) * 60, rel: 'influence' })
	})
	related.forEach((n, i) => {
		sats.push({ n, x: Math.min(w - 82, w * 0.85), y: cy + (i - (rightN - 1) / 2) * 60, rel: 'related' })
	})

	return (
		<div ref={wrapRef} className="gm-ego-diagram is-radial" style={{ height: H }}>
			<svg className="gm-ego-links" width={w} height={H}>
				<defs>
					<marker id={uid} markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto" markerUnits="userSpaceOnUse">
						<path d="M1 1 L8 4.5 L1 8 Z" className="gm-ego-arrowhead" />
					</marker>
				</defs>
				{sats.map(({ x, y, rel }, i) => {
					const [ex, ey] = gmEdgePoint(cx, cy, x, y, hw + 2, hh + 2)
					return (
						<line
							key={i}
							x1={x}
							y1={y}
							x2={ex}
							y2={ey}
							className={`gm-ego-link ${rel}`}
							markerEnd={rel === 'influence' ? `url(#${uid})` : undefined}
						/>
					)
				})}
			</svg>

			{sats.map(({ n, x, y, rel }) => (
				<button type="button" key={n.id + rel} className="gm-ego-sat" data-rel={rel} style={{ left: x, top: y }} onClick={() => onNavigate(n.id)}>
					<span className="gm-ego-sat-tag mono">{GM_RELS[rel].ko}</span>
					<span className="gm-ego-sat-label">{n.label}</span>
				</button>
			))}

			<div className="gm-ego-center" style={{ left: cx, top: cy }}>
				<span className="gm-ego-center-label">{node.label}</span>
				{node.tier === 1 ? <span className="mono gm-ego-center-meta">{`${gmCount(node.count)}장`}</span> : null}
			</div>
		</div>
	)
}

// ── the composed "opened node" body (definition + ego view) ──────────────────
export function EgoBody({ doc, node, onNavigate }: { doc: GmDoc, node: GmNode | null, onNavigate: (id: string) => void }) {
	if (!node)
		return null
	const hasDef = node.def.trim().length > 0
	const hasRelLayer = node.tier === 1
	const childCount = node.tier === 0 ? gmChildren(doc, node.id).length : 0
	return (
		<>
			{hasDef ?
				<Markdown text={node.def} /> :
				<p className="gm-a-noempty">정의 준비 중입니다.</p>}

			{node.tier === 0 && childCount > 0 ?
				<p className="gm-ego-containsnote mono">{`이 장르는 ${childCount}개의 하위 장르를 포함합니다 — 트리에서 펼쳐 보세요`}</p> :
				null}

			{hasRelLayer ?
				(
					<div className="gm-ego">
						<div className="gm-ego-head">
							<span className="mono gm-ego-title">관계 보기 · Ego view</span>
							<RelLegend />
						</div>
						<RelDiagram doc={doc} nodeId={node.id} onNavigate={onNavigate} />
					</div>
				) :
				null}
		</>
	)
}

// ── peek modal — explore a neighbour without losing your place ────────────────
export function Peek({ doc, nodeId, onNavigate, onBack, onClose, hasBack }: {
	doc: GmDoc
	nodeId: string | null
	onNavigate: (id: string) => void
	onBack: () => void
	onClose: () => void
	hasBack: boolean
}) {
	const node = gmNode(doc, nodeId)
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape')
				onClose()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [onClose])
	if (!node)
		return null
	const parent = gmPrimaryParent(doc, node)
	const tierLabel = node.tier === 0 ? '최상위 장르' : '하위 장르'
	return (
		<div className="gm-peek-scrim" onClick={onClose}>
			<div className="gm-peek" onClick={e => e.stopPropagation()} role="dialog" aria-label={`${node.label} 관계 보기`}>
				<div className="gm-peek-top">
					<div className="gm-peek-nav">
						{hasBack ? <button type="button" className="gm-peek-back" onClick={onBack}>← 이전</button> : null}
						<span className="mono gm-peek-tier">{tierLabel + (parent ? ` · ${parent.label}` : '')}</span>
					</div>
					<button type="button" className="gm-peek-x" onClick={onClose} title="닫기">✕</button>
				</div>
				<h2 className="gm-peek-name">{node.label}</h2>
				{node.tier === 1 ?
					(
						<div className="gm-peek-stats">
							<span>
								<strong>{gmCount(node.count)}</strong>
								{' '}
								<span className="mono">장</span>
							</span>
						</div>
					) :
					null}
				<div className="gm-peek-body">
					<EgoBody doc={doc} node={node} onNavigate={onNavigate} />
				</div>
			</div>
		</div>
	)
}
