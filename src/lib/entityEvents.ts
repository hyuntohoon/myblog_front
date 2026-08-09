// ARCH-entity-interaction-unify Step 1 — the public-safe entity-open event.
//
// `openAlbum(detail)` dispatches a window CustomEvent that the app-wide album
// overlay (components/album/AlbumOverlay, mounted in layout.astro) listens for.
// ANY surface — public review page, home tiles, search — opens the read-only
// album window by calling this, with no knowledge of the overlay or of member
// types. The member-context writable modal (memo/edit) is a SEPARATE path
// (SelfDashboard's openDetail(DetailTarget)); this event is inherently read-only, so
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
  /**
   * True when `albumId` is a display-only fallback (e.g. a Spotify id used
   * because a DB match wasn't found) — NOT a real catalog id. Callers that
   * still need a genuine DB `albumId` (playback, rating writes) must not fire
   * while this is set (id-namespace conflation found in
   * ARCH-entity-interaction-domain-audit item 9 review — releaseShared.tsx's
   * `dbId ?? spotify_album_id` fallback passing a foreign-namespace id).
   */
  unresolved?: boolean
}

/** Display fields allowed on a Spotify-only album fallback. */
export type UnresolvedAlbumDisplay = Omit<OpenAlbumDetail, 'albumId' | 'unresolved'>

/**
 * Build a display-only album target from a Spotify album id.
 *
 * Keeping `albumId` and `unresolved` out of `display` makes the foreign-id
 * namespace explicit and prevents callers from constructing a mismatched pair.
 */
export function openAlbumUnresolved(
  spotifyAlbumId: string,
  display: UnresolvedAlbumDisplay,
): OpenAlbumDetail {
  return {
    ...display,
    albumId: spotifyAlbumId,
    unresolved: true,
  }
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

// FEAT-album-review-authoring Step 1 — "my state for this album changed".
//
// The mark lives on two surfaces at once (RFC C6: the owner must be able to fix
// it from either, or they end up hand-moving albums again), and those surfaces
// are SEPARATE React roots — the app-wide album overlay in layout.astro and the
// bucket board island. Neither can hold the other's state, so the writer
// announces and every listener re-reads. Announce AFTER the server confirms:
// this event means "the stored state changed", not "someone clicked".
export interface AlbumStateChangedDetail {
  albumId: string
  /** The stored value after the write, so a listener can update without a fetch. */
  reviewCandidate: boolean
  /**
   * ARCH-bucket-album-modal-unification Step 1 — the stored 평가 rating after
   * the write (null when cleared), so the bucket board's tile score badge can
   * update live without a refetch. Undefined on a mark-only write (the field
   * genuinely wasn't touched, unlike null which means "cleared").
   */
  rating?: number | null
}

export const ENT_ALBUM_STATE_CHANGED = 'ent:album-state-changed'

/** Announce a confirmed change to my state for an album. No-op server-side. */
export function notifyAlbumStateChanged(detail: AlbumStateChangedDetail): void {
  if (typeof window === 'undefined')
    return
  window.dispatchEvent(new CustomEvent<AlbumStateChangedDetail>(ENT_ALBUM_STATE_CHANGED, { detail }))
}

// FEAT-playback-bucket-player Step 6/6b follow-up — the playback panel's 가사
// entry is a site-wide island (`PocketBuckit`, layout-mounted) but the live
// `LyricsViewer` overlay only exists inside `SelfDashboard` (member-dashboard
// local, per the RFC's "two React roots, no shared context" architecture).
// This is the "app-wide event like albums" the panel's own NOOP comment named
// as the fix: same shape as `openAlbum`/`ENT_OPEN_ALBUM`. A listener only
// exists where `SelfDashboard` is mounted (the member dashboard), so opening
// it from elsewhere is a deliberate, honest no-op rather than a crash.
export interface OpenLiveLyricsDetail {
  /** Spotify track id — `GET /api/lyrics/{id}` takes this, not a DB id. */
  trackId: string
  progressMs: number | null
  /** `performance.now()`-timeline instant `progressMs` was measured at. */
  progressAtMs: number | null
  durationMs: number | null
  albumCoverUrl: string | null
  track: string | null
  artist: string | null
  artists: Array<{ id: string, name: string }>
}

export const ENT_OPEN_LIVE_LYRICS = 'ent:open-live-lyrics'

/** Open the live lyrics viewer for whatever is currently playing. No-op server-side. */
export function openLiveLyrics(detail: OpenLiveLyricsDetail): void {
  if (typeof window === 'undefined')
    return
  window.dispatchEvent(new CustomEvent<OpenLiveLyricsDetail>(ENT_OPEN_LIVE_LYRICS, { detail }))
}
