// ARCH-entity-interaction-v2 E2 — the ONE drag payload.
//
// Every draggable representation in the product builds a `DragPayload`: what is being
// dragged (`ref`) and where it came from (`origin`). Today that is two surfaces (the
// board's `AlbumChip` / bucket node and the Pocket tray's drawer item); Step 5 rolls the
// same payload out to the rest.
//
// `DndItem` (@lib/boardDnd) is ADAPTED, NOT DELETED. Its routing/acceptance rules are a
// verified asset — `boardDnd.test.ts` pins them case-for-case — so this module converts
// both ways instead of rewriting them. `boardDnd.test.ts` runs every one of those cases
// through `fromDndItem` → `toDndItem` and asserts the SAME `ops` calls, which is what
// makes "the board behaves identically through the new payload" a measurement rather
// than a claim.
//
// What the adapter is and is not:
//   - `toDndItem` ∘ `fromDndItem` is the IDENTITY on `DndItem` — every field the rules
//     read survives the round trip unchanged, including the ones whose absence is
//     load-bearing (`copy`, `srcItemType`).
//   - `toDndItem` is deliberately lossy on the DISPLAY fields (`title`/`artist`/`cover`/
//     `name`/`image`): `DndItem` has no slots for them. No source populates them yet —
//     E1's "payload minimum" is a Step 5 obligation, and filling them here would be a
//     surface change in a step whose whole job is proving nothing changed.
import type { DndItem } from './boardDnd'

/**
 * What is being dragged, by E1's canonical identity for each entity.
 *
 * Display fields are optional on purpose: E1 states that a payload carrying only an id
 * is legal (it degrades to a blank header flash), so a future source that genuinely has
 * nothing but an id stays inside the contract rather than fabricating a title.
 *
 * `bucket` is here because E2 says "every draggable representation" and a bucket node is
 * one of the two things that drags today; E3's matrix already gives it its own column.
 * It is a container, not an E1 entity — which is why its `origin` is always external.
 *
 * On the track member, `albumId` is the PARENT album (E1), null when the source does not
 * know it — never the track's own id.
 */
export type EntityRef =
	| { entity: 'album', albumId: string, title?: string, artist?: string, cover?: string | null } |
	{ entity: 'track', trackId: string, albumId: string | null, title?: string, artist?: string } |
	{ entity: 'artist', artistId: string, name?: string, image?: string | null } |
	{ entity: 'bucket', bucketId: string, name?: string }

/**
 * Where the drag started — what replaces today's implicit `copy` / `fromLib` /
 * `fromBucketId` triad.
 *
 * E2 named two kinds (internal = MOVE, external = COPY). The code needs THREE, and
 * collapsing the third into `internal` would turn a copy into a move: a `spotify_library`
 * row IS a real membership (it has an `itemId`, and the trash can take it) yet it COPIES
 * out, because the library is sync-owned — moving a row out of it would desync Spotify.
 * `source` rides along because the trash refuses a `preexisting` library album (deleting
 * it locally would not remove it from Spotify, and the next sync re-pulls it).
 *
 * `itemType` is `review_bucket_items.item_type` — a property of the MEMBERSHIP, not of
 * the entity, which is why it lives here and not on `EntityRef`. It is what lets a queue
 * row ('playback') and a plain track row ('track') point at the same track while the
 * board still tells them apart. Optional because a source may legitimately not know it.
 *
 * The three kinds:
 * - `internal` — a real bucket membership → MOVE.
 * - `library` — a `spotify_library` membership → COPY out, and only trashable when
 *   `source === 'myblog_added'`.
 * - `external` — any non-membership surface. Its `copies` is the residue E2's binary did
 *   not capture: it says whether dropping this into a bucket ADDS by album id. The pinned
 *   최근 들은 앨범 strip is `copies: true`, the only external source in the product today.
 *   A `copies: false` source is draggable but adds nothing to a General bucket — a payload
 *   gap of the G-series kind, not a state any surface currently produces.
 */
export type DragOrigin =
	| { kind: 'internal', itemId: string, fromBucketId: string, itemType?: string } |
	{ kind: 'library', itemId: string, fromBucketId: string, itemType?: string, source?: string } |
	{ kind: 'external', fromBucketId?: string, itemType?: string, copies?: boolean }

/**
 * The single payload. `ref` is null when a member row points at no canonical entity — a
 * review / snapshot row today. That is inert by construction, never a crash (E1 Rule 0):
 * with no id, every accept-gate but the General bucket's refuses it.
 */
export interface DragPayload {
  ref: EntityRef | null
  origin: DragOrigin
}

/** A bucket node being dragged — a container move, so `origin` is trivially external. */
export function bucketDrag(bucketId: string, name?: string): DragPayload {
  return { ref: { entity: 'bucket', bucketId, name }, origin: { kind: 'external' } }
}

/**
 * Build the `ref` for a bucket member from the id columns it carries.
 *
 * Dispatch is on ID PRESENCE, not on `itemType`, and the order matters: a row carries at
 * most one of these today, but keying on the id keeps the adapter lossless even for a row
 * whose `itemType` disagrees with its ids (`boardDnd.test.ts` has exactly such a case —
 * the belt-and-braces artist-carrying-an-album). Keying on `itemType` would drop the id
 * and quietly change what the gates see.
 */
export function memberRef(m: { albumId?: string | null, trackId?: string | null, artistId?: string | null }): EntityRef | null {
  if (m.artistId)
    return { entity: 'artist', artistId: m.artistId }
  if (m.trackId)
    return { entity: 'track', trackId: m.trackId, albumId: m.albumId ?? null }
  if (m.albumId)
    return { entity: 'album', albumId: m.albumId }
  return null
}

/** The new payload → the legacy `DndItem` the board's verified rules consume. */
export function toDndItem(p: DragPayload): DndItem {
  const { ref, origin } = p
  // `|| undefined` (not `??`) so an empty id round-trips back to absent: every read site
  // treats '' and undefined alike, but keeping them distinct would make the adapter's
  // identity test pass on a technicality instead of on equality.
  if (ref?.entity === 'bucket')
    return { kind: 'bucket', bucketId: ref.bucketId || undefined }

  const it: DndItem = { kind: 'member' }
  if (ref?.entity === 'album') {
    it.albumId = ref.albumId
  }
  else if (ref?.entity === 'track') {
    it.trackId = ref.trackId
    // Only when known: a track whose parent album is null must not start carrying an
    // `albumId` KEY, because the library gate and the artist branch both read presence.
    if (ref.albumId !== null)
      it.albumId = ref.albumId
  }
  else if (ref?.entity === 'artist') {
    it.artistId = ref.artistId
  }

  if (origin.kind === 'external') {
    if (origin.copies)
      it.copy = true
    if (origin.fromBucketId !== undefined)
      it.fromBucketId = origin.fromBucketId
    if (origin.itemType !== undefined)
      it.srcItemType = origin.itemType
    return it
  }

  it.itemId = origin.itemId
  it.fromBucketId = origin.fromBucketId
  if (origin.itemType !== undefined)
    it.srcItemType = origin.itemType
  if (origin.kind === 'library') {
    it.fromLib = true
    it.source = origin.source
  }
  return it
}

/** The legacy `DndItem` → the new payload. The exact inverse of {@link toDndItem}. */
export function fromDndItem(it: DndItem): DragPayload {
  if (it.kind === 'bucket')
    return { ref: { entity: 'bucket', bucketId: it.bucketId ?? '' }, origin: { kind: 'external' } }

  const ref = memberRef(it)
  // A library row is a membership that copies; a plain membership moves. Anything else —
  // no `itemId`/`fromBucketId` pair — is not a membership at all, so it is external, and
  // `copies` carries whether it adds on drop (the recent strip does; a bare source does not).
  //
  // `fromLib` always arrives WITH the pair (it is set at exactly one drag source, on a
  // real `spotify_library` membership). The round-trip test is what keeps that true: a
  // future `fromLib` without an `itemId` would fall through to `external` and lose the
  // flag, and the identity assertion fails rather than the flag vanishing in prod.
  if (it.fromLib && it.itemId !== undefined && it.fromBucketId !== undefined)
    return { ref, origin: { kind: 'library', itemId: it.itemId, fromBucketId: it.fromBucketId, itemType: it.srcItemType, source: it.source } }
  if (!it.copy && it.itemId !== undefined && it.fromBucketId !== undefined)
    return { ref, origin: { kind: 'internal', itemId: it.itemId, fromBucketId: it.fromBucketId, itemType: it.srcItemType } }
  return { ref, origin: { kind: 'external', fromBucketId: it.fromBucketId, itemType: it.srcItemType, copies: it.copy } }
}
