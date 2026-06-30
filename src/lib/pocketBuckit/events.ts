// Cross-island window-event bridge names for the My Buckit board ⇄ Pocket Buckit
// tray. The board (/profile ProfileApp island) and the tray (PocketBuckit island)
// are two independent React roots with NO shared context, so they communicate via
// window CustomEvents — the established convention (see ReviewTrackAdder's
// PB_ADD_TRACK_EVENT). Defining the names here once keeps the two .tsx bundles in
// sync without a typo-prone duplicated literal.

/** Board → tray: flip the tray open/closed (in-memory `open` state only). */
export const PB_TOGGLE_EVENT = 'pb:toggle'

/** Tray → board: the tray was collapsed (닫기) — clear any NEW drag markers. */
export const PB_CLOSED_EVENT = 'pb:closed'

/**
 * Tray → board: broadcast the tray's open state on every open transition so the
 * board (a separate island that can't read the tray's `open`) can mirror it for
 * `aria-expanded` on its 🪣 Pocket toggle. `detail.open` carries the new value.
 * Dispatched from a useEffect([open]) so EVERY close path (the tray 닫기 button
 * AND the board toggle's open→false) is observed — not just the 닫기 click.
 */
export const PB_OPEN_STATE_EVENT = 'pb:open-state'

/** detail shape for {@link PB_OPEN_STATE_EVENT}. */
export interface PbOpenStateDetail {
  open: boolean
}

/**
 * Tray → board (FEAT-my-buckit-artist Step 6 — Pocket-open DnD into visible buckets):
 * a native HTML5 drag started on a tray drawer item. The board's drop routing reads
 * its module-level `dnd` payload (never `dataTransfer` — which is also unreadable
 * during `dragover`, where the artist-only gate runs), and that var is local to the
 * board island. So the tray hands the payload over via this synchronous window event:
 * `dragstart` fires before any board `dragover`, so the board's listener has populated
 * `dnd` in time. {@link PB_DND_END_EVENT} (on `dragend`, success OR cancel) clears it.
 * The payload mirrors the board's own member-drag `DndItem` (BucketBoard `AlbumChip`
 * onDragStart) so the existing `canAcceptAlbumDrag` / `ops.*` routing is reused verbatim.
 */
export const PB_DND_START_EVENT = 'pb:dnd-start'

/** Tray → board: the tray-originated drag ended (drop or cancel) — clear the board `dnd`. */
export const PB_DND_END_EVENT = 'pb:dnd-end'

/** detail shape for {@link PB_DND_START_EVENT} — a tray drawer item being dragged. */
export interface PbDndStartDetail {
  itemId: string
  fromBucketId: string
  albumId: string | null
  trackId: string | null
  artistId: string | null
  srcItemType: string
}
