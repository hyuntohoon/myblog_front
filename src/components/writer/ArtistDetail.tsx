import type { AlbumListItem, ArtistHero, TopTrackItem } from '../../scripts/write/artistApi'

interface Props {
	hero: ArtistHero | null
	topTracks: TopTrackItem[]
	albums: AlbumListItem[]
	isPending: boolean
	loadFailed: boolean
	source: 'db' | 'spotify'
	onBack: () => void
	onPickTrack: (track: TopTrackItem) => void
	onPickAlbum: (album: AlbumListItem) => void
	onPickArtist: (hero: ArtistHero) => void
	onRetry: () => void
}

function durationFormat(sec: number | null | undefined): string | null {
	if (sec == null)
		return null
	const m = Math.floor(sec / 60)
	const s = sec % 60
	return `${m}:${s.toString().padStart(2, '0')}`
}

function followersFormat(n: number | null | undefined): string | null {
	if (n == null)
		return null
	if (n >= 1_000_000)
		return `${(n / 1_000_000).toFixed(1)}M`
	if (n >= 1_000)
		return `${(n / 1_000).toFixed(1)}K`
	return String(n)
}

export default function ArtistDetail({
	hero,
topTracks,
albums,
isPending,
loadFailed,
source,
	onBack,
onPickTrack,
onPickAlbum,
onPickArtist,
onRetry,
}: Props) {
	const isSpotify = source === 'spotify'

	return (
		<div className="art-detail">
			<div className="art-detail-bar">
				<button type="button" className="art-back" onClick={onBack}>← 검색 결과</button>
				{isSpotify && (
					<span className="art-src-tag">
						<svg viewBox="0 0 24 24" width="12" height="12">
							<circle cx="12" cy="12" r="12" fill="#1DB954" />
							<path
								d="M6.5 9.2c3-.9 7.7-.8 10.6.9.4.3.5.8.3 1.2-.3.4-.8.5-1.2.3-2.5-1.5-6.7-1.6-9.3-.8-.5.2-1-.1-1.1-.6-.1-.4.2-.9.7-1zm.4 2.7c2.6-.8 6.4-.7 8.9.8.4.2.5.7.3 1-.2.4-.7.5-1 .3-2.1-1.3-5.5-1.4-7.6-.7-.4.1-.8-.1-.9-.4-.2-.4 0-.8.3-1zm.5 2.6c2.1-.6 4.7-.5 6.8.8.3.2.4.5.2.8-.2.3-.5.4-.8.2-1.8-1.1-4.1-1.2-5.9-.6-.3.1-.7-.1-.7-.4-.1-.3.1-.7.4-.8z"
								fill="#fff"
							/>
						</svg>
						Spotify
					</span>
				)}
			</div>

			{isPending && (
				<div className="art-pending">
					<span className="art-pending-spinner" aria-hidden="true"></span>
					<span>Spotify에서 가져오는 중…</span>
				</div>
			)}

			{loadFailed && !isPending && (
				<>
					<div className="art-pending">데이터 로드 실패</div>
					<button type="button" className="art-retry" onClick={onRetry}>다시 시도</button>
				</>
			)}

			{hero && !isPending && (
				<>
					<div className="art-hero">
						<div className="art-hero-cover">
							{hero.photo_url ?
								<img src={hero.photo_url} alt={hero.name} /> :
								<span className="cover-fallback">{hero.name[0] || '?'}</span>}
						</div>
						<div className="art-hero-info">
							<div className="art-hero-type">아티스트</div>
							<div className="art-hero-name">{hero.name}</div>
							<div className="art-hero-meta">
								{(hero.genres || []).join(' · ') || '미분류'}
								{hero.followers != null && (
									<>
{' · '}
팔로워
{' '}
{followersFormat(hero.followers)}
									</>
								)}
							</div>
							<button
								type="button"
								className="art-review-self"
								onClick={() => onPickArtist(hero)}
							>
								이 아티스트를 리뷰 →
							</button>
						</div>
					</div>

					{topTracks.length > 0 && (
						<div className="art-section">
							<div className="art-section-h">인기 트랙</div>
							<ol className="art-tracks">
								{topTracks.map((tk, i) => (
									<li key={tk.id} style={{ display: 'contents' }}>
										<button
											type="button"
											className="art-track"
											onClick={() => onPickTrack(tk)}
										>
											<span className="art-track-n">{i + 1}</span>
											<span className="art-track-cover">
												{tk.cover_url ?
													<img src={tk.cover_url} alt={tk.title} /> :
													null}
											</span>
											<div className="art-track-info">
												<div className="art-track-name">{tk.title}</div>
												<div className="art-track-album">{tk.album_title || ''}</div>
											</div>
											<span className="art-track-dur">{durationFormat(tk.duration_sec) || ''}</span>
											<span className="art-track-pick">선택 +</span>
										</button>
									</li>
								))}
							</ol>
						</div>
					)}

					{albums.length > 0 && (
						<div className="art-section">
							<div className="art-section-h">디스코그래피</div>
							<div className="art-albums">
								{albums.map(al => (
									<button
										key={al.id}
										type="button"
										className="art-album"
										onClick={() => onPickAlbum(al)}
									>
										<div className="art-album-cover">
											{al.cover_url ?
												<img src={al.cover_url} alt={al.title} /> :
												<span className="cover-fallback">{al.title[0] || '?'}</span>}
											<span className="art-album-pick">선택 +</span>
										</div>
										<div className="art-album-name">{al.title}</div>
										<div className="art-album-meta">
											{al.release_date ? al.release_date.slice(0, 4) : ''}
											{al.album_type ? ` · ${al.album_type}` : ''}
											{al.total_tracks ? ` · ${al.total_tracks}곡` : ''}
										</div>
									</button>
								))}
							</div>
						</div>
					)}
				</>
			)}
		</div>
	)
}
