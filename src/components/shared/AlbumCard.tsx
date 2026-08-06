// ARCH-album-card-contract-and-composition Stage 2 — the canonical album-card
// contract. This component is deliberately a no-op until Stage 3 implements
// the shared presentation; no live surface imports it yet.
import type { ReactNode } from 'react'
import type { DragPayload } from '@lib/entityDrag'

/** Display-only album identity. Bucket-item and surface state never belong here. */
export interface AlbumCardData {
	/** Catalog DB id. Null is a first-class unresolved state. */
	catalogAlbumId: string | null
	/** Display/navigation fallback, present only while catalogAlbumId is null. */
	spotifyAlbumId: string | null
	title: string
	artist: string | null
	artistId: string | null
	cover: string | null
	year: number | null
	/** Loading is distinct from a loaded album that has no cover. */
	loading?: boolean
}

interface AlbumCardCapabilitySlots {
	/** Whole-card album open. Omit for a display-only card. */
	open?: () => void
	play?: () => void
	artistOpen?: () => void
}

/**
 * Declared album-card actions. A missing capability renders no affordance.
 *
 * Drag is structurally paired with `add`, the tap/action-sheet path for the
 * same operation. This makes the touch fallback a type invariant instead of
 * a call-site convention (ARCH-entity-interaction-v2 Rule #14).
 */
export type AlbumCardCapabilities = AlbumCardCapabilitySlots & (
	{ add?: () => void, drag?: never } |
	{ add: () => void, drag: DragPayload }
)

export interface AlbumCardProps {
	data: AlbumCardData
	capabilities?: AlbumCardCapabilities
	layout: 'grid' | 'row'
	badge?: ReactNode
	secondaryLine?: ReactNode
}

/** Stage 2 compatibility shim. Stage 3 replaces this null render with the shared UI. */
export function AlbumCard(_props: AlbumCardProps) {
	return null
}
