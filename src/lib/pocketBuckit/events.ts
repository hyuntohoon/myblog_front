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
