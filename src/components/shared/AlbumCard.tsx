// ARCH-album-card-contract-and-composition Stage 3 — the canonical album-card
// contract + display primitive. Surface adapters provide display data and the
// capabilities they genuinely support; this component owns presentation only.
import type { ReactNode } from 'react'
import type { DragPayload } from '@lib/entityDrag'
import { artistHref } from '@lib/entityLinks'
import { PB_BOARD_DND_END_EVENT, PB_BOARD_DND_START_EVENT, PB_DND_END_EVENT, PB_DND_START_EVENT } from '@lib/pocketBuckit/events'
import '@styles/album-card.css'

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

function dragEffect(payload: DragPayload): DataTransfer['effectAllowed'] {
	if (payload.origin.kind === 'internal')
		return 'move'
	if (payload.origin.kind === 'library')
		return 'copyMove'
	return payload.origin.copies ? 'copy' : 'all'
}

function CoverArt({ title, cover, loading, badge }: {
	title: string
	cover: string | null
	loading: boolean
	badge?: ReactNode
}) {
	return (
		<div
			className={`album-card__cover cover${loading ? ' album-card__cover--loading' : ''}`}
			data-cover-state={loading ? 'loading' : cover ? 'image' : 'fallback'}
		>
			{loading ?
				<span className="album-card__skeleton-cover" aria-hidden="true" /> :
				cover ?
					<img src={cover} alt={title} loading="lazy" decoding="async" /> :
					<span className="cover-ph" aria-hidden="true">{(title || '?').slice(0, 2).toUpperCase()}</span>}
			{!loading && badge != null && <span className="album-card__badge">{badge}</span>}
		</div>
	)
}

function Meta({ data, artistOpen, secondaryLine }: {
	data: AlbumCardData
	artistOpen?: () => void
	secondaryLine?: ReactNode
}) {
	if (data.loading) {
		return (
		<div className="album-card__meta" aria-hidden="true">
			<span className="album-card__skeleton-line album-card__skeleton-line--title" />
			<span className="album-card__skeleton-line album-card__skeleton-line--artist" />
		</div>
		)
	}

	return (
		<div className="album-card__meta">
			<span className="album-card__title serif italic">{data.title}</span>
			{(data.artist || data.year != null) && (
				<span className="album-card__byline mono">
					{data.artist && (artistOpen && data.artistId ?
						(
							<a
								className="album-card__artist"
								href={artistHref(data.artistId)}
								onClick={(event) => {
								if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
									return
								event.preventDefault()
								artistOpen()
							}}
							>
								{data.artist}
							</a>
						) :
						<span className="album-card__artist-text">{data.artist}</span>)}
					{data.artist && data.year != null && <span aria-hidden="true"> · </span>}
					{data.year != null && <span className="album-card__year">{data.year}</span>}
				</span>
			)}
			{secondaryLine != null && <span className="album-card__secondary">{secondaryLine}</span>}
		</div>
	)
}

/**
 * Shared album presentation. It deliberately knows nothing about bucket item
 * ids, memo/editorial state, or routing; adapters close over those concerns in
 * the callbacks and drag payload they inject.
 */
export function AlbumCard({ data, capabilities = {}, layout, badge, secondaryLine }: AlbumCardProps) {
	const loading = data.loading === true
	const drag = loading ? undefined : capabilities.drag

	return (
		<article
			className={`album-card album-card--${layout}`}
			data-album-card-layout={layout}
			aria-busy={loading || undefined}
			aria-label={loading ? '앨범 불러오는 중' : undefined}
			{...(drag ?
				{
					draggable: true,
					onDragStart: (event: React.DragEvent<HTMLElement>) => {
						event.dataTransfer.effectAllowed = dragEffect(drag)
						window.dispatchEvent(new CustomEvent<DragPayload>(PB_DND_START_EVENT, { detail: drag }))
						window.dispatchEvent(new CustomEvent<DragPayload>(PB_BOARD_DND_START_EVENT, { detail: drag }))
					},
					onDragEnd: () => {
						window.dispatchEvent(new CustomEvent(PB_DND_END_EVENT))
						window.dispatchEvent(new CustomEvent(PB_BOARD_DND_END_EVENT))
					},
				} :
				{})}
		>
			{!loading && capabilities.open && (
				<button
					type="button"
					className="album-card__open-hit"
					onClick={capabilities.open}
					aria-label={`${data.title}${data.artist ? ` — ${data.artist}` : ''} 앨범 보기`}
				/>
			)}
			<CoverArt title={data.title} cover={data.cover} loading={loading} badge={badge} />
			<Meta
				data={data}
				artistOpen={!loading && data.artist ? capabilities.artistOpen : undefined}
				secondaryLine={loading ? undefined : secondaryLine}
			/>
			{!loading && (capabilities.play || capabilities.add) && (
				<span className="album-card__actions">
					{capabilities.play && (
						<button type="button" className="btn mono album-card__action" onClick={capabilities.play} aria-label={`${data.title} 재생`}>▶</button>
					)}
					{capabilities.add && (
						<button type="button" className="btn mono album-card__action" onClick={capabilities.add} aria-label={`${data.title} 담기`}>＋</button>
					)}
				</span>
			)}
		</article>
	)
}
