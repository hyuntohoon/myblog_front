import { useEffect, useMemo, useState } from 'react'
import { fetchGenreTree  } from '../../lib/genres'
import type { GenreNode } from '../../lib/genres'

// FEAT-genre-subgenres Step 2: the /write sub-genre picker. Tags a review with
// any of the ~211 tier-1 sub-genres (+ the 12 tier-0 roots), persisted as the
// post create/update payload `genre_ids` → `post_genres` (mirrors the review-tag
// chips, but the vocabulary is far too large for flat chips, so this is a
// searchable, parent-grouped list with removable selected pills).

interface FlatGenre {
  id: string
  label: string
  /** Immediate parent's label for breadcrumb disambiguation; '' for tier-0 roots. */
  parentLabel: string
}

interface Group {
  root: FlatGenre
  children: FlatGenre[]
}

interface Props {
  /** Selected genre ids (the WriterApp `genreIds` state). */
  value: string[]
  /** Toggle one genre id. WriterApp owns the functional updater (no clobber). */
  onToggle: (id: string) => void
}

// Flatten the containment forest into selectable rows grouped under their tier-0
// root, plus an id→genre lookup for resolving the selected pills' labels. The
// seed is 2-tier today, but walk recursively so a future tier-2 still appears.
function build(roots: GenreNode[]): { groups: Group[], byId: Map<string, FlatGenre> } {
  const byId = new Map<string, FlatGenre>()
  const groups: Group[] = []
  for (const root of roots) {
    const rootFg: FlatGenre = { id: root.id, label: root.label, parentLabel: '' }
    byId.set(root.id, rootFg)
    const children: FlatGenre[] = []
    const walk = (nodes: GenreNode[], parentLabel: string) => {
      for (const n of nodes) {
        const fg: FlatGenre = { id: n.id, label: n.label, parentLabel }
        byId.set(n.id, fg)
        children.push(fg)
        if (n.children.length > 0)
          walk(n.children, n.label)
      }
    }
    walk(root.children, root.label)
    groups.push({ root: rootFg, children })
  }
  return { groups, byId }
}

export default function GenrePicker({ value, onToggle }: Props) {
  const [groups, setGroups] = useState<Group[]>([])
  const [byId, setById] = useState<Map<string, FlatGenre>>(() => new Map())
  const [query, setQuery] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let alive = true
    fetchGenreTree()
      .then((roots) => {
        if (!alive)
          return
        const built = build(roots)
        setGroups(built.groups)
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

  // Search mode: a flat match across roots + children (label only — predictable,
  // no parent-flooding). Browse mode (empty query): the full grouped tree.
  const matches = useMemo(() => {
    if (!q)
      return []
    const out: FlatGenre[] = []
    for (const g of groups) {
      if (g.root.label.toLowerCase().includes(q))
        out.push(g.root)
      for (const c of g.children) {
        if (c.label.toLowerCase().includes(q))
          out.push(c)
      }
    }
    return out
  }, [groups, q])

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
            groups.map(group => (
              <div key={group.root.id} className="gp-group">
                <button
	type="button"
	role="option"
	aria-selected={selected.has(group.root.id)}
	className={`gp-row gp-root${selected.has(group.root.id) ? ' on' : ''}`}
	onClick={() => onToggle(group.root.id)}
                >
                  <span className="gp-row-label">{group.root.label}</span>
                </button>
                {group.children.map(c => (
                  <button
	key={c.id}
	type="button"
	role="option"
	aria-selected={selected.has(c.id)}
	className={`gp-row gp-child${selected.has(c.id) ? ' on' : ''}`}
	onClick={() => onToggle(c.id)}
                  >
                    <span className="gp-row-label">{c.label}</span>
                  </button>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
