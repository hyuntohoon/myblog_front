// FEAT-today-buckit Step 6 — track picker modal for the owner's "today's song"
// post. Built on the shared `useMusicSearch` core (same DB→Spotify-sync flow as
// the writer / AddAlbumModal), but renders TRACKS and maps a picked TrackHit to
// the PUT /api/todays-pick body. The parent owns the actual API call.
//
// FEAT-todays-pick-queue Step 4 — the modal is now two tabs: 검색 (the original
// search-and-post flow, plus a per-row "큐에 담기" side button) and 큐 (the
// owner's private staging queue, newest-first, with promote/remove per row).
// Promote is server-atomic (posts the pick AND consumes the queue row), so it
// finishes through `onPromoted`, not `onPick` — the parent treats both the same.
//
// FEAT-todays-pick-liked-tab — a third tab, 좋아요: the owner's Spotify saved
// tracks (the same GET /api/library/saved-tracks the dashboard's LikedBoard
// reads), so the day's song can be picked from what the owner already liked
// instead of being searched for or pre-staged. Rows carry DB ids already, so
// they post/queue through the SAME payload shape as a search hit — no re-resolve.
//
// recallTypes=['track','artist']: we render tracks, but REQUEST artist so the DB
// endpoint's artist→track expansion fires (searching an artist by name returns
// their tracks) — same rationale as AddAlbumModal's ['album','artist'].
import type { ChangeEvent, KeyboardEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { TrackHit } from '@lib/useMusicSearch'
import { useMusicSearch } from '@lib/useMusicSearch'
import { useDismissable } from '@lib/useDismissable'
import { useScrollLock } from '@lib/useScrollLock'
import { ResultRow, SourceTag } from '@components/search/atoms'
import type { SavedTrack } from '@components/member/analysis.api'
import { listSavedTracks } from '@components/member/analysis.api'
import type { DailyPick, DailyPickQueueItem, UpsertTodaysPick } from '@lib/todaysPick'
import { addToPickQueue, getPickQueue, promoteFromPickQueue, removeFromPickQueue } from '@lib/todaysPick'
// The qb-* modal shell. This island renders on the HOME page, which never loads
// member.css — without this import the scrim/dialog/scroll-container ship
// unstyled and the modal collapses into the page flow. Row visuals (.gs-row)
// come from search.css, already site-wide via layout.astro.
import '@styles/modal.css'

const MUSIC = import.meta.env.PUBLIC_API_URL as string

interface Props {
	/** Called with the PUT body once a track is resolved to DB ids. */
	onPick: (payload: UpsertTodaysPick) => Promise<boolean>
	/** Called with the already-posted pick after a queue promote succeeds. */
	onPromoted: (pick: DailyPick) => void
	onClose: () => void
}

type Tab = 'search' | 'queue' | 'liked'
interface Pending { key: string, action: 'pick' | 'queue' }

// 좋아요 tab. The filter is client-side, so the WHOLE set has to be resident or
// the filter would silently only search the pages already fetched. The endpoint
// caps `limit` at 500/call, so we accumulate by offset up to LIKED_CEILING and
// say so on screen when the set is larger (never a silent truncation).
const LIKED_PAGE = 500
const LIKED_CEILING = 2000
// Rendering cap — how many filtered rows go into the DOM before "더 보기". This
// one costs no network; it only keeps a 1000-row modal from painting at once.
const LIKED_RENDER_STEP = 60

/** A saved track flattened for the picker: display fields + the post/queue payload. */
interface LikedRow {
	/** spotify_track_id — stable key. */
	key: string
	title: string
	artist: string
	albumTitle: string | null
	cover: string | null
	/**
	 * null ⇒ not postable. `daily_picks.track_id`/`album_id` are both NOT NULL, so a
	 * liked track whose track (or album) is not in our catalog cannot be posted or
	 * queued — same refusal the 검색 tab applies to a Spotify-only hit.
	 */
	payload: UpsertTodaysPick | null
}

function toLikedRow(t: SavedTrack): LikedRow {
	const title = t.track_name
	const artist = t.artist_name ?? '—'
	const cover = t.album?.cover_url ?? null
	const albumId = t.album_id ?? null
	return {
		key: t.spotify_track_id,
		title,
		artist,
		albumTitle: t.album_name ?? null,
		cover,
		payload: (t.track_id && albumId) ?
			{
					track_id: t.track_id,
					album_id: albumId,
					title,
					artist,
					cover_url: cover,
					spotify_track_id: t.spotify_track_id,
				} :
			null,
	}
}

export default function TodaySongPicker({ onPick, onPromoted, onClose }: Props) {
	const search = useMusicSearch({ recallTypes: ['track', 'artist'] })
	const [tab, setTab] = useState<Tab>('search')
	const [pending, setPending] = useState<Pending | null>(null)
	const [notice, setNotice] = useState('')
	// null = not loaded (initial fetch pending or failed) — the 큐 tab shows a
	// loading/retry state; once loaded, add/remove/promote keep it in sync.
	const [queue, setQueue] = useState<DailyPickQueueItem[] | null>(null)
	const [queueLoading, setQueueLoading] = useState(false)
	const [queueBusyId, setQueueBusyId] = useState<string | null>(null)
	// null = not loaded (never opened, still loading the first page, or failed).
	// Loaded lazily on the tab's first open — the home page should not pay for
	// ~1000 saved tracks just because the modal was opened to search.
	const [liked, setLiked] = useState<LikedRow[] | null>(null)
	const [likedLoading, setLikedLoading] = useState(false)
	const [likedTotal, setLikedTotal] = useState(0)
	const [likedFilter, setLikedFilter] = useState('')
	const [likedShown, setLikedShown] = useState(LIKED_RENDER_STEP)
	const inputRef = useRef<HTMLInputElement>(null)
	const modalRef = useRef<HTMLDivElement>(null)

	// ESC + focus trap + focus restore; autoFocus off — focus the search input.
	useDismissable(true, onClose, modalRef, { autoFocus: false, inertBackground: true })

	useEffect(() => {
		inputRef.current?.focus()
	}, [])

	useScrollLock()

	// Load the queue once on open — feeds the tab count badge and lets a
	// successful "큐에 담기" prepend into an already-materialized list.
	useEffect(() => {
		void loadQueue()
	}, [])

	async function loadQueue() {
		setQueueLoading(true)
		try {
			setQueue(await getPickQueue())
		}
		finally {
			setQueueLoading(false)
		}
	}

	/**
	 * Fetch the whole 좋아요 set (offset pages of LIKED_PAGE, up to LIKED_CEILING)
	 * so the client-side filter searches everything the tab claims to hold. Any
	 * page failing leaves `liked` at null → the tab shows its retry state.
	 */
	async function loadLiked() {
		setLikedLoading(true)
		try {
			const rows: LikedRow[] = []
			let total = 0
			do {
				const page = await listSavedTracks(LIKED_PAGE, rows.length)
				total = page.total
				if (page.items.length === 0)
					break
				rows.push(...page.items.map(toLikedRow))
			} while (rows.length < Math.min(total, LIKED_CEILING))
			setLikedTotal(total)
			setLiked(rows)
		}
		catch {
			setLiked(null)
		}
		finally {
			setLikedLoading(false)
		}
	}

	// Auto-search the DB as the query changes (debounced, same UX as AddAlbumModal).
	useEffect(() => {
		if (!search.query.trim())
			return
		const id = setTimeout(() => void search.runDbSearch(), 200)
		return () => clearTimeout(id)
	}, [search.query, search.runDbSearch])

	function doSearch() {
		setNotice('')
		void search.runDbSearch()
	}

	function doSpotify() {
		setNotice('')
		void search.runSpotifySync()
	}

	function onQueryChange(e: ChangeEvent<HTMLInputElement>) {
		search.setQuery(e.target.value)
		if (notice)
			setNotice('')
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault()
			doSearch()
		}
	}

	function clearSearch() {
		search.reset()
		setNotice('')
	}

	function switchTab(next: Tab) {
		setTab(next)
		setNotice('')
		// A failed initial load gets a fresh chance whenever the 큐 tab opens.
		if (next === 'queue' && queue === null && !queueLoading)
			void loadQueue()
		// Same for 좋아요, which additionally defers its FIRST load to this point.
		if (next === 'liked' && liked === null && !likedLoading)
			void loadLiked()
	}

	/**
	 * Resolve a Spotify-only hit to a DB album id (single attempt; absorb may lag).
	 * track_id stays null for Spotify-only hits; we only need album_id for the click
	 * target, but the PUT requires both track_id AND album_id NOT NULL, so a hit
	 * without a DB track id cannot be posted (the absorb must complete first).
	 */
	async function resolveAlbumDbId(hit: TrackHit): Promise<string | null> {
		if (hit.albumId)
			return hit.albumId
		const spotifyAlbum = hit.albumSpotifyId
		if (!spotifyAlbum)
			return null
		try {
			const r = await fetch(`${MUSIC}/api/music/albums/by-spotify/${encodeURIComponent(spotifyAlbum)}`)
			if (!r.ok)
				return null
			const json = await r.json() as { album?: { id?: string } }
			return json.album?.id ?? null
		}
		catch {
			return null
		}
	}

	/**
	 * Validate a hit and build the shared post/queue body (identical field sets).
	 * track_id is NOT NULL in V39/V48 — a Spotify-only hit (no DB track id) can't
	 * be posted OR queued until the SQS absorb completes (OQ2: keep the refusal).
	 * Sets the notice and returns null on any refusal.
	 */
	async function resolvePayload(hit: TrackHit): Promise<UpsertTodaysPick | null> {
		if (!hit.id) {
			setNotice('이 곡은 아직 DB에 없어요. 잠시 후 다시 시도해주세요.')
			return null
		}
		if (!hit.spotifyId) {
			setNotice('이 곡은 Spotify id가 없어 올릴 수 없어요.')
			return null
		}
		const albumId = await resolveAlbumDbId(hit)
		if (!albumId) {
			setNotice('앨범을 찾을 수 없어요. 잠시 후 다시 시도해주세요.')
			return null
		}
		return {
			track_id: hit.id,
			album_id: albumId,
			title: hit.title,
			artist: hit.artist ?? '—',
			cover_url: hit.cover,
			spotify_track_id: hit.spotifyId,
		}
	}

	function hitKey(hit: TrackHit): string {
		return hit.id ?? hit.spotifyId ?? hit.title
	}

	// ── post / stage cores, shared by the 검색 and 좋아요 tabs ──────────────────
	// A 좋아요 row already carries DB ids, so it skips `resolvePayload` entirely and
	// hands the identical body straight in.

	async function postPayload(key: string, payload: UpsertTodaysPick) {
		setPending({ key, action: 'pick' })
		try {
			const ok = await onPick(payload)
			if (!ok)
				setNotice('올리지 못했어요. 다시 시도해주세요.')
		}
		finally {
			setPending(null)
		}
	}

	async function stagePayload(key: string, payload: UpsertTodaysPick) {
		setPending({ key, action: 'queue' })
		try {
			const saved = await addToPickQueue(payload)
			if (!saved) {
				setNotice('큐에 담지 못했어요. 다시 시도해주세요.')
				return
			}
			// Re-adding the same track is a server no-op returning the existing row.
			setQueue(q => (q && !q.some(r => r.id === saved.id)) ? [saved, ...q] : q)
			setNotice(`큐에 담았어요 — ${saved.title}`)
		}
		finally {
			setPending(null)
		}
	}

	async function pick(hit: TrackHit) {
		setNotice('')
		const key = hitKey(hit)
		// Pending covers the resolve too — it makes a network call of its own.
		setPending({ key, action: 'pick' })
		const payload = await resolvePayload(hit)
		if (!payload) {
			setPending(null)
			return
		}
		await postPayload(key, payload)
	}

	async function queueAdd(hit: TrackHit) {
		setNotice('')
		const key = hitKey(hit)
		setPending({ key, action: 'queue' })
		const payload = await resolvePayload(hit)
		if (!payload) {
			setPending(null)
			return
		}
		await stagePayload(key, payload)
	}

	function likedPick(row: LikedRow) {
		setNotice('')
		if (!row.payload)
			return
		void postPayload(row.key, row.payload)
	}

	function likedQueueAdd(row: LikedRow) {
		setNotice('')
		if (!row.payload)
			return
		void stagePayload(row.key, row.payload)
	}

	async function promote(item: DailyPickQueueItem) {
		setNotice('')
		setQueueBusyId(item.id)
		try {
			const saved = await promoteFromPickQueue(item.id)
			if (!saved) {
				setNotice('올리지 못했어요. 다시 시도해주세요.')
				return
			}
			// The server consumed the row in the same transaction as the pick upsert.
			setQueue(q => q ? q.filter(r => r.id !== item.id) : q)
			onPromoted(saved)
		}
		finally {
			setQueueBusyId(null)
		}
	}

	async function removeItem(item: DailyPickQueueItem) {
		setNotice('')
		setQueueBusyId(item.id)
		try {
			const ok = await removeFromPickQueue(item.id)
			if (!ok) {
				setNotice('제거하지 못했어요. 다시 시도해주세요.')
				return
			}
			setQueue(q => q ? q.filter(r => r.id !== item.id) : q)
		}
		finally {
			setQueueBusyId(null)
		}
	}

	// Filter over the WHOLE resident set (title / artist / album), not just the
	// painted slice — LIKED_RENDER_STEP caps rendering, never matching.
	const likedFiltered = useMemo(() => {
		if (!liked)
			return []
		const q = likedFilter.trim().toLowerCase()
		if (!q)
			return liked
		return liked.filter(r =>
			r.title.toLowerCase().includes(q) ||
			r.artist.toLowerCase().includes(q) ||
			(r.albumTitle?.toLowerCase().includes(q) ?? false),
		)
	}, [liked, likedFilter])

	// A new filter starts the render window over, so results are not hidden behind
	// a "더 보기" left scrolled from the previous query.
	useEffect(() => {
		setLikedShown(LIKED_RENDER_STEP)
	}, [likedFilter])

	const statusText = notice || (tab === 'search' ? search.status : '')

	return (
		<div className="qb-modal-scrim qb-modal-scrim--add" onClick={onClose} role="presentation">
			<div ref={modalRef} className="qb-modal qb-modal--add" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="오늘의 곡 올리기">
				<header className="qb-modal-head">
					<div>
						<p className="qb-modal-kicker">오늘의 곡</p>
						<h2 className="qb-modal-title">곡 고르기</h2>
					</div>
					<button type="button" className="qb-modal-close" onClick={onClose} aria-label="닫기">✕</button>
				</header>

				<div className="qb-modal-tabs" role="tablist" aria-label="곡 고르기 탭">
					<button type="button" role="tab" aria-selected={tab === 'search'} className={`qb-modal-tab${tab === 'search' ? ' is-active' : ''}`} onClick={() => switchTab('search')}>검색</button>
					<button type="button" role="tab" aria-selected={tab === 'queue'} className={`qb-modal-tab${tab === 'queue' ? ' is-active' : ''}`} onClick={() => switchTab('queue')}>
						큐
						{queue !== null && <span className="qb-modal-tab-count">{queue.length}</span>}
					</button>
					<button type="button" role="tab" aria-selected={tab === 'liked'} className={`qb-modal-tab${tab === 'liked' ? ' is-active' : ''}`} onClick={() => switchTab('liked')}>
						좋아요
						{liked !== null && <span className="qb-modal-tab-count">{likedTotal}</span>}
					</button>
				</div>

				{tab === 'search' && (
					<div className="qb-modal-searchrow">
						<div className="qb-modal-search">
							<span className="qb-modal-search-icon" aria-hidden="true">⌕</span>
							<input
								ref={inputRef}
								className="qb-modal-search-input"
								placeholder="오늘의 곡을 검색…"
								value={search.query}
								onChange={onQueryChange}
								onKeyDown={onKeyDown}
								autoComplete="off"
							/>
							{search.query && <button type="button" className="qb-modal-search-clear" onClick={clearSearch}>✕</button>}
						</div>
						<button type="button" className="qb-modal-search-btn" onClick={doSearch} disabled={search.loading}>검색</button>
						<button
							type="button"
							className="qb-modal-spotify-btn"
							onClick={doSpotify}
							disabled={search.loading || search.spotifyCooldown}
							title={search.spotifyCooldown ? '잠시 후 다시 시도 (Spotify 쿨다운)' : 'Spotify에서 검색 + DB 동기화'}
						>
							Spotify 싱크
						</button>
					</div>
				)}

				{tab === 'liked' && liked !== null && (
					<div className="qb-modal-searchrow">
						<div className="qb-modal-search">
							<span className="qb-modal-search-icon" aria-hidden="true">⌕</span>
							<input
								className="qb-modal-search-input"
								placeholder="좋아요한 곡 안에서 거르기…"
								value={likedFilter}
								onChange={e => setLikedFilter(e.target.value)}
								autoComplete="off"
								aria-label="좋아요 목록 거르기"
							/>
							{likedFilter && <button type="button" className="qb-modal-search-clear" onClick={() => setLikedFilter('')}>✕</button>}
						</div>
					</div>
				)}

				{statusText && <p className="qb-modal-status">{statusText}</p>}
				{search.syncRequested && (
					<button type="button" className="qb-modal-refresh mono" onClick={() => void search.runDbSearch()} disabled={search.loading}>
						{search.loading ? '불러오는 중…' : '카탈로그 새로고침'}
					</button>
				)}

				{tab === 'search' && (
					<div className="qb-modal-results">
						{search.loading && <div className="qb-modal-empty">검색 중…</div>}
						{!search.loading && search.tracks.map((hit) => {
							const key = hitKey(hit)
							const isSpotify = hit.source === 'spotify'
							const pendingThis = pending?.key === key
							const trailing = (pendingThis && pending.action === 'pick') ?
								<span className="gs-row-tag">올리는 중…</span> :
								isSpotify ?
									<SourceTag /> :
									<span className="gs-row-tag">올리기 +</span>
							return (
								<div className="qb-pickrow" key={`${hit.source}:${key}`}>
									<ResultRow
										name={hit.title}
										src={hit.cover}
										title={hit.title}
										sub={[hit.artist ?? '—', hit.albumTitle].filter(Boolean).join(' · ')}
										source={isSpotify ? 'spotify' : 'db'}
										trailing={trailing}
										action={{ type: 'button', onClick: () => void pick(hit), disabled: pending !== null }}
									/>
									<button
										type="button"
										className="qb-pickrow-side"
										onClick={() => void queueAdd(hit)}
										disabled={pending !== null}
									>
										{(pendingThis && pending.action === 'queue') ? '담는 중…' : '큐에 담기'}
									</button>
								</div>
							)
						})}
						{!search.loading && search.hasMore.track > 0 && (
							<button
								type="button"
								className="qb-modal-more"
								onClick={() => void search.loadMore('track')}
								disabled={search.loadingMore !== null}
							>
								{search.loadingMore === 'track' ? '불러오는 중…' : '더 보기'}
							</button>
						)}
					</div>
				)}

				{tab === 'queue' && (
					<div className="qb-modal-results">
						{queueLoading && queue === null && <div className="qb-modal-empty">큐 불러오는 중…</div>}
						{!queueLoading && queue === null && (
							<div className="qb-modal-empty">
								큐를 불러오지 못했어요.
								{' '}
								<button type="button" className="qb-modal-more" onClick={() => void loadQueue()}>다시 시도</button>
							</div>
						)}
						{queue !== null && queue.length === 0 && (
							<div className="qb-modal-empty">큐가 비어 있어요. 검색 탭에서 곡을 담아보세요.</div>
						)}
						{queue !== null && queue.map((item) => {
							const busyThis = queueBusyId === item.id
							return (
								<div className="qb-pickrow" key={item.id}>
									<ResultRow
										name={item.title}
										src={item.cover_url}
										title={item.title}
										sub={item.artist}
										action={{ type: 'static' }}
									/>
									<button
										type="button"
										className="qb-pickrow-side qb-pickrow-side--primary"
										onClick={() => void promote(item)}
										disabled={queueBusyId !== null}
									>
										{busyThis ? '올리는 중…' : '오늘의 곡으로 ↑'}
									</button>
									<button
										type="button"
										className="qb-pickrow-side qb-pickrow-side--danger"
										onClick={() => void removeItem(item)}
										disabled={queueBusyId !== null}
									>
										제거
									</button>
								</div>
							)
						})}
					</div>
				)}

				{tab === 'liked' && (
					<div className="qb-modal-results">
						{likedLoading && <div className="qb-modal-empty">좋아요 목록 불러오는 중…</div>}
						{!likedLoading && liked === null && (
							<div className="qb-modal-empty">
								좋아요 목록을 불러오지 못했어요.
								{' '}
								<button type="button" className="qb-modal-more" onClick={() => void loadLiked()}>다시 시도</button>
							</div>
						)}
						{!likedLoading && liked !== null && liked.length === 0 && (
							<div className="qb-modal-empty">좋아요한 곡이 없어요.</div>
						)}
						{!likedLoading && liked !== null && liked.length > 0 && likedFiltered.length === 0 && (
							<div className="qb-modal-empty">{`'${likedFilter}'와 맞는 곡이 없어요.`}</div>
						)}
						{!likedLoading && liked !== null && likedTotal > liked.length && (
							<p className="qb-modal-status">
								{`좋아요 ${likedTotal}곡 중 최근 ${liked.length}곡에서 고릅니다.`}
							</p>
						)}
						{!likedLoading && likedFiltered.slice(0, likedShown).map((row) => {
							const pendingThis = pending?.key === row.key
							const postable = row.payload !== null
							return (
								<div className="qb-pickrow" key={row.key}>
									<ResultRow
										name={row.title}
										src={row.cover}
										title={row.title}
										sub={[row.artist, row.albumTitle].filter(Boolean).join(' · ')}
										trailing={postable ? undefined : <span className="gs-row-tag">카탈로그에 없음</span>}
										action={{ type: 'static' }}
									/>
									<button
										type="button"
										className="qb-pickrow-side qb-pickrow-side--primary"
										onClick={() => likedPick(row)}
										disabled={!postable || pending !== null}
										title={postable ? undefined : '이 곡은 아직 카탈로그에 없어 올릴 수 없어요.'}
									>
										{(pendingThis && pending.action === 'pick') ? '올리는 중…' : '오늘의 곡으로 ↑'}
									</button>
									<button
										type="button"
										className="qb-pickrow-side"
										onClick={() => likedQueueAdd(row)}
										disabled={!postable || pending !== null}
										title={postable ? undefined : '이 곡은 아직 카탈로그에 없어 담을 수 없어요.'}
									>
										{(pendingThis && pending.action === 'queue') ? '담는 중…' : '큐에 담기'}
									</button>
								</div>
							)
						})}
						{!likedLoading && likedFiltered.length > likedShown && (
							<button
								type="button"
								className="qb-modal-more"
								onClick={() => setLikedShown(n => n + LIKED_RENDER_STEP)}
							>
								{`더 보기 (${likedShown}/${likedFiltered.length})`}
							</button>
						)}
					</div>
				)}
			</div>
		</div>
	)
}
