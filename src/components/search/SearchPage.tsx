// FEAT-global-search — the /search results island. Reads ?q from location at
// runtime (static site + CloudFront-Free strips the query from the cache key, so
// one shell + client-side parse), drives the shared useMusicSearch core (DB-only
// for the public surface), and overlays a first-class 평론(reviews) facet from the
// build-time /search-index.json. Artists link to their hub; albums/tracks are
// shown but not navigable (no album page); reviews link to /review/{slug}.
import { useEffect, useRef, useState } from 'react'
import type { AlbumHit, ArtistHit, TrackHit } from '@lib/useMusicSearch'
import { openAlbum, openTrackAlbum } from '@lib/entityEvents'
import { artistHref, reviewHref } from '@lib/entityLinks'
import { useMusicSearch } from '@lib/useMusicSearch'
import type { ReviewHit } from '@lib/reviewIndex'
import { filterReviews, loadReviews } from '@lib/reviewIndex'
import { GCover, GStars } from './atoms'

type Facet = 'all' | 'review' | 'artist' | 'album' | 'track'

function getQuery(): string {
	if (typeof window === 'undefined')
		return ''
	return new URLSearchParams(window.location.search).get('q') ?? ''
}

// ── cards ─────────────────────────────────────────────────────────
function ReviewCard({ r }: { r: ReviewHit }) {
	return (
		<a href={reviewHref(r.slug)} className="gs-albcard">
			<div className="gs-albcard-cov"><GCover name={r.album} src={r.cover} size={0} /></div>
			<div className="gs-albcard-body">
				<div className="gs-albcard-stars">
					<GStars rating={r.rating} size={15} />
					{r.bestNew && <span className="gs-bnm-badge">BNM</span>}
				</div>
				<h3 className="serif gs-albcard-title">{r.album}</h3>
				<p className="mono gs-albcard-meta">{[r.artist, r.year].filter(Boolean).join(' · ')}</p>
			</div>
		</a>
	)
}

function ArtistCard({ a }: { a: ArtistHit }) {
	return (
		// no catalog id → no hub page; render a dead card instead of /artist/null/
		// (mirrors HeaderSearch's 'static' row for id-less artists)
		<a href={a.id ? artistHref(a.id) : undefined} className="gs-acard">
			<GCover name={a.name} src={a.cover} size={84} shape="circle" />
			<div className="gs-acard-body">
				<div className="gs-acard-namerow"><h3 className="serif gs-acard-name">{a.name}</h3></div>
				{a.id && (
					<span className="mono gs-acard-go">
아티스트 허브
<span aria-hidden="true">→</span>
					</span>
				)}
			</div>
		</a>
	)
}

function AlbumCard({ a }: { a: AlbumHit }) {
	const albumSurface = (
		<>
			<div className="gs-albcard-cov"><GCover name={a.title} src={a.cover} size={0} /></div>
			<div className="gs-albcard-body">
				<h3 className="serif gs-albcard-title">{a.title}</h3>
			</div>
		</>
	)
	// ARCH-entity-interaction-unify Step 2: a DB-catalog album now opens the
	// app-wide read-only album overlay (openAlbum). Spotify-only hits with no DB
	// id stay a static figure (no album to fetch).
	return (
		<div className={a.id ? 'gs-albcard' : 'gs-albcard is-static'}>
			{a.id ?
				(
					<button
						type="button"
						className="gs-albcard-open"
						onClick={() => openAlbum({ albumId: a.id!, title: a.title, artist: a.artist ?? undefined, cover: a.cover, year: a.year ? Number.parseInt(a.year, 10) : null })}
						aria-label={`${a.title} 앨범 상세 보기`}
					>
						{albumSurface}
					</button>
				) :
				albumSurface}
			<p className="mono gs-albcard-meta">
				{a.artistId && a.artist ? <a href={artistHref(a.artistId)} className="gs-albcard-artist">{a.artist}</a> : a.artist}
				{a.artist && a.year ? ' · ' : null}
				{a.year}
			</p>
		</div>
	)
}

function SearchTrackRow({ t, no }: { t: TrackHit, no: number }) {
	const feat = t.featArtists.length ?
(
		<span className="gs-trk-feat">
{' '}
feat.
{t.featArtists.join(', ')}
  </span>
	) :
		null
	const inner = (
		<>
			<span className="mono gs-trk-no">{String(no).padStart(2, '0')}</span>
			<GCover name={t.title} src={t.cover} size={40} radius={2} />
			<span className="gs-trk-main">
				<span className="serif gs-trk-title">{t.title}</span>
				<span className="mono gs-trk-sub">
{t.artist}
{feat}
{t.albumTitle ? ` · ${t.albumTitle}` : ''}
    </span>
			</span>
		</>
	)
	// ARCH-entity-interaction-unify Step 3: a track opens the overlay for its
	// album. Spotify-only hits with no DB album id stay a static row.
	if (!t.albumId)
		return <div className="gs-trk is-static">{inner}</div>
	return (
		<button
			type="button"
			className="gs-trk"
			onClick={() => openTrackAlbum({ albumId: t.albumId, albumTitle: t.albumTitle, artist: t.artist, cover: t.cover })}
			aria-label={`${t.title}${t.albumTitle ? ` — ${t.albumTitle}` : ''} 앨범 상세 보기`}
		>
			{inner}
		</button>
	)
}

// First-class on-page search field. /search previously had no input of its own
// and relied on the header combobox, whose dropdown overlaid this hero (audit
// M4). This is the primary search surface for the route.
function PageField({ value, onType, onEnter }: { value: string, onType: (v: string) => void, onEnter: () => void }) {
	return (
		<div className="gs-pagefield">
			<svg className="gs-pagefield-ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
				<circle cx="11" cy="11" r="7" />
				<path d="M21 21l-4.3-4.3" strokeLinecap="round" />
			</svg>
			<input
				id="gs-page-search"
				name="q"
				className="gs-pagefield-input"
				value={value}
				placeholder="아티스트 · 앨범 · 트랙 · 평론 검색"
				aria-label="검색"
				autoComplete="off"
				autoFocus
				onChange={e => onType(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === 'Enter')
						onEnter()
				}}
			/>
		</div>
	)
}

function Section({ label, count, children }: { label: string, count: number, children: React.ReactNode }) {
	return (
		<section className="gs-psec">
			<div className="gs-psec-head">
				<h2 className="serif gs-psec-title">{label}</h2>
				<span className="mono gs-psec-count">
{count}
건
    </span>
			</div>
			{children}
		</section>
	)
}

export default function SearchPage() {
	const s = useMusicSearch({ recallTypes: ['album', 'artist', 'track'] })
	const { setQuery, runDbSearch } = s
	const [q, setQ] = useState(getQuery)
	const [input, setInput] = useState(getQuery)
	const [reviews, setReviews] = useState<ReviewHit[]>([])
	const [filter, setFilter] = useState<Facet>('all')
	const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

	// Commit a typed query to the search core + URL (replaceState, not push, so
	// per-keystroke typing doesn't flood history). Matches HeaderSearch's 180ms.
	function commit(v: string) {
		clearTimeout(debounceRef.current)
		setQ(v)
		const t = v.trim()
		window.history.replaceState(null, '', t ? `/search?q=${encodeURIComponent(t)}` : '/search')
	}
	function onType(v: string) {
		setInput(v)
		clearTimeout(debounceRef.current)
		debounceRef.current = setTimeout(() => commit(v), 180)
	}

	// back/forward between queries re-reads the URL
	useEffect(() => {
		const onPop = () => {
			const next = getQuery()
			setQ(next)
			setInput(next)
		}
		window.addEventListener('popstate', onPop)
		return () => window.removeEventListener('popstate', onPop)
	}, [])

	// push the committed query into the search core + the review filter
	useEffect(() => {
		setFilter('all')
		setQuery(q)
		loadReviews().then(idx => setReviews(filterReviews(idx, q)))
	}, [q, setQuery])

	// run the DB search once the core's query state catches up
	useEffect(() => {
		if (s.query.trim())
			runDbSearch()
	}, [s.query, runDbSearch])

	const query = q.trim()
	const total = reviews.length + s.artists.length + s.albums.length + s.tracks.length
	const show = (k: Facet) => filter === 'all' || filter === k
	const empty = !query
	const noResults = !empty && !s.loading && total === 0
	const hasResults = !empty && total > 0

	const pills: [Facet, string, number][] = [
		['all', '전체', total],
		['review', '평론', reviews.length],
		['artist', '아티스트', s.artists.length],
		['album', '앨범', s.albums.length],
		['track', '트랙', s.tracks.length],
	]

	// PageField is rendered ONCE in a stable position so it never remounts on
	// empty → results → no-results transitions (a remount would drop focus and
	// break Korean IME composition mid-type).
	return (
		<>
			<div className="gs-rhead">
				<div className="gs-rhead-top">
					{empty ?
						(
							<>
								<span className="mono gs-rhead-kicker">전역 검색</span>
								<h1 className="serif gs-rhead-q">무엇을 평론하시겠어요?</h1>
								<span className="mono gs-rhead-total">평론 · 아티스트 · 앨범 · 트랙을 한 곳에서</span>
							</>
						) :
						(
							<>
								<span className="mono gs-rhead-kicker">검색 결과</span>
								<h1 className="serif gs-rhead-q">{`‘${query}’`}</h1>
								<span className="mono gs-rhead-total">{s.loading && total === 0 ? '검색 중…' : noResults ? '일치하는 결과 없음' : `총 ${total}건`}</span>
							</>
						)}
					<PageField value={input} onType={onType} onEnter={() => commit(input)} />
				</div>
				{hasResults && (
					<div className="gs-pills" role="tablist">
						{pills.map(([v, label, n]) => (
							<button
								key={v}
								type="button"
								role="tab"
								aria-selected={filter === v}
								className={`gs-pill mono${filter === v ? ' is-on' : ''}`}
								onClick={() => setFilter(v)}
								disabled={v !== 'all' && n === 0}
							>
								{label}
								<span className="gs-pill-n">{n}</span>
							</button>
						))}
					</div>
				)}
			</div>

			{!empty && s.loading && total === 0 && <div className="gs-status">검색 중…</div>}

			{noResults && (
				<div className="gs-noresults">
					<p className="serif gs-nr-lead"><em>일치하는 결과가 없습니다.</em></p>
					<p className="serif gs-nr-sub">철자를 확인하거나 더 짧은 키워드로 시도해 보세요. 찾는 작품이 카탈로그에 아직 없을 수도 있습니다.</p>
				</div>
			)}

			{hasResults && (
				<div className="gs-results">
					{show('review') && reviews.length > 0 && (
						<Section label="평론" count={reviews.length}>
							<div className="gs-albgrid">{reviews.map(r => <ReviewCard key={r.slug} r={r} />)}</div>
						</Section>
					)}
					{show('artist') && s.artists.length > 0 && (
						<Section label="아티스트" count={s.artists.length}>
							<div className="gs-agrid">{s.artists.map(a => <ArtistCard key={a.id ?? a.name} a={a} />)}</div>
						</Section>
					)}
					{show('album') && s.albums.length > 0 && (
						<Section label="앨범" count={s.albums.length}>
							<div className="gs-albgrid">{s.albums.map(a => <AlbumCard key={a.id ?? a.title} a={a} />)}</div>
						</Section>
					)}
					{show('track') && s.tracks.length > 0 && (
						<Section label="트랙" count={s.tracks.length}>
							<div className="gs-trklist">{s.tracks.map((t, i) => <SearchTrackRow key={t.id ?? `${t.title}${i}`} t={t} no={i + 1} />)}</div>
						</Section>
					)}
				</div>
			)}
		</>
	)
}
