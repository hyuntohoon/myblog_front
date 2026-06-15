// FEAT-genre-subgenres Step 4 — Layout B: Miller columns.
// Parent list → children → detail. Containment is made explicit by navigation;
// the detail column opens the node's EGO VIEW. Multi-parent sub-genres are
// flagged where they appear.
import { useState } from 'react'
import type { GmDoc, GmNode } from './gm-model'
import { gmChildren, gmCount, gmNode, gmOtherParents, gmShare, gmShareLabel, gmTopList, gmTotal } from './gm-model'
import { Chevron, EgoBody, gmClamp, ResizeHandle, ShareBar, useStoredWidth } from './gm-shared'

function Col1Row({ doc, node, idx, total, maxPct, active, onPick }: { doc: GmDoc, node: GmNode, idx: number, total: number, maxPct: number, active: boolean, onPick: (id: string) => void }) {
	const pct = gmShare(node.count, total)
	const kids = gmChildren(doc, node.id).length
	return (
		<div
			className={`gm-b-row col1${active ? ' active' : ''}`}
			role="button"
			tabIndex={0}
			onClick={() => onPick(node.id)}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault()
					onPick(node.id)
				}
			}}
		>
			<span className="mono gm-b-num">{String(idx + 1).padStart(2, '0')}</span>
			<span className="gm-b-rowmain">
				<span className="gm-b-label">{node.label}</span>
				<span className="gm-b-meter"><ShareBar pct={pct} max={maxPct} accent /></span>
			</span>
			<span className="gm-b-rowend">
				<span className="mono gm-b-share">{gmShareLabel(pct)}</span>
				{kids ? <span className="mono gm-b-kids">{kids}</span> : <span className="gm-b-kids empty">·</span>}
				<Chevron open={false} size={13} />
			</span>
		</div>
	)
}

function Col2Row({ doc, node, parentId, active, onPick }: { doc: GmDoc, node: GmNode, parentId: string | null, active: boolean, onPick: (id: string) => void }) {
	const others = gmOtherParents(doc, node, parentId)
	return (
		<div
			className={`gm-b-row col2${active ? ' active' : ''}`}
			role="button"
			tabIndex={0}
			onClick={() => onPick(node.id)}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault()
					onPick(node.id)
				}
			}}
		>
			<span className="gm-b-childmark" aria-hidden="true">└</span>
			<span className="gm-b-rowmain">
				<span className="gm-b-label child">{node.label}</span>
				{others.length ? <span className="gm-b-shared mono" title={`또한 ${others.map(o => o.label).join(', ')} 하위`}>{`⇄ ${others.map(o => o.label).join('·')}`}</span> : null}
			</span>
			<span className="gm-b-rowend">
				<span className="mono gm-b-count">{gmCount(node.count)}</span>
				<Chevron open={false} size={13} />
			</span>
		</div>
	)
}

function Detail({ doc, node, parent, total, onNavigate }: { doc: GmDoc, node: GmNode | null, parent: GmNode | null, total: number, onNavigate: (id: string) => void }) {
	if (!node)
		return null
	const pct = gmShare(node.count, total)
	return (
		<div className="gm-b-detail">
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
				<span className="gm-b-crumb-tier">{node.tier === 0 ? '최상위' : '하위'}</span>
			</div>

			<div className="gm-b-detailhead">
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
			</div>

			<EgoBody doc={doc} node={node} onNavigate={onNavigate} />
		</div>
	)
}

export default function TreeB({ doc, selId, onSelect, onNavigate }: { doc: GmDoc, selId: string | null, onSelect: (id: string) => void, onNavigate: (id: string) => void }) {
	const total = gmTotal(doc)
	const tops = gmTopList(doc)
	const maxPct = Math.max(...tops.map(g => gmShare(g.count, total)), 1)
	const [col1W, setCol1W] = useStoredWidth('lfq-genremap-bw1', 360)
	const [col2W, setCol2W] = useStoredWidth('lfq-genremap-bw2', 250)

	const init = (() => {
		const n = gmNode(doc, selId)
		if (n && n.tier === 1 && n.parents.length)
			return { p: n.parents[0], c: n.id }
		if (n && n.tier === 0)
			return { p: n.id, c: null as string | null }
		return { p: tops[0]?.id ?? null, c: null as string | null }
	})()
	const [parentId, setParentId] = useState<string | null>(init.p)
	const [childId, setChildId] = useState<string | null>(init.c)

	const parent = gmNode(doc, parentId) ?? tops[0] ?? null
	const kids = parent ? gmChildren(doc, parent.id) : []
	const child = childId ? gmNode(doc, childId) : null
	const childStillHere = !!child && kids.some(k => k.id === child.id)
	const detailNode = childStillHere ? child : parent
	const detailParent = childStillHere ? parent : null

	const pickParent = (id: string) => {
		setParentId(id)
		setChildId(null)
		onSelect(id)
	}
	const pickChild = (id: string) => {
		setChildId(id)
		onSelect(id)
	}

	return (
		<div className="gm-b-wrap">
			<div className="gm-b-cols">
				<div className="gm-b-col gm-b-col1" style={{ flex: `0 0 ${col1W}px` }}>
					<div className="gm-b-colhead mono">
						장르 · Genre
						{' '}
						<span className="gm-b-colhead-sub">containment</span>
					</div>
					<div className="gm-b-collist">
						{tops.map((g, i) => (
							<Col1Row key={g.id} doc={doc} node={g} idx={i} total={total} maxPct={maxPct} active={g.id === parentId} onPick={pickParent} />
						))}
					</div>
				</div>

				<ResizeHandle getBase={() => col1W} onResize={(b, dx) => setCol1W(gmClamp(b + dx, 230, 620))} />

				<div className="gm-b-col gm-b-col2" style={{ flex: `0 0 ${col2W}px` }}>
					<div className="gm-b-colhead mono">
						{parent?.label}
						{' '}
						<span className="gm-b-colhead-sub">하위 장르</span>
					</div>
					<div className="gm-b-collist">
						{kids.length ?
							kids.map(c => (
								<Col2Row key={c.id} doc={doc} node={c} parentId={parentId} active={c.id === childId} onPick={pickChild} />
							)) :
							(
								<div className="gm-b-empty">
									<div className="gm-b-empty-mark">┐</div>
									<p>
										아직
										{' '}
										<strong>{parent?.label}</strong>
										{' '}
										아래에 하위 장르가 없습니다.
									</p>
									<span className="mono">출시 시 큐레이션 예정</span>
								</div>
							)}
					</div>
				</div>

				<ResizeHandle getBase={() => col2W} onResize={(b, dx) => setCol2W(gmClamp(b + dx, 190, 560))} />

				<div className="gm-b-col gm-b-col3" style={{ flex: '1 1 0' }}>
					<Detail doc={doc} node={detailNode} parent={detailParent} total={total} onNavigate={onNavigate} />
				</div>
			</div>
		</div>
	)
}
