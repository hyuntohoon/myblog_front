// FEAT-global-search — the /search results island. Reads ?q from location at
// runtime (static site + CloudFront-Free strips the query from the cache key, so
// one shell + client-side parse), drives the shared useMusicSearch core (DB-only
// for the public surface), and overlays a first-class 평론(reviews) facet from the
// build-time /search-index.json. Artists link to their hub; albums/tracks are
// shown but not navigable (no album page); reviews link to /review/{slug}.
import { useEffect, useState } from 'react'
import type { AlbumHit, ArtistHit, TrackHit } from '@lib/useMusicSearch'
import { useMusicSearch } from '@lib/useMusicSearch'
import { GCover, GStars } from './atoms'

interface ReviewHit {
	slug: string
	album: string
	artist: string
	genres: string[]
	year: number
	rating: number | null
	bestNew: boolean
	cover: string | null
	excerpt: string
	body: string
}

type Facet = 'all' | 'review' | 'artist' | 'album' | 'track'

// ── build-time review index (fetched once, memoized) ──────────────
let reviewIndex: ReviewHit[] | null = null
let reviewPromise: Promise<ReviewHit[]> | null = null
function loadReviews(): Promise<ReviewHit[]> {
	if (reviewIndex)
		return Promise.resolve(reviewIndex)
	if (!reviewPromise) {
		reviewPromise = fetch('/search-index.json')
			.then(r => (r.ok ? (r.json() as Promise<ReviewHit[]>) : []))
			.then((d) => {
				reviewIndex = d
				return d
			})
			.catch(() => [])
	}
	return reviewPromise
}
function filterReviews(idx: ReviewHit[], q: string): ReviewHit[] {
	const n = q.trim().toLowerCase()
	if (!n)
		return []
	return idx.filter(r =>
		r.album.toLowerCase().includes(n) ||
		r.artist.toLowerCase().includes(n) ||
		r.genres.some(g => g.toLowerCase().includes(n)) ||
		r.excerpt.toLowerCase().includes(n) ||
		r.body.toLowerCase().includes(n),
	)
}

function getQuery(): string {
	if (typeof window === 'undefined')
		return ''
	return new URLSearchParams(window.location.search).get('q') ?? ''
}

// ── cards ─────────────────────────────────────────────────────────
function ReviewCard({ r }: { r: ReviewHit }) {
	return (
		<a href={`/review/${r.slug}/`} className="gs-albcard">
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
		<a href={`/artist/${a.id}/`} className="gs-acard">
			<GCover name={a.name} src={a.cover} size={84} shape="circle" />
			<div className="gs-acard-body">
				<div className="gs-acard-namerow"><h3 className="serif gs-acard-name">{a.name}</h3></div>
				<span className="mono gs-acard-go">
아티스트 허브
<span aria-hidden="true">→</span>
    </span>
			</div>
		</a>
	)
}

function AlbumCard({ a }: { a: AlbumHit }) {
	// non-navigable (no album page) — static figure
	return (
		<div className="gs-albcard is-static">
			<div className="gs-albcard-cov"><GCover name={a.title} src={a.cover} size={0} /></div>
			<div className="gs-albcard-body">
				<h3 className="serif gs-albcard-title">{a.title}</h3>
				<p className="mono gs-albcard-meta">{[a.artist, a.year].filter(Boolean).join(' · ')}</p>
			</div>
		</div>
	)
}

function TrackRow({ t, no }: { t: TrackHit, no: number }) {
	const feat = t.featArtists.length ?
(
		<span className="gs-trk-feat">
{' '}
feat.
{t.featArtists.join(', ')}
  </span>
	) :
		null
	return (
		<div className="gs-trk">
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
	const [reviews, setReviews] = useState<ReviewHit[]>([])
	const [filter, setFilter] = useState<Facet>('all')

	// back/forward between queries re-reads the URL
	useEffect(() => {
		const onPop = () => setQ(getQuery())
		window.addEventListener('popstate', onPop)
		return () => window.removeEventListener('popstate', onPop)
	}, [])

	// push the URL query into the search core + the review filter
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

	if (!query) {
		return (
			<div className="gs-rhead">
				<div className="gs-rhead-top">
					<span className="mono gs-rhead-kicker">전역 검색</span>
					<h1 className="serif gs-rhead-q">무엇을 평론하시겠어요?</h1>
					<span className="mono gs-rhead-total">평론 · 아티스트 · 앨범 · 트랙을 한 곳에서</span>
				</div>
			</div>
		)
	}

	if (s.loading && total === 0)
		return <div className="gs-status">검색 중…</div>

	if (!s.loading && total === 0) {
		return (
			<div className="gs-noresults">
				<span className="mono gs-nr-kicker">검색 결과</span>
				<h1 className="serif gs-nr-q">
‘
{query}
’
    </h1>
				<p className="serif gs-nr-lead"><em>일치하는 결과가 없습니다.</em></p>
				<p className="serif gs-nr-sub">철자를 확인하거나 더 짧은 키워드로 시도해 보세요. 찾는 작품이 카탈로그에 아직 없을 수도 있습니다.</p>
			</div>
		)
	}

	const pills: [Facet, string, number][] = [
		['all', '전체', total],
		['review', '평론', reviews.length],
		['artist', '아티스트', s.artists.length],
		['album', '앨범', s.albums.length],
		['track', '트랙', s.tracks.length],
	]

	return (
		<>
			<div className="gs-rhead">
				<div className="gs-rhead-top">
					<span className="mono gs-rhead-kicker">검색 결과</span>
					<h1 className="serif gs-rhead-q">
‘
{query}
’
     </h1>
					<span className="mono gs-rhead-total">
총
{total}
건
     </span>
				</div>
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
			</div>

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
						<div className="gs-trklist">{s.tracks.map((t, i) => <TrackRow key={t.id ?? `${t.title}${i}`} t={t} no={i + 1} />)}</div>
					</Section>
				)}
			</div>
		</>
	)
}
