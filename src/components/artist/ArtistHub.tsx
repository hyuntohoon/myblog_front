// FEAT-artist-page — public artist hub island for /artist/[id].
// "한 아티스트를 보는 비평적 렌즈": identity masthead → 평론한 앨범 (the site's
// reviews, build-time overlay) → 디스코그래피 + 주요 트랙 (live music API).
//
// Honesty rules (load-bearing): albums are the only rated unit — NO artist score,
// NO similar artists, NO aggregation. followers/popularity are a tiny footnote,
// never a hero metric. Numeric rating is never shown (stars only, owner decision).
import type { AlbumCardData } from '@components/shared/AlbumCard'
import type { ReactNode } from 'react'
import { Fragment, useEffect, useState } from 'react'
import type { ArtistReviewCard } from '../../lib/artistReviews'
import type { AlbumListItem, ArtistHero, TopTrackItem } from '../../scripts/write/artistApi'
import { fetchArtistAlbums, fetchArtistHero, fetchArtistTopTracks } from '../../scripts/write/artistApi'
import { openAlbum, openTrackAlbum, reviewHref } from '@lib/entityLinks'
import { genreMapHref } from '@lib/genres'
import { unresolvedAlbumCardData } from '@components/shared/AlbumCard'
import { CatalogAlbumCardAdapter } from '@components/shared/CatalogAlbumCardAdapter'
import { CoverImage } from '@components/shared/CoverImage'
import { SectionTitle, Stars } from '../home/ui'
import TrackArtistButton from './TrackArtistButton'

interface Props {
	artistId: string
	/** Build-time name (prebuilt shell shows it before the island loads). */
	name: string
	/** Reviewed-album overlay built from the content collection (build time). */
	reviews: ArtistReviewCard[]
	/** Album ids that have a review — excluded from the dimmed catalog. */
	reviewedAlbumIds: string[]
}

type CatalogSort = 'popular' | 'latest' | 'title'

const CATALOG_SORTS: { value: CatalogSort, label: string }[] = [
	{ value: 'popular', label: '인기순' },
	{ value: 'latest', label: '최신순' },
	{ value: 'title', label: '제목순' },
]

function fmtFollowers(n: number | null | undefined): string | null {
	if (n == null)
		return null
	if (n >= 1_000_000)
		return `${(n / 1_000_000).toFixed(1)}M`
	if (n >= 1_000)
		return `${(n / 1_000).toFixed(1)}K`
	return String(n)
}

// Front UI/UX audit #7 — Spotify's album_type has no EP: an EP is a
// `single`. Everything that is not a single (album, compilation, or a row
// with no type) is shown as an album, so no release can fall out of both groups.
type DiscographyGroup = 'album' | 'single'

const DISCOGRAPHY_GROUPS: { value: DiscographyGroup, label: string }[] = [
	{ value: 'album', label: '앨범' },
	{ value: 'single', label: '싱글·EP' },
]

export function discographyGroup(al: AlbumListItem): DiscographyGroup {
	return al.album_type === 'single' ? 'single' : 'album'
}

const SQUARE_COVER = { width: '100%', aspectRatio: '1 / 1', borderRadius: 3 } as const
const SQUARE_COVER_PH = { fontSize: 'clamp(20px, 4vw, 40px)' } as const

function releaseYear(date: string | null | undefined): number | null {
	if (!date)
		return null
	const year = Number.parseInt(date.slice(0, 4), 10)
	return Number.isFinite(year) ? year : null
}

/**
 * Catalog row → canonical album identity. The artist name is left out on
 * purpose: every card here is this artist's, so the byline carries the year
 * only. A Spotify-only row goes through the smart constructor.
 */
export function artistDiscographyCardData(al: AlbumListItem): AlbumCardData {
	const display = {
		title: al.title,
		artist: null,
		artistId: null,
		cover: al.cover_url ?? null,
		year: releaseYear(al.release_date),
	}
	if (al.id)
		return { ...display, catalogAlbumId: al.id, spotifyAlbumId: null }
	if (al.spotify_id)
		return unresolvedAlbumCardData(al.spotify_id, display)
	return { ...display, catalogAlbumId: null, spotifyAlbumId: null }
}

// Front UI/UX audit S1 — the discography composes the canonical card through
// the shared catalog adapter, like /search: the same album now has the same
// open + ＋담기 (+ copy-drag when logged in) on both pages. Before this it was a
// bespoke tile with open only.
function ArtistDiscographyCard({ al, artistName }: { al: AlbumListItem, artistName: string }) {
	const data = artistDiscographyCardData(al)
	const albumId = data.catalogAlbumId
	return (
		<CatalogAlbumCardAdapter
			data={data}
			layout="grid"
			titleAs="h3"
			secondaryLine={al.album_type ? <span className="art-disco-type">{al.album_type}</span> : undefined}
			capabilities={albumId ?
				{ open: () => openAlbum({ albumId, title: al.title, artist: artistName, cover: al.cover_url, year: data.year }) } :
				{}}
		/>
	)
}

function DotJoined({ parts }: { parts: { key: string, node: ReactNode }[] }) {
	return parts.map((p, i) => (
		<Fragment key={p.key}>
			{i > 0 && <span className="art-id-dot" aria-hidden="true">·</span>}
			{p.node}
		</Fragment>
	))
}

function LetterTile({ label }: { label: string }) {
	const ch = (label.trim()[0] ?? '?').toUpperCase()
	return <span className="art-letter" aria-hidden="true">{ch}</span>
}

export default function ArtistHub({ artistId, name, reviews, reviewedAlbumIds }: Props) {
	const [hero, setHero] = useState<ArtistHero | null>(null)
	const [albums, setAlbums] = useState<AlbumListItem[]>([])
	const [topTracks, setTopTracks] = useState<TopTrackItem[]>([])
	const [status, setStatus] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading')
	const [reloadTick, setReloadTick] = useState(0)
	const [catalogSort, setCatalogSort] = useState<CatalogSort>('popular')

	useEffect(() => {
		let alive = true
		setStatus('loading')
		Promise.all([
			fetchArtistHero(artistId),
			// The music API collapses editions over the whole discography and caps a
			// page at 100; the largest prod discography is 92, so one page is all of
			// it and the masthead counts below are exact.
			fetchArtistAlbums(artistId, 100),
			fetchArtistTopTracks(artistId, 8),
		]).then(([heroRes, albumList, tracks]) => {
			if (!alive)
				return
			if (!heroRes.ok) {
				// FIX-user-flow-state-consistency leg 4 — `getHero` has always
				// reported *why* it failed (404, an HTTP status, or 0 for a
				// transport error) and this threw it away, so a 5xx or a dead
				// network told the reader the artist does not exist. Same shape as
				// the /search defect leg 3 fixed: the distinction was computed and
				// then dropped on the floor.
				setStatus(heroRes.status === 404 ? 'notfound' : 'error')
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
	}, [artistId, reloadTick])

	if (status === 'notfound') {
		return (
			<div className="art-pending">
				<p className="art-cov-empty-lead">아티스트를 찾을 수 없습니다.</p>
				<p className="art-cov-empty-sub">{name}</p>
			</div>
		)
	}

	if (status === 'error') {
		return (
			<div className="art-pending">
				<p className="art-cov-empty-lead">아티스트 정보를 불러오지 못했습니다.</p>
				<p className="art-cov-empty-sub">서버 또는 네트워크 문제입니다. 이 아티스트가 없는 것은 아닙니다.</p>
				<button type="button" className="art-track mono" onClick={() => setReloadTick(t => t + 1)}>다시 시도</button>
			</div>
		)
	}

	const displayName = hero?.name ?? name
	const catalogGenres = hero?.catalog_genres ?? []
	const spotifyGenres = hero?.genres ?? []
	const reviewed = new Set(reviewedAlbumIds)
	// catalog = albums NOT yet reviewed (the reviewed ones live in the section above)
	const catalog = albums.filter(a => !a.id || !reviewed.has(a.id))
	if (catalogSort === 'latest') {
		catalog.sort((a, b) => {
			if (!a.release_date)
				return b.release_date ? 1 : 0
			if (!b.release_date)
				return -1
			return b.release_date.localeCompare(a.release_date)
		})
	}
	else if (catalogSort === 'title') {
		catalog.sort((a, b) => a.title.localeCompare(b.title, 'ko'))
	}
	const hasReviews = reviews.length > 0
	const catalogGroups = DISCOGRAPHY_GROUPS
		.map(g => ({ ...g, items: catalog.filter(a => discographyGroup(a) === g.value) }))
		.filter(g => g.items.length > 0)
	// Masthead counts by type over the whole fetched discography (reviewed
	// albums included). If the album list came back empty — no albums, or a
	// failed fetch, which artistApi does not distinguish — keep the hero count.
	const typeCounts = DISCOGRAPHY_GROUPS
		.map(g => ({ label: g.label, count: albums.filter(a => discographyGroup(a) === g.value).length }))
		.filter(c => c.count > 0)
	const countParts = hero ?
		[
			...(albums.length > 0 ?
				typeCounts.map(c => `${c.count} ${c.label}`) :
				[`${hero.album_count} 앨범`]),
			`${hero.track_count} 트랙`,
		] :
		[]
	// Audit #7 — the footnote separators are placed between the items that
	// render, so a missing Spotify link no longer leaves a leading "·".
	const footParts: { key: string, node: ReactNode }[] = []
	if (hero?.spotify_url) {
		footParts.push({ key: 'spotify', node: (
			<a className="art-id-spotify" href={hero.spotify_url} target="_blank" rel="noreferrer">
				Spotify ↗
			</a>
		) })
	}
	if (hero?.followers != null)
		footParts.push({ key: 'followers', node: <span>{`팔로워 ${fmtFollowers(hero.followers)}`}</span> })
	if (hero?.popularity != null)
		footParts.push({ key: 'popularity', node: <span>{`인기도 ${hero.popularity}`}</span> })
	const sortControls = (
		<div className="art-sort mono" role="group" aria-label="디스코그래피 정렬">
			{CATALOG_SORTS.map(option => (
				<button
					key={option.value}
					type="button"
					className={catalogSort === option.value ? 'is-active' : ''}
					aria-pressed={catalogSort === option.value}
					onClick={() => setCatalogSort(option.value)}
				>
					{option.label}
				</button>
			))}
		</div>
	)

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
					{(catalogGenres.length > 0 || spotifyGenres.length > 0) && (
						<div className="art-id-genres">
							{catalogGenres.length > 0 ?
								catalogGenres.map(g => <a key={g.slug} className="art-id-gchip" href={genreMapHref(g.slug)}>{g.label}</a>) :
								spotifyGenres.map(g => <span key={g} className="art-id-gchip">{g}</span>)}
						</div>
					)}
					{countParts.length > 0 && (
						<div className="art-id-counts">
							<DotJoined parts={countParts.map(text => ({ key: text, node: <span>{text}</span> }))} />
						</div>
					)}
					{/* FIX-user-flow-state-consistency leg 4 — the artist hub is where a
					    reader decides an artist matters, and until now the Release Radar
					    could only be filled from inside /releases. */}
					<div className="art-id-actions">
						<TrackArtistButton artistId={artistId} name={displayName} />
					</div>
					{footParts.length > 0 && (
						<div className="art-id-foot">
							<DotJoined parts={footParts} />
						</div>
					)}
				</div>
			</header>

			{/* ── 2. 평론한 앨범 (the critic's lens) ───────────────────── */}
			{/* Audit #7 — with no 평론 the section is not rendered at all, like the
			    empty 평론 nav items (FEAT-public-surfaces-before-first-review). */}
			{hasReviews && (
				<section className="art-block">
					<SectionTitle kicker="THE CRITIC’S LENS" title="평론한 앨범" />
					<div className="art-cov-grid">
						{reviews.map(r => (
							<a key={r.slug} className="art-rev-card" href={reviewHref(r.slug)}>
								<div className="art-rev-cover">
									<CoverImage src={r.cover} label={r.album} style={SQUARE_COVER} placeholderStyle={SQUARE_COVER_PH} />
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
			)}

			{/* ── 3. 디스코그래피 + 주요 트랙 ─────────────────────────── */}
			<div className="art-lower-grid art-block">
				<div className="art-disco-block">
					<SectionTitle
						kicker={hasReviews ? 'Catalog · not yet reviewed' : 'Catalog'}
						title="디스코그래피"
						right={sortControls}
					/>
					{status === 'loading' ?
						<div className="art-pending">불러오는 중…</div> :
						catalogGroups.length > 0 ?
							catalogGroups.map(g => (
								<section key={g.value} className="art-disco-group" aria-labelledby={`art-disco-${g.value}`}>
									<p id={`art-disco-${g.value}`} className="art-disco-group-title mono">
										{g.label}
										<span className="art-disco-group-count">{g.items.length}</span>
									</p>
									<div className={`art-disco-grid${hasReviews ? '' : ' is-foreground'}`}>
										{g.items.map(al => <ArtistDiscographyCard key={al.id ?? al.title} al={al} artistName={name} />)}
									</div>
								</section>
							)) :
							<p className="art-cov-empty-sub">등록된 앨범이 없습니다.</p>}
				</div>

				{topTracks.length > 0 && (
					<aside className="art-tt-wrap">
						<SectionTitle title="주요 트랙" />
						<ol className="art-tt-list">
							{topTracks.map((tk, i) => (
								// ARCH-entity-interaction-unify Step 3: a top track opens the
								// overlay for its album (Music_TrackItem.album_id is always set).
								<li key={tk.id} className="art-tt-row">
									<button
										type="button"
										className="art-tt-open"
										onClick={() => openTrackAlbum({ albumId: tk.album_id, albumTitle: tk.album_title, artist: tk.artist_name ?? name, cover: tk.cover_url })}
										aria-label={`${tk.title}${tk.album_title ? ` — ${tk.album_title}` : ''} 앨범 상세 보기`}
									>
										<span className="art-tt-rank">{String(i + 1).padStart(2, '0')}</span>
										<span className="art-tt-name">{tk.title}</span>
									</button>
								</li>
							))}
						</ol>
					</aside>
				)}
			</div>
		</div>
	)
}
