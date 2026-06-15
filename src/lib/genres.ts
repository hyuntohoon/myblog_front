// FEAT-genre-system Step 7 — typed client for the public genre map (/genres).
//
// GET /api/genres/tree returns the 2-tier containment forest (roots, children
// inlined); each node carries album_count (the grouped album_genres count that
// drives the share-bars). PUT /api/genres/{id} is the owner's inline edit surface
// (label / definition_md / position only — no rename of the taxonomy shape, no
// create/delete here). The read carries the Bearer when logged in (skips
// edge_guard) and otherwise rides CloudFront's injected x-origin-verify; mutations
// go through apiFetch (Bearer + 401 refresh). Routes live on PUBLIC_BACKEND_API_URL.
import { apiFetch } from '@lib/api'
import type { components } from '@lib/api.gen'

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string

type ApiGenreNode = components['schemas']['Backend_GenreNode']
type ApiTreeResponse = components['schemas']['Backend_GenreTreeResponse']

/** A genre node, camelCased from the API for component use. */
export interface GenreNode {
  id: string
  slug: string
  label: string
  parentId: string | null
  /** Editorial prose (markdown). May be empty — no definition written yet. */
  definitionMd: string
  position: number
  /** Albums tagged with this genre in album_genres (all confidences). */
  albumCount: number
  children: GenreNode[]
}

/**
 * A tier-1 relationship edge (FEAT-genre-subgenres). Drives the /genres ego-view.
 * `type` ∈ influenced_by | related | parent (parent = the multi-parent fallback).
 */
export interface GenreEdge {
  fromId: string
  toId: string
  type: string
}

/** The full genre map: containment forest + the relationship edges over it. */
export interface GenreMapData {
  genres: GenreNode[]
  edges: GenreEdge[]
}

/** Fields the owner can PUT. All optional; only sent fields are applied. */
export interface GenrePatch {
  label?: string
  definition_md?: string
  position?: number
}

function mapNode(n: ApiGenreNode): GenreNode {
  return {
    id: n.id,
    slug: n.slug,
    label: n.label,
    parentId: n.parent_id ?? null,
    definitionMd: n.definition_md ?? '',
    position: n.position ?? 0,
    albumCount: n.album_count ?? 0,
    children: (n.children ?? []).map(mapNode),
  }
}

async function asJson<T>(res: Response | null): Promise<T> {
  if (!res)
    throw new Error('network error (no response)')
  if (!res.ok)
    throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

/** GET /api/genres/tree — the full containment forest (public read). */
export async function fetchGenreTree(): Promise<GenreNode[]> {
  const res = await apiFetch(`${BASE}/api/genres/tree`, { method: 'GET' })
  const data = await asJson<ApiTreeResponse>(res)
  return (data.genres ?? []).map(mapNode)
}

/**
 * GET /api/genres/tree — containment forest plus relationship edges, for the
 * Genre Map ego-view (FEAT-genre-subgenres Step 4). Same endpoint as
 * fetchGenreTree; this variant also surfaces the `edges` array.
 */
export async function fetchGenreMap(): Promise<GenreMapData> {
  const res = await apiFetch(`${BASE}/api/genres/tree`, { method: 'GET' })
  const data = await asJson<ApiTreeResponse>(res)
  return {
    genres: (data.genres ?? []).map(mapNode),
    edges: (data.edges ?? []).map(e => ({ fromId: e.from_id, toId: e.to_id, type: e.type })),
  }
}

/** PUT /api/genres/{id} — owner inline edit (label / definition / position). */
export async function updateGenre(id: string, patch: GenrePatch): Promise<GenreNode> {
  const res = await apiFetch(`${BASE}/api/genres/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
  return mapNode(await asJson<ApiGenreNode>(res))
}
