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
// recallTypes=['track','artist']: we render tracks, but REQUEST artist so the DB
// endpoint's artist→track expansion fires (searching an artist by name returns
// their tracks) — same rationale as AddAlbumModal's ['album','artist'].
import type { ChangeEvent, KeyboardEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { TrackHit } from '@lib/useMusicSearch'
import { useMusicSearch } from '@lib/useMusicSearch'
import { useDismissable } from '@lib/useDismissable'
import { useScrollLock } from '@lib/useScrollLock'
import { ResultRow, SourceTag } from '@components/search/atoms'
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

type Tab = 'search' | 'queue'
interface Pending { key: string, action: 'pick' | 'queue' }

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
	const inputRef = useRef<HTMLInputElement>(null)
	const modalRef = useRef<HTMLDivElement>(null)

	// ESC + focus trap + focus restore; autoFocus off — focus the search input.
	useDismissable(true, onClose, modalRef, { autoFocus: false })

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

	async function pick(hit: TrackHit) {
		setNotice('')
		setPending({ key: hitKey(hit), action: 'pick' })
		try {
			const payload = await resolvePayload(hit)
			if (!payload)
				return
			const ok = await onPick(payload)
			if (!ok)
				setNotice('올리지 못했어요. 다시 시도해주세요.')
		}
		finally {
			setPending(null)
		}
	}

	async function queueAdd(hit: TrackHit) {
		setNotice('')
		setPending({ key: hitKey(hit), action: 'queue' })
		try {
			const payload = await resolvePayload(hit)
			if (!payload)
				return
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

				{statusText && <p className="qb-modal-status">{statusText}</p>}

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
			</div>
		</div>
	)
}
