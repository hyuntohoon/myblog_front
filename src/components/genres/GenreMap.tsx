import { useCallback, useEffect, useMemo, useState } from 'react'
import { isLoggedIn } from '@lib/auth'
import { fetchGenreTree, updateGenre } from '@lib/genres'
import type { GenreNode } from '@lib/genres'

/**
 * /genres — the public Genre Map (FEAT-genre-system Step 7).
 *
 * Tier-0 containment Outliner: the 12 fixed top-level genres as a numbered canon
 * (01–12) with an album-share meter (album_count / total) and click-to-expand
 * editorial definitions. Renders the REAL tree from GET /api/genres/tree; children
 * render the same way (empty at launch — sub-genres are the separate
 * FEAT-genre-subgenres RFC, which slots in here with no change).
 *
 * Public is read-only and calm. When logged in (single-user owner) the rows gain
 * inline editing — rename the label, edit the markdown definition, reorder — each
 * persisted via PUT /api/genres/{id} (optimistic; reverts on failure). No
 * create/delete, no relationship/ego view at this tier.
 *
 * Adapted from the Claude Design "장르 맵" Outliner (Layout A); the ego-view /
 * Miller-columns / diagram layouts there are tier-1 and deferred with the rest of
 * FEAT-genre-subgenres.
 */

// ── tiny markdown: paragraphs · **bold** · *italic* (mirrors the design) ──────
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

function Markdown({ text }: { text: string }) {
	const paras = String(text || '').trim().split(/\n{2,}/)
	return (
		<div className="gm-prose">
			{paras.map((p, i) => <p key={i}>{inlineMd(p)}</p>)}
		</div>
	)
}

// ── icons ─────────────────────────────────────────────────────────────────────
function Chevron({ open }: { open: boolean }) {
	return (
		<svg className={`gm-chev${open ? ' open' : ''}`} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M9 6l6 6-6 6" />
		</svg>
	)
}

function Pencil() {
	return (
		<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M12 20h9" />
			<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
		</svg>
	)
}

// ── share meter ─────────────────────────────────────────────────────────────
function ShareBar({ pct, max, accent, thin }: { pct: number, max: number, accent?: boolean, thin?: boolean }) {
	const w = max ? Math.max(1.5, (pct / max) * 100) : 0
	return (
		<div className={`gm-bar${thin ? ' gm-bar-thin' : ''}`}>
			<span className={`gm-bar-fill${accent ? ' accent' : ''}`} style={{ width: `${w}%` }} />
		</div>
	)
}

function shareLabel(pct: number): string {
	if (pct >= 9.95)
		return `${Math.round(pct)}%`
	if (pct >= 0.95)
		return `${pct.toFixed(1)}%`
	if (pct > 0)
		return '<1%'
	return '0%'
}

// ── inline editors (owner) ────────────────────────────────────────────────────
function LabelEdit({ value, size, onSave, onCancel }: { value: string, size: 1 | 2, onSave: (v: string) => void, onCancel: () => void }) {
	const [v, setV] = useState(value)
	function handleKey(e: React.KeyboardEvent) {
		if (e.key === 'Enter')
			onSave(v.trim() || value)
		if (e.key === 'Escape')
			onCancel()
	}
	return (
		<input
			className={`gm-label-input gm-label-input-${size}`}
			autoFocus
			value={v}
			onChange={e => setV(e.target.value)}
			onClick={e => e.stopPropagation()}
			onKeyDown={handleKey}
			onBlur={() => onSave(v.trim() || value)}
		/>
	)
}

function DefEdit({ value, onSave, onCancel }: { value: string, onSave: (v: string) => void, onCancel: () => void }) {
	const [v, setV] = useState(value || '')
	function autoGrow(el: HTMLTextAreaElement) {
		el.style.height = 'auto'
		el.style.height = `${el.scrollHeight}px`
	}
	function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
		setV(e.target.value)
		autoGrow(e.target)
	}
	function handleKey(e: React.KeyboardEvent) {
		if (e.key === 'Escape')
			onCancel()
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey))
			onSave(v)
	}
	return (
		<div className="gm-defedit" onClick={e => e.stopPropagation()}>
			<div className="gm-defedit-bar">
				<span className="mono gm-defedit-hint">Markdown — **굵게** · *기울임* · 빈 줄로 문단 구분</span>
			</div>
			<textarea
				className="gm-defedit-area"
				autoFocus
				value={v}
				ref={(el) => {
 if (el)
autoGrow(el)
}}
				onChange={handleChange}
				onKeyDown={handleKey}
			/>
			<div className="gm-defedit-actions">
				<button type="button" className="gm-btn-ghost" onMouseDown={e => e.preventDefault()} onClick={onCancel}>취소</button>
				<button type="button" className="gm-btn-solid" onMouseDown={e => e.preventDefault()} onClick={() => onSave(v)}>
저장
<span className="gm-kbd">⌘↵</span>
    </button>
			</div>
		</div>
	)
}

function ReorderButtons({ canUp, canDown, onUp, onDown }: { canUp: boolean, canDown: boolean, onUp: () => void, onDown: () => void }) {
	return (
		<div className="gm-reorder" onClick={e => e.stopPropagation()}>
			<button type="button" className="gm-reorder-btn" disabled={!canUp} title="위로" onClick={onUp}>
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M18 15l-6-6-6 6" /></svg>
			</button>
			<button type="button" className="gm-reorder-btn" disabled={!canDown} title="아래로" onClick={onDown}>
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
			</button>
		</div>
	)
}

// ── row actions, threaded down the tree ───────────────────────────────────────
interface RowApi {
	owner: boolean
	total: number
	maxPct: number
	isOpen: (id: string) => boolean
	toggle: (id: string) => void
	rename: (id: string, label: string) => void
	saveDef: (id: string, def: string) => void
	move: (parentId: string | null, id: string, delta: number) => void
}

function GenreBody({ node, api }: { node: GenreNode, api: RowApi }) {
	const [editingDef, setEditingDef] = useState(false)
	function saveDef(v: string) {
		api.saveDef(node.id, v)
		setEditingDef(false)
	}
	function openEdit(e: React.MouseEvent) {
		e.stopPropagation()
		setEditingDef(true)
	}
	if (api.owner && editingDef)
		return <DefEdit value={node.definitionMd} onSave={saveDef} onCancel={() => setEditingDef(false)} />

	const hasDef = node.definitionMd.trim().length > 0
	return (
		<>
			{hasDef ?
				<Markdown text={node.definitionMd} /> :
				<p className="gm-a-noempty">{api.owner ? '정의가 아직 없습니다.' : '정의 준비 중입니다.'}</p>}
			{api.owner ?
				(
						<button type="button" className="gm-edit-link" onClick={openEdit}>
							<Pencil />
							{hasDef ? '정의 편집' : '정의 추가'}
						</button>
					) :
				null}
		</>
	)
}

function GenreRow({ node, idx, depth, parentId, listLen, api }: { node: GenreNode, idx: number, depth: number, parentId: string | null, listLen: number, api: RowApi }) {
	const [editingLabel, setEditingLabel] = useState(false)
	const open = api.isOpen(node.id)
	const pct = api.total ? (node.albumCount / api.total) * 100 : 0
	const kids = node.children
	const num = depth === 0 ? String(idx + 1).padStart(2, '0') : null

	function rowKey(e: React.KeyboardEvent) {
		if ((e.key === 'Enter' || e.key === ' ') && !editingLabel) {
			e.preventDefault()
			api.toggle(node.id)
		}
	}
	function saveLabel(v: string) {
		api.rename(node.id, v)
		setEditingLabel(false)
	}
	function openRename(e: React.MouseEvent) {
		e.stopPropagation()
		setEditingLabel(true)
	}

	return (
		<div className={`gm-a-item depth-${depth}${open ? ' open' : ''}`}>
			<div
				className={`gm-a-row${api.owner ? ' owner' : ''}`}
				role="button"
				tabIndex={0}
				onClick={() => {
 if (!editingLabel)
api.toggle(node.id)
}}
				onKeyDown={rowKey}
			>
				<span className="gm-a-chevcol"><Chevron open={open} /></span>
				{num ?
					<span className="mono gm-a-num">{num}</span> :
					<span className="gm-a-childmark" aria-hidden="true">└</span>}

				<span className="gm-a-labelwrap">
					{api.owner && editingLabel ?
						<LabelEdit value={node.label} size={depth === 0 ? 1 : 2} onSave={saveLabel} onCancel={() => setEditingLabel(false)} /> :
						<span className={`gm-a-label${depth ? ' child' : ''}`}>{node.label}</span>}
					{kids.length ?
(
<span className="gm-a-kidcount mono">
{kids.length}
{' '}
하위
</span>
) :
null}
					{api.owner && !editingLabel ?
						(
								<button type="button" className="gm-a-renamebtn" title="이름 변경" onClick={openRename}>
									<Pencil />
								</button>
							) :
						null}
				</span>

				<span className="gm-a-meter"><ShareBar pct={pct} max={api.maxPct} accent={depth === 0} thin={depth > 0} /></span>
				<span className="gm-a-stats">
					<span className="mono gm-a-count">{node.albumCount.toLocaleString('en-US')}</span>
					<span className="mono gm-a-share">{shareLabel(pct)}</span>
				</span>

				{api.owner ?
					(
							<ReorderButtons
								canUp={idx > 0}
								canDown={idx < listLen - 1}
								onUp={() => api.move(parentId, node.id, -1)}
								onDown={() => api.move(parentId, node.id, 1)}
							/>
						) :
					null}
			</div>

			{open ?
				(
						<div className="gm-a-expand">
							<div className="gm-a-body"><GenreBody node={node} api={api} /></div>
							{kids.length ?
								(
										<div className="gm-a-children">
											<div className="mono gm-a-children-head">하위 장르 · 포함(contains)</div>
											{kids.map((c, ci) => (
												<GenreRow key={c.id} node={c} idx={ci} depth={1} parentId={node.id} listLen={kids.length} api={api} />
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

// ── tree helpers ──────────────────────────────────────────────────────────────
function patchTree(nodes: GenreNode[], id: string, fn: (n: GenreNode) => GenreNode): GenreNode[] {
	return nodes.map(n => n.id === id ? fn(n) : { ...n, children: patchTree(n.children, id, fn) })
}

/** Replace the sibling list under `parentId` (null = roots) with `next`. */
function setSiblings(nodes: GenreNode[], parentId: string | null, next: GenreNode[]): GenreNode[] {
	if (parentId === null)
		return next
	return nodes.map(n => n.id === parentId ? { ...n, children: next } : { ...n, children: setSiblings(n.children, parentId, next) })
}

function findSiblings(nodes: GenreNode[], parentId: string | null): GenreNode[] {
	if (parentId === null)
		return nodes
	for (const n of nodes) {
		if (n.id === parentId)
			return n.children
		const deep = findSiblings(n.children, parentId)
		if (deep.length)
			return deep
	}
	return []
}

// ── root component ────────────────────────────────────────────────────────────
export default function GenreMap() {
	const [nodes, setNodes] = useState<GenreNode[]>([])
	const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
	const [owner, setOwner] = useState(false)
	const [openIds, setOpenIds] = useState<Set<string>>(() => new Set())

	useEffect(() => {
		let alive = true
		setOwner(isLoggedIn())
		fetchGenreTree()
			.then((tree) => {
				if (!alive)
					return
				setNodes(tree)
				setStatus('ready')
			})
			.catch(() => {
				if (alive)
					setStatus('error')
			})
		return () => {
			alive = false
		}
	}, [])

	const total = useMemo(() => nodes.reduce((s, n) => s + n.albumCount, 0), [nodes])
	const maxPct = useMemo(() => {
		if (!total)
			return 100
		return Math.max(...nodes.map(n => (n.albumCount / total) * 100), 1)
	}, [nodes, total])

	const isOpen = useCallback((id: string) => openIds.has(id), [openIds])
	const toggle = useCallback((id: string) => {
		setOpenIds((s) => {
			const next = new Set(s)
			if (next.has(id))
				next.delete(id)
			else
				next.add(id)
			return next
		})
	}, [])

	const allOpen = nodes.length > 0 && nodes.every(n => openIds.has(n.id))
	const toggleAll = useCallback(() => {
		setOpenIds(allOpen ? new Set() : new Set(nodes.map(n => n.id)))
	}, [allOpen, nodes])

	// Optimistic edit: apply locally, persist, restore the snapshot on failure.
	const rename = useCallback((id: string, label: string) => {
		setNodes((prev) => {
			const snapshot = prev
			updateGenre(id, { label }).catch(() => setNodes(snapshot))
			return patchTree(prev, id, n => ({ ...n, label }))
		})
	}, [])

	const saveDef = useCallback((id: string, def: string) => {
		setNodes((prev) => {
			const snapshot = prev
			updateGenre(id, { definition_md: def }).catch(() => setNodes(snapshot))
			return patchTree(prev, id, n => ({ ...n, definitionMd: def }))
		})
	}, [])

	const move = useCallback((parentId: string | null, id: string, delta: number) => {
		setNodes((prev) => {
			const snapshot = prev
			const sibs = findSiblings(prev, parentId)
			const i = sibs.findIndex(s => s.id === id)
			const j = i + delta
			if (i < 0 || j < 0 || j >= sibs.length)
				return prev
			const reordered = sibs.slice()
			const tmp = reordered[i]
			reordered[i] = reordered[j]
			reordered[j] = tmp
			// Renumber positions contiguously; PUT only the rows whose position changed.
			const renumbered = reordered.map((s, idx) => ({ ...s, position: idx }))
			const changed = renumbered.filter(s => sibs.find(o => o.id === s.id)?.position !== s.position)
			Promise.all(changed.map(s => updateGenre(s.id, { position: s.position })))
				.catch(() => setNodes(snapshot))
			return setSiblings(prev, parentId, renumbered)
		})
	}, [])

	const api: RowApi = { owner, total, maxPct, isOpen, toggle, rename, saveDef, move }

	if (status === 'loading')
		return <div className="gm-a-state">장르 맵을 불러오는 중…</div>
	if (status === 'error')
		return <div className="gm-a-state gm-a-state-err">장르 맵을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>
	if (nodes.length === 0)
		return <div className="gm-a-state">아직 장르가 없습니다.</div>

	return (
		<div className="gm-a-wrap">
			<div className="gm-a-col">
				<div className="gm-a-toolrow">
					<span className="mono gm-a-toolhint">
						{`${nodes.length}개 최상위 장르 · ${total.toLocaleString('en-US')}장 수록 · 부모→자식 containment`}
					</span>
					<button type="button" className="gm-a-expandall" onClick={toggleAll}>
						{allOpen ? '모두 접기' : '모두 펼치기'}
					</button>
				</div>
				<div className="gm-a-list">
					{nodes.map((g, i) => (
						<GenreRow key={g.id} node={g} idx={i} depth={0} parentId={null} listLen={nodes.length} api={api} />
					))}
				</div>
			</div>
		</div>
	)
}
