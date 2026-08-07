import type { AlbumCardCapabilities, AlbumCardProps } from '@components/shared/AlbumCard'
import { AlbumCard } from '@components/shared/AlbumCard'
import { AddToBucketMenu } from '@components/member/pocket/AddToBucketMenu'

type HomeNavigationCapabilities = Pick<AlbumCardCapabilities, 'open' | 'play' | 'artistOpen'>

export interface HomeAlbumCardAdapterProps extends Omit<AlbumCardProps, 'capabilities'> {
	capabilities?: HomeNavigationCapabilities
}

/**
 * Shared Home composition for album cards that can be copied into Pocket.
 *
 * A catalog id is the only write-safe album identity. It grants both halves of
 * the interaction contract: native desktop copy-drag and the AddToBucketMenu
 * tap/keyboard path. Spotify-only cards remain display-only and say why; a
 * foreign id is never projected into a catalog write or drag payload.
 */
export function HomeAlbumCardAdapter({ data, capabilities = {}, secondaryLine, ...props }: HomeAlbumCardAdapterProps) {
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
							className: 'home-album-card__add',
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
