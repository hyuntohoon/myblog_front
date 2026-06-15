// FEAT-genre-subgenres Step 4 — the Genre Map data model.
//
// The API (GET /api/genres/tree) returns a 2-tier containment FOREST (roots with
// inlined children) plus a flat list of relationship EDGES. The map views want a
// flat node registry keyed by id, with the tree derived from `order` (tier-0) +
// `childOrder` (sub-genres per parent) so a multi-parent sub-genre can appear under
// several branches, and per-node relationship arrays for the ego view.
//
// Two layers, exactly as the editorial design intends:
//   • Global layer = pure parent→child CONTAINMENT of the fixed top-level genres.
//   • Local layer  = a per-node "ego view" revealed when a single node is opened.
//     Three relationship types, sub-genre level only — parent (is-a, may be
//     multiple) · influence (directed) · related (lateral).
import type { GenreEdge, GenreNode } from '@lib/genres'

/**
 * A flat registry node. `tier` 0 = top-level containment root, 1+ = sub-genre
 * depth (the taxonomy is N-tier as of FEAT-genre-deepen — was 2-tier).
 */
export interface GmNode {
	id: string
	slug: string
	label: string
	tier: number
	count: number
	def: string
	parents: string[]
	influencedBy: string[]
	related: string[]
}

export interface GmDoc {
	/** tier-0 root ids, in position order. */
	order: string[]
	/** parent id → child ids (independent per branch → multi-parent friendly). */
	childOrder: Record<string, string[]>
	nodes: Record<string, GmNode>
}

export type RelType = 'parent' | 'influence' | 'related'

export interface RelMeta {
	ko: string
	en: string
	glyph: string
}

/** Relationship metadata — shared by the diagram, the legend, and chips. */
export const GM_RELS: Record<RelType, RelMeta> = {
	parent: { ko: '상위 장르', en: 'is-a', glyph: '▸' },
	influence: { ko: '영향받음', en: 'influenced by', glyph: '→' },
	related: { ko: '관련', en: 'see-also', glyph: '~' },
}

/** Build the flat registry from the API forest + edge list. */
export function buildDoc(genres: GenreNode[], edges: GenreEdge[]): GmDoc {
	const nodes: Record<string, GmNode> = {}
	const order: string[] = []
	const childOrder: Record<string, string[]> = {}

	function add(n: GenreNode, tier: number) {
		nodes[n.id] = {
			id: n.id,
			slug: n.slug,
			label: n.label,
			tier,
			count: n.albumCount,
			def: n.definitionMd,
			parents: n.parentId ? [n.parentId] : [],
			influencedBy: [],
			related: [],
		}
	}

	// Recurse the full forest (N-tier as of FEAT-genre-deepen): every node gets
	// its own childOrder, so a tier-3/4 node is reachable. tier = depth from root.
	function walk(n: GenreNode, tier: number) {
		add(n, tier)
		const kids = n.children ?? []
		childOrder[n.id] = kids.map(k => k.id)
		for (const k of kids)
			walk(k, tier + 1)
	}

	for (const root of genres) {
		walk(root, 0)
		order.push(root.id)
	}

	// Apply edges with directional storage (mirrors the seed model: the reverse
	// direction is surfaced lazily by gmInbound, not pre-symmetrised).
	for (const e of edges) {
		const from = nodes[e.fromId]
		if (!from)
			continue
		if (e.type === 'influenced_by') {
			if (!from.influencedBy.includes(e.toId))
				from.influencedBy.push(e.toId)
		}
		else if (e.type === 'related') {
			if (!from.related.includes(e.toId))
				from.related.push(e.toId)
		}
		else if (e.type === 'parent') {
			if (nodes[e.toId] && !from.parents.includes(e.toId)) {
				from.parents.push(e.toId)
				if (!childOrder[e.toId])
					childOrder[e.toId] = []
				if (!childOrder[e.toId].includes(e.fromId))
					childOrder[e.toId].push(e.fromId)
			}
		}
	}

	return { order, childOrder, nodes }
}

// ── registry helpers ────────────────────────────────────────────────────────
export function gmNode(doc: GmDoc, id: string | null): GmNode | null {
	return id ? doc.nodes[id] ?? null : null
}

export function gmTopList(doc: GmDoc): GmNode[] {
	return doc.order.map(id => doc.nodes[id]).filter(Boolean)
}

export function gmChildren(doc: GmDoc, pid: string): GmNode[] {
	return (doc.childOrder[pid] ?? []).map(id => doc.nodes[id]).filter(Boolean)
}

export function gmTotal(doc: GmDoc): number {
	return doc.order.reduce((s, id) => s + (doc.nodes[id]?.count ?? 0), 0)
}

export function gmShare(count: number, total: number): number {
	return total ? (count / total) * 100 : 0
}

export function gmShareLabel(pct: number): string {
	if (pct >= 9.95)
		return `${Math.round(pct)}%`
	if (pct >= 0.95)
		return `${pct.toFixed(1)}%`
	if (pct > 0)
		return '<1%'
	return '0%'
}

export function gmCount(n: number): string {
	return (n ?? 0).toLocaleString('en-US')
}

export function gmRelList(doc: GmDoc, node: GmNode, key: 'parents' | 'influencedBy' | 'related'): GmNode[] {
	return (node[key] ?? []).map(id => doc.nodes[id]).filter(Boolean)
}

export function gmOtherParents(doc: GmDoc, node: GmNode, currentPid: string | null): GmNode[] {
	return (node.parents ?? []).filter(p => p !== currentPid).map(id => doc.nodes[id]).filter(Boolean)
}

export function gmPrimaryParent(doc: GmDoc, node: GmNode | null): GmNode | null {
	return node && node.parents.length ? doc.nodes[node.parents[0]] ?? null : null
}

/** Nodes that reference `id` — for leaf nodes with no outbound relationships. */
export function gmInbound(doc: GmDoc, id: string): { node: GmNode, rel: 'child' | 'influence' | 'related' }[] {
	const out: { node: GmNode, rel: 'child' | 'influence' | 'related' }[] = []
	for (const k of Object.keys(doc.nodes)) {
		const n = doc.nodes[k]
		if (n.id === id)
			continue
		if ((n.parents ?? []).includes(id))
			out.push({ node: n, rel: 'child' })
		else if ((n.influencedBy ?? []).includes(id))
			out.push({ node: n, rel: 'influence' })
		else if ((n.related ?? []).includes(id))
			out.push({ node: n, rel: 'related' })
	}
	return out
}
