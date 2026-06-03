// FEAT-review-bucket-board Step 4 — typed client for the backend buckets API.
// All calls go through `apiFetch` (Bearer + 401 refresh). Bucket routes live on
// the *backend* service (PUBLIC_BACKEND_API_URL), not the music service.
import { apiFetch } from '@lib/api'
import type { components } from '@lib/api.gen'

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string

export type Bucket = components['schemas']['Backend_BucketResponse']
export type BucketItem = components['schemas']['Backend_BucketItemResponse']
export type AlbumBrief = components['schemas']['Backend_AlbumBrief']
type BucketsResponse = components['schemas']['Backend_BucketsResponse']
type CreateBucketRequest = components['schemas']['Backend_CreateBucketRequest']
type UpdateBucketRequest = components['schemas']['Backend_UpdateBucketRequest']
type AddItemRequest = components['schemas']['Backend_AddBucketItemRequest']
type UpdateItemRequest = components['schemas']['Backend_UpdateBucketItemRequest']
type ReorderRequest = components['schemas']['Backend_ReorderRequest']

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

/** GET /api/buckets — all buckets + items, pre-sorted by position. */
export async function listBuckets(): Promise<Bucket[]> {
  const res = await apiFetch(`${BASE}/api/buckets`, { method: 'GET' })
  const data = await asJson<BucketsResponse>(res)
  return (data.buckets ?? []).map(b => ({ ...b, items: b.items ?? [] }))
}

export async function createBucket(body: CreateBucketRequest): Promise<Bucket> {
  const res = await apiFetch(`${BASE}/api/buckets`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return asJson<Bucket>(res)
}

export async function updateBucket(id: string, body: UpdateBucketRequest): Promise<Bucket> {
  const res = await apiFetch(`${BASE}/api/buckets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
  return asJson<Bucket>(res)
}

export async function deleteBucket(id: string): Promise<void> {
  const res = await apiFetch(`${BASE}/api/buckets/${id}`, { method: 'DELETE' })
  await expectNoContent(res)
}

export interface AddItemOutcome {
  item: BucketItem | null
  /** true when the album was already in this bucket (409). */
  conflict: boolean
}

export async function addItem(bucketId: string, body: AddItemRequest): Promise<AddItemOutcome> {
  const res = await apiFetch(`${BASE}/api/buckets/${bucketId}/items`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (res && res.status === 409)
    return { item: null, conflict: true }
  const item = await asJson<BucketItem>(res)
  return { item, conflict: false }
}

export async function updateItem(
  bucketId: string,
  itemId: string,
  body: UpdateItemRequest,
): Promise<BucketItem> {
  const res = await apiFetch(`${BASE}/api/buckets/${bucketId}/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
  return asJson<BucketItem>(res)
}

export async function deleteItem(bucketId: string, itemId: string): Promise<void> {
  const res = await apiFetch(`${BASE}/api/buckets/${bucketId}/items/${itemId}`, {
    method: 'DELETE',
  })
  await expectNoContent(res)
}

/** PUT /api/buckets/reorder — idempotent bulk position reassignment. */
export async function reorder(body: ReorderRequest): Promise<void> {
  const res = await apiFetch(`${BASE}/api/buckets/reorder`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  await expectNoContent(res)
}
