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

// ARCH-entity-interaction-unify Step 3 — a track opens the album window for its
// album (the album window is the canonical track destination in v1; play/add
// stay reserved). The read stack resolves only the DB album id, so a track with
// no `albumId` (Spotify-only hit) is non-navigable → no-op (RFC OQ4). Display
// identity (album title / artist / cover) seeds the overlay header immediately.
export interface OpenTrackAlbumDetail {
  /** DB album id of the track's album; null/absent ⇒ non-navigable (no-op). */
  albumId?: string | null
  albumTitle?: string | null
  artist?: string | null
  cover?: string | null
  year?: number | null
}

/** Open the album overlay for a track's album. No-op when the album id is null. */
export function openTrackAlbum(t: OpenTrackAlbumDetail): void {
  if (!t.albumId)
    return
  openAlbum({
    albumId: t.albumId,
    title: t.albumTitle ?? undefined,
    artist: t.artist ?? undefined,
    cover: t.cover,
    year: t.year,
  })
}
