// Track-card presentation primitive — modeled on AlbumCard's contract
// (display data + declared capabilities; the card owns presentation only, an
// adapter closes over identity/write concerns). No drag/add capability yet:
// today's only caller (개요 최근 재생 트랙) has no catalog track id to write
// with, only a Spotify play-history row, so there is nothing safe to drag or
// add. Add those slots back the way AlbumCard did (paired, type-enforced)
// once a real caller needs them.
import type { ReactNode } from 'react'
import '@styles/track-card.css'

/** Display-only track fields. Bucket-item and playback state never belong here. */
interface TrackCardDisplayData {
	title: string
	artist: string | null
	album: string | null
	cover: string | null
	/** Loading is distinct from a loaded track that has no cover. */
	loading?: boolean
}

export type TrackCardData = TrackCardDisplayData

export type TrackCardAction = (() => void) | {
	fire: () => void
	label: string
	content: ReactNode
	className?: string
}

export type TrackCardOpenAction = (() => void) | {
	fire: () => void
	label: string
}

export interface TrackCardCapabilities {
	/** Whole-card track open. Omit for a display-only card. */
	open?: TrackCardOpenAction
	/**
	 * "가사" affordance. The card doesn't know whether lyrics exist — same as
	 * LikedBoard's per-row lyrics button, the viewer resolves that on open.
	 */
	lyrics?: TrackCardAction
}

export interface TrackCardProps {
	data: TrackCardData
	capabilities?: TrackCardCapabilities
	layout: 'grid' | 'row'
	/** Semantic title element; visual typography remains canonical. */
	titleAs?: 'span' | 'h1' | 'h2' | 'h3'
	badge?: ReactNode
	eyebrow?: ReactNode
	secondaryLine?: ReactNode
}

function CoverArt({ title, cover, loading, badge, actions }: {
	title: string
	cover: string | null
	loading: boolean
	badge?: ReactNode
	actions?: ReactNode
}) {
	return (
		<div
			className={`track-card__cover cover${loading ? ' track-card__cover--loading' : ''}`}
			data-cover-state={loading ? 'loading' : cover ? 'image' : 'fallback'}
		>
			{loading ?
				<span className="track-card__skeleton-cover" aria-hidden="true" /> :
				cover ?
					<img src={cover} alt={title} loading="lazy" decoding="async" /> :
					<span className="cover-ph" aria-hidden="true">{(title || '?').slice(0, 2).toUpperCase()}</span>}
			{!loading && badge != null && <span className="track-card__badge">{badge}</span>}
			{actions}
		</div>
	)
}

function actionProps(action: TrackCardAction, defaults: { label: string, content: ReactNode }) {
	if (typeof action === 'function')
		return { fire: action, label: defaults.label, content: defaults.content, className: '' }
	return action
}

function openActionProps(action: TrackCardOpenAction, defaultLabel: string) {
	if (typeof action === 'function')
		return { fire: action, label: defaultLabel }
	return action
}

function Actions({ title, lyrics }: { title: string, lyrics?: TrackCardAction }) {
	if (!lyrics)
		return null
	const lyricsAction = actionProps(lyrics, { label: `${title} 가사 보기`, content: '가사' })
	return (
		<span className="track-card__actions">
			<button type="button" className={`btn mono track-card__action ${lyricsAction.className ?? ''}`.trim()} onClick={lyricsAction.fire} aria-label={lyricsAction.label}>{lyricsAction.content}</button>
		</span>
	)
}

function Meta({ data, eyebrow, secondaryLine, titleAs: Title }: {
	data: TrackCardData
	eyebrow?: ReactNode
	secondaryLine?: ReactNode
	titleAs: NonNullable<TrackCardProps['titleAs']>
}) {
	if (data.loading) {
		return (
			<div className="track-card__meta" aria-hidden="true">
				<span className="track-card__skeleton-line track-card__skeleton-line--title" />
				<span className="track-card__skeleton-line track-card__skeleton-line--artist" />
			</div>
		)
	}

	return (
		<div className="track-card__meta">
			{eyebrow != null && <span className="track-card__eyebrow">{eyebrow}</span>}
			<Title className="track-card__title serif">{data.title}</Title>
			{(data.artist || data.album) && (
				<span className="track-card__byline mono">
					{data.artist && <span className="track-card__artist">{data.artist}</span>}
					{data.artist && data.album && <span aria-hidden="true"> · </span>}
					{data.album && <span className="track-card__album">{data.album}</span>}
				</span>
			)}
			{secondaryLine != null && <div className="track-card__secondary">{secondaryLine}</div>}
		</div>
	)
}

/**
 * Shared track presentation. It deliberately knows nothing about bucket item
 * ids or playback state — adapters close over those concerns in the
 * callbacks they inject, same split as AlbumCard.
 */
export function TrackCard({ data, capabilities = {}, layout, titleAs = 'span', badge, eyebrow, secondaryLine }: TrackCardProps) {
	const loading = data.loading === true
	const openAction = !loading && capabilities.open ?
		openActionProps(capabilities.open, `${data.title}${data.artist ? ` — ${data.artist}` : ''} 트랙 정보`) :
		null
	const actions = !loading ? <Actions title={data.title} lyrics={capabilities.lyrics} /> : null

	return (
		<article
			className={`track-card track-card--${layout}`}
			data-track-card-layout={layout}
			aria-busy={loading || undefined}
			aria-label={loading ? '트랙 불러오는 중' : undefined}
		>
			{openAction && (
				<button
					type="button"
					className="track-card__open-hit"
					onClick={openAction.fire}
					aria-label={openAction.label}
				/>
			)}
			<CoverArt title={data.title} cover={data.cover} loading={loading} badge={badge} actions={layout === 'grid' ? actions : null} />
			<Meta
				data={data}
				eyebrow={loading ? undefined : eyebrow}
				secondaryLine={loading ? undefined : secondaryLine}
				titleAs={titleAs}
			/>
			{layout === 'row' && actions}
		</article>
	)
}
