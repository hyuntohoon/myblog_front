// ARCH-entity-interaction-unify Step 1 — the public-safe entity-open event.
//
// `openAlbum(detail)` dispatches a window CustomEvent that the app-wide album
// overlay (components/album/AlbumOverlay, mounted in layout.astro) listens for.
// ANY surface — public review page, home tiles, search — opens the read-only
// album window by calling this, with no knowledge of the overlay or of member
// types. The member-context writable modal (memo/edit) is a SEPARATE path
// (ProfileApp's onOpen(DetailTarget)); this event is inherently read-only, so
// it deliberately carries only public primitives — never a DetailTarget.
//
// Payload carries display identity (title/artist/cover/year) as well as the DB
// `albumId` so the overlay header paints immediately instead of flashing blank
// during the ~1s album-detail fetch on a cache miss (lib/albumDetail).

export interface OpenAlbumDetail {
  /** music-catalog album id (DB uuid). The read stack has no spotify→album resolve. */
  albumId: string
  title?: string
  artist?: string
  cover?: string | null
  year?: number | null
}

export const ENT_OPEN_ALBUM = 'ent:open-album'

/** Open the app-wide read-only album detail overlay. No-op server-side. */
export function openAlbum(detail: OpenAlbumDetail): void {
  if (typeof window === 'undefined')
    return
  window.dispatchEvent(new CustomEvent<OpenAlbumDetail>(ENT_OPEN_ALBUM, { detail }))
}
