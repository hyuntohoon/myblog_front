// FEAT-member-dashboard Step 5 — typed client for the nested review-bucket API.
// The member 평론 버킷 board persists here, replacing Step 1's localStorage seed.
// GET /api/buckets returns a nested tree (only roots at the top level, every
// bucket's descendants inlined as `children`); the new PUT /{id}/move reparents +
// repositions a bucket (cycle prevention is enforced server-side). Mutations go
// through apiFetch (Bearer + 401 refresh); the GET read carries the Bearer too,
// which skips edge_guard. Routes live on the backend service (PUBLIC_BACKEND_API_URL).
import { apiFetch } from '@lib/api'
import type { components } from '@lib/api.gen'
import type { ResearchStatus } from '@lib/research'

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string

type ApiBucket = components['schemas']['Backend_BucketResponse']
type ApiBucketsResponse = components['schemas']['Backend_BucketsResponse']
type ApiItem = components['schemas']['Backend_BucketItemResponse']
type ApiArtistExpansion = components['schemas']['Backend_ArtistExpansionResponse']
type ApiArtistBrief = components['schemas']['Backend_ArtistBrief']
type ApiPublicBucketsResponse = components['schemas']['Backend_PublicBucketsResponse']
type ApiPublicBucket = components['schemas']['Backend_PublicBucket']
type ApiPublicItem = components['schemas']['Backend_PublicBucketItem']

/**
 * Album card inside a bucket. Carries the bucket *item* id (the unit DnD/reorder
 * act on) plus the resolved DB album metadata for display + the detail slide-over.
 */
export interface BoardAlbum {
  /** review_bucket_items.id — the handle for move/reorder. */
  itemId: string
  /**
   * FEAT-pocket-buckit Step 5: generalized membership kind
   * ('album'|'track'|'review'|'playback'|'snapshot'). Every prod row is 'album'
   * today (Step 3 rejects non-album INSERTs with 422; the relax is Step 6), so
   * non-album rows are forward-compat only — the board/tray must render them
   * without crashing, but creation stays album-only until Step 6.
   */
  itemType: string
  /**
   * DB album id — for the detail slide-over + add-dedup. **Null on non-album
   * members** (the contract relaxed `album_id` to nullable in Step 4). Album-only
   * operations (drag, copy, undo-re-add) must guard on it being present.
   */
  albumId: string | null
  /** Typed non-album target FKs (forward-compat; null on album rows). */
  trackId: string | null
  reviewTargetId: string | null
  /**
   * FEAT-my-buckit-artist: the credited artist for an `itemType==='artist'`
   * member (`review_bucket_items.artist_id` → `artists.id`), null on every
   * other kind. Drives the click-through to `/artist/[id]`.
   */
  artistId: string | null
  title: string
  artist: string
  cover: string | null
  year: number | null
  /** Advisory: this album already has a published review. */
  alreadyReviewed: boolean
  /**
   * FEAT-bucket-identity Direction B: the posts-table DB id linked to this item
   * (`review_bucket_items.post_id`) when a draft/post has been kicked off from
   * the bucket, else null. Drives the rename-proof "작성 중" lifecycle tag and the
   * review→bucket reverse join. Nullable: most items have no post linked yet.
   */
  postId: string | null
  /**
   * FEAT-album-research-notes: per-item auto-research opt-in. Only meaningful
   * when the parent bucket's research_mode is 'selected' (the cover checkbox).
   */
  researchSelected: boolean
  /**
   * FEAT-album-research-notes: latest research-note status for this album
   * ('queued'|'running'|'done'|'failed') or null when never researched. Seeds the
   * cover badge so a done album shows its dot on first paint — no per-cover GET.
   * Optional: album sources without a bucket payload (recent strip, copies) omit it.
   */
  researchStatus?: ResearchStatus | null
  /**
   * FEAT-bucket-organize Step 1 — view-control fields surfaced from AlbumBrief so
   * the BucketBoard view toolbar can sort (newest/oldest/popular) and group (by
   * primary artist) entirely on the client. Optional: non-bucket sources (recent
   * strip, optimistic copies) may omit them → treated as null/last when sorting.
   */
  popularity?: number | null
  /** Full release date ('YYYY' or 'YYYY-MM-DD') for precise newest/oldest sort. */
  releaseDate?: string | null
  /** Ordered artist list; `[0]` is the primary artist used for grouping. */
  artistNames?: string[]
  /**
   * FEAT-bucket-organize Step 2: high-confidence tier-0 genre labels, primary
   * first (`[0]` = the single "home" for group-by-genre). Empty when the album
   * has no high-confidence genre rows. Drives the genre group + filter chips.
   */
  genres?: string[]
  /**
   * FEAT-editor-buckit Step 3: the freeform bucket memo (`review_bucket_items.note`)
   * — the "쓰레기통" memo body shown in the album-click memo window. Optional: non-bucket
   * sources (recent strip, optimistic copies) omit it.
   */
  note?: string | null
  /**
   * FEAT-editor-buckit Step 3: the "오늘 밤 키우기" gate (`review_bucket_items.prep_tonight`)
   * — when on, the nightly $0 memo→skeleton job is cleared to process this item.
   */
  prepTonight?: boolean
}

/** A bucket node in the board tree (mapped from the API's nested BucketResponse). */
export interface BoardBucket {
  id: string
  name: string
  /** Editorial accent color (oklch/hex) or null for the default ink. */
  color: string | null
  /** The single "평론 완료" column — drives the on-cover rating chips. */
  isDone: boolean
  /**
   * Bucket kind — 'review' (a normal crate) or 'spotify_library' (the single
   * special Spotify-library mirror bucket, filtered out of the normal tree and
   * rendered as its own section). Defaults to 'review' when the field is absent.
   */
  kind: string
  /**
   * FEAT-my-buckit-artist: the fixed bucket TYPE — 'general' (today's polymorphic
   * crate, default) or 'artist' (accepts artist members only). Orthogonal to
   * `kind` (system/role). System buckets are always 'general'. Set once at create,
   * immutable in v1.
   */
  type: string
  /**
   * FEAT-public-bucket-multiuser Scope A: opt-in public visibility. When true a
   * `kind==='review'` bucket is exposed by GET /api/buckets/public + the read-only
   * /collection viewer. Defaults false (private); the spotify_library bucket is
   * always excluded server-side.
   */
  isPublic: boolean
  /**
   * FEAT-album-research-notes: per-bucket auto-research scope. 'off' (default) |
   * 'all' (research every note-less item) | 'selected' (only checked items).
   */
  researchMode: string
  albums: BoardAlbum[]
  children: BoardBucket[]
}

// Placeholder display title for the generalized-membership kinds when no display
// payload resolves (a payload-less playback row, a caption-less review/snapshot
// row) — so the tile stays labeled instead of '제목 미상'. album/track/playback use
// their brief; review/snapshot prefer the auto-caption stashed in `note` at add time.
const TYPE_TITLE: Record<string, string> = { review: '평론', playback: '재생 큐', snapshot: '스냅샷' }

function mapItem(it: ApiItem): BoardAlbum {
  const a = it.album
  const tr = it.track
  const ar = it.artist
  const itemType = it.item_type ?? 'album'
  // A playback (queue) member is a track reference too — the serializer sends its
  // TrackBrief for item_type in ('track','playback'), so both render identically.
  const isTrack = itemType === 'track' || itemType === 'playback'
  const isArtist = itemType === 'artist'
  const rel = a?.release_date
  // review/snapshot carry no display payload in BucketItemResponse; the add path
  // seeds `note` with a display caption (review title / analysis-period summary),
  // so a first-line-of-note title keeps the tile meaningful without a contract
  // change. Scoped to those two kinds only — on an album row `note` is a user
  // memo and must not surface as the title when the album relation is null.
  const noteTitle = (itemType === 'review' || itemType === 'snapshot') ?
    ((it.note ?? '').trim().split('\n')[0] || null) :
    null
  return {
    itemId: it.id,
    itemType,
    // Album-only ops (drag-copy, undo-re-add, restore, dedup) guard on albumId
    // being present, so a track row keeps it null even though its TrackBrief
    // carries the parent album_id — those paths must NOT treat a track as an album.
    albumId: it.album_id ?? null,
    trackId: it.track_id ?? null,
    reviewTargetId: it.review_target_id ?? null,
    artistId: it.artist_id ?? null,
    // FEAT-pocket-buckit Step 6: a track/playback member renders from its TrackBrief
    // (title + artist_names) so it never falls back to '제목 미상'. An artist member
    // (FEAT-my-buckit-artist) renders its ArtistBrief name. review/snapshot render
    // their note caption, falling back to the typed placeholder ('평론'/'스냅샷').
    title: isArtist ? (ar?.name ?? '아티스트') : isTrack ? (tr?.title ?? '제목 미상') : (a?.title ?? noteTitle ?? TYPE_TITLE[itemType] ?? '제목 미상'),
    // An artist tile has no secondary line (the name is the title); a track shows
    // its artists; an album shows its artists.
    artist: isArtist ? '' : isTrack ? ((tr?.artist_names ?? []).join(', ') || '—') : ((a?.artist_names ?? []).join(', ') || '—'),
    // TrackBrief has no cover_url (the cover lives on its album, not resolved
    // here) → a track tile shows the initials placeholder. An artist tile uses
    // its photo_url.
    cover: isArtist ? (ar?.photo_url ?? null) : (a?.cover_url ?? null),
    year: rel ? Number(String(rel).slice(0, 4)) || null : null,
    alreadyReviewed: it.already_reviewed ?? false,
    postId: it.post_id ?? null,
    researchSelected: it.research_selected ?? false,
    note: it.note ?? null,
    prepTonight: it.prep_tonight ?? false,
    researchStatus: (it.research_status ?? null) as ResearchStatus | null,
    popularity: a?.popularity ?? null,
    releaseDate: rel ?? null,
    artistNames: a?.artist_names ?? [],
    genres: a?.genres ?? [],
  }
}

function mapBucket(b: ApiBucket): BoardBucket {
  // `kind` (FEAT-spotify-library-sync) distinguishes a normal crate from the
  // single Spotify-library bucket; default to 'review' for safety.
  const kind = b.kind ?? 'review'
  return {
    id: b.id,
    name: b.name,
    color: b.color ?? null,
    isDone: b.is_done ?? false,
    kind,
    type: b.type ?? 'general',
    isPublic: b.is_public ?? false,
    researchMode: b.research_mode ?? 'off',
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

// ── FEAT-public-bucket-multiuser Scope A A4 — read-only public collection ──────
// The /collection viewer reads GET /api/buckets/public (unauthenticated, served
// flat with a whitelisted projection: album + position + already_reviewed, no
// private item fields, spotify_library excluded). apiFetch is safe unauthed — with
// no token it omits the Bearer header and returns the 200 as-is.

/** A public album cover in a collection (slim, read-only projection). */
export interface PublicAlbum {
  albumId: string
  title: string
  artist: string
  cover: string | null
  year: number | null
  /** Advisory: this album already has a published review. */
  alreadyReviewed: boolean
  genres: string[]
}

/** A public bucket = one named collection on the /collection viewer. */
export interface PublicCollection {
  id: string
  name: string
  color: string | null
  /**
   * Whose shelf this is (FEAT-multi-user-accounts P2: any member can publish a
   * bucket, so the viewer attributes every shelf). Nullable defensively for the
   * rollout window where the deployed backend predates the field.
   */
  owner: { handle: string, displayName: string | null } | null
  albums: PublicAlbum[]
}

function mapPublicItem(it: ApiPublicItem): PublicAlbum {
  const a = it.album
  const rel = a.release_date
  return {
    albumId: it.album_id,
    title: a.title,
    artist: (a.artist_names ?? []).join(', ') || '—',
    cover: a.cover_url ?? null,
    year: rel ? Number(String(rel).slice(0, 4)) || null : null,
    alreadyReviewed: it.already_reviewed,
    genres: a.genres ?? [],
  }
}

function mapPublicBucket(b: ApiPublicBucket): PublicCollection {
  // b.owner is required in the current contract but may be absent from a
  // not-yet-redeployed backend during rollout — degrade to unattributed.
  const owner = (b as Partial<ApiPublicBucket>).owner
  return {
    id: b.id,
    name: b.name,
    color: b.color ?? null,
    owner: owner ? { handle: owner.handle, displayName: owner.display_name ?? null } : null,
    albums: (b.items ?? []).map(mapPublicItem),
  }
}

/**
 * GET /api/buckets/public — every member-published review bucket (flat, each
 * attributed to its owner), mapped to slim read-only collections. No auth required.
 */
export async function listPublicBuckets(): Promise<PublicCollection[]> {
  const res = await apiFetch(`${BASE}/api/buckets/public`, { method: 'GET' })
  const data = await asJson<ApiPublicBucketsResponse>(res)
  return (data.buckets ?? []).map(mapPublicBucket)
}

/**
 * POST /api/buckets — create a root bucket (sub-buckets are created then moved).
 * FEAT-my-buckit-artist: `type` ('general' | 'artist') is fixed at create and
 * immutable afterwards; system buckets are forced 'general' server-side.
 */
export async function createBucket(name: string, type: 'general' | 'artist' = 'general'): Promise<BoardBucket> {
  const res = await apiFetch(`${BASE}/api/buckets`, {
    method: 'POST',
    body: JSON.stringify({ name, type }),
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

/** PATCH /api/buckets/{id} — set (or clear, with null) the bucket accent color. */
export async function setBucketColor(id: string, color: string | null): Promise<void> {
  const res = await apiFetch(`${BASE}/api/buckets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ color }),
  })
  await asJson<ApiBucket>(res)
}

/**
 * PATCH /api/buckets/{id} — opt the bucket in/out of public visibility
 * (FEAT-public-bucket-multiuser Scope A). When true the bucket is exposed by
 * GET /api/buckets/public. The backend refuses to publish the spotify_library
 * bucket (400); the board hides the toggle for it, so that path isn't reachable.
 */
export async function setBucketIsPublic(id: string, isPublic: boolean): Promise<void> {
  const res = await apiFetch(`${BASE}/api/buckets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_public: isPublic }),
  })
  await asJson<ApiBucket>(res)
}

/**
 * PATCH /api/buckets/{id} — set the auto-research scope. Switching to 'all' /
 * 'selected' makes the backend auto-enqueue the bucket's note-less (checked)
 * items through the dedupe gate; 'off' only stops future auto-triggers.
 */
export async function setBucketResearchMode(id: string, mode: 'off' | 'all' | 'selected'): Promise<void> {
	const res = await apiFetch(`${BASE}/api/buckets/${id}`, {
		method: 'PATCH',
		body: JSON.stringify({ research_mode: mode }),
	})
	await asJson<ApiBucket>(res)
}

/**
 * PATCH /api/buckets/{bucketId}/items/{itemId} — toggle per-item research opt-in.
 * Checking an item while the bucket is in 'selected' mode auto-enqueues it.
 */
export async function setItemResearchSelected(bucketId: string, itemId: string, selected: boolean): Promise<void> {
	const res = await apiFetch(`${BASE}/api/buckets/${bucketId}/items/${itemId}`, {
		method: 'PATCH',
		body: JSON.stringify({ research_selected: selected }),
	})
	await asJson<ApiItem>(res)
}

/**
 * PATCH /api/buckets/{bucketId}/items/{itemId} — persist the freeform memo (`note`)
 * and/or the "오늘 밤 키우기" gate (`prep_tonight`). FEAT-editor-buckit Step 3: backed
 * by the existing item PATCH (Step 2), which is **set-only** for these fields (no
 * enqueue side-effect — the offline nightly job is their only reader). An empty
 * `note` string clears it to NULL server-side (`note or None`). Throws on non-2xx.
 */
export async function updateBucketItemMemo(
	bucketId: string,
	itemId: string,
	patch: { note?: string | null, prep_tonight?: boolean },
): Promise<void> {
	const res = await apiFetch(`${BASE}/api/buckets/${bucketId}/items/${itemId}`, {
		method: 'PATCH',
		body: JSON.stringify(patch),
	})
	await asJson<ApiItem>(res)
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

/**
 * POST /api/buckets/{id}/items — the shared add path. `item_type` is sent
 * explicitly; a per-kind 409 ('이미 담겨 있어요') maps to `conflict` (the backend's
 * partial-uniques reject a dup album/track/review). FEAT-pocket-buckit Step 6
 * relaxed the backend to accept non-album writes; album + track are wired here.
 */
async function postBucketItem(bucketId: string, body: Record<string, unknown>): Promise<AddItemOutcome> {
  const res = await apiFetch(`${BASE}/api/buckets/${bucketId}/items`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (res && res.status === 409)
    return { item: null, conflict: true }
  return { item: mapItem(await asJson<ApiItem>(res)), conflict: false }
}

/** POST an album membership (item_type='album'); 409 on a dup album in the bucket. */
export async function addBucketItem(bucketId: string, albumId: string): Promise<AddItemOutcome> {
  return postBucketItem(bucketId, { album_id: albumId, item_type: 'album' })
}

/** POST a track membership (item_type='track'); 409 on a dup track in the bucket. */
export async function addBucketTrack(bucketId: string, trackId: string): Promise<AddItemOutcome> {
  return postBucketItem(bucketId, { track_id: trackId, item_type: 'track' })
}

/**
 * FEAT-my-buckit-artist: POST a direct artist membership (item_type='artist',
 * artist_id). 409 ('이미 담겨 있어요') on a duplicate artist in the bucket (the
 * partial-unique uq_review_bucket_items_artist). Returns the new member row.
 */
export async function addBucketArtist(bucketId: string, artistId: string): Promise<AddItemOutcome> {
  return postBucketItem(bucketId, { artist_id: artistId, item_type: 'artist' })
}

// ── FEAT-pocket-buckit member authoring — the remaining generalized kinds ───────
// The backend has accepted these since Step 6 (backend #93); these are their first
// front callers. `note` doubles as the tile display caption (see mapItem) — the
// response carries no ReviewBrief/snapshot payload, so the caption is seeded at add
// time instead of widening the contract.

/**
 * POST a review membership (item_type='review', review_target_id = the posts-table
 * DB id). 409 on a duplicate review in the bucket (uq_review_bucket_items_review).
 * `note` carries the review title as the tile caption.
 */
export async function addBucketReview(bucketId: string, reviewTargetId: string, note?: string): Promise<AddItemOutcome> {
  return postBucketItem(bucketId, { review_target_id: reviewTargetId, item_type: 'review', ...(note ? { note } : {}) })
}

/**
 * POST a playback (queue) membership (item_type='playback', track_id). Queues are
 * ordered + duplicate-allowed (D8) — no 409 path; re-adding the same track appends
 * another queue entry.
 */
export async function addBucketPlayback(bucketId: string, trackId: string): Promise<AddItemOutcome> {
  return postBucketItem(bucketId, { track_id: trackId, item_type: 'playback' })
}

/** The frozen capture body for a snapshot membership (append-only server-side). */
export type SnapshotCapture = components['schemas']['Backend_SnapshotCaptureRequest']

/**
 * POST a snapshot membership (item_type='snapshot' + the frozen capture). The
 * server APPEND-ONLY inserts a bucket_item_snapshots side-row — a re-capture is a
 * new member, never an update. Duplicates allowed (D8). `note` carries the
 * period/metric caption as the tile title.
 */
export async function addBucketSnapshot(bucketId: string, snapshot: SnapshotCapture, note?: string): Promise<AddItemOutcome> {
  return postBucketItem(bucketId, { item_type: 'snapshot', snapshot, ...(note ? { note } : {}) })
}

/** One credited artist as added/skipped by a source-expansion. */
export interface ArtistBriefView { id: string, name: string, photoUrl: string | null }

/** The result of expanding a featuring track / compilation album into its artists. */
export interface ExpansionOutcome { added: ArtistBriefView[], skipped: ArtistBriefView[] }

function mapArtistBrief(a: ApiArtistBrief): ArtistBriefView {
  return { id: a.id, name: a.name, photoUrl: a.photo_url ?? null }
}

/**
 * FEAT-my-buckit-artist: drop a featuring track / compilation album on an Artist
 * bucket → the backend expands the source into its credited artists (Various
 * Artists excluded), inserting each not-already-present one and skipping dups.
 * The source row itself is never stored. Returns the added/skipped artist briefs
 * for the toast; the caller refreshes the tree to render the new members.
 *
 * The add endpoint returns a Union — a `source_*` artist add yields an
 * ArtistExpansionResponse rather than a single BucketItemResponse.
 */
export async function expandSourceArtists(
  bucketId: string,
  source: { albumId: string } | { trackId: string },
): Promise<ExpansionOutcome> {
  const body = 'albumId' in source ?
    { item_type: 'artist', source_album_id: source.albumId } :
    { item_type: 'artist', source_track_id: source.trackId }
  const res = await apiFetch(`${BASE}/api/buckets/${bucketId}/items`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  const data = await asJson<ApiArtistExpansion>(res)
  const exp = data.expansion ?? {}
  return {
    added: (exp.added ?? []).map(mapArtistBrief),
    skipped: (exp.skipped ?? []).map(mapArtistBrief),
  }
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
