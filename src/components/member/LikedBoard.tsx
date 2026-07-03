// 분석 버킷 → 좋아요한 트랙 (Liked Tracks) workbench. FEAT-liked-tracks-workbench
// Step 2-3. Ported from the design prototype (liked-tracks.jsx `LikedBoard`),
// adapted to real saved-track data + the member.css `lf-*` design system — no
// inline-style prototype, no localStorage persistence. The whole 좋아요 set is
// loaded via offset pagination (≤1000-row ceiling); the row table / hero /
// facets / decade / likes-flow are liked-only, while the analysis charts carry a
// 좋아요/재생 source toggle (LikedAnalysis). Row actions: 작품 상세 (onOpen) ·
// 가사 (shared TrackRow → ProfileApp lyrics mount, list view) · 평론 버킷에 담기
// (reuses BucketPickerSheet + buckets.ts) · 평론 쓰기 (/write).
import type { DetailTarget } from '@lib/member'
import type { SavedTrack } from './analysis.api'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { addBucketItem } from '@lib/buckets'
import { bucketStore, useBucketStore } from '@lib/pocketBuckit/bucketStore'
import { TrackRow } from '../shared/TrackRow'
import { listSavedTracks } from './analysis.api'
import { BucketPickerSheet } from './BucketPickerSheet'
import { LikedAnalysis } from './LikedAnalysis'
import { Cover, fmtTime, Seg } from './ui'

// Endpoint caps `limit` at 500/call; accumulate by offset to this ceiling.
const PAGE = 500
const CEILING = 1000

type SortKey = 'recent' | 'title' | 'artist' | 'album' | 'genre' | 'length'
type View = 'list' | 'card'
type SortDir = 'asc' | 'desc'
type ClassifyBy = 'genre' | 'artist'

/** A flattened, display-ready view of one saved track. */
export interface LikedRowVM {
	/** spotify_track_id — stable React key. */
	id: string
	track: string
	artist: string
	albumName: string
	/** DB album id — present only for catalogued tracks (gates promote/detail). */
	albumId: string | null
	cover: string | null
	/** Release year (null when uncatalogued / no release_date). */
	year: number | null
	/** `${decade}년대` or null. */
	decade: string | null
	/** Primary resolved genre, else '미분류'. */
	genre: string
	/** Raw ISO added_at — for weekly likes-flow bucketing + recency sort. */
	addedAtRaw: string
	/** `YYYY.MM.DD` formatted added_at. */
	likedAt: string
	/** Track length in ms (FEAT-liked-tracks-workbench Step 4); null when unknown / pre-backfill. */
	durationMs: number | null
	/** `m:ss` formatted length, or '' when unknown. */
	durationLabel: string
}

const SORT_OPTS: { v: SortKey, label: string }[] = [
	{ v: 'recent', label: '최근 추가' },
	{ v: 'title', label: '제목' },
	{ v: 'artist', label: '아티스트' },
	{ v: 'album', label: '앨범' },
	{ v: 'genre', label: '장르' },
	{ v: 'length', label: '길이' },
]
const VIEW_OPTS: { v: View, label: string }[] = [
	{ v: 'list', label: '리스트' },
	{ v: 'card', label: '카드' },
]
const CLASSIFY_OPTS: { v: ClassifyBy, label: string }[] = [
	{ v: 'genre', label: '장르' },
	{ v: 'artist', label: '아티스트' },
]

const UNGENRED = '미분류'

/** Build a row view-model from a raw saved track, coding defensively for nulls. */
function toRow(t: SavedTrack): LikedRowVM {
	const album = t.album ?? null
	const rel = album?.release_date ?? null
	const year = rel ? Number(String(rel).slice(0, 4)) || null : null
	const decade = year ? `${Math.floor(year / 10) * 10}년대` : null
	const genre = album?.genres?.[0] ?? UNGENRED
	const durationMs = t.duration_ms ?? null
	return {
		id: t.spotify_track_id,
		track: t.track_name,
		artist: t.artist_name ?? '—',
		albumName: t.album_name ?? album?.title ?? '—',
		albumId: t.album_id ?? null,
		cover: album?.cover_url ?? null,
		year,
		decade,
		genre,
		addedAtRaw: t.added_at,
		likedAt: fmtLiked(t.added_at),
		durationMs,
		durationLabel: durationMs != null ? fmtTime(Math.round(durationMs / 1000)) : '',
	}
}

/** ISO/date-time → `YYYY.MM.DD`; empty string when unparseable. */
function fmtLiked(iso: string): string {
	const d = new Date(iso)
	if (Number.isNaN(d.getTime()))
		return ''
	const y = d.getFullYear()
	const m = String(d.getMonth() + 1).padStart(2, '0')
	const day = String(d.getDate()).padStart(2, '0')
	return `${y}.${m}.${day}`
}

/** Count rows by a string key, descending — used for the facet pills. */
function aggCounts(rows: LikedRowVM[], key: 'genre' | 'artist'): { name: string, count: number }[] {
	const m = new Map<string, number>()
	for (const r of rows)
		m.set(r[key], (m.get(r[key]) ?? 0) + 1)
	return [...m.entries()]
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count)
}

function defaultDir(col: SortKey): SortDir {
	return col === 'recent' || col === 'length' ? 'desc' : 'asc'
}

// ── table column template — shared by header + rows ───────────────────────
// [#, identity, album, date, length, (가사 when a lyrics mount is wired), ⋯]
function lkCols(withLyrics: boolean): string {
	return `30px minmax(0,1.7fr) minmax(0,1fr) 108px 56px ${withLyrics ? '44px ' : ''}38px`
}

// ── row action menu ───────────────────────────────────────────────────────
function RowMenu({ row, onOpen, onPromote }: {
	row: LikedRowVM
	onOpen: (t: DetailTarget) => void
	onPromote: (row: LikedRowVM) => void
}) {
	const [open, setOpen] = useState(false)
	useEffect(() => {
		if (!open)
			return
		const close = () => setOpen(false)
		window.addEventListener('click', close)
		return () => window.removeEventListener('click', close)
	}, [open])
	const catalogued = row.albumId != null
	const itemStyle: React.CSSProperties = {
		display: 'flex',
		alignItems: 'center',
		gap: 8,
		width: '100%',
		textAlign: 'left',
		padding: '8px 10px',
		fontSize: 11,
		letterSpacing: '0.03em',
		textTransform: 'uppercase',
		border: 'none',
		background: 'none',
		borderRadius: 3,
		cursor: 'pointer',
	}
	return (
		<div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
			<button type="button" className="iconbtn" title="동작" aria-label="동작" onClick={() => setOpen(o => !o)} style={{ fontSize: 16, letterSpacing: '1px' }}>⋯</button>
			{open && (
				<div className="panel" style={{ position: 'absolute', right: 0, top: 'calc(100% + 5px)', zIndex: 40, padding: 5, minWidth: 184, background: 'var(--color-bg)', boxShadow: '0 16px 36px -14px rgba(0,0,0,.45)' }}>
					<button
						type="button"
						className="mono"
						disabled={!catalogued}
						title={catalogued ? undefined : '카탈로그 미등록 — 분류하기 먼저'}
						onClick={() => {
							openDetail(row, onOpen)
							setOpen(false)
						}}
						style={{ ...itemStyle, color: 'var(--color-text)', opacity: catalogued ? 1 : 0.4, cursor: catalogued ? 'pointer' : 'not-allowed' }}
					>
						작품 상세 열기
					</button>
					<button
						type="button"
						className="mono"
						disabled={!catalogued}
						title={catalogued ? undefined : '카탈로그 미등록 — 분류하기 먼저'}
						onClick={() => {
							onPromote(row)
							setOpen(false)
						}}
						style={{ ...itemStyle, color: catalogued ? 'var(--color-accent)' : 'var(--color-text)', opacity: catalogued ? 1 : 0.4, cursor: catalogued ? 'pointer' : 'not-allowed' }}
					>
						My Buckit에 담기
					</button>
					<a
						href="/write"
						className="mono"
						style={{ ...itemStyle, color: 'var(--color-text)', textDecoration: 'none' }}
					>
						평론 쓰기 →
					</a>
				</div>
			)}
		</div>
	)
}

/** Map a catalogued row → a read-only album-detail target. */
function openDetail(row: LikedRowVM, onOpen: (t: DetailTarget) => void) {
	if (row.albumId == null)
		return
	onOpen({
		album: row.albumName,
		artist: row.artist,
		track: row.track,
		genre: row.genre === UNGENRED ? undefined : row.genre,
		year: row.year,
		rating: null,
		real: true,
		albumId: row.albumId,
		cover: row.cover,
	})
}

// ── sortable table header ─────────────────────────────────────────────────
function SortHead({ col, label, sort, sortDir, onSort, className }: {
	col: SortKey
	label: string
	sort: SortKey
	sortDir: SortDir
	onSort: (c: SortKey) => void
	className?: string
}) {
	const active = sort === col
	return (
		<button
			type="button"
			onClick={() => onSort(col)}
			className={`mono${className ? ` ${className}` : ''}`}
			title="클릭하여 정렬"
			style={{ display: 'inline-flex', alignItems: 'center', gap: 5, width: '100%', padding: 0, background: 'none', border: 'none', cursor: 'pointer', justifyContent: 'flex-start', color: active ? 'var(--color-text)' : 'var(--color-faded)', fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase' }}
		>
			{label}
			<span style={{ fontSize: 7, opacity: active ? 1 : 0 }}>{active && sortDir === 'asc' ? '▲' : '▼'}</span>
		</button>
	)
}

function TableHead({ cols, withLyrics, sort, sortDir, onSort }: { cols: string, withLyrics: boolean, sort: SortKey, sortDir: SortDir, onSort: (c: SortKey) => void }) {
	return (
		<div style={{ display: 'grid', gridTemplateColumns: cols, gap: 14, alignItems: 'center', padding: '9px 12px', borderBottom: '1px solid var(--color-border)', position: 'sticky', top: 0, background: 'var(--color-bg)', zIndex: 5 }}>
			<span className="mono" style={{ color: 'var(--color-faded)', fontSize: 10.5, textAlign: 'center' }}>#</span>
			<SortHead col="title" label="제목" sort={sort} sortDir={sortDir} onSort={onSort} />
			<SortHead col="album" label="앨범" sort={sort} sortDir={sortDir} onSort={onSort} className="lk-col-album" />
			<SortHead col="recent" label="추가한 날짜" sort={sort} sortDir={sortDir} onSort={onSort} className="lk-col-date" />
			<SortHead col="length" label="길이" sort={sort} sortDir={sortDir} onSort={onSort} className="lk-col-length" />
			{withLyrics && <span />}
			<span />
		</div>
	)
}

// ── table row ─────────────────────────────────────────────────────────────
// Shared-TrackRow consumer (ARCH-entity-interaction-contract Step 2). Declared
// actions = what the surface already had (open-detail) + lyrics; 담기/평론쓰기
// stay in the surface-specific ⋯ menu (trailing).
function Row({ row, n, cols, onOpen, onPromote, onLyrics }: {
	row: LikedRowVM
	n: number
	cols: string
	onOpen: (t: DetailTarget) => void
	onPromote: (row: LikedRowVM) => void
	onLyrics?: (spotifyTrackId: string) => void
}) {
	const catalogued = row.albumId != null
	return (
		<TrackRow
			className="lk-row"
			gridTemplate={cols}
			no={n}
			cover={<span style={{ flex: '0 0 auto', lineHeight: 0 }}><LkCover label={row.albumName} cover={row.cover} size={42} /></span>}
			title={row.track}
			sub={row.artist}
			cells={(
				<>
					<span className="sans lk-col-album" style={{ fontSize: 12.5, color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.albumName}</span>
					<span className="mono lk-col-date" style={{ fontSize: 11, color: 'var(--color-faded)' }}>{row.likedAt}</span>
					<span className="mono lk-col-length" style={{ fontSize: 11, color: 'var(--color-faded)', fontVariantNumeric: 'tabular-nums' }}>{row.durationLabel}</span>
				</>
			)}
			actions={{
				open: { fire: () => openDetail(row, onOpen), disabled: !catalogued, title: '작품 상세', disabledTitle: '카탈로그 미등록' },
				...(onLyrics ? { lyrics: () => onLyrics(row.id) } : {}),
			}}
			trailing={<span style={{ display: 'inline-flex', justifyContent: 'flex-end' }}><RowMenu row={row} onOpen={onOpen} onPromote={onPromote} /></span>}
			style={{ padding: '9px 12px', borderRadius: 4 }}
		/>
	)
}

// ── card (grid view) ──────────────────────────────────────────────────────
function Card({ row, onOpen, onPromote }: {
	row: LikedRowVM
	onOpen: (t: DetailTarget) => void
	onPromote: (row: LikedRowVM) => void
}) {
	const catalogued = row.albumId != null
	return (
		<div className="panel" style={{ padding: 13, background: 'var(--color-bg)', display: 'flex', flexDirection: 'column', gap: 10 }}>
			<button type="button" onClick={() => openDetail(row, onOpen)} disabled={!catalogued} style={{ position: 'relative', padding: 0, border: 'none', background: 'none', cursor: catalogued ? 'pointer' : 'default', lineHeight: 0 }}>
				<LkCover label={row.albumName} cover={row.cover} square />
			</button>
			<div style={{ minWidth: 0 }}>
				<div className="serif" style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.track}</div>
				<div className="sans" style={{ fontSize: 11.5, color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{row.artist}</div>
			</div>
			<div style={{ display: 'flex', alignItems: 'center', gap: 6, borderTop: '1px solid var(--color-border-soft)', paddingTop: 9 }}>
				<span className="chip" style={{ pointerEvents: 'none', padding: '3px 7px', fontSize: 9.5 }}>{row.genre}</span>
				<span className="mono" style={{ fontSize: 10, color: 'var(--color-faded)' }}>{row.likedAt.slice(5)}</span>
				<span style={{ marginLeft: 'auto' }}><RowMenu row={row} onOpen={onOpen} onPromote={onPromote} /></span>
			</div>
		</div>
	)
}

/** Real cover image when available, else the editorial letter tile. */
function LkCover({ label, cover, size = 42, square = false }: { label: string, cover: string | null, size?: number, square?: boolean }) {
	if (cover) {
		const dim = square ? { width: '100%', aspectRatio: '1 / 1' } : { width: size, height: size }
		return <img src={cover} alt={label} loading="lazy" decoding="async" style={{ ...dim, objectFit: 'cover', borderRadius: square ? 4 : 3, display: 'block', border: '1px solid var(--color-border)' }} />
	}
	return <Cover label={label} size={size} radius={square ? 4 : 3} square={square} />
}

// ── filter pill ───────────────────────────────────────────────────────────
function Pill({ on, children, onClick }: { on: boolean, children: React.ReactNode, onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="sans"
			style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', cursor: 'pointer', padding: '7px 14px', borderRadius: 999, fontSize: 12.5, fontWeight: 500, transition: 'background .14s, border-color .14s, color .14s', border: `1px solid ${on ? 'var(--color-text)' : 'var(--color-border)'}`, background: on ? 'var(--color-text)' : 'var(--color-paper)', color: on ? 'var(--color-bg)' : 'var(--color-text)' }}
		>
			{children}
		</button>
	)
}

// ── toast ─────────────────────────────────────────────────────────────────
function Toast({ msg }: { msg: string }) {
	return createPortal(
		<div className="lf-rise" style={{ position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)', zIndex: 200, display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', borderRadius: 8, background: 'var(--color-text)', color: 'var(--color-bg)', boxShadow: '0 16px 40px rgba(0,0,0,.3)', maxWidth: '90vw' }}>
			<span className="sans" style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{msg}</span>
		</div>,
		document.body,
	)
}

// ── board ─────────────────────────────────────────────────────────────────
export function LikedBoard({ onOpen, onOpenLyrics }: { onOpen?: (t: DetailTarget) => void, onOpenLyrics?: (spotifyTrackId: string) => void }) {
	// List rows gain the 가사 column only when ProfileApp's viewer mount is wired.
	const cols = lkCols(onOpenLyrics != null)
	const [rows, setRows] = useState<LikedRowVM[] | null>(null)
	const [loadError, setLoadError] = useState(false)

	const [view, setView] = useState<View>('list')
	const [showAnalysis, setShowAnalysis] = useState(true)
	const [sort, setSort] = useState<SortKey>('recent')
	const [sortDir, setSortDir] = useState<SortDir>('desc')
	const [classifyBy, setClassifyBy] = useState<ClassifyBy>('genre')
	const [q, setQ] = useState('')
	const [fGenres, setFGenres] = useState<Set<string>>(() => new Set())
	const [fArtists, setFArtists] = useState<Set<string>>(() => new Set())

	const [toast, setToast] = useState<string | null>(null)
	const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	// FEAT-pocket-buckit-workspace Step B — read the bucket tree from the SHARED store
	// (reuses what the tray/board already loaded; no third independent fetch).
	const bucketTree = useBucketStore().tree
	const [promoting, setPromoting] = useState<LikedRowVM | null>(null)

	// Load the whole 좋아요 set by offset pagination to the ceiling.
	useEffect(() => {
		let on = true
		;(async () => {
			try {
				const acc: SavedTrack[] = []
				for (let offset = 0; offset < CEILING; offset += PAGE) {
					const page = await listSavedTracks(PAGE, offset)
					acc.push(...page.items)
					if (page.items.length < PAGE)
						break
				}
				if (on)
					setRows(acc.map(toRow))
			}
			catch {
				if (on) {
					setLoadError(true)
					setRows([])
				}
			}
		})()
		return () => {
			on = false
		}
	}, [])

	const flash = (msg: string) => {
		setToast(msg)
		if (toastTimer.current)
			clearTimeout(toastTimer.current)
		toastTimer.current = setTimeout(() => setToast(null), 4500)
	}
	useEffect(() => () => {
		if (toastTimer.current)
			clearTimeout(toastTimer.current)
	}, [])

	const allRows = rows ?? []

	// Facet sources (over the whole loaded set, not the filtered view).
	const genreCounts = useMemo(() => aggCounts(allRows, 'genre'), [allRows])
	const artistCounts = useMemo(() => aggCounts(allRows, 'artist'), [allRows])

	const onSortHead = (col: SortKey) => {
		if (sort === col) {
			setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
		}
		else {
			setSort(col)
			setSortDir(defaultDir(col))
		}
	}
	const onSortPick = (col: SortKey) => {
		setSort(col)
		setSortDir(defaultDir(col))
	}
	const toggleSet = (setter: typeof setFGenres, val: string) => setter((s) => {
		const n = new Set(s)
		if (n.has(val))
			n.delete(val)
		else
			n.add(val)
		return n
	})

	const filtered = useMemo(() => {
		const needle = q.trim().toLowerCase()
		return allRows.filter((r) => {
			if (fGenres.size && !fGenres.has(r.genre))
				return false
			if (fArtists.size && !fArtists.has(r.artist))
				return false
			if (needle) {
				const hay = (r.track + r.artist + r.albumName).toLowerCase()
				if (!hay.includes(needle))
					return false
			}
			return true
		})
	}, [allRows, fGenres, fArtists, q])

	const sorted = useMemo(() => {
		const dir = sortDir === 'asc' ? 1 : -1
		const copy = filtered.slice()
		copy.sort((a, b) => {
			let r: number
			if (sort === 'title')
				r = a.track.localeCompare(b.track)
			else if (sort === 'album')
				r = a.albumName.localeCompare(b.albumName) || a.track.localeCompare(b.track)
			else if (sort === 'artist')
				r = a.artist.localeCompare(b.artist) || a.track.localeCompare(b.track)
			else if (sort === 'genre')
				r = a.genre.localeCompare(b.genre) || a.artist.localeCompare(b.artist)
			else if (sort === 'length')
				r = (a.durationMs ?? -1) - (b.durationMs ?? -1)
			else
				r = a.addedAtRaw.localeCompare(b.addedAtRaw)
			return r * dir
		})
		return copy
	}, [filtered, sort, sortDir])

	// Group when sorting by artist / genre — makes 분류 visceral.
	const grouped = sort === 'artist' || sort === 'genre'
	const groups = useMemo(() => {
		if (!grouped)
			return []
		const map = new Map<string, LikedRowVM[]>()
		for (const r of sorted) {
			const k = sort === 'artist' ? r.artist : r.genre
			if (!map.has(k))
				map.set(k, [])
			map.get(k)!.push(r)
		}
		return [...map.entries()].map(([key, items]) => ({ key, items }))
	}, [sorted, grouped, sort])

	const anyFilter = fGenres.size > 0 || fArtists.size > 0 || q.trim().length > 0
	const resetFilters = () => {
		setFGenres(new Set())
		setFArtists(new Set())
		setQ('')
	}
	const facet = classifyBy === 'genre' ?
		{ counts: genreCounts, set: fGenres, setter: setFGenres } :
		{ counts: artistCounts, set: fArtists, setter: setFArtists }

	// Promote → open the bucket picker (loading the tree lazily on first open).
	const startPromote = (row: LikedRowVM) => {
		setPromoting(row)
		if (bucketTree == null)
			void bucketStore.ensureFresh()
	}
	const onPickBucket = async (bucketId: string | null) => {
		const row = promoting
		setPromoting(null)
		if (!row || !bucketId || row.albumId == null)
			return
		try {
			const { conflict } = await addBucketItem(bucketId, row.albumId)
			flash(conflict ?
				`‘${row.albumName}’ 은(는) 이미 이 버킷에 있어요.` :
				`‘${row.albumName}’ 을(를) My Buckit에 담았어요.`)
		}
		catch {
			flash('버킷에 담지 못했어요. 잠시 후 다시 시도해 주세요.')
		}
	}

	if (rows == null) {
		return (
			<div className="meta" style={{ textAlign: 'center', padding: '64px 0', color: 'var(--color-faded)' }}>좋아요한 트랙을 불러오는 중…</div>
		)
	}

	return (
		<div style={{ paddingBottom: 56 }}>

			{loadError && (
				<div className="meta" style={{ marginBottom: 14, color: 'var(--color-accent)' }}>일부 데이터를 불러오지 못했어요.</div>
			)}

			{/* analysis — above search */}
			<div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: showAnalysis ? 12 : 14 }}>
				<Pill on={showAnalysis} onClick={() => setShowAnalysis(a => !a)}>
					분석
					{' '}
					{showAnalysis ? '숨기기' : '보기'}
				</Pill>
			</div>
			{showAnalysis && <LikedAnalysis rows={sorted} loadedCount={allRows.length} />}

			{/* classify */}
			<div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
				<span className="meta">분류</span>
				<Seg value={classifyBy} onChange={v => setClassifyBy(v as ClassifyBy)} options={CLASSIFY_OPTS} />
			</div>

			{/* facet pills — genre OR artist */}
			<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
				{facet.counts.map(g => (
					<Pill key={g.name} on={facet.set.has(g.name)} onClick={() => toggleSet(facet.setter, g.name)}>
						{g.name}
						<span style={{ opacity: 0.55, fontSize: 11.5, marginLeft: 2 }}>{g.count}</span>
					</Pill>
				))}
			</div>

			{/* search · sort · view */}
			<div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
				<div style={{ position: 'relative', flex: '1 1 200px', minWidth: 160 }}>
					<span className="serif" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 16, color: 'var(--color-faded)', pointerEvents: 'none' }}>⌕</span>
					<input
						value={q}
						onChange={e => setQ(e.target.value)}
						placeholder="곡·아티스트·앨범 검색…"
						aria-label="곡·아티스트·앨범 검색"
						className="sans"
						style={{ width: '100%', padding: '9px 12px 9px 32px', border: '1px solid var(--color-border)', borderRadius: 999, background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 13.5, outline: 'none' }}
					/>
				</div>
				<Seg value={sort} onChange={v => onSortPick(v as SortKey)} options={SORT_OPTS} />
				<Seg value={view} onChange={v => setView(v as View)} options={VIEW_OPTS} />
			</div>

			{anyFilter && (
				<div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
					<span className="meta">
						{sorted.length.toLocaleString()}
						곡 일치
					</span>
					<button type="button" className="chip" onClick={resetFilters} style={{ borderColor: 'color-mix(in srgb, var(--color-accent) 40%, var(--color-border))', color: 'var(--color-accent)' }}>필터 초기화 ✕</button>
				</div>
			)}

			{/* list / cards */}
			{sorted.length === 0 ?
				(
					<div className="panel" style={{ padding: 48, textAlign: 'center' }}>
						<span className="meta">{anyFilter ? '조건에 맞는 좋아요가 없습니다' : '아직 좋아요한 트랙이 없어요.'}</span>
					</div>
				) :
				view === 'card' ?
						(
							<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }}>
								{sorted.map(t => <Card key={t.id} row={t} onOpen={onOpen ?? (() => {})} onPromote={startPromote} />)}
							</div>
						) :
						(
							<div className="panel" style={{ padding: '0 8px 8px' }}>
								<TableHead cols={cols} withLyrics={onOpenLyrics != null} sort={sort} sortDir={sortDir} onSort={onSortHead} />
								{grouped ?
									groups.map(grp => (
										<div key={grp.key}>
											<div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '16px 12px 6px' }}>
												<span className="serif italic" style={{ fontSize: 17, fontWeight: 500, whiteSpace: 'nowrap' }}>{grp.key}</span>
												<span className="meta" style={{ whiteSpace: 'nowrap' }}>
													{grp.items.length}
													곡
												</span>
											</div>
											{grp.items.map((t, i) => <Row key={t.id} row={t} n={i + 1} cols={cols} onOpen={onOpen ?? (() => {})} onPromote={startPromote} onLyrics={onOpenLyrics} />)}
										</div>
									)) :
									sorted.map((t, i) => <Row key={t.id} row={t} n={i + 1} cols={cols} onOpen={onOpen ?? (() => {})} onPromote={startPromote} onLyrics={onOpenLyrics} />)}
							</div>
						)}

			{promoting && bucketTree && (
				<BucketPickerSheet
					title="My Buckit에 담기"
					tree={bucketTree}
					onPick={onPickBucket}
					onClose={() => setPromoting(null)}
				/>
			)}
			{promoting && bucketTree == null && (
				<div className="meta" style={{ position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)', zIndex: 200, padding: '10px 14px', borderRadius: 8, background: 'var(--color-text)', color: 'var(--color-bg)' }}>버킷 목록 불러오는 중…</div>
			)}

			{toast && <Toast msg={toast} />}
		</div>
	)
}
