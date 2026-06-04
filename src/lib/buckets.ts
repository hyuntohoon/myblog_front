// FEAT-member-dashboard Step 5 — typed client for the nested review-bucket API.
// The /profile 평론 버킷 board persists here, replacing Step 1's localStorage seed.
// GET /api/buckets returns a nested tree (only roots at the top level, every
// bucket's descendants inlined as `children`); the new PUT /{id}/move reparents +
// repositions a bucket (cycle prevention is enforced server-side). Mutations go
// through apiFetch (Bearer + 401 refresh); the GET read carries the Bearer too,
// which skips edge_guard. Routes live on the backend service (PUBLIC_BACKEND_API_URL).
import { apiFetch } from '@lib/api'
import type { components } from '@lib/api.gen'

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string

type ApiBucket = components['schemas']['Backend_BucketResponse']
type ApiBucketsResponse = components['schemas']['Backend_BucketsResponse']
type ApiItem = components['schemas']['Backend_BucketItemResponse']

/**
 * Album card inside a bucket. Carries the bucket *item* id (the unit DnD/reorder
 * act on) plus the resolved DB album metadata for display + the detail slide-over.
 */
export interface BoardAlbum {
  /** review_bucket_items.id — the handle for move/reorder. */
  itemId: string
  /** DB album id — for the detail slide-over + add-dedup. */
  albumId: string
  title: string
  artist: string
  cover: string | null
  year: number | null
  /** Advisory: this album already has a published review. */
  alreadyReviewed: boolean
}

/** A bucket node in the board tree (mapped from the API's nested BucketResponse). */
export interface BoardBucket {
  id: string
  name: string
  albums: BoardAlbum[]
  children: BoardBucket[]
}

function mapItem(it: ApiItem): BoardAlbum {
  const a = it.album
  const rel = a?.release_date
  return {
    itemId: it.id,
    albumId: it.album_id,
    title: a?.title ?? '제목 미상',
    artist: (a?.artist_names ?? []).join(', ') || '—',
    cover: a?.cover_url ?? null,
    year: rel ? Number(String(rel).slice(0, 4)) || null : null,
    alreadyReviewed: it.already_reviewed ?? false,
  }
}

function mapBucket(b: ApiBucket): BoardBucket {
  return {
    id: b.id,
    name: b.name,
    albums: (b.items ?? []).map(mapItem),
    children: (b.children ?? []).map(mapBucket),
  }
}

async function asJson<T>(res: Response | null): Promise<T> {
  if (!res)
    throw new Error('network error (no response)')
  if (!res.ok)
    throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

async function expectNoContent(res: Response | null): Promise<void> {
  if (!res)
    throw new Error('network error (no response)')
  if (!res.ok)
    throw new Error(`HTTP ${res.status}`)
}

/** GET /api/buckets — the full nested tree (roots, descendants inlined). */
export async function listBuckets(): Promise<BoardBucket[]> {
  const res = await apiFetch(`${BASE}/api/buckets`, { method: 'GET' })
  const data = await asJson<ApiBucketsResponse>(res)
  return (data.buckets ?? []).map(mapBucket)
}

/** POST /api/buckets — create a root bucket (sub-buckets are created then moved). */
export async function createBucket(name: string): Promise<BoardBucket> {
  const res = await apiFetch(`${BASE}/api/buckets`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
  return mapBucket(await asJson<ApiBucket>(res))
}

/** PATCH /api/buckets/{id} — rename. */
export async function renameBucket(id: string, name: string): Promise<void> {
  const res = await apiFetch(`${BASE}/api/buckets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
  await asJson<ApiBucket>(res)
}

/** DELETE /api/buckets/{id} — cascades to descendants + items (DB FK). */
export async function deleteBucket(id: string): Promise<void> {
  const res = await apiFetch(`${BASE}/api/buckets/${id}`, { method: 'DELETE' })
  await expectNoContent(res)
}

/**
 * PUT /api/buckets/{id}/move — reparent + reposition; returns the full new tree.
 * parentId null = move to root. A cycle attempt is rejected server-side (400).
 */
export async function moveBucket(
  id: string,
  parentId: string | null,
  position: number,
): Promise<BoardBucket[]> {
  const res = await apiFetch(`${BASE}/api/buckets/${id}/move`, {
    method: 'PUT',
    body: JSON.stringify({ parent_id: parentId, position }),
  })
  const data = await asJson<ApiBucketsResponse>(res)
  return (data.buckets ?? []).map(mapBucket)
}

export interface AddItemOutcome { item: BoardAlbum | null, conflict: boolean }

/** POST /api/buckets/{id}/items — add an album (409 when already in the bucket). */
export async function addBucketItem(bucketId: string, albumId: string): Promise<AddItemOutcome> {
  const res = await apiFetch(`${BASE}/api/buckets/${bucketId}/items`, {
    method: 'POST',
    body: JSON.stringify({ album_id: albumId }),
  })
  if (res && res.status === 409)
    return { item: null, conflict: true }
  return { item: mapItem(await asJson<ApiItem>(res)), conflict: false }
}

/** DELETE /api/buckets/{bucketId}/items/{itemId} — remove a single album (204). */
export async function deleteBucketItem(bucketId: string, itemId: string): Promise<void> {
  const res = await apiFetch(`${BASE}/api/buckets/${bucketId}/items/${itemId}`, { method: 'DELETE' })
  await expectNoContent(res)
}

/**
 * PUT /api/buckets/reorder — bulk item reassignment. Used to move an album
 * between buckets: list both affected buckets with their new item_ids order
 * (the backend re-buckets + repositions the listed items).
 */
export async function reorderItems(buckets: { id: string, item_ids: string[] }[]): Promise<void> {
  const res = await apiFetch(`${BASE}/api/buckets/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ buckets }),
  })
  await expectNoContent(res)
}
