import type { AlbumCardCapabilities, AlbumCardProps } from '@components/shared/AlbumCard'
import { AlbumCard } from '@components/shared/AlbumCard'
import { AddToBucketMenu } from '@components/member/pocket/AddToBucketMenu'

type CatalogNavigationCapabilities = Pick<AlbumCardCapabilities, 'open' | 'play' | 'artistOpen'>

export interface CatalogAlbumCardAdapterProps extends Omit<AlbumCardProps, 'capabilities'> {
	capabilities?: CatalogNavigationCapabilities
}

/**
 * Shared composition for any catalog-browsing surface whose album cards can be
 * copied into Pocket — Home rails, Review Candidates, and the /search results
 * grid. It is deliberately not Home-scoped: the rule it encodes ("a catalog id
 * is the only write-safe album identity") is a product invariant, not a
 * surface preference. Surfaces that own bucket-item state (BucketBoard) or a
 * document (ReviewCard) compose AlbumCard directly instead.
 *
 * A catalog id grants both halves of the interaction contract: native desktop
 * copy-drag and the AddToBucketMenu tap/keyboard path. Spotify-only cards
 * remain display-only and say why; a foreign id is never projected into a
 * catalog write or drag payload.
 */
export function CatalogAlbumCardAdapter({ data, capabilities = {}, secondaryLine, ...props }: CatalogAlbumCardAdapterProps) {
	if (!data.catalogAlbumId) {
		const reason = data.spotifyAlbumId ? '카탈로그 등록 후 담기 가능' : '카탈로그 ID 없음 · 담기 불가'
		return (
			<AlbumCard
				{...props}
				data={data}
				capabilities={capabilities}
				secondaryLine={(
					<>
						{secondaryLine}
						<span className="album-card__catalog-note mono">{reason}</span>
					</>
				)}
			/>
		)
	}

	const albumId = data.catalogAlbumId
	return (
		<AddToBucketMenu
			item={{ itemType: 'album', albumId, title: data.title }}
			render={({ open }) => (
				<AlbumCard
					{...props}
					data={data}
					capabilities={{
						...capabilities,
						add: {
							fire: open,
							label: `${data.title} 버킷에 담기`,
							content: '＋',
							className: 'catalog-album-card__add',
						},
						drag: {
							ref: { entity: 'album', albumId, title: data.title },
							origin: { kind: 'external', copies: true },
						},
					}}
					secondaryLine={secondaryLine}
				/>
			)}
		/>
	)
}
