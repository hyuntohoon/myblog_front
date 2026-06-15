// FEAT-genre-subgenres Step 4 — Layout A: indented expandable outliner.
// Global layer = containment only. Opening a row reveals that node's EGO VIEW
// (definition + relationship diagram for sub-genres) inline. A sub-genre with
// multiple parents appears under each branch, flagged with a "shared" badge.
import { useCallback, useEffect, useState } from 'react'
import type { GmDoc, GmNode } from './gm-model'
import { gmChildren, gmCount, gmNode, gmOtherParents, gmShare, gmShareLabel, gmTopList, gmTotal } from './gm-model'
import { Chevron, EgoBody, gmClamp, ResizeHandle, ShareBar, useStoredWidth } from './gm-shared'

interface RowCtx {
	doc: GmDoc
	total: number
	maxPct: number
	isOpen: (id: string) => boolean
	toggle: (id: string) => void
	onNavigate: (id: string) => void
}

function TreeARow({ node, idx, depth, parentId, ctx }: { node: GmNode, idx: number, depth: number, parentId: string | null, ctx: RowCtx }) {
	const open = ctx.isOpen(node.id)
	const pct = gmShare(node.count, ctx.total)
	const kids = depth === 0 ? gmChildren(ctx.doc, node.id) : []
	const hasKids = kids.length > 0
	const others = depth === 1 ? gmOtherParents(ctx.doc, node, parentId) : []
	const num = depth === 0 ? String(idx + 1).padStart(2, '0') : null

	function rowKey(e: React.KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault()
			ctx.toggle(node.id)
		}
	}

	return (
		<div className={`gm-a-item depth-${depth}${open ? ' open' : ''}`}>
			<div className="gm-a-row" role="button" tabIndex={0} aria-expanded={open} onClick={() => ctx.toggle(node.id)} onKeyDown={rowKey}>
				<span className="gm-a-chevcol"><Chevron open={open} /></span>
				{num ?
					<span className="mono gm-a-num">{num}</span> :
					<span className="gm-a-childmark" aria-hidden="true">└</span>}

				<span className="gm-a-labelwrap">
					<span className={`gm-a-label${depth ? ' child' : ''}`}>{node.label}</span>
					{hasKids ?
						(
							<span className="gm-a-kidcount mono">
								{kids.length}
								{' '}
								하위
							</span>
						) :
						null}
					{others.length ?
						(
							<span className="gm-a-shared mono" title={`또한 ${others.map(o => o.label).join(', ')} 하위`}>
								{`⇄ 또한 ${others.map(o => o.label).join(' · ')} 하위`}
							</span>
						) :
						null}
				</span>

				<span className="gm-a-meter"><ShareBar pct={pct} max={ctx.maxPct} accent={depth === 0} thin={depth > 0} /></span>
				<span className="gm-a-stats">
					<span className="mono gm-a-count">{gmCount(node.count)}</span>
					<span className="mono gm-a-share">{gmShareLabel(pct)}</span>
				</span>
			</div>

			{open ?
				(
					<div className="gm-a-expand">
						<div className="gm-a-body"><EgoBody doc={ctx.doc} node={node} onNavigate={ctx.onNavigate} /></div>
						{hasKids ?
							(
								<div className="gm-a-children">
									<div className="mono gm-a-children-head">하위 장르 · 포함(contains)</div>
									{kids.map((c, ci) => (
										<TreeARow key={c.id} node={c} idx={ci} depth={1} parentId={node.id} ctx={ctx} />
									))}
								</div>
							) :
							null}
					</div>
				) :
				null}
		</div>
	)
}

export default function TreeA({ doc, selId, onSelect, onNavigate }: { doc: GmDoc, selId: string | null, onSelect: (id: string) => void, onNavigate: (id: string) => void }) {
	const total = gmTotal(doc)
	const tops = gmTopList(doc)
	const maxPct = Math.max(...tops.map(g => gmShare(g.count, total)), 1)
	const [colW, setColW] = useStoredWidth('lfq-genremap-aw', 760)

	const [openIds, setOpenIds] = useState<Set<string>>(() => {
		const s = new Set<string>()
		if (selId) {
			s.add(selId)
			const n = gmNode(doc, selId)
			if (n && n.tier === 1)
				n.parents.forEach(p => s.add(p))
		}
		return s
	})
	useEffect(() => {
		if (!selId)
			return
		setOpenIds((s) => {
			const n = new Set(s)
			n.add(selId)
			const node = gmNode(doc, selId)
			if (node && node.tier === 1)
				node.parents.forEach(p => n.add(p))
			return n
		})
	}, [selId, doc])

	const isOpen = useCallback((id: string) => openIds.has(id), [openIds])
	const toggle = useCallback((id: string) => {
		setOpenIds((s) => {
			const n = new Set(s)
			if (n.has(id))
				n.delete(id)
			else
				n.add(id)
			return n
		})
		onSelect(id)
	}, [onSelect])

	const allOpen = tops.length > 0 && tops.every(g => openIds.has(g.id))
	const toggleAll = useCallback(() => {
		setOpenIds(allOpen ? new Set() : new Set(tops.map(g => g.id)))
	}, [allOpen, tops])

	const ctx: RowCtx = { doc, total, maxPct, isOpen, toggle, onNavigate }

	return (
		<div className="gm-a-wrap">
			<div className="gm-a-col" style={{ maxWidth: colW }}>
				<div className="gm-a-toolrow">
					<span className="mono gm-a-toolhint">
						{`${tops.length}개 최상위 장르 · ${gmCount(total)}장 수록 · 부모→자식 containment`}
					</span>
					<button type="button" className="gm-a-expandall" onClick={toggleAll}>
						{allOpen ? '모두 접기' : '모두 펼치기'}
					</button>
				</div>
				<div className="gm-a-list">
					{tops.map((g, i) => (
						<TreeARow key={g.id} node={g} idx={i} depth={0} parentId={null} ctx={ctx} />
					))}
				</div>
				<ResizeHandle className="gm-a-resizer" getBase={() => colW} onResize={(b, dx) => setColW(gmClamp(b + 2 * dx, 560, 1180))} />
			</div>
		</div>
	)
}
