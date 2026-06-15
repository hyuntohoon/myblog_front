import { useEffect, useMemo, useState } from 'react'
import { fetchGenreTree } from '../../lib/genres'
import type { GenreNode } from '../../lib/genres'

// FEAT-genre-subgenres Step 2 (+ FEAT-genre-deepen): the /write sub-genre picker.
// Tags a review with any of the ~1.2k N-tier sub-genres (+ the 13 top-level
// roots), persisted as the post create/update payload `genre_ids` → `post_genres`.
// The vocabulary is far too large for flat chips, so this is a searchable picker:
// type-to-filter (flat results with a parent breadcrumb), or browse a COLLAPSIBLE
// tree (roots collapsed by default — the deep tree only renders the branch you
// open). Removable selected pills sit on top.

interface FlatGenre {
  id: string
  label: string
  /** Immediate parent's label for breadcrumb disambiguation; '' for tier-0 roots. */
  parentLabel: string
}

interface Props {
  /** Selected genre ids (the WriterApp `genreIds` state). */
  value: string[]
  /** Toggle one genre id. WriterApp owns the functional updater (no clobber). */
  onToggle: (id: string) => void
}

// Flatten the forest into an id→genre lookup (for the pills) + a flat list (for
// search). The raw nested tree is kept separately for the collapsible browse.
function flatten(roots: GenreNode[]): { flat: FlatGenre[], byId: Map<string, FlatGenre> } {
  const byId = new Map<string, FlatGenre>()
  const flat: FlatGenre[] = []
  const walk = (nodes: GenreNode[], parentLabel: string) => {
    for (const n of nodes) {
      const fg: FlatGenre = { id: n.id, label: n.label, parentLabel }
      byId.set(n.id, fg)
      flat.push(fg)
      if (n.children.length > 0)
        walk(n.children, n.label)
    }
  }
  walk(roots, '')
  return { flat, byId }
}

// One row of the collapsible browse tree. A twisty toggles its subtree; the label
// toggles selection. Two sibling buttons (never nested — invalid HTML).
function PickRow({ node, depth, selected, onToggle, openSet, toggleOpen }: {
  node: GenreNode
  depth: number
  selected: Set<string>
  onToggle: (id: string) => void
  openSet: Set<string>
  toggleOpen: (id: string) => void
}) {
  const hasKids = node.children.length > 0
  const on = selected.has(node.id)
  const open = openSet.has(node.id)
  return (
    <div className="gp-treenode">
      <div className={`gp-treerow${on ? ' on' : ''}${depth === 0 ? ' gp-root' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}>
        {hasKids ?
          (
            <button type="button" className="gp-twisty" aria-label={open ? '접기' : '펼치기'} aria-expanded={open} onClick={() => toggleOpen(node.id)}>
              {open ? '▾' : '▸'}
            </button>
          ) :
          <span className="gp-twisty-sp" aria-hidden="true" />}
        <button
	type="button"
	role="option"
	aria-selected={on}
	className="gp-row-pick"
	onClick={() => onToggle(node.id)}
        >
          <span className="gp-row-label">{node.label}</span>
          {hasKids && <span className="gp-row-kids mono">{node.children.length}</span>}
        </button>
      </div>
      {open && hasKids ?
        node.children.map(c => (
          <PickRow key={c.id} node={c} depth={depth + 1} selected={selected} onToggle={onToggle} openSet={openSet} toggleOpen={toggleOpen} />
        )) :
        null}
    </div>
  )
}

export default function GenrePicker({ value, onToggle }: Props) {
  const [roots, setRoots] = useState<GenreNode[]>([])
  const [byId, setById] = useState<Map<string, FlatGenre>>(() => new Map())
  const [flat, setFlat] = useState<FlatGenre[]>([])
  const [openSet, setOpenSet] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let alive = true
    fetchGenreTree()
      .then((tree) => {
        if (!alive)
          return
        const built = flatten(tree)
        setRoots(tree)
        setFlat(built.flat)
        setById(built.byId)
        setState('ready')
      })
      .catch(() => {
        if (alive)
          setState('error')
      })
    return () => {
      alive = false
    }
  }, [])

  const selected = new Set(value)
  const q = query.trim().toLowerCase()

  const toggleOpen = (id: string) =>
    setOpenSet(prev => prev.has(id) ? new Set([...prev].filter(x => x !== id)) : new Set([...prev, id]))

  // Search mode: flat label match across the whole tree (capped — 1.2k genres,
  // so a stray short query won't render thousands of rows).
  const matches = useMemo(() => {
    if (!q)
      return []
    return flat.filter(g => g.label.toLowerCase().includes(q)).slice(0, 80)
  }, [flat, q])

  const pills = value.map(id => byId.get(id) ?? { id, label: '…', parentLabel: '' })

  return (
    <div className="set-block">
      <label className="set-l">서브장르</label>

      {pills.length > 0 && (
        <div className="gp-pills" role="group" aria-label="선택한 서브장르">
          {pills.map(p => (
            <span key={p.id} className="gp-pill">
              {p.label}
              <button type="button" aria-label={`${p.label} 제거`} onClick={() => onToggle(p.id)}>✕</button>
            </span>
          ))}
        </div>
      )}

      <input
	type="text"
	className="set-input gp-search"
	placeholder={state === 'ready' ? '서브장르 검색…' : '불러오는 중…'}
	aria-label="서브장르 검색"
	value={query}
	onChange={e => setQuery(e.target.value)}
	disabled={state !== 'ready'}
      />

      {state === 'error' && (
        <div className="set-hint">장르 목록을 불러오지 못했습니다.</div>
      )}

      {state === 'ready' && (
        <div className="gp-list" role="listbox" aria-label="서브장르 목록" aria-multiselectable="true">
          {q ?
            (matches.length === 0 ?
              <div className="gp-empty">검색 결과 없음</div> :
              matches.map(g => (
                <button
	key={g.id}
	type="button"
	role="option"
	aria-selected={selected.has(g.id)}
	className={`gp-row${selected.has(g.id) ? ' on' : ''}`}
	onClick={() => onToggle(g.id)}
                >
                  <span className="gp-row-label">{g.label}</span>
                  {g.parentLabel && <span className="gp-row-crumb">{g.parentLabel}</span>}
                </button>
              ))) :
            roots.map(r => (
              <PickRow key={r.id} node={r} depth={0} selected={selected} onToggle={onToggle} openSet={openSet} toggleOpen={toggleOpen} />
            ))}
        </div>
      )}
    </div>
  )
}
