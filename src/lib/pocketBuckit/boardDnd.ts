// FEAT-pocket-buckit-viewers Track A — the Pocket-island mirror of the board's live drag
// (the REVERSE of Step 6). A board `AlbumChip` dragstart broadcasts PB_BOARD_DND_START with
// its member payload; we cache it here so a Pocket drop target (tray chip / open drawer) can
// run the General/Artist accept-gate for drag-over highlighting. The actual mutation stays
// the board's: on drop the Pocket target fires PB_BOARD_DROP and the board runs `routeAlbumDrop`
// against its live `dnd`. Module singleton + observable so any island component re-renders when
// a board drag begins/ends.
//
// The board island can't read this, and this island can't read the board's `dnd` — two React
// roots, no shared context — so the window event is the only channel (the established pattern).
import type { DragPayload } from '@lib/entityDrag'
import { useSyncExternalStore } from 'react'
import { PLAYBACK_TYPE, SLIB_KIND } from '@lib/buckets'
import { toDndItem } from '@lib/entityDrag'
import { PB_BOARD_DND_END_EVENT, PB_BOARD_DND_START_EVENT } from './events'

let current: DragPayload | null = null
const listeners = new Set<() => void>()
let wired = false

function emit(): void {
  for (const l of listeners)
    l()
}

// Register the window listeners once, client-side. Called at module load (the Pocket island
// is client:only, so `window` exists when this is imported) AND defensively from useBoardDnd.
function ensureWired(): void {
  if (wired || typeof window === 'undefined')
    return
  wired = true
  window.addEventListener(PB_BOARD_DND_START_EVENT, (e: Event) => {
    current = (e as CustomEvent<DragPayload>).detail ?? null
    emit()
  })
  window.addEventListener(PB_BOARD_DND_END_EVENT, () => {
    current = null
    emit()
  })
}

/** The live board-drag payload, or null. Read synchronously inside onDragOver / onDrop. */
export function getBoardDnd(): DragPayload | null {
  return current
}

/**
 * Resolve the one drag Pocket can complete without BucketBoard: a catalog-backed
 * external album COPY. Home mounts Pocket but not BucketBoard, so forwarding this
 * payload through PB_BOARD_DROP would acknowledge the gesture and then no-op.
 */
export function externalAlbumCopy(payload: DragPayload | null): { albumId: string, title: string } | null {
  if (payload?.origin.kind !== 'external' || !payload.origin.copies || payload.ref?.entity !== 'album')
    return null
  return { albumId: payload.ref.albumId, title: payload.ref.title ?? '앨범' }
}

/**
 * Does this Pocket bucket accept the current board drag? **The twin of the board's
 * `canAcceptAlbumDrag`** — the sync-owned Spotify-library bucket takes albums only; General
 * accepts all; an Artist bucket needs an artist member or an album/track SOURCE (which
 * expands to its credited artists); the Playback Bucket needs a track or album source and
 * rejects an artist. null payload → false. UX-only: the board re-checks authoritatively on
 * drop.
 *
 * Takes the bucket's `kind` as well as its `type` because the library is identified by
 * `kind` — the axis mismatch that made its rejection invisible on the board
 * (ARCH-entity-interaction-v2 E3). The tray filters the library out of its rail today
 * (`leaf.ts` `flatten`), so that branch is unreachable from here; it is mirrored anyway
 * because the twin must be the same RULE, not the same reachable subset — a filter is not
 * an invariant, and Step 5 may well put the library in the rail.
 *
 * These two functions are duplicated on purpose (two React roots, no shared context — this
 * island cannot read the board's live payload), which makes them a drift pair: **a rule
 * change in either one must land in both in the same PR**, or a tray chip previews an
 * acceptance the board then refuses. `boardDnd.test.ts` asserts the two agree case-for-case.
 */
export function boardDragAccepts(bucket: { type: string, kind: string }): boolean {
  if (!current)
    return false
  const it = toDndItem(current)
  if (bucket.kind === SLIB_KIND)
    return !!it.albumId && !it.trackId && it.srcItemType !== 'artist'
  if (bucket.type === PLAYBACK_TYPE)
    return it.srcItemType !== 'artist' && (!!it.albumId || !!it.trackId)
  if (bucket.type !== 'artist')
    return true
  return it.srcItemType === 'artist' || !!it.albumId || !!it.trackId
}

/** Subscribe a component so it re-renders when a board drag begins / ends (highlight). */
export function useBoardDnd(): DragPayload | null {
  ensureWired()
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
    () => null,
  )
}

ensureWired()
