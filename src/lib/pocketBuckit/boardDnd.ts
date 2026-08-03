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
import type { PbBoardDndStartDetail } from './events'
import { useSyncExternalStore } from 'react'
import { PLAYBACK_TYPE } from '@lib/buckets'
import { PB_BOARD_DND_END_EVENT, PB_BOARD_DND_START_EVENT } from './events'

let current: PbBoardDndStartDetail | null = null
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
    current = (e as CustomEvent<PbBoardDndStartDetail>).detail ?? null
    emit()
  })
  window.addEventListener(PB_BOARD_DND_END_EVENT, () => {
    current = null
    emit()
  })
}

/** The live board-drag payload, or null. Read synchronously inside onDragOver / onDrop. */
export function getBoardDnd(): PbBoardDndStartDetail | null {
  return current
}

/**
 * Does a Pocket bucket of this `type` ('general' | 'artist' | 'playback') accept the current
 * board drag? **The twin of the board's `canAcceptAlbumDrag`** — General accepts all; an
 * Artist bucket needs an artist member or an album/track SOURCE (which expands to its
 * credited artists); the Playback Bucket needs a track or album source and rejects an artist.
 * null payload → false. UX-only: the board re-checks authoritatively on drop.
 *
 * These two functions are duplicated on purpose (two React roots, no shared context — this
 * island cannot read the board's live `dnd`), which makes them a drift pair: **a rule change
 * in either one must land in both in the same PR**, or a tray chip previews an acceptance the
 * board then refuses. `boardDnd.test.ts` asserts the two agree case-for-case.
 */
export function boardDragAccepts(bucketType: string): boolean {
  const it = current
  if (!it)
    return false
  if (bucketType === PLAYBACK_TYPE)
    return it.srcItemType !== 'artist' && (!!it.albumId || !!it.trackId)
  if (bucketType !== 'artist')
    return true
  return it.srcItemType === 'artist' || !!it.albumId || !!it.trackId
}

/** Subscribe a component so it re-renders when a board drag begins / ends (highlight). */
export function useBoardDnd(): PbBoardDndStartDetail | null {
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
