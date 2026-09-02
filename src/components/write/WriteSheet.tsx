// The unified write entry (FEAT-album-review-authoring Step 4 — C1, OQ9).
//
// One affordance in the header for everyone who is signed in, opening one sheet
// that shows only what the viewer may actually write:
//
//   owner  → [평가] or [평론] → album → 평가 lands in the rating editor,
//                                       평론 opens /write with that album
//   member → album → the rating editor
//
// Before this, the header's 글쓰기 went straight to /write and was hidden from
// members entirely, so a member had NO write entry at all outside an album page
// — and a member who typed /write got the editor (audit E-5, closed in the same
// change by scripts/ownerOnly.guard.ts).
//
// WHAT THIS DELIBERATELY DOES NOT DO: it does not reimplement the 평가 editor.
// Picking 평가 closes the sheet and fires `openAlbum({ openRating: true })`, so
// the writing happens in AlbumRatingBlock inside the app-wide album overlay —
// the SAME editor an album page, a home card and a bucket tile already open. A
// second star-and-one-liner form would be a second place for the 60-char cap,
// the 재평가 path and the 평론 후보 mark to drift. That reuse is also what makes
// C1's "카드에서 들어오면 그 앨범이 이미 선택된 상태" true without new controls on
// the cards: every route ends at one editor, which is the property C1 asks for.
//
// The sheet is mounted once in layout.astro (sibling to AlbumOverlay) and opens
// on `ent:open-write`. It renders nothing until then.
import type { ChangeEvent, KeyboardEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { AlbumHit } from '@lib/useMusicSearch'
import { isLoggedIn } from '@lib/auth'
import { ENT_OPEN_WRITE, openAlbum } from '@lib/entityEvents'
import { isOwnerUser } from '@lib/owner'
import { useDismissable } from '@lib/useDismissable'
import { useMusicSearch } from '@lib/useMusicSearch'
import { useScrollLock } from '@lib/useScrollLock'
import '../../styles/write-sheet.css'

const MUSIC = import.meta.env.PUBLIC_API_URL as string

/** What the author picked. `null` while the owner is still choosing. */
type Kind = 'rating' | 'review'

export default function WriteSheet() {
	const [open, setOpen] = useState(false)

	useEffect(() => {
		const onOpen = () => {
			// The header hides its trigger when logged out, so this is a guard
			// against a stray dispatch, not a code path a visitor can reach.
			if (isLoggedIn())
				setOpen(true)
		}
		const onNav = () => setOpen(false)
		window.addEventListener(ENT_OPEN_WRITE, onOpen)
		// Not per-page state — close across ClientRouter swaps, like AlbumOverlay.
		document.addEventListener('astro:before-swap', onNav)
		return () => {
			window.removeEventListener(ENT_OPEN_WRITE, onOpen)
			document.removeEventListener('astro:before-swap', onNav)
		}
	}, [])

	if (!open)
		return null
	return <Sheet onClose={() => setOpen(false)} />
}

function Sheet({ onClose }: { onClose: () => void }) {
	const sheetRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLInputElement>(null)
	/**
	 * null = not resolved yet. Three states, not two: the kind step must not
	 * flash for a member, and the album step must not skip the kind step for the
	 * owner, so neither can render until this settles. `isOwnerUser()` is cached
	 * per access token and the header has normally already resolved it, so this
	 * is usually one render, not a visible wait.
	 */
	const [isOwner, setIsOwner] = useState<boolean | null>(null)
	const [kind, setKind] = useState<Kind | null>(null)
	const [pendingId, setPendingId] = useState<string | null>(null)
	// A pick outcome (a Spotify-only album with no catalog row yet). Distinct
	// from the hook's `status`, which is about the SEARCH.
	const [notice, setNotice] = useState('')

	// recallTypes=['album','artist']: albums only are rendered, but the DB
	// endpoint needs 'artist' or an artist-name query returns zero rows. Same
	// reason AddAlbumModal passes it — see useMusicSearch.
	const search = useMusicSearch({ recallTypes: ['album', 'artist'] })

	useDismissable(true, onClose, sheetRef, { autoFocus: false, inertBackground: true })
	useScrollLock()

	useEffect(() => {
		let alive = true
		isOwnerUser().then((v) => {
			if (!alive)
				return
			setIsOwner(v)
			// A member has exactly one thing they may write, so asking is noise.
			if (!v)
				setKind('rating')
		})
		return () => {
			alive = false
		}
	}, [])

	// Focus the search box as soon as the album step is the one on screen.
	useEffect(() => {
		if (kind != null)
			inputRef.current?.focus()
	}, [kind])

	// Debounced DB search, same 200ms as the 담기 modal and the header search.
	useEffect(() => {
		if (!search.query.trim())
			return
		const id = setTimeout(() => void search.runDbSearch(), 200)
		return () => clearTimeout(id)
	}, [search.query, search.runDbSearch])

	/** Resolve a Spotify-only hit to a catalog album id. Null when there is none. */
	async function resolveDbId(hit: AlbumHit): Promise<string | null> {
		if (hit.id)
			return hit.id
		if (!hit.spotifyId)
			return null
		try {
			const r = await fetch(`${MUSIC}/api/music/albums/by-spotify/${encodeURIComponent(hit.spotifyId)}`)
			if (!r.ok)
				return null
			const json = await r.json() as { album?: { id?: string } }
			return json.album?.id ?? null
		}
		catch {
			return null
		}
	}

	async function pick(hit: AlbumHit) {
		const key = hit.id ?? hit.spotifyId ?? hit.title
		setPendingId(key)
		setNotice('')
		try {
			const albumId = await resolveDbId(hit)
			if (!albumId) {
				// A Spotify row with no catalog album behind it yet. Both destinations
				// need a real catalog id — the rating write is keyed by it and the
				// editor loads the album from it — so this stops here rather than
				// handing on a foreign-namespace id (the `unresolved` hazard
				// OpenAlbumDetail documents).
				setNotice('아직 카탈로그에 없는 앨범이에요. Spotify 싱크 후 다시 검색해 주세요.')
				return
			}
			if (kind === 'review') {
				// Full page nav on purpose: /write is a different document with its own
				// editor bundle and its own owner guard.
				window.location.assign(`/write?album=${encodeURIComponent(albumId)}`)
				return
			}
			// 평가 — hand off to the one editor. Close FIRST: the overlay is a sibling
			// island and both use useScrollLock/inertBackground, so leaving this sheet
			// mounted would stack two modals over the same page.
			onClose()
			openAlbum({
				albumId,
				title: hit.title,
				artist: hit.artist ?? undefined,
				cover: hit.cover,
				year: hit.year ? Number(hit.year) : undefined,
				openRating: true,
			})
		}
		finally {
			setPendingId(null)
		}
	}

	function onQueryChange(e: ChangeEvent<HTMLInputElement>) {
		search.setQuery(e.target.value)
		if (notice)
			setNotice('')
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault()
			setNotice('')
			void search.runDbSearch()
		}
	}

	function backToKind() {
		setKind(null)
		setNotice('')
	}

	function runSpotifySync() {
		setNotice('')
		void search.runSpotifySync()
	}

	const statusText = notice || search.status

	return (
		<div className="ws-scrim" onClick={onClose} role="presentation">
			<div
				ref={sheetRef}
				className="ws-sheet"
				onClick={e => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-label="쓰기"
			>
				<header className="ws-head">
					<div>
						<p className="mono ws-kicker">쓰기</p>
						<h2 className="serif ws-title">
							{kind == null ?
								'무엇을 쓰시겠어요?' :
								kind === 'review' ?
									'어떤 앨범의 평론인가요?' :
									'어떤 앨범을 평가할까요?'}
						</h2>
					</div>
					<button type="button" className="ws-close" onClick={onClose} aria-label="닫기">✕</button>
				</header>

				{isOwner == null && <p className="mono ws-status">불러오는 중…</p>}

				{/* Kind step — owner only. A member never sees it (하드 룰 1: 평론 is
				    editors-only, and C1 says do not render what they cannot write). */}
				{isOwner === true && kind == null && (
					<div className="ws-kinds">
						<button type="button" className="ws-kind" onClick={() => setKind('rating')}>
							<span className="serif ws-kind-name">평가</span>
							<span className="sans ws-kind-desc">별점과 한 줄. 남기면 바로 공개됩니다.</span>
						</button>
						<button type="button" className="ws-kind" onClick={() => setKind('review')}>
							<span className="serif ws-kind-name">평론</span>
							<span className="sans ws-kind-desc">편집 지면에 싣는 글. 에디터가 열립니다.</span>
						</button>
					</div>
				)}

				{/* Album step. */}
				{kind != null && (
					<>
						{isOwner === true && (
							<button type="button" className="mono ws-back" onClick={backToKind}>← 종류 다시 고르기</button>
						)}
						<div className="ws-searchrow">
							<div className="ws-search">
								<span className="ws-search-icon" aria-hidden="true">⌕</span>
								<input
									ref={inputRef}
									className="sans ws-search-input"
									placeholder="앨범을 검색…"
									value={search.query}
									onChange={onQueryChange}
									onKeyDown={onKeyDown}
									autoComplete="off"
									aria-label="앨범 검색"
								/>
							</div>
							<button
								type="button"
								className="mono ws-btn"
								onClick={runSpotifySync}
								disabled={search.loading || search.spotifyCooldown}
								title={search.spotifyCooldown ? '잠시 후 다시 시도 (Spotify 쿨다운)' : 'Spotify에서 검색 + 카탈로그 동기화'}
							>
								Spotify 싱크
							</button>
						</div>

						{statusText && <p className="mono ws-status" role="status">{statusText}</p>}

						<ul className="ws-results">
							{search.albums.map((hit) => {
								const key = hit.id ?? hit.spotifyId ?? hit.title
								return (
									<li key={key}>
										<button
											type="button"
											className="ws-hit"
											onClick={() => void pick(hit)}
											disabled={pendingId != null}
										>
											{hit.cover ?
												<img className="ws-hit-cover" src={hit.cover} alt="" loading="lazy" /> :
												<span className="ws-hit-cover ws-hit-cover--blank" aria-hidden="true" />}
											<span className="ws-hit-text">
												<span className="serif ws-hit-title">{hit.title}</span>
												<span className="sans ws-hit-meta">
													{[hit.artist, hit.year].filter(Boolean).join(' · ')}
												</span>
											</span>
											{pendingId === key && <span className="mono ws-hit-pending">여는 중…</span>}
										</button>
									</li>
								)
							})}
						</ul>
					</>
				)}
			</div>
		</div>
	)
}
