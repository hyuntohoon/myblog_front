// FEAT-artist-page — public artist hub island for /artist/[id].
// "한 아티스트를 보는 비평적 렌즈": identity masthead → 평론한 앨범 (the site's
// reviews, build-time overlay) → 디스코그래피 + 주요 트랙 (live music API).
//
// Honesty rules (load-bearing): albums are the only rated unit — NO artist score,
// NO similar artists, NO aggregation. followers/popularity are a tiny footnote,
// never a hero metric. Numeric rating is never shown (stars only, owner decision).
import { useEffect, useState } from 'react'
import type { ArtistReviewCard } from '../../lib/artistReviews'
import type { AlbumListItem, ArtistHero, TopTrackItem } from '../../scripts/write/artistApi'
import { fetchArtistAlbums, fetchArtistHero, fetchArtistTopTracks } from '../../scripts/write/artistApi'
import { Cover, SectionTitle, Stars } from '../home/ui'

interface Props {
	artistId: string
	/** Build-time name (prebuilt shell shows it before the island loads). */
	name: string
	/** Reviewed-album overlay built from the content collection (build time). */
	reviews: ArtistReviewCard[]
	/** Album ids that have a review — excluded from the dimmed catalog. */
	reviewedAlbumIds: string[]
}

function fmtFollowers(n: number | null | undefined): string | null {
	if (n == null)
		return null
	if (n >= 1_000_000)
		return `${(n / 1_000_000).toFixed(1)}M`
	if (n >= 1_000)
		return `${(n / 1_000).toFixed(1)}K`
	return String(n)
}

function LetterTile({ label }: { label: string }) {
	const ch = (label.trim()[0] ?? '?').toUpperCase()
	return <span className="art-letter" aria-hidden="true">{ch}</span>
}

export default function ArtistHub({ artistId, name, reviews, reviewedAlbumIds }: Props) {
	const [hero, setHero] = useState<ArtistHero | null>(null)
	const [albums, setAlbums] = useState<AlbumListItem[]>([])
	const [topTracks, setTopTracks] = useState<TopTrackItem[]>([])
	const [status, setStatus] = useState<'loading' | 'ready' | 'notfound'>('loading')

	useEffect(() => {
		let alive = true
		setStatus('loading')
		Promise.all([
			fetchArtistHero(artistId),
			fetchArtistAlbums(artistId, 48),
			fetchArtistTopTracks(artistId, 8),
		]).then(([heroRes, albumList, tracks]) => {
			if (!alive)
				return
			if (!heroRes.ok) {
				setStatus('notfound')
				return
			}
			setHero(heroRes.hero)
			setAlbums(albumList)
			setTopTracks(tracks)
			setStatus('ready')
		})
		return () => {
			alive = false
		}
	}, [artistId])

	if (status === 'notfound') {
		return (
			<div className="art-pending">
				<p className="art-cov-empty-lead">아티스트를 찾을 수 없습니다.</p>
				<p className="art-cov-empty-sub">{name}</p>
			</div>
		)
	}

	const displayName = hero?.name ?? name
	const genres = hero?.genres ?? []
	const reviewed = new Set(reviewedAlbumIds)
	// catalog = albums NOT yet reviewed (the reviewed ones live in the section above)
	const catalog = albums.filter(a => !a.id || !reviewed.has(a.id))
	const hasReviews = reviews.length > 0

	return (
		<div className="art-root">
			{/* ── 1. identity masthead ───────────────────────────────── */}
			<header className="art-id-grid rise">
				<div className="art-id-photo">
					{hero?.photo_url ?
						<img src={hero.photo_url} alt={displayName} /> :
						<LetterTile label={displayName} />}
				</div>
				<div className="art-id-info">
					<div className="art-id-kicker meta">아티스트</div>
					<h1 className="art-id-name serif">{displayName}</h1>
					{genres.length > 0 && (
						<div className="art-id-genres">
							{genres.map(g => <span key={g} className="art-id-gchip">{g}</span>)}
						</div>
					)}
					{hero && (
						<div className="art-id-counts">
							<span>
								{hero.album_count}
								{' 앨범'}
							</span>
							<span className="art-id-dot">·</span>
							<span>
								{hero.track_count}
								{' 트랙'}
							</span>
						</div>
					)}
					<div className="art-id-foot">
						{hero?.spotify_url && (
							<a className="art-id-spotify" href={hero.spotify_url} target="_blank" rel="noreferrer">
								Spotify ↗
							</a>
						)}
						{hero?.followers != null && (
							<>
								<span className="art-id-dot">·</span>
								<span>
									{'팔로워 '}
									{fmtFollowers(hero.followers)}
								</span>
							</>
						)}
						{hero?.popularity != null && (
							<>
								<span className="art-id-dot">·</span>
								<span>
									{'인기도 '}
									{hero.popularity}
								</span>
							</>
						)}
					</div>
				</div>
			</header>

			{/* ── 2. 평론한 앨범 (the critic's lens) ───────────────────── */}
			{hasReviews ?
				(
					<section className="art-block">
						<SectionTitle kicker="THE CRITIC’S LENS" title="평론한 앨범" />
						<div className="art-cov-grid">
							{reviews.map(r => (
								<a key={r.slug} className="art-rev-card" href={`/review/${r.slug}/`}>
									<div className="art-rev-cover">
										<Cover label={r.album} src={r.cover} square />
										{r.bestNew && <span className="art-rev-bnm">베스트 뉴 뮤직</span>}
									</div>
									<div className="art-rev-body">
										<Stars rating={r.rating} />
										<h3 className="art-rev-title">{r.album}</h3>
										<div className="art-rev-meta meta">
											{r.year ?? ''}
											{r.genre ? ` · ${r.genre}` : ''}
										</div>
										{r.pull && <p className="art-rev-pull">{r.pull}</p>}
									</div>
								</a>
							))}
						</div>
					</section>
				) :
				(
					<section className="art-block art-cov-empty">
						<p className="art-cov-empty-lead">아직 이 아티스트의 평론이 없습니다.</p>
						<p className="art-cov-empty-sub">
							{displayName}
							의 디스코그래피를 아래에서 살펴보세요.
						</p>
					</section>
				)}

			{/* ── 3. 디스코그래피 + 주요 트랙 ─────────────────────────── */}
			<div className="art-lower-grid art-block">
				<div className="art-disco-block">
					<SectionTitle
						kicker={hasReviews ? 'Catalog · not yet reviewed' : 'Catalog'}
						title="디스코그래피"
					/>
					{status === 'loading' ?
						<div className="art-pending">불러오는 중…</div> :
						catalog.length > 0 ?
							(
								<div className={`art-disco-grid${hasReviews ? '' : ' is-foreground'}`}>
									{catalog.map(al => (
										<div key={al.id ?? al.title} className="art-disco-item">
											<div className="art-disco-cover">
												<Cover label={al.title} src={al.cover_url} square />
											</div>
											<div className="art-disco-title">{al.title}</div>
											<div className="art-disco-meta">
												<span>
													{al.release_date ? al.release_date.slice(0, 4) : ''}
													{al.album_type ? ` · ${al.album_type}` : ''}
												</span>
												<span className="art-disco-unrated">아직 평론 없음</span>
											</div>
										</div>
									))}
								</div>
							) :
							<p className="art-cov-empty-sub">등록된 앨범이 없습니다.</p>}
				</div>

				{topTracks.length > 0 && (
					<aside className="art-tt-wrap">
						<SectionTitle title="주요 트랙" />
						<ol className="art-tt-list">
							{topTracks.map((tk, i) => (
								<li key={tk.id} className="art-tt-row">
									<span className="art-tt-rank">{String(i + 1).padStart(2, '0')}</span>
									<span className="art-tt-name">{tk.title}</span>
								</li>
							))}
						</ol>
					</aside>
				)}
			</div>
		</div>
	)
}
