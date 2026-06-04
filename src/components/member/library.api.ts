// FEAT-member-dashboard Step 2 (D18) — typed client for the backend library API.
// Two sources: 들을 것 (to-listen queue, a real table) and 평론한 앨범 (reviewed,
// a derived view). All mutations go through `apiFetch` (Bearer + 401 refresh);
// reads ride the edge_guard GET proxy. Routes live on the *backend* service
// (PUBLIC_BACKEND_API_URL), mirroring components/queue/api.ts.
import { apiFetch } from '@lib/api'
import type { components } from '@lib/api.gen'

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string

export type ToListenItem = components['schemas']['Backend_ToListenItemResponse']
export type ReviewedAlbum = components['schemas']['Backend_ReviewedAlbumResponse']
export type AlbumBrief = components['schemas']['Backend_AlbumBrief']
type ToListenResponse = components['schemas']['Backend_ToListenResponse']
type ReviewedResponse = components['schemas']['Backend_ReviewedResponse']
type AddToListenRequest = components['schemas']['Backend_AddToListenRequest']

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

/** GET /api/library/to-listen — the to-listen queue, pre-sorted by position. */
export async function listToListen(): Promise<ToListenItem[]> {
  const res = await apiFetch(`${BASE}/api/library/to-listen`, { method: 'GET' })
  const data = await asJson<ToListenResponse>(res)
  return data.items ?? []
}

export interface AddToListenOutcome {
  item: ToListenItem | null
  /** true when the album is already queued (409). */
  conflict: boolean
}

/** POST /api/library/to-listen — append an album to the queue. */
export async function addToListen(body: AddToListenRequest): Promise<AddToListenOutcome> {
  const res = await apiFetch(`${BASE}/api/library/to-listen`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (res && res.status === 409)
    return { item: null, conflict: true }
  const item = await asJson<ToListenItem>(res)
  return { item, conflict: false }
}

/** DELETE /api/library/to-listen/{item_id}. */
export async function removeToListen(itemId: string): Promise<void> {
  const res = await apiFetch(`${BASE}/api/library/to-listen/${itemId}`, {
    method: 'DELETE',
  })
  await expectNoContent(res)
}

/** PUT /api/library/to-listen/reorder — idempotent bulk position reassignment. */
export async function reorderToListen(itemIds: string[]): Promise<void> {
  const res = await apiFetch(`${BASE}/api/library/to-listen/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ item_ids: itemIds }),
  })
  await expectNoContent(res)
}

/** GET /api/library/reviewed — one entry per album with ≥1 published review. */
export async function listReviewed(): Promise<ReviewedAlbum[]> {
  const res = await apiFetch(`${BASE}/api/library/reviewed?group_by=album`, { method: 'GET' })
  const data = await asJson<ReviewedResponse>(res)
  return data.items ?? []
}
