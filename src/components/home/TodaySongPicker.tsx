// FEAT-today-buckit Step 6 — track picker modal for the owner's "today's song"
// post. Built on the shared `useMusicSearch` core (same DB→Spotify-sync flow as
// the writer / AddAlbumModal), but renders TRACKS and maps a picked TrackHit to
// the PUT /api/todays-pick body. The parent owns the actual API call.
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
import type { UpsertTodaysPick } from '@lib/todaysPick'

const MUSIC = import.meta.env.PUBLIC_API_URL as string

interface Props {
	/** Called with the PUT body once a track is resolved to DB ids. */
	onPick: (payload: UpsertTodaysPick) => Promise<boolean>
	onClose: () => void
}

export default function TodaySongPicker({ onPick, onClose }: Props) {
	const search = useMusicSearch({ recallTypes: ['track', 'artist'] })
	const [pendingId, setPendingId] = useState<string | null>(null)
	const [notice, setNotice] = useState('')
	const inputRef = useRef<HTMLInputElement>(null)
	const modalRef = useRef<HTMLDivElement>(null)

	// ESC + focus trap + focus restore; autoFocus off — focus the search input.
	useDismissable(true, onClose, modalRef, { autoFocus: false })

	useEffect(() => {
		inputRef.current?.focus()
	}, [])

	useScrollLock()

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

	async function pick(hit: TrackHit) {
		const key = hit.id ?? hit.spotifyId ?? hit.title
		// track_id is NOT NULL in V39 — a Spotify-only hit (no DB track id) can't be
		// posted until the SQS absorb completes. Surface that instead of failing.
		if (!hit.id) {
			setNotice('이 곡은 아직 DB에 없어요. 잠시 후 다시 시도해주세요.')
			return
		}
		if (!hit.spotifyId) {
			setNotice('이 곡은 Spotify id가 없어 올릴 수 없어요.')
			return
		}
		setPendingId(key)
		setNotice('')
		try {
			const albumId = await resolveAlbumDbId(hit)
			if (!albumId) {
				setNotice('앨범을 찾을 수 없어요. 잠시 후 다시 시도해주세요.')
				return
			}
			const payload: UpsertTodaysPick = {
				track_id: hit.id,
				album_id: albumId,
				title: hit.title,
				artist: hit.artist ?? '—',
				cover_url: hit.cover,
				spotify_track_id: hit.spotifyId,
			}
			const ok = await onPick(payload)
			if (!ok)
				setNotice('올리지 못했어요. 다시 시도해주세요.')
		}
		finally {
			setPendingId(null)
		}
	}

	const statusText = notice || search.status

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

				{statusText && <p className="qb-modal-status">{statusText}</p>}

				<div className="qb-modal-results">
					{search.loading && <div className="qb-modal-empty">검색 중…</div>}
					{!search.loading && search.tracks.map((hit) => {
						const key = hit.id ?? hit.spotifyId ?? hit.title
						const isSpotify = hit.source === 'spotify'
						const pendingThis = pendingId === key
						const trailing = pendingThis ?
							<span className="gs-row-tag">올리는 중…</span> :
							isSpotify ?
								<SourceTag /> :
								<span className="gs-row-tag">올리기 +</span>
						return (
							<ResultRow
								key={`${hit.source}:${key}`}
								name={hit.title}
								src={hit.cover}
								title={hit.title}
								sub={[hit.artist ?? '—', hit.albumTitle].filter(Boolean).join(' · ')}
								source={isSpotify ? 'spotify' : 'db'}
								trailing={trailing}
								action={{ type: 'button', onClick: () => void pick(hit), disabled: pendingId !== null }}
							/>
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
			</div>
		</div>
	)
}
