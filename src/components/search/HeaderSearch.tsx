// FEAT-global-search — the header search field + instant dropdown island.
// Replaces the Pagefind ⌘K dialog as the site's single global search. Public =
// DB-only (no Spotify candidate rows). Dropdown groups 평론(reviews, from the
// build-time index) + 아티스트/앨범/트랙 (unified search); artist/review rows
// navigate (hub / review page), album/track rows are non-navigable (no page).
// Enter on an active nav row goes there; otherwise → the full /search page.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReviewHit } from '@lib/reviewIndex'
import { filterReviews, loadReviews } from '@lib/reviewIndex'
import { useMusicSearch } from '@lib/useMusicSearch'
import { ResultRow } from './atoms'

const DROPDOWN_LIMIT = 4

function submitAll(q: string) {
	const v = q.trim()
	window.location.href = v ? `/search?q=${encodeURIComponent(v)}` : '/search'
}

function Group({ label, count, children }: { label: string, count: number, children: React.ReactNode }) {
	return (
		<section className="gs-group">
			<header className="gs-group-head">
				<span className="gs-group-label mono">{label}</span>
				<span className="gs-group-count mono">{count}</span>
			</header>
			<div className="gs-group-rows">{children}</div>
		</section>
	)
}

export default function HeaderSearch() {
	const s = useMusicSearch({ recallTypes: ['album', 'artist', 'track'] })
	const { setQuery: setCoreQuery, runDbSearch } = s
	const [q, setQ] = useState('')
	const [open, setOpen] = useState(false)
	const [activeIdx, setActiveIdx] = useState(-1)
	const [reviews, setReviews] = useState<ReviewHit[]>([])
	const inputRef = useRef<HTMLInputElement>(null)
	const wrapRef = useRef<HTMLDivElement>(null)
	const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	// On /search the page renders its own first-class field (M4); suppress this
	// header dropdown there so it doesn't overlay the page hero. The input still
	// works as a quick-nav (Enter → submitAll).
	const onSearchPage = typeof window !== 'undefined' && window.location.pathname.startsWith('/search')

	// ⌘K / Ctrl+K focuses the field (the single global owner, post-Pagefind)
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
				e.preventDefault()
				inputRef.current?.focus()
				setOpen(true)
			}
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [])

	// close on outside click
	useEffect(() => {
		if (!open)
			return
		const onDown = (e: MouseEvent) => {
			if (wrapRef.current && !wrapRef.current.contains(e.target as Node))
				setOpen(false)
		}
		window.addEventListener('mousedown', onDown)
		return () => window.removeEventListener('mousedown', onDown)
	}, [open])

	// debounced search + review filter as the query changes
	useEffect(() => {
		setActiveIdx(-1)
		clearTimeout(debounceRef.current)
		const v = q.trim()
		if (!v) {
			setReviews([])
			setCoreQuery('')
			return
		}
		debounceRef.current = setTimeout(() => {
			setCoreQuery(v)
			loadReviews().then(idx => setReviews(filterReviews(idx, v).slice(0, DROPDOWN_LIMIT)))
		}, 180)
		return () => clearTimeout(debounceRef.current)
	}, [q, setCoreQuery])

	// run the DB search once the core query catches up
	useEffect(() => {
		if (s.query.trim())
			runDbSearch()
	}, [s.query, runDbSearch])

	const artists = s.artists.slice(0, DROPDOWN_LIMIT)
	const albums = s.albums.slice(0, DROPDOWN_LIMIT)
	const tracks = s.tracks.slice(0, DROPDOWN_LIMIT)
	const total = reviews.length + artists.length + albums.length + tracks.length

	// flat nav targets for keyboard ↑↓/Enter, in render order
	const flatHref = useMemo<(string | null)[]>(() => [
		...reviews.map(r => `/review/${r.slug}/`),
		...artists.map(a => (a.id ? `/artist/${a.id}/` : null)),
		...albums.map(() => null),
		...tracks.map(() => null),
	], [reviews, artists, albums, tracks])

	// scroll the active row into view
	useEffect(() => {
		if (activeIdx < 0 || !wrapRef.current)
			return
		const el = wrapRef.current.querySelector(`[data-gsidx="${activeIdx}"]`)
		const box = el?.closest('.gs-drop-scroll')
		if (!el || !box)
			return
		const er = el.getBoundingClientRect()
		const br = box.getBoundingClientRect()
		if (er.bottom > br.bottom)
			box.scrollTop += er.bottom - br.bottom + 6
		else if (er.top < br.top)
			box.scrollTop -= br.top - er.top + 6
	}, [activeIdx])

	function onKeyDown(e: React.KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault()
			setOpen(true)
			setActiveIdx(i => Math.min(flatHref.length - 1, i + 1))
		}
		else if (e.key === 'ArrowUp') {
			e.preventDefault()
			setActiveIdx(i => Math.max(-1, i - 1))
		}
		else if (e.key === 'Enter') {
			e.preventDefault()
			const href = activeIdx >= 0 ? flatHref[activeIdx] : null
			if (href) {
				window.location.href = href
				return
			}
			submitAll(q)
		}
		else if (e.key === 'Escape') {
			setOpen(false)
			inputRef.current?.blur()
		}
	}

	// running cursor so each row's data-gsidx matches flatHref order
	let cursor = -1
	const idx = () => (cursor += 1)

	const footLabel = q.trim() ? `‘${q.trim()}’ 전체 결과 보기` : '둘러보기 — 전체 카탈로그'

	function onInput(e: React.ChangeEvent<HTMLInputElement>) {
		setQ(e.target.value)
		setOpen(true)
	}
	function onClear(e: React.MouseEvent) {
		e.preventDefault()
		setQ('')
		inputRef.current?.focus()
	}
	function onFootDown(e: React.MouseEvent) {
		e.preventDefault()
		submitAll(q)
	}

	return (
		<div className="gs-search" ref={wrapRef}>
			<label className={`gs-field${open ? ' is-open' : ''}`}>
				<svg className="gs-field-ic" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
					<circle cx="11" cy="11" r="7" />
					<path d="M21 21l-4.3-4.3" strokeLinecap="round" />
				</svg>
				<input
					ref={inputRef}
					id="gs-header-search"
					name="q"
					className="gs-input"
					value={q}
					placeholder="아티스트 · 앨범 · 트랙 · 평론 검색"
					aria-label="검색"
					onChange={onInput}
					onFocus={() => setOpen(true)}
					onKeyDown={onKeyDown}
					role="combobox"
					aria-expanded={open}
					aria-controls="gs-drop"
				/>
				{q ?
					(
						<button
							type="button"
							className="gs-clear"
							aria-label="지우기"
							onMouseDown={onClear}
						>
							✕
						</button>
					) :
					<kbd className="gs-kbd mono">⌘K</kbd>}
			</label>

			{open && !onSearchPage && (
				<div className="gs-drop" id="gs-drop" role="listbox">
					<div className="gs-drop-scroll">
						{!q.trim() ?
							(
								<div className="gs-drop-empty">
									<span className="serif italic gs-empty-lead">무엇을 찾으시나요?</span>
									<span className="mono gs-empty-sub">아티스트 · 앨범 · 트랙 · 평론을 한 곳에서</span>
								</div>
							) :
							total === 0 ?
								(
									<div className="gs-drop-empty">
										<span className="serif italic gs-empty-lead">
‘
{q.trim()}
’ 검색 결과 없음
          </span>
										<span className="mono gs-empty-sub">철자를 확인하거나 다른 키워드로 시도해 보세요</span>
									</div>
								) :
								(
									<div className="gs-drop-body">
										{reviews.length > 0 && (
											<Group label="평론" count={reviews.length}>
												{reviews.map((r) => {
													const i = idx()
													return (
														<ResultRow
															key={r.slug}
															name={r.album}
															src={r.cover}
															title={r.album}
															sub={[r.artist, r.year].filter(Boolean).join(' · ')}
															active={i === activeIdx}
															onHover={() => setActiveIdx(i)}
															idAttr={i}
															trailing={<span className="gs-row-go mono" aria-hidden="true">평론 →</span>}
															action={{ type: 'navigate', href: `/review/${r.slug}/` }}
														/>
													)
												})}
											</Group>
										)}
										{artists.length > 0 && (
											<Group label="아티스트" count={artists.length}>
												{artists.map((a) => {
													const i = idx()
													return (
														<ResultRow
															key={a.id ?? a.name}
															name={a.name}
															src={a.cover}
															shape="circle"
															title={a.name}
															sub="아티스트"
															active={i === activeIdx}
															onHover={() => setActiveIdx(i)}
															idAttr={i}
															trailing={a.id ? <span className="gs-row-go mono" aria-hidden="true">허브 →</span> : undefined}
															action={a.id ? { type: 'navigate', href: `/artist/${a.id}/` } : { type: 'static' }}
														/>
													)
												})}
											</Group>
										)}
										{albums.length > 0 && (
											<Group label="앨범" count={albums.length}>
												{albums.map((a) => {
													const i = idx()
													return (
														<ResultRow
															key={a.id ?? a.title}
															name={a.title}
															src={a.cover}
															title={a.title}
															sub={[a.artist, a.year].filter(Boolean).join(' · ')}
															active={i === activeIdx}
															onHover={() => setActiveIdx(i)}
															idAttr={i}
															action={{ type: 'static' }}
														/>
													)
												})}
											</Group>
										)}
										{tracks.length > 0 && (
											<Group label="트랙" count={tracks.length}>
												{tracks.map((t) => {
													const i = idx()
													return (
														<ResultRow
															key={t.id ?? t.title}
															name={t.title}
															src={t.cover}
															title={t.title}
															sub={[t.artist, t.albumTitle].filter(Boolean).join(' · ')}
															active={i === activeIdx}
															onHover={() => setActiveIdx(i)}
															idAttr={i}
															action={{ type: 'static' }}
														/>
													)
												})}
											</Group>
										)}
									</div>
								)}
					</div>
					<button
						type="button"
						className="gs-drop-foot"
						onMouseDown={onFootDown}
					>
						<span className="mono gs-foot-all">
{footLabel}
<span aria-hidden="true"> →</span>
      </span>
						<span className="gs-foot-hints mono">
							<span>
<kbd className="gs-kbd sm">↑</kbd>
<kbd className="gs-kbd sm">↓</kbd>
{' '}
이동
       </span>
							<span>
<kbd className="gs-kbd sm">↵</kbd>
{' '}
선택
       </span>
							<span>
<kbd className="gs-kbd sm">esc</kbd>
{' '}
닫기
       </span>
						</span>
					</button>
				</div>
			)}
		</div>
	)
}
