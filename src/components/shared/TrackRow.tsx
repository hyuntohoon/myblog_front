// ARCH-entity-interaction-contract Step 2 — the shared track row for React
// member-island surfaces. THE contract point for track-row actions: a future
// track action (or a new consumer surface) is wired here once instead of
// hunting per-surface hand-rolled rows. Registered in
// myblog-workspace/docs/frontend/component-map.md (sibling repo — "Track-click behavior").
//
// Scope (deliberate):
//   · Consumers are React islands only — the vanilla review-page tracklist
//     (`scripts/albumDetail.client.ts`) is EXCLUDED (RFC non-goal: no vanilla →
//     React migration; revival trigger = a track action that must ship on the
//     public review page).
//   · Layout is a slot model (index / identity / cells / trailing) because the
//     two consumers differ (flex list in the album modal vs sortable grid in
//     LikedBoard); the ACTIONS — what a row can do — are what this component
//     unifies, matching the `search/atoms.tsx` `RowAction` idea promoted to
//     compound actions.
//
// ARCH-entity-interaction-v2 E4/Step 5 — `play`/`add`/`drag` are OPEN (owner
// scope grant, RFC OQ2/OQ3 both resolved 2026-08-04): a consumer may declare
// any of them, none are wired to a surface by this change alone. `drag`
// dispatches the SAME board⇄tray bridge (`@lib/pocketBuckit/events`) every
// existing drag source uses, so a future grant is a real, working drop
// source with no further plumbing — see `TrackRowActions.drag`.
//
// The former memo-trow TWIN is adopted (Step 5): `member/AlbumDetail.tsx`
// MemoWindow now renders this component via `actions.openLyrics` (the
// whole-row lyrics target E4 asked for), so a track-row change here reaches
// every consumer, memo window included.
import type { CSSProperties, ReactNode } from 'react'
import { useState } from 'react'
import type { DragPayload } from '@lib/entityDrag'
import { PB_BOARD_DND_END_EVENT, PB_BOARD_DND_START_EVENT, PB_DND_END_EVENT, PB_DND_START_EVENT } from '@lib/pocketBuckit/events'

export interface TrackRowOpen {
	/** The identity cell's click behavior (open the album, or — via `openLyrics` — view lyrics). */
	fire: () => void
	disabled?: boolean
	/** Tooltip on the enabled identity button (e.g. 작품 상세, 가사 보기). */
	title?: string
	/** Tooltip explaining a disabled open (e.g. 카탈로그 미등록). */
	disabledTitle?: string
}

/**
 * The declared action set. Provide only what the surface actually grants:
 * `lyrics` opens the dashboard lyrics viewer mount non-live (`{trackId,
 * progressMs: null, live: false}`) — per RFC OQ1 it is ALWAYS shown when
 * granted (no per-row availability probe; the viewer's availability empty
 * state handles misses). Omit `lyrics` when the track has no Spotify id
 * (nothing to query) or the surface has no reachable viewer mount.
 */
export interface TrackRowActions {
	lyrics?: () => void
	/** Identity cell → open the track's album. Mutually exclusive with `openLyrics`. */
	open?: TrackRowOpen
	/**
	 * View lyrics instead of opening the album — memo window's shape. When it
	 * is the only control the WHOLE row (`no` + identity + `cells`) becomes the
	 * button (`role="button"` + keyboard support). When trailing controls are
	 * granted, lyrics moves to the identity cell so native buttons never nest.
	 * Omit entirely for a track with nothing to open — that renders a plain,
	 * non-interactive row, same as omitting `open`. Mutually exclusive with
	 * `open` — a row grants one identity action, never both.
	 */
	openLyrics?: TrackRowOpen
	/** Trailing ▶ button. No queue/playback logic here — the surface owns it. */
	play?: () => void
	/** Trailing ＋ (담기) button. No bucket logic here — the surface owns it. */
	add?: () => void
	/**
	 * Native HTML5 drag source (E2/E5). Grant only with a stable id and a
	 * browsing context (OQ3) — omit for guest reads, command rows, and
	 * selection-mode rows. The payload is dispatched on both the tray→board
	 * and board→tray bridges so a granted row is droppable on either target.
	 */
	drag?: DragPayload
}

export function TrackRow({ as = 'div', no, cover, title, titleSuffix, sub, cells, trailing, actions = {}, gridTemplate, className, style }: {
	/** Row element tag — `li` inside the album modal's `<ol>`, `div` in grids. */
	as?: 'li' | 'div'
	/** Index cell content (track number / list position). */
	no?: ReactNode
	/** Optional leading cover node (surface-owned visual, e.g. LkCover). */
	cover?: ReactNode
	title: string
	/** Inline suffix on the title line (e.g. feat. credits). */
	titleSuffix?: ReactNode
	/** Second identity line (artist). */
	sub?: string
	/** Surface-specific middle cells (grid columns / trailing meta spans). */
	cells?: ReactNode
	/** Surface-specific trailing node (e.g. LikedBoard's ⋯ menu). */
	trailing?: ReactNode
	actions?: TrackRowActions
	/** Grid layout (must reserve columns for cells + granted actions + trailing); omit for a flex row. */
	gridTemplate?: string
	className?: string
	style?: CSSProperties
}) {
	const Tag = as
	const [isDragging, setIsDragging] = useState(false)
	const layout: CSSProperties = gridTemplate ?
		{ display: 'grid', gridTemplateColumns: gridTemplate, gap: 14, alignItems: 'center' } :
		{ display: 'flex', alignItems: 'center', gap: 12 }

	const identityInner = (
		<>
			{cover}
			<span style={{ minWidth: 0, flex: 1 }}>
				<span className="serif" style={{ display: 'block', fontSize: 15.5, fontWeight: 500, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--color-text)' }}>
					{title}
					{titleSuffix}
				</span>
				{sub && <span className="sans" style={{ display: 'block', fontSize: 11.5, color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{sub}</span>}
			</span>
		</>
	)

	// `open` wraps ONLY the identity cell (cover + text) in a button — one tab
	// stop, not two separate cover/title buttons. `openLyrics` (memo-trow's
	// shape) makes the WHOLE ROW the target only while it is the row's sole
	// control. Once play/add/another trailing control is granted, lyrics moves
	// to the identity cell so no interactive control is nested inside a row
	// with role=button. `open` still wins if both identity actions are supplied.
	const hasTrailingControl = Boolean(actions.lyrics || actions.play || actions.add || trailing)
	const wholeRowLyrics = !actions.open && actions.openLyrics && !hasTrailingControl ? actions.openLyrics : undefined
	const identityAction = actions.open ?? (!actions.open && actions.openLyrics && hasTrailingControl ? actions.openLyrics : undefined)
	const identity = identityAction ?
		(
			<button
				type="button"
				onClick={identityAction.fire}
				disabled={identityAction.disabled}
				title={identityAction.disabled ? identityAction.disabledTitle : identityAction.title}
				style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, textAlign: 'left', padding: 0, border: 'none', background: 'none', cursor: identityAction.disabled ? 'default' : 'pointer' }}
			>
				{identityInner}
			</button>
		) :
		<span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: gridTemplate ? undefined : 1 }}>{identityInner}</span>

	const trailingBtnStyle: CSSProperties = { padding: '3px 9px', fontSize: 10.5, letterSpacing: '.06em', borderRadius: 3, whiteSpace: 'nowrap', flex: '0 0 auto', justifySelf: gridTemplate ? 'end' : undefined }

	return (
		<Tag
			className={className}
			style={{
				...layout,
				...style,
				...(wholeRowLyrics && { cursor: 'pointer' }),
				...(actions.drag && { cursor: isDragging ? 'grabbing' : 'grab' }),
				// Source-card dim while the drag is in flight — opacity only, same
				// invariant as AlbumCard's `[data-dragging]` (album-card.css) and the
				// board/tray drop targets (widgets.css, pocket.css): no reflow.
				...(isDragging && { opacity: 0.45, transition: 'opacity 120ms ease' }),
			}}
			{...(wholeRowLyrics ?
				{
					role: 'button',
					tabIndex: 0,
					title: wholeRowLyrics.title,
					onClick: wholeRowLyrics.fire,
					onKeyDown: (e: React.KeyboardEvent) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault()
							wholeRowLyrics.fire()
						}
					},
				} :
				{})}
			{...(actions.drag ?
				{
					draggable: true,
					onDragStart: (e: React.DragEvent<HTMLElement>) => {
						e.dataTransfer.effectAllowed = 'copy'
						setIsDragging(true)
						window.dispatchEvent(new CustomEvent<DragPayload>(PB_DND_START_EVENT, { detail: actions.drag! }))
						window.dispatchEvent(new CustomEvent<DragPayload>(PB_BOARD_DND_START_EVENT, { detail: actions.drag! }))
					},
					onDragEnd: () => {
						setIsDragging(false)
						window.dispatchEvent(new CustomEvent(PB_DND_END_EVENT))
						window.dispatchEvent(new CustomEvent(PB_BOARD_DND_END_EVENT))
					},
				} :
				{})}
		>
			{no != null && <span className="mono" style={{ fontSize: 11.5, color: 'var(--color-faded)', textAlign: gridTemplate ? 'center' : 'right', fontVariantNumeric: 'tabular-nums', flex: gridTemplate ? undefined : '0 0 auto', width: gridTemplate ? undefined : 22 }}>{no}</span>}
			{identity}
			{cells}
			{actions.lyrics && (
				<button
					type="button"
					className="btn mono"
					onClick={(event) => {
						event.stopPropagation()
						actions.lyrics?.()
					}}
					onKeyDown={event => event.stopPropagation()}
					aria-label={`${title} 가사 보기`}
					style={trailingBtnStyle}
				>
					가사
				</button>
			)}
			{actions.play && (
				<button
					type="button"
					className="btn mono"
					onClick={(event) => {
						event.stopPropagation()
						actions.play?.()
					}}
					onKeyDown={event => event.stopPropagation()}
					aria-label={`${title} 재생`}
					style={trailingBtnStyle}
				>
					▶
				</button>
			)}
			{actions.add && (
				<button
					type="button"
					className="btn mono"
					onClick={(event) => {
						event.stopPropagation()
						actions.add?.()
					}}
					onKeyDown={event => event.stopPropagation()}
					aria-label={`${title} 담기`}
					style={trailingBtnStyle}
				>
					＋
				</button>
			)}
			{trailing}
		</Tag>
	)
}
