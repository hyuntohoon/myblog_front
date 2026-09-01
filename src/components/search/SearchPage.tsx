// FEAT-global-search — the /search results island. Reads ?q from location at
// runtime (static site + CloudFront-Free strips the query from the cache key, so
// one shell + client-side parse), drives the shared useMusicSearch core (DB-only
// for the public surface), and overlays a first-class 평론(reviews) facet from the
// build-time /search-index.json. Artists link to their hub; albums open the
// app-wide overlay and can be copied into Pocket; reviews link to /review/{slug}.
import { useEffect, useRef, useState } from 'react'
import type { AlbumHit, ArtistHit, SearchKind, TrackHit, UseMusicSearch } from '@lib/useMusicSearch'
import type { AlbumCardData } from '@components/shared/AlbumCard'
import { unresolvedAlbumCardData } from '@components/shared/AlbumCard'
import { CatalogAlbumCardAdapter } from '@components/shared/CatalogAlbumCardAdapter'
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
	const cover = <div className="gs-albcard-cov"><GCover name={r.album} src={r.cover} size={0} /></div>
	return (
		<div className="gs-albcard">
			{/* ARCH-entity-interaction-v2 E7 — cover peeks the album overlay (the same
			    openAlbum entry SearchAlbumCard uses); the rest of the card stays the
			    review link. A published review is a document, not an album card, so it
			    keeps its own renderer rather than composing the canonical primitive. */}
			{r.albumId ?
				(
					<button
						type="button"
						className="gs-albcard-open"
						onClick={() => openAlbum({ albumId: r.albumId!, title: r.album, artist: r.artist || undefined, cover: r.cover, year: r.year })}
						aria-label={`${r.album} 앨범 상세 보기`}
					>
						{cover}
					</button>
				) :
				cover}
			<a href={reviewHref(r.slug)} className="gs-albcard-body">
				<div className="gs-albcard-stars">
					<GStars rating={r.rating} size={15} />
					{r.bestNew && <span className="gs-bnm-badge">BNM</span>}
				</div>
				<h3 className="serif gs-albcard-title">{r.album}</h3>
				<p className="mono gs-albcard-meta">{[r.artist, r.year].filter(Boolean).join(' · ')}</p>
			</a>
		</div>
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

/**
 * A search hit carries `year` as a free-form string; the canonical card slot is
 * numeric. Anything non-numeric collapses to null rather than rendering NaN.
 */
function hitYear(year: string | null): number | null {
	if (!year)
		return null
	const parsed = Number.parseInt(year, 10)
	return Number.isNaN(parsed) ? null : parsed
}

/** AlbumHit → canonical identity. A Spotify-only hit must go through the smart constructor. */
function searchAlbumCardData(a: AlbumHit): AlbumCardData {
	const display = {
		title: a.title,
		artist: a.artist,
		artistId: a.artistId,
		cover: a.cover,
		year: hitYear(a.year),
	}
	if (a.id)
		return { ...display, catalogAlbumId: a.id, spotifyAlbumId: null }
	if (a.spotifyId)
		return unresolvedAlbumCardData(a.spotifyId, display)
	return { ...display, catalogAlbumId: null, spotifyAlbumId: null }
}

// ARCH-album-card-contract-and-composition — the /search album grid composes the
// canonical card through the shared catalog adapter, so a catalog-backed hit gets
// the same open + copy-drag + AddToBucketMenu contract Home already ships. A
// Spotify-only hit stays display-only and says why; its foreign id is never
// projected into a catalog write. (Before this, /search had its own local
// `AlbumCard` — same name as the shared primitive, different component, and the
// only album-discovery surface with no way to add what you found.)
function SearchAlbumCard({ a }: { a: AlbumHit }) {
	const data = searchAlbumCardData(a)
	const albumId = a.id
	const artistId = a.artistId
	return (
		<CatalogAlbumCardAdapter
			data={data}
			layout="grid"
			titleAs="h3"
			capabilities={{
				...(albumId ?
					{ open: () => openAlbum({ albumId, title: a.title, artist: a.artist ?? undefined, cover: a.cover, year: data.year }) } :
					{}),
				...(artistId ? { artistOpen: () => window.location.assign(artistHref(artistId)) } : {}),
			}}
		/>
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

const MORE_LABEL: Record<SearchKind, string> = { album: '앨범', artist: '아티스트', track: '트랙' }

/**
 * FIX-user-flow-state-consistency leg 3 — per-bucket "더 보기".
 *
 * `useMusicSearch` has always exposed `hasMore` + `loadMore`, and /search has
 * always ignored both, so the page silently truncated every bucket at the
 * hook's 20-row page and gave the reader no way to tell a full answer from a
 * first page. A failed page reports itself here rather than only through the
 * hook's shared `status` string, so the retry is next to the thing that failed.
 */
function MoreRow({ kind, s }: { kind: SearchKind, s: UseMusicSearch }) {
	const busy = s.loadingMore === kind
	if (s.moreFailed === kind) {
		return (
			<div className="gs-more">
				<span className="mono gs-more-err">더 불러오지 못했습니다.</span>
				{' '}
				<button type="button" className="gs-retry-inline mono" onClick={() => void s.loadMore(kind)} disabled={busy}>
					다시 시도
				</button>
			</div>
		)
	}
	if (!s.hasMore[kind])
		return null
	return (
		<div className="gs-more">
			<button
				type="button"
				className="gs-more-btn mono"
				onClick={() => void s.loadMore(kind)}
				disabled={busy}
			>
				{busy ? '불러오는 중…' : `${MORE_LABEL[kind]} 더 보기`}
			</button>
		</div>
	)
}

export default function SearchPage() {
	const s = useMusicSearch({ recallTypes: ['album', 'artist', 'track'] })
	const { setQuery, runDbSearch } = s
	const [q, setQ] = useState(getQuery)
	const [input, setInput] = useState(getQuery)
	const [reviews, setReviews] = useState<ReviewHit[]>([])
	// FIX-user-flow-state-consistency leg 3 — the 평론 index failing is its own
	// state, not zero hits. It is also survivable: the DB facets still rendered,
	// so this degrades the page rather than replacing it.
	const [reviewsFailed, setReviewsFailed] = useState(false)
	const [retryTick, setRetryTick] = useState(0)
	const [filter, setFilter] = useState<Facet>('all')
	const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

	/**
	 * Whether the query in the current history entry is one the reader *arrived
	 * at* — followed a link to, submitted, or came back to — as opposed to one
	 * this page wrote into the entry while they were typing.
	 *
	 * This is the leg-3 history fix. Every commit used to replaceState, which
	 * reads like the careful choice (don't flood history with keystrokes) but
	 * destroys the entry you came from: after searching 'miles' and then typing
	 * 'davis', the 'miles' entry no longer existed, so Back walked out of /search
	 * entirely instead of returning to the previous query — and the popstate
	 * listener below could never fire from this page's own navigation.
	 *
	 * So: the first edit after an arrival opens a NEW entry, preserving what you
	 * arrived with; every edit after that refines that same entry, so a burst of
	 * typing still costs one entry, not one per keystroke.
	 */
	const entryIsArrival = useRef(true)

	function writeUrl(trimmed: string, mode: 'push' | 'replace') {
		const url = trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search'
		const current = `${window.location.pathname}${window.location.search}`
		if (mode === 'push' && url !== current)
			window.history.pushState(null, '', url)
		else
			window.history.replaceState(null, '', url)
	}

	// Commit a typed query to the search core + URL.
	function commit(v: string) {
		clearTimeout(debounceRef.current)
		setQ(v)
		writeUrl(v.trim(), entryIsArrival.current ? 'push' : 'replace')
		entryIsArrival.current = false
	}
	function onType(v: string) {
		setInput(v)
		clearTimeout(debounceRef.current)
		debounceRef.current = setTimeout(() => commit(v), 180)
	}
	// Pressing Enter is the reader saying this query is a place to be, so the
	// entry it lands on becomes an arrival in its own right and the next edit
	// will open a new one rather than overwrite it.
	function onSubmit(v: string) {
		commit(v)
		entryIsArrival.current = true
	}

	// back/forward between queries re-reads the URL
	useEffect(() => {
		const onPop = () => {
			const next = getQuery()
			setQ(next)
			setInput(next)
			entryIsArrival.current = true
		}
		window.addEventListener('popstate', onPop)
		return () => window.removeEventListener('popstate', onPop)
	}, [])

	// push the committed query into the search core + the review filter
	useEffect(() => {
		setFilter('all')
		setQuery(q)
		if (!q.trim()) {
			setReviews([])
			setReviewsFailed(false)
			return
		}
		let alive = true
		loadReviews()
			.then((idx) => {
				if (!alive)
					return
				setReviews(filterReviews(idx, q))
				setReviewsFailed(false)
			})
			.catch(() => {
				if (!alive)
					return
				setReviews([])
				setReviewsFailed(true)
			})
		return () => {
			alive = false
		}
	}, [q, retryTick, setQuery])

	// Re-run both halves of the page. loadReviews() drops its memo on failure, so
	// this genuinely reconnects rather than replaying a cached rejection.
	//
	// It bumps the tick and nothing else, on purpose. Calling runDbSearch() from
	// here as well loses the race with its own re-render: the effect above re-runs
	// on the new tick and calls the core's setQuery, which invalidates the search
	// sequence and aborts whatever is in flight — including the request the retry
	// had just started a moment earlier. Retry then "succeeded" into an empty
	// result. Both halves are driven by the tick instead, in effect order.
	function retryAll() {
		setRetryTick(t => t + 1)
	}

	// run the DB search once the core's query state catches up. `retryTick` is a
	// dependency so a retry re-runs it after (not before) the effect above has
	// reset the core.
	useEffect(() => {
		if (s.query.trim())
			runDbSearch()
	}, [s.query, retryTick, runDbSearch])

	const query = q.trim()
	const total = reviews.length + s.artists.length + s.albums.length + s.tracks.length
	const show = (k: Facet) => filter === 'all' || filter === k
	const empty = !query
	// A failed search is not an empty one. Before this, `검색 실패` was computed
	// by the hook and dropped on the floor here, so a 5xx or a dead network
	// rendered "일치하는 결과가 없습니다 — 철자를 확인하거나…", telling the reader
	// their spelling was wrong about a request that never landed.
	const failed = !empty && s.searchFailed
	const noResults = !empty && !s.loading && !failed && total === 0
	const hasResults = !empty && total > 0

	const headline =
		empty ?
			'평론 · 아티스트 · 앨범 · 트랙을 한 곳에서' :
			failed ?
				'검색을 불러오지 못했습니다' :
				s.loading && total === 0 ?
					'검색 중…' :
					noResults ?
						'일치하는 결과 없음' :
						`총 ${total}건`

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
					<span className="mono gs-rhead-kicker">{empty ? '전역 검색' : '검색 결과'}</span>
					<h1 className="serif gs-rhead-q">{empty ? '무엇을 평론하시겠어요?' : `‘${query}’`}</h1>
					{/*
					  The result summary is the only thing that can announce "the results
					  changed": /search never navigates, the heading is the query the
					  reader just typed, and the results themselves are an unlabelled
					  grid. It carried no live-region semantics at all, so a screen-reader
					  user got silence on every search. It is announced now — and it is
					  deliberately rendered here, unconditionally, rather than inside the
					  empty/results branch: a live region has to be in the DOM BEFORE its
					  content arrives, because a region that is inserted together with its
					  text announces nothing.
					*/}
					<span className="mono gs-rhead-total" role="status" aria-live="polite">{headline}</span>
					<PageField value={input} onType={onType} onEnter={() => onSubmit(input)} />
				</div>
				{hasResults && (
					// These are filter toggles, not tabs: 전체 shows four panels at once,
					// so there is no one tab ↔ one tabpanel relationship for a tablist to
					// describe. The old role="tab"/role="tablist" pair promised a
					// structure the page does not have — no tabpanel, no aria-controls,
					// no roving focus — which reads worse to AT than the plain toggle
					// group these actually are.
					<div className="gs-pills" role="group" aria-label="결과 유형 필터">
						{pills.map(([v, label, n]) => (
							<button
								key={v}
								type="button"
								aria-pressed={filter === v}
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

			{failed && (
				<div className="gs-noresults">
					<p className="serif gs-nr-lead"><em>검색 결과를 불러오지 못했습니다.</em></p>
					<p className="serif gs-nr-sub">서버 또는 네트워크 문제로 요청이 완료되지 않았습니다. 검색어 문제가 아닙니다.</p>
					<button type="button" className="gs-retry mono" onClick={retryAll}>다시 시도</button>
				</div>
			)}

			{!empty && !failed && reviewsFailed && (
				<p className="gs-idxwarn mono">
					평론 검색 목록을 불러오지 못해 평론 결과는 빠져 있습니다.
					{' '}
					<button type="button" className="gs-retry-inline mono" onClick={retryAll}>다시 시도</button>
				</p>
			)}

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
							<MoreRow kind="artist" s={s} />
						</Section>
					)}
					{show('album') && s.albums.length > 0 && (
						<Section label="앨범" count={s.albums.length}>
							<div className="gs-albgrid">{s.albums.map(a => <SearchAlbumCard key={a.id ?? a.title} a={a} />)}</div>
							<MoreRow kind="album" s={s} />
						</Section>
					)}
					{show('track') && s.tracks.length > 0 && (
						<Section label="트랙" count={s.tracks.length}>
							<div className="gs-trklist">{s.tracks.map((t, i) => <SearchTrackRow key={t.id ?? `${t.title}${i}`} t={t} no={i + 1} />)}</div>
							<MoreRow kind="track" s={s} />
						</Section>
					)}
				</div>
			)}
		</>
	)
}
