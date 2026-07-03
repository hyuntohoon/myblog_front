// ARCH-entity-interaction-contract Step 2 — the shared track row for React
// member-island surfaces. THE contract point for track-row actions: a future
// track action (or a new consumer surface) is wired here once instead of
// hunting per-surface hand-rolled rows. Registered in
// docs/frontend/component-map.md ("Track-click behavior").
//
// Scope (deliberate):
//   · Consumers are React islands only — the vanilla review-page tracklist
//     (`scripts/albumDetail.client.ts`) is EXCLUDED (RFC non-goal: no vanilla →
//     React migration; revival trigger = a track action that must ship on the
//     public review page).
//   · `play` / `add` are reserved contract slots, not implemented: granting a
//     surface a NEW play/add affordance is a product decision (RFC OQ2), so a
//     consumer may only declare what it already has today + `lyrics`. When a
//     play/add grant is approved, implement the affordance here and every
//     consumer that declares it gets it.
//   · Layout is a slot model (index / identity / cells / trailing) because the
//     two consumers differ (flex list in the album modal vs sortable grid in
//     LikedBoard); the ACTIONS — what a row can do — are what this component
//     unifies, matching the `search/atoms.tsx` `RowAction` idea promoted to
//     compound actions.
import type { CSSProperties, ReactNode } from 'react'

export interface TrackRowOpen {
	/** Open detail for this track's album — the identity cell's click behavior. */
	fire: () => void
	disabled?: boolean
	/** Tooltip on the enabled identity button (e.g. 작품 상세). */
	title?: string
	/** Tooltip explaining a disabled open (e.g. 카탈로그 미등록). */
	disabledTitle?: string
}

/**
 * The declared action set. Provide only what the surface actually grants:
 * `lyrics` opens the ProfileApp lyrics viewer mount non-live (`{trackId,
 * progressMs: null, live: false}`) — per RFC OQ1 it is ALWAYS shown when
 * granted (no per-row availability probe; the viewer's availability empty
 * state handles misses). Omit `lyrics` when the track has no Spotify id
 * (nothing to query) or the surface has no reachable viewer mount.
 */
export interface TrackRowActions {
	lyrics?: () => void
	open?: TrackRowOpen
	// play?/add? — reserved (RFC OQ2); see the header comment before adding.
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

	// One button around the whole identity cell (cover + text) when `open` is
	// granted — one tab stop per row, not two separate cover/title buttons.
	const identity = actions.open ?
		(
			<button
				type="button"
				onClick={actions.open.fire}
				disabled={actions.open.disabled}
				title={actions.open.disabled ? actions.open.disabledTitle : actions.open.title}
				style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, textAlign: 'left', padding: 0, border: 'none', background: 'none', cursor: actions.open.disabled ? 'default' : 'pointer' }}
			>
				{identityInner}
			</button>
		) :
		<span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: gridTemplate ? undefined : 1 }}>{identityInner}</span>

	return (
		<Tag className={className} style={{ ...layout, ...style }}>
			{no != null && <span className="mono" style={{ fontSize: 11.5, color: 'var(--color-faded)', textAlign: gridTemplate ? 'center' : 'right', fontVariantNumeric: 'tabular-nums', flex: gridTemplate ? undefined : '0 0 auto', width: gridTemplate ? undefined : 22 }}>{no}</span>}
			{identity}
			{cells}
			{actions.lyrics && (
				<button
					type="button"
					className="btn mono"
					onClick={actions.lyrics}
					aria-label={`${title} 가사 보기`}
					style={{ padding: '3px 9px', fontSize: 10.5, letterSpacing: '.06em', borderRadius: 3, whiteSpace: 'nowrap', flex: '0 0 auto', justifySelf: gridTemplate ? 'end' : undefined }}
				>
					가사
				</button>
			)}
			{trailing}
		</Tag>
	)
}
