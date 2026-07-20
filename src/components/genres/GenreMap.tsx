import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchGenreMap } from '@lib/genres'
import type { GmDoc } from './gm-model'
import { buildDoc } from './gm-model'
import { Peek } from './gm-shared'
import TreeA from './TreeA'
import TreeB from './TreeB'
import TreeC from './TreeC'

/**
 * /genres — the public Genre Map (FEAT-genre-subgenres Step 4).
 *
 * A layout switcher over the REAL taxonomy from GET /api/genres/tree (12 fixed
 * top-level genres + their tier-1 sub-genres + the relationship edges):
 *   A · Outliner  — indented containment tree; opening a row reveals its ego view.
 *   B · Columns   — Miller columns (parent → children → detail/ego).
 *   C · Diagram   — horizontal containment dendrogram; selecting a node docks its
 *                   ego view on the right.
 *
 * The "global layer" is pure parent→child containment. Each node's relationships
 * (parent · influenced-by · related) live in a per-node EGO VIEW, shown only when a
 * single node is opened. Clicking a related neighbour opens a peek modal so you can
 * explore without losing your place. Read-only — the taxonomy is curated elsewhere.
 *
 * Adapted from the Claude Design "장르 맵" handoff (tree-based ego layouts).
 */

type LayoutId = 'A' | 'B' | 'C'
const LAYOUTS: { id: LayoutId, label: string }[] = [
	{ id: 'A', label: '아웃라인' },
	{ id: 'B', label: '칼럼' },
	{ id: 'C', label: '다이어그램' },
]
const HINTS: Record<LayoutId, string> = {
	A: '행을 열면 정의와 관계 보기가 펼쳐집니다.',
	B: '장르 → 하위 → 상세 순으로 좁혀 보세요.',
	C: '드래그로 이동, 노드를 누르면 관계 보기가 옆에 열립니다.',
}

function readStored(key: string, fallback: string): string {
	if (typeof localStorage === 'undefined')
		return fallback
	return localStorage.getItem(key) ?? fallback
}

/* Below --bp-md the map always renders layout A (FEAT-mobile-web-app Step 2,
   OQ2): B/C are desktop-only exploratory views, and a stored B/C preference
   must not leak onto a phone. Keep in sync with the genres.css 767px block
   that hides .gm-controlbar. */
const MOBILE_MQ = '(max-width: 767px)'

function useIsMobile(): boolean {
	const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia(MOBILE_MQ).matches)
	useEffect(() => {
		const mq = window.matchMedia(MOBILE_MQ)
		const onChange = () => setIsMobile(mq.matches)
		mq.addEventListener('change', onChange)
		return () => mq.removeEventListener('change', onChange)
	}, [])
	return isMobile
}

export default function GenreMap() {
	const [doc, setDoc] = useState<GmDoc | null>(null)
	const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
	const [layout, setLayoutRaw] = useState<LayoutId>(() => (readStored('lfq-genremap-layout', 'A') as LayoutId))
	const isMobile = useIsMobile()
	const effLayout: LayoutId = isMobile ? 'A' : layout
	const [selId, setSelId] = useState<string | null>(() => readStored('lfq-genremap-sel', '') || null)

	// peek modal — explore a relationship neighbour without losing your place
	const [peekId, setPeekId] = useState<string | null>(null)
	const [peekStack, setPeekStack] = useState<string[]>([])

	useEffect(() => {
		let alive = true
		fetchGenreMap()
			.then(({ genres, edges }) => {
				if (!alive)
					return
				setDoc(buildDoc(genres, edges))
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

	const setLayout = useCallback((l: LayoutId) => {
		setLayoutRaw(l)
		try {
			localStorage.setItem('lfq-genremap-layout', l)
		}
		catch {}
	}, [])
	const onSelect = useCallback((id: string | null) => {
		setSelId(id)
		if (id) {
			try {
				localStorage.setItem('lfq-genremap-sel', id)
			}
			catch {}
		}
	}, [])

	useEffect(() => {
		if (!doc)
			return
		const slug = new URLSearchParams(location.search).get('g')
		if (!slug)
			return
		const match = Object.values(doc.nodes).find(node => node.slug === slug)
		if (match)
			onSelect(match.id)
	}, [doc, onSelect])

	const openPeek = useCallback((id: string) => {
		setPeekId((cur) => {
			if (cur)
				setPeekStack(s => [...s, cur])
			return id
		})
	}, [])
	const peekBack = useCallback(() => {
		setPeekStack((s) => {
			if (!s.length) {
				setPeekId(null)
				return s
			}
			const p = s.slice()
			const last = p.pop()!
			setPeekId(last)
			return p
		})
	}, [])
	const closePeek = useCallback(() => {
		setPeekId(null)
		setPeekStack([])
	}, [])

	const view = useMemo(() => {
		if (!doc)
			return null
		const common = { doc, selId, onSelect, onNavigate: openPeek }
		if (effLayout === 'B')
			return <TreeB {...common} />
		if (effLayout === 'C')
			return <TreeC {...common} />
		return <TreeA {...common} />
	}, [doc, effLayout, selId, onSelect, openPeek])

	if (status === 'loading')
		return <div className="gm-a-state">장르 맵을 불러오는 중…</div>
	if (status === 'error')
		return <div className="gm-a-state gm-a-state-err">장르 맵을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>
	if (!doc || doc.order.length === 0)
		return <div className="gm-a-state">아직 장르가 없습니다.</div>

	return (
		<div className="gm-app-embed" data-layout={effLayout}>
			<div className="gm-controlbar">
				<div className="gm-switch" role="tablist" aria-label="레이아웃">
					<span className="mono gm-switch-label">보기</span>
					{LAYOUTS.map(l => (
						<button
							type="button"
							key={l.id}
							role="tab"
							aria-selected={effLayout === l.id}
							className={effLayout === l.id ? 'on' : ''}
							onClick={() => setLayout(l.id)}
						>
							{l.label}
						</button>
					))}
				</div>
				<span className="gm-controlbar-hint">{HINTS[effLayout]}</span>
			</div>

			<div className="gm-stage-host" key={effLayout}>
				{view}
			</div>

			<Peek
				doc={doc}
				nodeId={peekId}
				onNavigate={openPeek}
				onBack={peekBack}
				onClose={closePeek}
				hasBack={peekStack.length > 0}
			/>
		</div>
	)
}
