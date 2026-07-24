// Member dashboard — 평론 버킷 board (nested, API-backed).
//
// Crate-gallery redesign (FEAT-crate-redesign): each bucket is a distinct card
// with a colored left spine, status dot + label, and a wrap-grid of large album
// covers (replacing the old horizontal-scroll chip row). New affordances:
//   · per-bucket accent color picker (PATCH color — already in the contract)
//   · rating chips on covers inside the single "평론 완료" (is_done) bucket,
//     read from the member's own reviews (no extra backend call)
//   · drag a bucket BETWEEN cards (the gaps show a red insertion line) to
//     reorder it / un-nest it to the top level; drop a bucket ON another card
//     to nest it as a child. Drag an album onto a cover to reorder, or onto a
//     card to move it between buckets.
//   · a single 휴지통 dock card (center-bottom of the viewport) that appears
//     ONLY while dragging — no backdrop blur, so the other buckets stay crisp
//     as drop targets. Drop an album → recoverable trash; a bucket → confirm +
//     delete (cascades server-side; bucket delete is not recoverable).
//   · recoverable album trash (localStorage stash + restore via re-add)
// Wires to the nested-bucket backend via src/lib/buckets.ts (parent_id +
// recursive GET + PUT /{id}/move + PATCH color).
import type { DetailTarget, MemberReview } from '@lib/member'
import type { AddOutcome } from './AddAlbumModal'
import type { BoardAlbum, BoardBucket } from '@lib/buckets'
import type { PbBoardDndStartDetail, PbBoardDropDetail, PbDndStartDetail, PbOpenStateDetail } from '@lib/pocketBuckit/events'
import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as api from '@lib/buckets'
import { findBucket, SLIB_KIND, subtreeHas, visit } from '@lib/buckets'
import type { DndItem } from '@lib/boardDnd'
import { canAcceptAlbumDrag, canAcceptBucketDrag, routeAlbumDrop } from '@lib/boardDnd'
import { crMeta } from '@lib/bucketLifecycle'
import { artistHref } from '@lib/entityLinks'
import { bucketStore, useBucketStore } from '@lib/pocketBuckit/bucketStore'
import { PB_BOARD_DND_END_EVENT, PB_BOARD_DND_START_EVENT, PB_BOARD_DROP_EVENT, PB_CLOSED_EVENT, PB_DND_END_EVENT, PB_DND_START_EVENT, PB_OPEN_STATE_EVENT, PB_TOGGLE_EVENT } from '@lib/pocketBuckit/events'
import { prefetchAlbumDetail } from '@lib/albumDetail'
import { sendConnectPlay } from '@lib/spotifyPlayback'
import type { ResearchStatus } from '@lib/research'
import { RESEARCH_STATUS_LABEL, researchStatusColor, useResearchStatusMap } from '@lib/research'
import { useDismissable } from '@lib/useDismissable'
import { useScrollLock } from '@lib/useScrollLock'
import ResearchNote from './ResearchNote'
import { BucketPickerSheet } from './BucketPickerSheet'
import { BUCKETS_KEY } from '@lib/member'
import AddAlbumModal from './AddAlbumModal'
import AddArtistModal from './AddArtistModal'
import { ActionSheet } from './ActionSheet'
import type { SheetAction } from './ActionSheet'
import { listRecentlyListened } from './spotify.api'
import type { SpotifyLibraryAlbumState } from './spotify.api'
import { useSpotifyLibrary } from './useSpotifyLibrary'
import { AlbumArt, SectionTitle } from './ui'

// Module-level drag payload (native DnD can't carry live object refs reliably).
// The payload shape (`DndItem`) and the drop routing/acceptance rules live in
// @lib/boardDnd; this component owns only the gesture wiring + this live ref.
let dnd: DndItem | null = null
type DragKind = 'album' | 'bucket' | null

// Synthetic id of the read-only 최근 들은 앨범 strip (never persisted server-side).
const RECENT_ID = '__recent__'
// Recoverable album trash, mirrored to localStorage so it survives reloads.
const TRASH_KEY = 'lf_crate_trash'
// Last-seen 최근 들은 앨범 strip, cached so it paints instantly on the next mount
// (tab switch / navigation) while the worker-fed list revalidates in the
// background — kills the empty-then-pop flash. See the recent-strip effect.
const RECENT_KEY = 'lf_crate_recent'

// Curated editorial palette — muted oklch siblings of the brand red. `null` key
// is the default ink (no stored color). Mirrors the design prototype.
const BUCKET_COLORS: { key: string, label: string, color: string | null }[] = [
  { key: 'ink', label: '기본', color: null },
  { key: 'red', label: '레드', color: '#c8332b' },
  { key: 'amber', label: '앰버', color: 'oklch(0.66 0.12 70)' },
  { key: 'green', label: '그린', color: 'oklch(0.58 0.10 155)' },
  { key: 'blue', label: '블루', color: 'oklch(0.56 0.10 245)' },
  { key: 'violet', label: '바이올렛', color: 'oklch(0.55 0.11 300)' },
]

// item_type → Korean label for the per-bucket type-filter chips + the non-album
// tile badge. 'album' is the default kind; the others are the generalized-
// membership kinds (FEAT-pocket-buckit Step 5). Mirrors PocketTray's table.
const ITEM_TYPE_LABEL: Record<string, string> = {
  album: '앨범',
  track: '트랙',
  artist: '아티스트',
  review: '평론',
  playback: '재생',
  snapshot: '스냅샷',
}

// Read a cached array seed from localStorage (SWR first paint). Returns null on
// miss / parse error / non-array so callers fall back to the loading state.
function readSeed<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed))
        return parsed as T
    }
  }
  catch { /* ignore */ }
  return null
}

// FEAT-my-buckit-artist Step 4: a row in the ＋버킷 create-type menu (General/Artist).
const CREATE_MENU_ROW: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', padding: '9px 11px', background: 'none', border: 'none', borderRadius: 6, cursor: 'pointer', color: 'var(--color-text)', fontSize: 13.5 }

// ── tree helpers ────────────────────────────────────────────────────────────
const clone = (t: BoardBucket[]): BoardBucket[] => JSON.parse(JSON.stringify(t))
// FEAT-my-buckit-artist: the board-level type filter. Keeps any bucket of the
// selected type PLUS every ancestor on the path to a match (so a nested match is
// never flattened — the path stays visible). 'all' returns the tree untouched.
function pruneByType(buckets: BoardBucket[], type: 'all' | 'general' | 'artist'): BoardBucket[] {
  if (type === 'all')
    return buckets
  const out: BoardBucket[] = []
  for (const b of buckets) {
    const children = pruneByType(b.children, type)
    if (b.type === type || children.length > 0)
      out.push({ ...b, children })
  }
  return out
}
function removeBucketNode(buckets: BoardBucket[], id: string): BoardBucket | null {
  let removed: BoardBucket | null = null
  const rec = (arr: BoardBucket[]): boolean => {
    const i = arr.findIndex(b => b.id === id)
    if (i >= 0) {
      removed = arr[i]
      arr.splice(i, 1)
      return true
    }
    for (const b of arr) {
      if (rec(b.children))
        return true
    }
    return false
  }
  rec(buckets)
  return removed
}
function countAlbums(b: BoardBucket): number {
  let n = b.albums.length
  for (const c of b.children)
    n += countAlbums(c)
  return n
}
function findAlbum(buckets: BoardBucket[], itemId: string): { album: BoardAlbum, bucketName: string } | null {
  let f: { album: BoardAlbum, bucketName: string } | null = null
  visit(buckets, (b) => {
    const a = b.albums.find(x => x.itemId === itemId)
    if (a)
      f = { album: a, bucketName: b.name }
  })
  return f
}

// First album anywhere in the tree with this albumId — used to paint a copy's
// optimistic tile with real cover/title (a cross-bucket / library copy isn't in the
// recent strip), instead of a "…" placeholder until the server round-trip lands.
function findAlbumByAlbumId(buckets: BoardBucket[], albumId: string): BoardAlbum | null {
  let f: BoardAlbum | null = null
  visit(buckets, (b) => {
    const a = b.albums.find(x => x.albumId === albumId)
    if (a && !f)
      f = a
  })
  return f
}

// ── per-bucket view controls (FEAT-bucket-organize) ─────────────────────────-
// Each review bucket carries its OWN transient sort / group / genre-filter,
// remembered per bucket in localStorage (keyed by bucket id) so it survives
// reload/navigation. The controls live INSIDE each bucket card; bucket boundaries
// are always kept (no cross-bucket flattening). Sort reorders the bucket's covers;
// group splits them into per-artist / per-genre sections within the card; the
// genre filter narrows that bucket to selected tier-0 genres (OQ4 high-confidence
// labels). DnD stays live in every mode — dragging to reorder a bucket whose view
// is non-default first BAKES the current display order into the persisted
// `position` and resets that bucket to the manual/none view (so the drop lands
// where it looks). The special Spotify-library bucket has no view controls.
type SortMode = 'manual' | 'newest' | 'oldest' | 'popular'
type GroupMode = 'none' | 'artist' | 'genre'
interface BucketView { sort: SortMode, group: GroupMode, genreFilter: string[], typeFilter: string[] }
const VIEW_KEY = 'lf_bucket_views'
const DEFAULT_BUCKET_VIEW: BucketView = { sort: 'manual', group: 'none', genreFilter: [], typeFilter: [] }
// Group label shown when an album carries no high-confidence genre (OQ4) — it
// sorts last and is never a filter chip.
const NO_GENRE = '장르 없음'
const SORT_OPTS: { v: SortMode, l: string }[] = [
  { v: 'manual', l: '수동' },
  { v: 'newest', l: '최신' },
  { v: 'oldest', l: '오래된' },
  { v: 'popular', l: '인기' },
]
const GROUP_OPTS: { v: GroupMode, l: string }[] = [
  { v: 'none', l: '끔' },
  { v: 'artist', l: '아티스트' },
  { v: 'genre', l: '장르' },
]

function sanitizeView(p: Partial<BucketView> | undefined): BucketView {
  const sort = SORT_OPTS.some(o => o.v === p?.sort) ? p!.sort! : 'manual'
  const group = GROUP_OPTS.some(o => o.v === p?.group) ? p!.group! : 'none'
  const genreFilter = Array.isArray(p?.genreFilter) ?
    p!.genreFilter!.filter((g): g is string => typeof g === 'string') :
    []
  const typeFilter = Array.isArray(p?.typeFilter) ?
    p!.typeFilter!.filter((t): t is string => typeof t === 'string') :
    []
  return { sort, group, genreFilter, typeFilter }
}

// The whole per-bucket view map (bucketId → BucketView), seeded from localStorage.
function readBucketViews(): Record<string, BucketView> {
  try {
    const raw = localStorage.getItem(VIEW_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      if (p && typeof p === 'object' && !Array.isArray(p)) {
        const out: Record<string, BucketView> = {}
        for (const [k, v] of Object.entries(p))
          out[k] = sanitizeView(v as Partial<BucketView>)
        return out
      }
    }
  }
  catch { /* ignore */ }
  return {}
}

function isDefaultView(v: BucketView): boolean {
  return v.sort === 'manual' && v.group === 'none' && v.genreFilter.length === 0 && v.typeFilter.length === 0
}

// Primary artist for grouping: the first artist_names entry, falling back to the
// first comma-token of the joined display string, then a neutral dash.
function primaryArtist(a: BoardAlbum): string {
  const n = a.artistNames?.[0]?.trim()
  if (n)
    return n
  const first = a.artist?.split(',')[0]?.trim()
  return first || '—'
}

// Stable sort by the active mode (original order preserved on ties / for 'manual').
// Missing release dates / popularity sink to the end regardless of direction.
function sortAlbums(albums: BoardAlbum[], sort: SortMode): BoardAlbum[] {
  if (sort === 'manual')
    return albums
  return albums
    .map((a, i) => ({ a, i }))
    .sort((x, y) => {
      if (sort === 'popular') {
        const px = x.a.popularity ?? null
        const py = y.a.popularity ?? null
        if (px == null || py == null)
          return (px == null ? 1 : 0) - (py == null ? 1 : 0) || x.i - y.i
        return py - px || x.i - y.i // higher popularity first
      }
      const dx = x.a.releaseDate || ''
      const dy = y.a.releaseDate || ''
      if (!dx || !dy)
        return (dx ? 0 : 1) - (dy ? 0 : 1) || x.i - y.i
      if (dx === dy)
        return x.i - y.i
      // ISO date strings sort lexically; 'newest' = descending.
      return sort === 'newest' ? (dx < dy ? 1 : -1) : (dx < dy ? -1 : 1)
    })
    .map(w => w.a)
}

// Per-artist groups over a (already deduped + filtered) flat album list. Groups
// are ordered by size (largest first), then artist name; within a group the active
// sort applies.
function artistGroups(albums: BoardAlbum[], sort: SortMode): { artist: string, albums: BoardAlbum[] }[] {
  const groups = new Map<string, BoardAlbum[]>()
  for (const a of albums) {
    const k = primaryArtist(a)
    const arr = groups.get(k) ?? []
    arr.push(a)
    groups.set(k, arr)
  }
  return [...groups.entries()]
    .map(([artist, gAlbums]) => ({ artist, albums: sortAlbums(gAlbums, sort) }))
    .sort((x, y) => y.albums.length - x.albums.length || x.artist.localeCompare(y.artist, 'ko'))
}

// Primary (single-home) genre of an album: the first high-confidence label the
// backend sent (already ordered by genre position), or null → the NO_GENRE group.
function primaryGenre(a: BoardAlbum): string | null {
  const g = a.genres?.[0]?.trim()
  return g || null
}

// An album passes the genre filter when no chips are selected, or it carries at
// least one of the selected genres (any-match, OQ4 high-confidence labels).
function passesGenre(a: BoardAlbum, filter: string[]): boolean {
  if (filter.length === 0)
    return true
  const gs = a.genres ?? []
  return filter.some(f => gs.includes(f))
}

// Per-genre groups (single home = primary genre, OQ5). Same sort-within-group as
// artistGroups; the NO_GENRE group always sorts last.
function genreGroups(albums: BoardAlbum[], sort: SortMode): { genre: string, albums: BoardAlbum[] }[] {
  const groups = new Map<string, BoardAlbum[]>()
  for (const a of albums) {
    const k = primaryGenre(a) ?? NO_GENRE
    const arr = groups.get(k) ?? []
    arr.push(a)
    groups.set(k, arr)
  }
  return [...groups.entries()]
    .map(([genre, gAlbums]) => ({ genre, albums: sortAlbums(gAlbums, sort) }))
    .sort((x, y) => {
      // NO_GENRE always last, regardless of size.
      if ((x.genre === NO_GENRE) !== (y.genre === NO_GENRE))
        return x.genre === NO_GENRE ? 1 : -1
      return y.albums.length - x.albums.length || x.genre.localeCompare(y.genre, 'ko')
    })
}

// Distinct genre labels in one bucket's albums, with counts, for its filter chip
// row. Counts every high-confidence label an album carries (not just the primary)
// so the chips mirror what a filter would surface. Frequency desc.
function albumGenres(albums: BoardAlbum[]): { label: string, count: number }[] {
  const counts = new Map<string, number>()
  for (const a of albums) {
    for (const g of a.genres ?? [])
      counts.set(g, (counts.get(g) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((x, y) => y.count - x.count || x.label.localeCompare(y.label, 'ko'))
}

// Distinct item-types in one bucket's members, with counts, for its type-filter
// chip row (앨범/트랙/평론/…). Frequency desc; the row only shows when ≥2 types
// coexist (a single-type bucket needs no filter). FEAT-pocket-buckit multi-type.
function albumTypes(albums: BoardAlbum[]): { type: string, count: number }[] {
  const counts = new Map<string, number>()
  for (const a of albums)
    counts.set(a.itemType, (counts.get(a.itemType) ?? 0) + 1)
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((x, y) => y.count - x.count || x.type.localeCompare(y.type))
}

// An item passes the type filter when no types are selected, or its itemType is
// among the selected set (any-match, mirrors passesGenre).
function passesType(a: BoardAlbum, filter: string[]): boolean {
  return filter.length === 0 || filter.includes(a.itemType)
}

// The order the bucket's covers appear under the active view — the FULL set
// (filter-independent, so nothing is lost), as item ids. Used to bake a non-default
// view into manual `position` on a drag-reorder (the drop then lands where it
// looks, and the bucket flips back to the manual/none view).
function displayOrder(albums: BoardAlbum[], view: BucketView): string[] {
  if (view.group === 'none')
    return sortAlbums(albums, view.sort).map(a => a.itemId)
  const groups = view.group === 'genre' ?
    genreGroups(albums, view.sort) :
    artistGroups(albums, view.sort)
  return groups.flatMap(g => g.albums.map(a => a.itemId))
}

// ── status meta ───────────────────────────────────────────────────────────--
// The lifecycle-tag rule (`crMeta` + `collectItems` + `isResearchEngaged` +
// `TOLISTEN_KIND`) now lives in @lib/bucketLifecycle (REFACTOR-frontend-member-
// surface Step 3), unit-tested by member/bucketLifecycle.test.ts.

// Effective accent color: an explicit user color wins, else the neutral ink (top
// level) / hairline (nested) default. (Direction B dropped the old name-regex
// urgency accent — no typed field encodes a deadline.)
function crColor(b: BoardBucket, depth: number): string {
  if (b.color)
    return b.color
  return depth ? 'var(--color-border)' : 'var(--color-text)'
}

function CrStatus({ b }: { b: BoardBucket }) {
  const m = crMeta(b)
  const ink = b.color || 'var(--color-faded)'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: 6, background: ink, flex: '0 0 auto' }} />
      <span className="meta" style={{ color: ink, letterSpacing: '0.1em' }}>{m.tag}</span>
    </span>
  )
}

// ── spotify-library badge meta ───────────────────────────────────────────────
// Per-album source + sync-state, joined to a cover by album_id from the
// /spotify-library/state map. source → who put it there; state → the last
// reconcile outcome (dot color). Rendered only inside the special library bucket.
function slibSourceLabel(source: string): string {
  return source === 'myblog_added' ? '내가 추가' : '기존'
}
function slibStateColor(state: string): string {
  if (state === 'synced')
    return 'oklch(0.58 0.10 155)' // 녹 — Spotify matches intent
  if (state === 'failed')
    return 'var(--color-accent)' // 적 — a write errored
  if (state === 'needs_attention')
    return 'oklch(0.66 0.12 70)' // 주 — scope / reauth
  return 'var(--color-faded)' // 회 — pending (not yet reconciled)
}

// Source pill (top-left) + state dot (top-right) overlaid on a library cover.
function SlibBadges({ row }: { row: SpotifyLibraryAlbumState }) {
  return (
    <>
      <span className="mono" style={{ position: 'absolute', left: 6, top: 6, fontSize: 9, letterSpacing: '0.06em', color: '#fff', background: 'rgba(11,61,31,0.82)', padding: '2px 5px', borderRadius: 3 }}>
        {slibSourceLabel(row.source)}
      </span>
      <span
	title={`상태: ${row.state}${row.last_error ? ` · ${row.last_error}` : ''}`}
	style={{ position: 'absolute', top: 6, right: 6, width: 10, height: 10, borderRadius: 10, background: slibStateColor(row.state), border: '1.5px solid var(--color-bg)' }}
      />
    </>
  )
}

// ── per-cover research affordance ───────────────────────────────────────────
// A small dot at the cover's bottom-left that opens the research slide-over.
// `status` is resolved by the board (one batched GET /api/research/status poll ⊕
// the bucket-payload seed) — NOT a per-cover note GET. The old per-cover fetch
// fired album-count concurrent requests on mount and throttled the Lambda → 503s.
function CoverResearchBadge({ status, active, onOpen }: { status: ResearchStatus | null, active: boolean, onOpen: () => void }) {
  const show = active || status != null
  const color = show ? researchStatusColor(status) : 'var(--color-bg)'
  const title = show && status ? `리서치: ${RESEARCH_STATUS_LABEL[status]}` : '조사 노트'
  return (
    <button
	type="button"
	className="rsh-cover-badge"
	title={title}
	aria-label="조사 노트 열기"
	style={{ background: color, borderColor: show ? 'var(--color-bg)' : 'var(--color-border)' }}
	onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
    />
  )
}

// ── album cover tile ──────────────────────────────────────────────────────--
// Drag = move/reorder; dropping ON a cover inserts the dragged item BEFORE it
// (both directions). Click opens detail. Rating chips show only inside the
// is_done ("rated") bucket. `copySource` tiles (최근 들은 앨범) drag as a copy.
function AlbumChip({ album, bucketId, bucketType, rated, score, onOpen, copySource, fromLib, libRow, listened, draggingId, setDraggingId, setDragKind, onInsert, research, onTouchActions, isNew }: {
  album: BoardAlbum
  bucketId: string
  /**
   * FEAT-my-buckit-artist: the parent bucket's TYPE ('general' | 'artist').
   * An Artist bucket's per-cover insert target only accepts an artist→artist
   * reorder; a foreign album/track bubbles up to the bucket-level expansion drop.
   */
  bucketType?: string
  rated: boolean
  score: number | null
  onOpen: (t: DetailTarget) => void
  copySource?: boolean
  /**
   * FEAT-my-buckit — a transient 'NEW' dot: this item just entered the bucket via
   * a genuine drag (copy-in / cross-bucket move-in). In-memory, self-clears in 8s
   * or on tray collapse. Copy sources (recent strip) / library chips pass none.
   */
  isNew?: boolean
  /**
   * This chip lives in the spotify_library bucket: it drags as a COPY (drop into
   * another bucket copies it, leaving the library row intact) yet keeps its itemId
   * so a myblog_added album can still be trashed. Pre-existing albums can't.
   */
  fromLib?: boolean
  /**
   * Spotify-library sync row for this album (source/state badges) when inside
   * the special library bucket; absent for every other surface.
   */
  libRow?: SpotifyLibraryAlbumState | null
  /**
   * FEAT-bucket-identity Direction B — this album is in the member's listened
   * set AND not yet reviewed, so the cover shows the quiet "이미 들음 → 평론
   * 가능" hint. Computed by the card from the board's listenedAlbumIds set.
   */
  listened?: boolean
  draggingId: string | null
  setDraggingId: (id: string | null) => void
  setDragKind: (k: DragKind) => void
  onInsert?: (itemId: string, fromBucketId: string, beforeItemId: string) => void
  /**
   * FEAT-album-research-notes: per-cover research dot + (in 'selected' mode) the
   * auto-research checkbox. Only passed for normal-bucket covers (not the recent
   * strip / Spotify-library bucket).
   */
  research?: { mode: string, selected: boolean, status: ResearchStatus | null, onOpen: () => void, onToggleSelected: (next: boolean) => void }
  /**
   * Touch fallback (coarse pointers): open the album action sheet. The ⋯ button
   * shows only on hover (desktop) / always (touch); it never affects the drag
   * path. Absent → no button (the read-only recent strip passes none? it DOES
   * pass it as a copy source).
   */
  onTouchActions?: () => void
}) {
  const [over, setOver] = useState(false)
  const dragging = draggingId === album.itemId
  // FEAT-pocket-buckit Step 5/6 — only an 'album' member has a DB album to open +
  // rating/research affordances. Every non-album kind (track/review/playback/
  // snapshot) renders as a labeled tile with a placeholder cover and no detail.
  const isAlbum = album.itemType === 'album'
  const isArtist = album.itemType === 'artist'
  const acceptCol = (): boolean => {
    const it = dnd
    // Reorder-insert targets reject copy drags (recent strip) AND library drags —
    // a fromLib item must bubble to the bucket's onDrop so it COPIES instead of moving.
    if (!it || it.kind !== 'album' || it.copy || it.fromLib || !it.itemId || it.itemId === album.itemId)
      return false
    // FEAT-my-buckit-artist: inside an Artist bucket only an artist→artist reorder
    // inserts here; a foreign album/track must bubble to the bucket-level drop so it
    // EXPANDS into credited artists rather than landing as a raw member.
    if (bucketType === 'artist' && it.srcItemType !== 'artist')
      return false
    return true
  }
  return (
    <div
	style={{ position: 'relative' }}
	onDragOver={(e) => {
        if (onInsert && acceptCol()) {
          e.preventDefault()
          e.stopPropagation()
          setOver(true)
        }
      }}
	onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setOver(false)
      }}
	onDrop={(e) => {
        if (!onInsert || !acceptCol())
          return
        e.preventDefault()
        e.stopPropagation()
        const it = dnd
        setOver(false)
        if (it && it.itemId && it.fromBucketId)
          onInsert(it.itemId, it.fromBucketId, album.itemId)
        dnd = null
      }}
    >
      {over && <div style={{ position: 'absolute', left: -7, top: 0, bottom: 26, width: 3, borderRadius: 2, background: 'var(--color-accent)' }} />}
      <div
	draggable
	onDragStart={(e) => {
          if (copySource)
            dnd = { kind: 'album', copy: true, albumId: album.albumId, fromBucketId: bucketId, srcItemType: 'album' }
          else if (fromLib)
            dnd = { kind: 'album', itemId: album.itemId, fromBucketId: bucketId, albumId: album.albumId, fromLib: true, source: libRow?.source, srcItemType: 'album' }
          else
            // srcItemType/trackId/artistId let an Artist-bucket drop route a source
            // (album/track → expand into credited artists) vs an artist member (move).
            dnd = { kind: 'album', itemId: album.itemId, fromBucketId: bucketId, albumId: album.albumId, trackId: album.trackId, artistId: album.artistId, srcItemType: album.itemType }
          e.dataTransfer.effectAllowed = copySource ? 'copy' : (fromLib ? 'copyMove' : 'move')
          setDraggingId(album.itemId)
          setDragKind('album')
          // FEAT-pocket-buckit-viewers Track A — REVERSE of Step 6: hand this board
          // member's drag to the Pocket island (separate React root) so a Pocket target
          // (tray chip / open drawer) can preview the drop via the General/Artist accept
          // gate. The board keeps the live `dnd`; on drop the Pocket target fires
          // PB_BOARD_DROP back here and routeAlbumDrop runs the actual add/expand.
          if (dnd) {
            window.dispatchEvent(new CustomEvent<PbBoardDndStartDetail>(PB_BOARD_DND_START_EVENT, {
              detail: {
                srcItemType: dnd.srcItemType ?? 'album',
                albumId: dnd.albumId ?? null,
                trackId: dnd.trackId ?? null,
                artistId: dnd.artistId ?? null,
              },
            }))
          }
        }}
	onDragEnd={() => {
          dnd = null
          setDraggingId(null)
          setDragKind(null)
          window.dispatchEvent(new CustomEvent(PB_BOARD_DND_END_EVENT))
        }}
	onClick={() => {
          // FEAT-my-buckit-artist: an artist member navigates to its /artist/[id]
          // hub (the canonical detail surface, not a modal). A drag never fires a
          // click (HTML5 DnD), so no suppressClick guard is needed.
          if (isArtist) {
            if (album.artistId)
              window.location.assign(artistHref(album.artistId))
            return
          }
          // A non-album member has no album-detail target — clicking it is a no-op.
          if (!isAlbum)
            return
          onOpen({ album: album.title, artist: album.artist, real: true, albumId: album.albumId ?? undefined, cover: album.cover, year: album.year, writable: !copySource && !fromLib, bucketId, itemId: album.itemId, note: album.note ?? null, prepTonight: album.prepTonight ?? false })
        }}
	// Warm the album-detail cache on intent (hover / tap-start) so the modal
	// opens on an edge hit instead of a ~1s miss (see lib/albumDetail.ts).
	onPointerEnter={() => prefetchAlbumDetail(album.albumId)}
	onPointerDown={() => prefetchAlbumDetail(album.albumId)}
	className={`lf-drag-handle bb-tile${dragging ? ' lf-is-dragging' : ''}`}
	title={`${album.title} — ${album.artist}`}
      >
        <div style={{ position: 'relative' }}>
          <AlbumArt url={album.cover} label={album.title} />
          {isNew && (
            <span
	aria-label="새로 추가됨"
	style={{ position: 'absolute', top: -4, right: -4, width: 10, height: 10, borderRadius: '50%', background: 'var(--color-accent)', boxShadow: '0 0 0 2px var(--color-bg)' }}
            />
          )}
          {copySource && (
            <span className="mono" style={{ position: 'absolute', left: 6, top: 6, fontSize: 9, letterSpacing: '0.06em', color: '#fff', background: 'rgba(11,61,31,0.82)', padding: '2px 5px', borderRadius: 3 }}>복사</span>
          )}
          {!isAlbum && (
            <span className="mono" style={{ position: 'absolute', left: 6, top: 6, fontSize: 9, letterSpacing: '0.06em', color: 'var(--color-bg)', background: 'color-mix(in srgb, var(--color-text) 78%, transparent)', padding: '2px 5px', borderRadius: 3 }}>{ITEM_TYPE_LABEL[album.itemType] ?? album.itemType}</span>
          )}
          {libRow && <SlibBadges row={libRow} />}
          {!copySource && !libRow && !rated && album.alreadyReviewed && (
            <span className="mono" style={{ position: 'absolute', top: 0, left: 0, fontSize: 9, letterSpacing: '0.06em', color: '#fff', background: 'var(--color-accent)', padding: '3px 6px' }}>평론함</span>
          )}
          {rated && score != null && (
            <span className="mono" style={{ position: 'absolute', top: 6, right: 6, fontSize: 11, fontWeight: 600, color: 'var(--color-bg)', background: 'var(--color-text)', padding: '2px 6px', borderRadius: 3 }}>{score.toFixed(1)}</span>
          )}
          {rated && score == null && (
            <span className="mono" style={{ position: 'absolute', top: 6, right: 6, fontSize: 9, letterSpacing: '0.05em', color: 'var(--color-subtle)', background: 'var(--color-bg)', border: '1px solid var(--color-border-soft)', padding: '2px 5px', borderRadius: 3 }}>미평가</span>
          )}
          {/* FEAT-bucket-identity Direction B — quiet "이미 들음 → 평론 가능" hint:
              a small hollow ring at the bottom-right. Listened implies not-yet-
              reviewed, so it never collides with the 평론함 badge or rating chips. */}
          {listened && (
            <span
	title="이미 들음 → 평론 가능"
	aria-label="이미 들음 — 평론 가능"
	style={{ position: 'absolute', bottom: 6, right: 6, width: 10, height: 10, borderRadius: '50%', background: 'var(--color-bg)', border: '2px solid oklch(0.62 0.10 155)', boxShadow: '0 0 0 1px var(--color-bg)' }}
            />
          )}
          {research && (
            <CoverResearchBadge status={research.status} active={research.mode !== 'off'} onOpen={research.onOpen} />
          )}
          {research && research.mode === 'selected' && (
            <input
	type="checkbox"
	className="rsh-cover-check"
	checked={research.selected}
	title="자동 조사 대상"
	aria-label="자동 조사 대상으로 선택"
	onClick={e => e.stopPropagation()}
	onChange={e => research.onToggleSelected(e.target.checked)}
            />
          )}
          {onTouchActions && (
            <button
	type="button"
	className="bb-tile-kebab"
	title="동작"
	aria-label="앨범 동작"
	draggable={false}
	onClick={(e) => {
                e.stopPropagation()
                onTouchActions()
              }}
            >
              ⋯
            </button>
          )}
        </div>
        <div style={{ marginTop: 7 }}>
          <div className="serif italic" style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{album.title}</div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{album.artist}</div>
        </div>
      </div>
    </div>
  )
}

interface Ops {
  tree: BoardBucket[]
  copyAlbum: (albumId: string, toBucketId: string) => void
  // `bakeOrder` (FEAT-bucket-organize per-bucket view): when set, the destination's
  // stored order is first re-sorted to this item-id list (the bucket's current
  // display order) before the move, so a reorder done from a sorted/grouped view
  // lands where it looks. The caller then resets that bucket's view to manual.
  insertAlbum: (itemId: string, fromBucketId: string, toBucketId: string, beforeItemId: string | null, bakeOrder?: string[]) => void
  // Nest a bucket as the last child of `targetId` (drop ON a card body).
  moveBucketInto: (bucketId: string, targetId: string | null) => void
  // Reposition a bucket among `parentId`'s children, before `beforeId` (null =
  // append). parentId null = top level. Drives reorder + un-nest (gap drops).
  moveBucketTo: (bucketId: string, parentId: string | null, beforeId: string | null) => void
  // FEAT-my-buckit-artist: `type` ('general' | 'artist') is fixed at create.
  addBucket: (parentId: string | null, type?: 'general' | 'artist') => void
  rename: (id: string, name: string) => void
  setColor: (id: string, color: string | null) => void
  // FEAT-public-bucket-multiuser Scope A — opt the bucket in/out of public visibility.
  setIsPublic: (id: string, isPublic: boolean) => void
  requestAdd: (bucketId: string, bucketName: string, bucketType: string) => void
  // FEAT-my-buckit-artist: expand a featuring track / compilation album source into
  // its credited artists on an Artist bucket (the source row is never stored).
  expandSource: (bucketId: string, source: { albumId: string } | { trackId: string }) => void
  // FEAT-album-research-notes
  setResearchMode: (bucketId: string, mode: 'off' | 'all' | 'selected') => void
  setItemSelected: (bucketId: string, itemId: string, selected: boolean) => void
  openResearch: (albumId: string, title: string) => void
}

// Props shared by every BucketCard / BucketList in the tree (everything except
// the per-node `bucket` + `depth`). Bundled so BucketList can forward them with a
// single spread to the recursive cards.
interface SharedProps {
  ops: Ops
  onOpen: (t: DetailTarget) => void
  ratings: Map<string, number>
  /**
   * album_id → Spotify-library sync row; only populated for the special
   * spotify_library bucket so its covers get source/state badges.
   */
  libState: Map<string, SpotifyLibraryAlbumState>
  /**
   * FEAT-bucket-identity Direction B — album_ids the member has already listened
   * to, for the quiet "이미 들음 → 평론 가능" hint on not-yet-reviewed bucket
   * covers. Empty until the one-shot mount fetch resolves (or on error).
   */
  listenedAlbumIds: Set<string>
  dropTarget: string | null
  setDropTarget: (fn: string | null | ((t: string | null) => string | null)) => void
  draggingId: string | null
  setDraggingId: (id: string | null) => void
  draggingBucket: string | null
  setDraggingBucket: (id: string | null) => void
  setDragKind: (k: DragKind) => void
  dragKind: DragKind
  // Per-bucket sort/group/filter (FEAT-bucket-organize). Keyed by bucket id; a
  // missing entry means DEFAULT_BUCKET_VIEW. Persisted to localStorage by the board.
  bucketViews: Record<string, BucketView>
  setBucketViews: Dispatch<SetStateAction<Record<string, BucketView>>>
  // album_id → live research status (one batched GET /api/research/status poll for
  // the whole board), falling back to the bucket-payload seed. No per-cover GET.
  researchStatus: Record<string, ResearchStatus>
  // Touch fallback (coarse pointers): open the per-album / per-bucket action
  // sheet. The board owns the single open sheet + the picker it spawns; these
  // are no-ops on the drag path (desktop keeps using DnD).
  openAlbumSheet: (a: AlbumSheet) => void
  openBucketSheet: (b: BoardBucket) => void
  // FEAT-my-buckit — itemIds with a live transient 'NEW' dot (just drag-added).
  newItemIds: Set<string>
}

// A pending album action sheet — carries enough to drive the exact ops the drop
// handlers would, plus the copy/library flags so the right verbs show.
interface AlbumSheet { album: BoardAlbum, bucketId: string, copySource: boolean, fromLib: boolean, source?: string }

type CardProps = SharedProps & { bucket: BoardBucket, depth: number }

function BucketCard({ bucket, depth, ops, onOpen, ratings, libState, listenedAlbumIds, dropTarget, setDropTarget, draggingId, setDraggingId, draggingBucket, setDraggingBucket, setDragKind, dragKind, bucketViews, setBucketViews, researchStatus, openAlbumSheet, openBucketSheet, newItemIds }: CardProps) {
  const shared: SharedProps = { ops, onOpen, ratings, libState, listenedAlbumIds, dropTarget, setDropTarget, draggingId, setDraggingId, draggingBucket, setDraggingBucket, setDragKind, dragKind, bucketViews, setBucketViews, researchStatus, openAlbumSheet, openBucketSheet, newItemIds }
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(bucket.name)
  const [coloring, setColoring] = useState(false)
  const [researching, setResearching] = useState(false)
  const [publicizing, setPublicizing] = useState(false)
  const [viewing, setViewing] = useState(false)
  const accent = crColor(bucket, depth)
  const hot = dropTarget === bucket.id
  const isLib = bucket.kind === SLIB_KIND

  // This bucket's view + a functional setter (per-bucket; missing → default).
  const view = bucketViews[bucket.id] ?? DEFAULT_BUCKET_VIEW
  const viewActive = !isDefaultView(view)
  const updateView = (fn: (v: BucketView) => BucketView) =>
    setBucketViews(prev => ({ ...prev, [bucket.id]: fn(prev[bucket.id] ?? DEFAULT_BUCKET_VIEW) }))
  const resetView = () => setBucketViews((prev) => {
    if (!prev[bucket.id])
      return prev
    const next = { ...prev }
    delete next[bucket.id]
    return next
  })
  const bucketGenreList = albumGenres(bucket.albums)
  // Item-types present in this bucket — drives the type-filter chips (only when
  // ≥2 kinds coexist; a single-type bucket needs no filter).
  const bucketTypeList = albumTypes(bucket.albums)

  // A within-bucket reorder (cover insert-before). When the view is non-default we
  // bake the current display order into manual `position` and reset the view, so the
  // drop lands where it looks (the user's "drag → becomes manual" rule).
  const handleInsert = (itemId: string, fromBucketId: string, beforeItemId: string) => {
    if (viewActive) {
      ops.insertAlbum(itemId, fromBucketId, bucket.id, beforeItemId, displayOrder(bucket.albums, view))
      resetView()
    }
    else {
      ops.insertAlbum(itemId, fromBucketId, bucket.id, beforeItemId)
    }
  }

  const onDragOver = (e: React.DragEvent) => {
    const it = dnd
    if (!it)
      return
    // Acceptance rules live in @lib/boardDnd (pure, unit-tested).
    if ((it.kind === 'album' && canAcceptAlbumDrag(bucket, it)) || (it.kind === 'bucket' && canAcceptBucketDrag(ops.tree, bucket, it))) {
      e.preventDefault()
      e.stopPropagation()
      setDropTarget(bucket.id)
    }
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const it = dnd
    setDropTarget(null)
    if (!it)
      return
    // Route via the shared helper so the board card and the reverse-DnD PB_BOARD_DROP
    // listener apply IDENTICAL semantics (library copy/guard, Artist source-expansion,
    // General add/move, bucket-into-bucket). drag-over already gated acceptance.
    routeAlbumDrop(bucket, it, ops)
    dnd = null
  }

  const renderChip = (a: BoardAlbum) => (
    <AlbumChip
	key={a.itemId}
	album={a}
	bucketId={bucket.id}
	bucketType={bucket.type}
	rated={bucket.isDone && a.itemType === 'album'}
	score={bucket.isDone && a.itemType === 'album' ? (ratings.get(a.albumId ?? '') ?? null) : null}
	libRow={isLib ? (libState.get(a.albumId ?? '') ?? null) : null}
	listened={a.albumId != null && listenedAlbumIds.has(a.albumId) && !a.alreadyReviewed}
	fromLib={isLib}
	isNew={newItemIds.has(a.itemId)}
	onOpen={onOpen}
	draggingId={draggingId}
	setDraggingId={setDraggingId}
	setDragKind={setDragKind}
	onTouchActions={() => openAlbumSheet({ album: a, bucketId: bucket.id, copySource: false, fromLib: isLib, source: isLib ? libState.get(a.albumId ?? '')?.source : undefined })}
	onInsert={isLib ? undefined : handleInsert}
	research={(isLib || a.itemType !== 'album') ?
		undefined :
		{
			mode: bucket.researchMode,
			selected: a.researchSelected,
			// live batched status ⊕ bucket-payload seed — no per-cover GET.
			status: researchStatus[a.albumId ?? ''] ?? a.researchStatus ?? null,
			onOpen: () => {
 if (a.albumId)
ops.openResearch(a.albumId, a.title)
},
			onToggleSelected: (next: boolean) => ops.setItemSelected(bucket.id, a.itemId, next),
		}}
    />
  )
  const addBtn = (
    <button
	type="button"
	onClick={() => ops.requestAdd(bucket.id, bucket.name, bucket.type)}
	style={{ aspectRatio: '1 / 1', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-faded)', background: 'none', border: '1px dashed var(--color-border)', borderRadius: 4, cursor: 'pointer' }}
    >
      ＋ 추가
    </button>
  )
  // Library bucket: split covers into "내가 넣은" (myblog_added → pushed to Spotify) and
  // "기존" (preexisting in the Library, non-deletable) with a boundary between the two.
  const libMine = isLib ? bucket.albums.filter(a => (libState.get(a.albumId ?? '')?.source ?? 'myblog_added') !== 'preexisting') : []
  const libExisting = isLib ? bucket.albums.filter(a => libState.get(a.albumId ?? '')?.source === 'preexisting') : []
  const slibLabel = (divider: boolean): React.CSSProperties => ({
    gridColumn: '1 / -1',
    fontSize: 10,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--color-subtle)',
    marginTop: divider ? 6 : 0,
    paddingTop: divider ? 14 : 0,
    borderTop: divider ? '1px solid var(--color-border)' : 'none',
  })

  // This bucket's albums under its view: genre-filter, then either a flat sorted
  // list (group none) or per-artist / per-genre sections (each sorted within).
  const filtered = isLib ? [] : bucket.albums.filter(a => passesGenre(a, view.genreFilter) && passesType(a, view.typeFilter))
  const flatAlbums = view.group === 'none' ? sortAlbums(filtered, view.sort) : []
  const sections: { label: string, albums: BoardAlbum[] }[] =
    view.group === 'genre' ?
      genreGroups(filtered, view.sort).map(g => ({ label: g.genre, albums: g.albums })) :
      view.group === 'artist' ?
        artistGroups(filtered, view.sort).map(g => ({ label: g.artist, albums: g.albums })) :
        []
  const sectionLabelStyle: React.CSSProperties = { gridColumn: '1 / -1', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-subtle)', marginTop: 2 }
  const filteredEmpty = !isLib && bucket.albums.length > 0 && filtered.length === 0

  return (
    <div
	onDragOver={onDragOver}
	onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDropTarget(t => (t === bucket.id ? null : t))
      }}
	onDrop={onDrop}
	style={{
        background: depth ? 'color-mix(in srgb, var(--color-paper) 55%, var(--color-bg))' : 'var(--color-paper)',
        border: hot ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
        borderLeft: `3px solid ${accent}`,
        borderRadius: 8,
        padding: 14,
        boxShadow: hot ? '0 0 0 3px color-mix(in srgb, var(--color-accent) 14%, transparent)' : (depth ? 'none' : '0 1px 2px rgba(26,26,26,0.05)'),
        opacity: draggingBucket === bucket.id ? 0.45 : 1,
        transition: 'box-shadow 0.12s, border-color 0.12s',
      }}
    >
      {/* header — the WHOLE row is the bucket drag handle now (was just the tiny
          ⠿, which users couldn't find / grab). Disabled while renaming so the
          text field stays selectable. Child buttons still click normally. */}
      <div
	draggable={!editing}
	onDragStart={(e) => {
          dnd = { kind: 'bucket', bucketId: bucket.id }
          e.dataTransfer.effectAllowed = 'move'
          setDraggingBucket(bucket.id)
          setDragKind('bucket')
        }}
	onDragEnd={() => {
          dnd = null
          setDraggingBucket(null)
          setDropTarget(null)
          setDragKind(null)
        }}
	style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12, cursor: editing ? 'default' : 'grab' }}
      >
        <span
	className="mono"
	style={{ color: 'var(--color-faded)', fontSize: 16, lineHeight: 1, userSelect: 'none', flex: '0 0 auto' }}
        >
          ⠿
        </span>
        {editing ?
          (
              <input
	autoFocus
	value={name}
	onChange={e => setName(e.target.value)}
	onBlur={() => {
                  const next = name.trim() || bucket.name
                  if (next !== bucket.name)
                    ops.rename(bucket.id, next)
                  setEditing(false)
                }}
	onKeyDown={(e) => {
                  if (e.key === 'Enter')
                    e.currentTarget.blur()
                  if (e.key === 'Escape') {
                    setName(bucket.name)
                    setEditing(false)
                  }
                }}
	className="serif"
	style={{ fontSize: 17, fontWeight: 500, color: 'var(--color-text)', background: 'var(--color-bg)', border: '1px solid var(--color-accent)', borderRadius: 4, padding: '1px 7px', minWidth: 120 }}
              />
            ) :
          (
              <button
	type="button"
	onClick={() => {
                  setName(bucket.name)
                  setEditing(true)
                }}
	className="serif"
	style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-0.01em', color: bucket.color || 'var(--color-text)', background: 'none', border: 'none', padding: 0, cursor: 'text', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}
	title="클릭하여 이름 변경"
              >
                {bucket.name}
              </button>
            )}
        <span style={{ marginLeft: 2 }}><CrStatus b={bucket} /></span>
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--color-faded)', whiteSpace: 'nowrap' }}>
          {countAlbums(bucket)}
          장
        </span>
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <button type="button" className="iconbtn" title="버킷 색상" onClick={() => setColoring(v => !v)} style={{ padding: 0 }}>
            <span style={{ width: 13, height: 13, borderRadius: 13, background: accent, border: '1px solid var(--color-border)', display: 'block' }} />
          </button>
          {!isLib && (
            <button
	type="button"
	className="iconbtn"
	title="정렬 · 그룹 · 장르 필터"
	aria-pressed={viewActive}
	onClick={() => setViewing(v => !v)}
	style={viewActive ? { color: 'var(--color-accent)' } : undefined}
            >
              ⇅
            </button>
          )}
          {!isLib && (
            <button
	type="button"
	className="iconbtn"
	title="자동 조사 설정"
	aria-pressed={bucket.researchMode !== 'off'}
	onClick={() => setResearching(v => !v)}
	style={bucket.researchMode !== 'off' ? { color: 'var(--color-accent)' } : undefined}
            >
              🔎
            </button>
          )}
          {!isLib && (
            <button
	type="button"
	className="iconbtn"
	title={bucket.isPublic ? '공개됨 — 공개 설정' : '비공개 — 공개 설정'}
	aria-pressed={bucket.isPublic}
	onClick={() => setPublicizing(v => !v)}
	style={bucket.isPublic ? { color: 'var(--color-accent)' } : undefined}
            >
              🌐
            </button>
          )}
          <button type="button" className="iconbtn" title={bucket.type === 'artist' ? '아티스트 추가' : '앨범 추가'} onClick={() => ops.requestAdd(bucket.id, bucket.name, bucket.type)}>＋</button>
          <button type="button" className="iconbtn" title="하위 버킷 추가" onClick={() => ops.addBucket(bucket.id)}>⊞</button>
          {!isLib && (
            // Explicit rename — complements the click-the-title gesture so the
            // action is discoverable, not just an unlabeled title click.
            <button
	type="button"
	className="iconbtn"
	title="이름 변경"
	aria-label="이름 변경"
	onClick={() => {
                setName(bucket.name)
                setEditing(true)
              }}
            >
              ✎
            </button>
          )}
          {!isLib && (
            // The 버킷 동작 menu (이동/중첩 + 삭제) — now visible on every viewport
            // (was touch-only), so those actions aren't discoverable only via the
            // drag-to-trash / header-drag gestures. See .bb-bucket-actions CSS.
            <button type="button" className="iconbtn bb-bucket-actions" title="버킷 동작" aria-label="버킷 동작" onClick={() => openBucketSheet(bucket)}>⋯</button>
          )}
        </div>
      </div>

      {/* color picker */}
      {coloring && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span className="meta">색상</span>
          <div style={{ display: 'flex', gap: 7 }}>
            {BUCKET_COLORS.map((c) => {
              const selected = c.color == null ? !bucket.color : bucket.color === c.color
              return (
                <button
	type="button"
	key={c.key}
	title={c.label}
	aria-label={`버킷 색상 ${c.label}`}
	onClick={() => {
                    ops.setColor(bucket.id, c.color)
                    setColoring(false)
                  }}
	style={{ width: 20, height: 20, borderRadius: 20, background: c.color ?? 'var(--color-text)', cursor: 'pointer', border: selected ? '2px solid var(--color-text)' : '1px solid var(--color-border)', outline: selected ? '1px solid var(--color-bg)' : 'none', outlineOffset: -3 }}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* auto-research scope (off / 전체 / 선택) */}
      {researching && !isLib && (
        <div className="rsh-mode-row">
          <span className="meta">자동 조사</span>
          <div className="rsh-seg" role="group" aria-label="자동 조사 범위">
            {(['off', 'all', 'selected'] as const).map(val => (
              <button
	key={val}
	type="button"
	className="rsh-seg-btn"
	aria-pressed={bucket.researchMode === val}
	onClick={() => ops.setResearchMode(bucket.id, val)}
              >
                {val === 'off' ? '끔' : (val === 'all' ? '전체' : '선택')}
              </button>
            ))}
          </div>
          <span className="rsh-mode-hint">
            {bucket.researchMode === 'all' ?
              '담는 앨범을 자동으로 조사합니다' :
              (bucket.researchMode === 'selected' ? '체크한 앨범만 조사합니다' : '자동 조사가 꺼져 있습니다')}
          </span>
        </div>
      )}

      {/* public visibility (비공개 / 공개) — FEAT-public-bucket-multiuser A3 */}
      {publicizing && !isLib && (
        <div className="rsh-mode-row">
          <span className="meta">공개</span>
          <div className="rsh-seg" role="group" aria-label="버킷 공개 여부">
            <button type="button" className="rsh-seg-btn" aria-pressed={!bucket.isPublic} onClick={() => ops.setIsPublic(bucket.id, false)}>비공개</button>
            <button type="button" className="rsh-seg-btn" aria-pressed={bucket.isPublic} onClick={() => ops.setIsPublic(bucket.id, true)}>공개</button>
          </div>
          <span className="rsh-mode-hint">
            {bucket.isPublic ?
              '이 버킷이 공개됩니다 — 누구나 컬렉션에서 볼 수 있어요' :
              '비공개 버킷입니다'}
          </span>
        </div>
      )}

      {/* per-bucket view controls — sort / group / genre filter (FEAT-bucket-organize) */}
      {viewing && !isLib && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12, padding: '10px 12px', background: 'color-mix(in srgb, var(--color-paper) 60%, var(--color-bg))', border: '1px solid var(--color-border-soft)', borderRadius: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="meta">정렬</span>
              <div className="rsh-seg" role="group" aria-label="정렬">
                {SORT_OPTS.map(o => (
                  <button key={o.v} type="button" className="rsh-seg-btn" aria-pressed={view.sort === o.v} onClick={() => updateView(v => ({ ...v, sort: o.v }))}>{o.l}</button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="meta">그룹</span>
              <div className="rsh-seg" role="group" aria-label="그룹">
                {GROUP_OPTS.map(o => (
                  <button key={o.v} type="button" className="rsh-seg-btn" aria-pressed={view.group === o.v} onClick={() => updateView(v => ({ ...v, group: o.v }))}>{o.l}</button>
                ))}
              </div>
            </div>
            {viewActive && (
              <button type="button" className="chip" onClick={resetView} style={{ color: 'var(--color-accent)', borderColor: 'var(--color-border-soft)' }}>초기화</button>
            )}
          </div>
          {bucketGenreList.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              <span className="meta" style={{ marginRight: 2 }}>장르</span>
              {bucketGenreList.map(g => (
                <button
	key={g.label}
	type="button"
	className="chip"
	aria-pressed={view.genreFilter.includes(g.label)}
	onClick={() => updateView(v => ({ ...v, genreFilter: v.genreFilter.includes(g.label) ? v.genreFilter.filter(x => x !== g.label) : [...v.genreFilter, g.label] }))}
	style={view.genreFilter.includes(g.label) ? { background: 'var(--color-text)', color: 'var(--color-bg)', borderColor: 'var(--color-text)' } : undefined}
                >
                  {g.label}
                  <span style={{ marginLeft: 5, opacity: 0.6 }}>{g.count}</span>
                </button>
              ))}
            </div>
          )}
          {bucketTypeList.length >= 2 && (
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              <span className="meta" style={{ marginRight: 2 }}>종류</span>
              {bucketTypeList.map(t => (
                <button
	key={t.type}
	type="button"
	className="chip"
	aria-pressed={view.typeFilter.includes(t.type)}
	onClick={() => updateView(v => ({ ...v, typeFilter: v.typeFilter.includes(t.type) ? v.typeFilter.filter(x => x !== t.type) : [...v.typeFilter, t.type] }))}
	style={view.typeFilter.includes(t.type) ? { background: 'var(--color-text)', color: 'var(--color-bg)', borderColor: 'var(--color-text)' } : undefined}
                >
                  {ITEM_TYPE_LABEL[t.type] ?? t.type}
                  <span style={{ marginLeft: 5, opacity: 0.6 }}>{t.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* cover grid */}
      <div style={{ display: 'grid', gap: '14px 12px', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))' }}>
        {isLib ?
(
          <>
            <div className="mono" style={slibLabel(false)}>내가 넣은 · Spotify에 추가</div>
            {libMine.map(renderChip)}
            {addBtn}
            <div className="mono" style={slibLabel(true)}>기존 · Spotify 라이브러리 (삭제 불가)</div>
            {libExisting.length > 0 ?
              libExisting.map(renderChip) :
              <div className="mono" style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--color-faded)', padding: '4px 0', letterSpacing: '0.04em' }}>없음</div>}
          </>
        ) :
(
          <>
            {view.group === 'none' ?
              flatAlbums.map(renderChip) :
              sections.flatMap(s => [
                <div key={`sec-${s.label}`} className="mono" style={sectionLabelStyle}>
                  {s.label}
                  <span style={{ marginLeft: 6, color: 'var(--color-faded)' }}>{s.albums.length}</span>
                </div>,
                ...s.albums.map(renderChip),
              ])}
            {bucket.albums.length === 0 && bucket.children.length === 0 && (
              <div className="mono" style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--color-faded)', border: '1px dashed var(--color-border)', borderRadius: 4, padding: 18, textAlign: 'center', letterSpacing: '0.04em' }}>비어 있음</div>
            )}
            {filteredEmpty && (
              <div className="mono" style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--color-faded)', padding: '4px 0', letterSpacing: '0.04em' }}>이 필터에 해당하는 항목이 없습니다</div>
            )}
            {addBtn}
          </>
        )}
      </div>

      {/* nested buckets — a reorderable list (gaps show the insertion line) */}
      {bucket.children.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <BucketList items={bucket.children} parentId={bucket.id} depth={depth + 1} shared={shared} />
        </div>
      )}
    </div>
  )
}

// ── trash icon (simple stroke) ───────────────────────────────────────────────
function CrTrashIcon({ s = 28 }: { s?: number }) {
  return (
    <svg
	width={s}
	height={s}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	strokeWidth="1.7"
	strokeLinecap="round"
	strokeLinejoin="round"
	aria-hidden="true"
    >
      <line x1="4" y1="7" x2="20" y2="7" />
      <path d="M9 7V5.6A1.6 1.6 0 0 1 10.6 4h2.8A1.6 1.6 0 0 1 15 5.6V7" />
      <path d="M6.3 7l.9 12.4A1.7 1.7 0 0 0 8.9 21h6.2a1.7 1.7 0 0 0 1.7-1.6L17.7 7" />
      <line x1="10" y1="10.5" x2="10" y2="17.5" />
      <line x1="14" y1="10.5" x2="14" y2="17.5" />
    </svg>
  )
}

// ── trash dock (center-bottom card, mounted only while dragging) ─────────────--
// A single solid card pinned to the bottom-center of the viewport (portaled to
// <body>). No backdrop / blur — the buckets behind it stay crisp so you can keep
// dropping onto them. Replaces the old full-height side rails (휴지통 + 최상위로
// 빼기): un-nesting now happens by dragging a bucket into a top-level gap, so the
// dock only needs to host deletion. Albums → recoverable trash; buckets → confirm.
function TrashDock({ trashCount, onTrashAlbum, onTrashBucket }: { trashCount: number, onTrashAlbum: (itemId: string, fromBucketId: string) => void, onTrashBucket: (bucketId: string) => void }) {
  const [hot, setHot] = useState(false)
  // A 기존/preexisting Spotify-library album can't be trashed (req 4): removing it
  // wouldn't delete it from Spotify and the next sync re-pulls it anyway. myblog_added
  // library albums DO trash (→ next sync removes them from Spotify).
  // `!!dnd.albumId`: only album members are trashable — the trash restores solely via
  // the album re-add path, so a track/artist/review/playback row (albumId null) would
  // vanish permanently on 복원. Reject the drop rather than offer a false recovery.
  const accepts = (): boolean => !!dnd && ((dnd.kind === 'album' && !dnd.copy && !!dnd.albumId && !(dnd.fromLib && dnd.source === 'preexisting')) || dnd.kind === 'bucket')
  return (
    <div
	className="crate-trash-dock"
	onDragOver={(e) => {
        if (accepts()) {
          e.preventDefault()
          setHot(true)
        }
      }}
	onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setHot(false)
      }}
	onDrop={(e) => {
        if (!accepts())
          return
        e.preventDefault()
        const it = dnd
        setHot(false)
        if (it && it.kind === 'album' && it.itemId && it.fromBucketId)
          onTrashAlbum(it.itemId, it.fromBucketId)
        else if (it && it.kind === 'bucket' && it.bucketId)
          onTrashBucket(it.bucketId)
        dnd = null
      }}
    >
      <div className="crate-trash-card" data-hot={hot ? 'true' : 'false'}>
        <span className="crate-trash-ring"><CrTrashIcon s={28} /></span>
        <div>
          <div className="serif" style={{ fontSize: 21, fontWeight: 500, lineHeight: 1.2, color: hot ? 'var(--color-accent)' : 'var(--color-text)' }}>휴지통</div>
          {trashCount > 0 && (
            <div className="mono" style={{ marginTop: 7, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, letterSpacing: '0.06em', whiteSpace: 'nowrap', color: hot ? 'var(--color-accent)' : 'var(--color-faded)' }}>
              <span style={{ width: 5, height: 5, borderRadius: 5, background: 'currentColor' }} />
              보관
              {' '}
              {trashCount}
              개
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── bucket reorder drop gap (shows the red insertion line) ───────────────────-
// Sits between sibling bucket cards (and at the head/tail of each list). While a
// bucket is being dragged it becomes a drop target: dropping here repositions the
// bucket among `parentId`'s children before `beforeId` (null = append). A
// top-level gap (parentId == null) un-nests a nested bucket — the replacement for
// the removed "최상위로 빼기" rail. Cycle / self-adjacent drops are rejected.
function BucketDropGap({ parentId, beforeId, ops, active }: { parentId: string | null, beforeId: string | null, ops: Ops, active: boolean }) {
  const [hot, setHot] = useState(false)
  const accepts = (): boolean => {
    const it = dnd
    if (!it || it.kind !== 'bucket' || !it.bucketId)
      return false
    if (it.bucketId === beforeId)
      return false // gap directly above itself = no-op
    if (parentId != null) {
      const src = findBucket(ops.tree, it.bucketId)
      if (parentId === it.bucketId || (src && subtreeHas(src, parentId)))
        return false // would nest a bucket inside its own subtree
    }
    return true
  }
  return (
    <div
	onDragOver={(e) => {
        if (active && accepts()) {
          e.preventDefault()
          e.stopPropagation()
          setHot(true)
        }
      }}
	onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setHot(false)
      }}
	onDrop={(e) => {
        if (!active || !accepts())
          return
        e.preventDefault()
        e.stopPropagation()
        const it = dnd
        setHot(false)
        if (it && it.bucketId)
          ops.moveBucketTo(it.bucketId, parentId, beforeId)
        dnd = null
      }}
	style={{ height: 14, position: 'relative' }}
    >
      {active && (
        <div
	style={{
            position: 'absolute',
            left: 2,
            right: 2,
            top: '50%',
            transform: 'translateY(-50%)',
            height: hot ? 4 : 2,
            borderRadius: 3,
            background: hot ? 'var(--color-accent)' : 'transparent',
            boxShadow: hot ? '0 0 0 3px color-mix(in srgb, var(--color-accent) 18%, transparent)' : 'none',
            transition: 'height 0.1s, background 0.1s',
          }}
        >
          {hot && <span style={{ position: 'absolute', left: -2, top: '50%', transform: 'translate(-100%, -50%)', width: 7, height: 7, borderRadius: 7, background: 'var(--color-accent)' }} />}
        </div>
      )}
    </div>
  )
}

// ── bucket list — drop gaps interleaved with cards ───────────────────────────-
// Renders a sibling list with a BucketDropGap before each card and a trailing gap
// (the append target). Recurses through BucketCard for nested children so reorder
// works at every depth.
function BucketList({ items, parentId, depth, shared }: { items: BoardBucket[], parentId: string | null, depth: number, shared: SharedProps }) {
  const active = shared.dragKind === 'bucket'
  return (
    <div>
      {items.map(b => (
        <div key={b.id}>
          <BucketDropGap parentId={parentId} beforeId={b.id} ops={shared.ops} active={active} />
          <BucketCard bucket={b} depth={depth} {...shared} />
        </div>
      ))}
      <BucketDropGap parentId={parentId} beforeId={null} ops={shared.ops} active={active} />
    </div>
  )
}

// ── trash drawer (recoverable albums) ────────────────────────────────────────
interface TrashEntry { tid: string, album: BoardAlbum, fromBucketId: string, fromName: string }

function TrashDrawer({ trash, onRestore, onPurge, onEmpty, onClose }: { trash: TrashEntry[], onRestore: (tid: string) => void, onPurge: (tid: string) => void, onEmpty: () => void, onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape')
        onClose()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="scrim" onClick={onClose} role="presentation">
      <aside className="slideover" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="휴지통">
        <button type="button" className="iconbtn" onClick={onClose} aria-label="닫기" style={{ position: 'absolute', top: 16, right: 16, width: 30, height: 30, borderColor: 'var(--color-border-soft)' }}>✕</button>
        <div className="kicker" style={{ marginBottom: 6 }}>휴지통</div>
        <h2 className="serif" style={{ fontSize: 24, fontWeight: 500 }}>
          {trash.length}
          개 항목
        </h2>
        <p className="serif italic" style={{ color: 'var(--color-subtle)', fontSize: 14, marginTop: 6, marginBottom: 22 }}>버킷에서 뺀 앨범이 보관됩니다. 원래 버킷으로 복원하거나 완전히 비울 수 있어요.</p>

        {trash.length === 0 && (
          <div className="mono" style={{ fontSize: 11, color: 'var(--color-faded)', border: '1px dashed var(--color-border)', borderRadius: 6, padding: 28, textAlign: 'center' }}>휴지통이 비어 있습니다</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {trash.map(t => (
            <div key={t.tid} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'var(--color-paper)', border: '1px solid var(--color-border-soft)', borderRadius: 6 }}>
              <div style={{ flex: '0 0 42px', width: 42 }}><AlbumArt url={t.album.cover} label={t.album.title} size={42} /></div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="serif" style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.album.title}</div>
                <div className="meta" style={{ textTransform: 'none', letterSpacing: 0, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {t.album.artist}
                  {t.fromName ? ` · ${t.fromName}에서` : ''}
                </div>
              </div>
              <button type="button" className="chip" onClick={() => onRestore(t.tid)}>복원</button>
              <button type="button" className="iconbtn danger" title="완전 삭제" onClick={() => onPurge(t.tid)}>✕</button>
            </div>
          ))}
        </div>

        {trash.length > 0 && (
          <button type="button" className="btn" onClick={onEmpty} style={{ width: '100%', marginTop: 18, color: 'var(--color-accent)', borderColor: 'var(--color-accent)' }}>휴지통 비우기</button>
        )}
      </aside>
    </div>
  )
}

// ── action sheet (touch fallback) ────────────────────────────────────────────
// A small bottom sheet of labeled actions, portaled to <body> like TrashDock.
// Replaces drag-and-drop on touch devices (where onDragStart never fires). Each
// row's onClick runs the SAME ops the drop handlers call. Dismissable on
// backdrop tap / ESC.
// ── board ────────────────────────────────────────────────────────────────---
// Stable empty id-set: passed to useResearchStatusMap when the bucket tab is
// hidden so the hook clears its map + stops polling without thrashing the memo.
const NO_RESEARCH_IDS: string[] = []

export function BucketBoard({ onOpen, reviews, active = true }: { onOpen: (t: DetailTarget) => void, reviews: MemberReview[], active?: boolean }) {
  // Seed both from localStorage so the board paints immediately on mount and
  // only the (background) revalidation is async — no "불러오는 중…" flash, no
  // disappear-then-reappear when returning to the tab. Stale by design; the
  // mount effects below overwrite with the canonical server data (SWR).
  // FEAT-pocket-buckit-workspace Step B — the tree lives in the SHARED bucketStore so the
  // board, the layout tray, and the library are one source of truth (a mutation in one is
  // seen by the others instantly, no refetch). `setTree` is a drop-in shim writing the
  // store, so every existing call site is unchanged.
  const storeSnap = useBucketStore()
  const tree = storeSnap.tree
  const setTree = useCallback<Dispatch<SetStateAction<BoardBucket[] | null>>>((updater) => {
    const prev = bucketStore.getTree()
    const next = typeof updater === 'function' ? updater(prev) : updater
    if (next)
      bucketStore.setTree(next)
  }, [])
  const [recent, setRecent] = useState<BoardAlbum[] | null>(() => readSeed<BoardAlbum[]>(RECENT_KEY))
  const [error, setError] = useState(false)
  const [addingTo, setAddingTo] = useState<{ id: string, name: string, type: string } | null>(null)
  // FEAT-my-buckit-artist: a transient board-level toast for the source-expansion
  // feedback ("참여 아티스트 N명 담음 · M명 중복"). Auto-clears after a few seconds.
  const [flash, setFlash] = useState<string | null>(null)
  useEffect(() => {
    if (!flash)
      return
    const t = setTimeout(() => setFlash(null), 4000)
    return () => clearTimeout(t)
  }, [flash])
  // FEAT-my-buckit-artist Step 4: the board-level type filter ('all'|'general'|
  // 'artist') and the ＋버킷 create-type menu (General / Artist).
  const [boardType, setBoardType] = useState<'all' | 'general' | 'artist'>('all')
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const createMenuRef = useRef<HTMLDivElement>(null)
  useDismissable(createMenuOpen, () => setCreateMenuOpen(false), createMenuRef)

  // Per-bucket sort/group/filter (FEAT-bucket-organize). bucketId → BucketView,
  // seeded from + mirrored to localStorage so each bucket's view survives reload;
  // never touches server `position`. Each BucketCard reads/writes its own entry.
  const [bucketViews, setBucketViews] = useState<Record<string, BucketView>>(() => readBucketViews())
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(bucketViews))
    }
    catch { /* ignore */ }
  }, [bucketViews])

  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [draggingBucket, setDraggingBucket] = useState<string | null>(null)
  const [dragKind, setDragKind] = useState<DragKind>(null)

  // Auto-scroll the page while a drag is in flight and the pointer nears the top or
  // bottom edge of the viewport — otherwise you can't reach buckets off-screen mid-
  // drag (HTML5 DnD suppresses normal wheel/scroll). Speed ramps with edge proximity.
  useEffect(() => {
    if (draggingId == null && draggingBucket == null)
      return
    const EDGE = 96 // px band at top/bottom that triggers scroll
    const MAX = 24 // px per frame at the very edge
    let vy = 0
    let raf = 0
    const onMove = (e: DragEvent) => {
      const y = e.clientY
      const h = window.innerHeight
      if (y < EDGE)
        vy = -Math.ceil(((EDGE - y) / EDGE) * MAX)
      else if (y > h - EDGE)
        vy = Math.ceil(((y - (h - EDGE)) / EDGE) * MAX)
      else
        vy = 0
    }
    const tick = () => {
      if (vy !== 0)
        window.scrollBy(0, vy)
      raf = requestAnimationFrame(tick)
    }
    window.addEventListener('dragover', onMove)
    raf = requestAnimationFrame(tick)
    return () => {
      window.removeEventListener('dragover', onMove)
      cancelAnimationFrame(raf)
    }
  }, [draggingId, draggingBucket])

  // Safety net: always clear the drag state when ANY drag ends — even one that
  // ends without a drop (released outside a target / Escape). The per-op endDrag
  // below covers the case where a card drop handler stopPropagation()'d the
  // event AND the dragged item's original DOM node unmounted (cross-bucket move),
  // so neither this document `drop` nor the item's own `dragend` fires; without
  // both, a moved item would stay stuck at the 0.45 drag opacity.
  useEffect(() => {
    const reset = () => {
      setDraggingId(null)
      setDraggingBucket(null)
      setDragKind(null)
      setDropTarget(null)
      dnd = null
    }
    document.addEventListener('drop', reset)
    document.addEventListener('dragend', reset)
    return () => {
      document.removeEventListener('drop', reset)
      document.removeEventListener('dragend', reset)
    }
  }, [])
  const [trash, setTrash] = useState<TrashEntry[]>(() => {
    try {
      const s = localStorage.getItem(TRASH_KEY)
      if (s)
        return JSON.parse(s) as TrashEntry[]
    }
    catch { /* ignore */ }
    return []
  })
  const [trashOpen, setTrashOpen] = useState(false)
  // FEAT-my-buckit — a transient 'NEW' dot on items that just entered a bucket via
  // a genuine drag (copy-in or cross-bucket move-in; NOT a same-bucket reorder).
  // In-memory only — no backend, no localStorage. Each id self-clears after 8s, or
  // ALL clear when the Pocket tray collapses (whichever first), via the pb:closed
  // window event from the tray island (the board can't read the tray's open state
  // cross-island). Functional setState throughout; timers cleared on unmount.
  const [newItemIds, setNewItemIds] = useState<Set<string>>(() => new Set())
  const newTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // FEAT-pocket-buckit-viewers Track A — latest ops/tree for the reverse-DnD listener.
  const opsRef = useRef<Ops | null>(null)
  const markNew = useCallback((id: string) => {
    setNewItemIds((prev) => {
      const n = new Set(prev)
      n.add(id)
      return n
    })
    const prevT = newTimers.current.get(id)
    if (prevT)
      clearTimeout(prevT)
    const t = setTimeout(() => {
      setNewItemIds((prev) => {
        if (!prev.has(id))
          return prev
        const n = new Set(prev)
        n.delete(id)
        return n
      })
      newTimers.current.delete(id)
    }, 8000)
    newTimers.current.set(id, t)
  }, [])
  // Clear every marker + timer on tray collapse and on unmount.
  useEffect(() => {
    const timers = newTimers.current
    const onClosed = () => {
      setNewItemIds(new Set())
      timers.forEach(clearTimeout)
      timers.clear()
    }
    window.addEventListener(PB_CLOSED_EVENT, onClosed)
    return () => {
      window.removeEventListener(PB_CLOSED_EVENT, onClosed)
      timers.forEach(clearTimeout)
      timers.clear()
    }
  }, [])
  // Mirror the Pocket tray's open state for the 🪣 Pocket toggle's aria-expanded.
  // The tray lives in a separate island (layout.astro) so the board can't read its
  // `open` directly; PocketBuckitInner broadcasts pb:open-state on every transition.
  const [pocketOpen, setPocketOpen] = useState(false)
  useEffect(() => {
    const onOpenState = (e: Event) => {
      const detail = (e as CustomEvent<PbOpenStateDetail>).detail
      if (detail)
        setPocketOpen(detail.open)
    }
    window.addEventListener(PB_OPEN_STATE_EVENT, onOpenState)
    return () => window.removeEventListener(PB_OPEN_STATE_EVENT, onOpenState)
  }, [])
  // FEAT-my-buckit-artist Step 6 — Pocket-open DnD into visible buckets. A drag
  // started on a tray drawer item (separate island) hands its payload over via a
  // synchronous window event so the board's module-level `dnd` is populated before
  // the first board `dragover` reads it. The payload mirrors AlbumChip's member-drag
  // shape, so canAcceptAlbumDrag / acceptCol / the bucket onDrop routing (move into a
  // General bucket, expand-source into an Artist bucket) are all reused unchanged.
  // `dragend` (drop OR cancel) always fires → `dnd` is cleared even on a missed drop.
  useEffect(() => {
    const onDndStart = (e: Event) => {
      const d = (e as CustomEvent<PbDndStartDetail>).detail
      if (d) {
        dnd = { kind: 'album', itemId: d.itemId, fromBucketId: d.fromBucketId, albumId: d.albumId, trackId: d.trackId, artistId: d.artistId, srcItemType: d.srcItemType }
      }
    }
    const onDndEnd = () => {
      dnd = null
    }
    window.addEventListener(PB_DND_START_EVENT, onDndStart)
    window.addEventListener(PB_DND_END_EVENT, onDndEnd)
    return () => {
      window.removeEventListener(PB_DND_START_EVENT, onDndStart)
      window.removeEventListener(PB_DND_END_EVENT, onDndEnd)
    }
  }, [])
  // FEAT-pocket-buckit-viewers Track A — REVERSE of Step 6: a board member dropped on a
  // Pocket target (tray chip / open drawer). The Pocket island can't run the board's
  // ops, so it hands the chosen target bucket back here; the board still holds the live
  // `dnd` (HTML5 `dragend` fires AFTER `drop`), so routeAlbumDrop applies the exact
  // add/move/expand semantics of a board-card drop. opsRef keeps the latest tree+ops
  // without re-subscribing the listener each render.
  useEffect(() => {
    const onBoardDrop = (e: Event) => {
      const d = (e as CustomEvent<PbBoardDropDetail>).detail
      const it = dnd
      const ops = opsRef.current
      if (!d || !it || !ops)
        return
      const target = findBucket(ops.tree, d.targetBucketId)
      if (target)
        routeAlbumDrop(target, it, ops)
      dnd = null
    }
    window.addEventListener(PB_BOARD_DROP_EVENT, onBoardDrop)
    return () => window.removeEventListener(PB_BOARD_DROP_EVENT, onBoardDrop)
  }, [])
  const [pendingBucketDelete, setPendingBucketDelete] = useState<{ id: string, name: string } | null>(null)
  // Touch fallback (coarse pointers): the single open album / bucket action
  // sheet, and a pending bucket-picker spawned from a sheet (carries the chosen
  // op to run once a target bucket is tapped). Drag is unaffected by all three.
  const [albumSheet, setAlbumSheet] = useState<AlbumSheet | null>(null)
  const [bucketSheet, setBucketSheet] = useState<BoardBucket | null>(null)
  const [picker, setPicker] = useState<{ title: string, skip?: (b: BoardBucket) => boolean, allowRoot?: boolean, onPick: (bucketId: string | null) => void } | null>(null)
  const confirmModalRef = useRef<HTMLDivElement>(null)
  useDismissable(!!pendingBucketDelete, () => setPendingBucketDelete(null), confirmModalRef)

  // FEAT-album-research-notes — the album whose research note reading modal is open.
  const [researchTarget, setResearchTarget] = useState<{ albumId: string, title: string } | null>(null)
  const researchPanelRef = useRef<HTMLElement>(null)
  useDismissable(!!researchTarget, () => setResearchTarget(null), researchPanelRef)
  // Lock background page scroll while the reading modal is open (only the modal
  // body scrolls). useDismissable handles ESC + focus, not scroll.
  useScrollLock(!!researchTarget)

  // album_id → the member's own star rating (0–5). Feeds the rated-bucket chips
  // without any extra fetch (reviews are already server-built into props).
  const ratings = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of reviews) {
      if (r.rating == null)
        continue
      for (const id of r.albumIds) {
        if (!m.has(id))
          m.set(id, r.rating)
      }
    }
    return m
  }, [reviews])

  // Split the special spotify_library bucket out of the normal crate tree: it
  // renders as its own section below the recent strip, never inside the grid.
  // (Top-level only — the backend guarantees one such bucket at the root.)
  const libBucket = useMemo(
    () => (tree ?? []).find(b => b.kind === SLIB_KIND) ?? null,
    [tree],
  )
  const normalTree = useMemo(
    () => (tree ?? []).filter(b => b.kind !== SLIB_KIND),
    [tree],
  )

  // Every album id that shows a research dot (normal buckets — the library bucket
  // has no research). One batched GET /api/research/status poll keeps all the
  // cover dots live; covers fall back to the bucket-payload seed meanwhile. This
  // replaces the per-cover note GET that fired album-count concurrent requests on
  // mount and throttled the Lambda → 503s ("조사 안 됨" until refresh).
  const researchAlbumIds = useMemo(() => {
    const ids: string[] = []
    visit(normalTree, b => b.albums.forEach((a) => {
 if (a.albumId)
ids.push(a.albumId)
}))
    return ids
  }, [normalTree])
  // Pause the 4s research-status self-poll while this dashboard tab is hidden
  // (SelfDashboard keeps the board mounted). An empty id-set clears the map and
  // stops the poll; it re-arms with a fresh tick when the tab becomes active.
  const researchStatus = useResearchStatusMap(active ? researchAlbumIds : NO_RESEARCH_IDS)

  // Load the real tree on mount via the shared store (SWR: reuses the cache the tray may
  // already have filled — often zero extra fetches on the member dashboard). Store load errors sync
  // into the local error flag.
  useEffect(() => {
    void bucketStore.ensureFresh()
  }, [])
  useEffect(() => {
    if (storeSnap.error)
      setError(true)
  }, [storeSnap.error])

  // Load the pinned 최근 들은 앨범 strip — same worker-fed cache the overview uses
  // (GET /api/library/recently-listened, no synchronous Spotify call, rule #9).
  useEffect(() => {
    let alive = true
    listRecentlyListened()
      .then((r) => {
        if (!alive)
          return
        const mapped: BoardAlbum[] = r.items.map(it => ({
          itemId: `recent:${it.album_id}`,
          itemType: 'album',
          albumId: it.album_id,
          trackId: null,
          reviewTargetId: null,
          artistId: null,
          title: it.album?.title ?? '제목 미상',
          artist: (it.album?.artist_names ?? []).join(', ') || '—',
          cover: it.album?.cover_url ?? null,
          year: it.album?.release_date ? Number(String(it.album.release_date).slice(0, 4)) || null : null,
          alreadyReviewed: false,
          postId: null,
          researchSelected: false,
        }))
        setRecent(mapped)
        try {
          localStorage.setItem(RECENT_KEY, JSON.stringify(mapped))
        }
        catch { /* ignore */ }
      })
      // Keep the cached seed on a transient failure instead of blanking the
      // strip; only fall back to empty when there was nothing cached.
      .catch(() => alive && setRecent(prev => prev ?? []))
    return () => {
      alive = false
    }
  }, [])

  // Mirror the album count to localStorage so the overview's bucket shortcut
  // (lib/member.ts bucketCount(), read synchronously) matches the live board.
  useEffect(() => {
    if (tree == null)
      return
    try {
      localStorage.setItem(BUCKETS_KEY, JSON.stringify(tree))
    }
    catch { /* ignore */ }
  }, [tree])

  useEffect(() => {
    try {
      localStorage.setItem(TRASH_KEY, JSON.stringify(trash))
    }
    catch { /* ignore */ }
  }, [trash])

  async function refresh() {
    await bucketStore.ensureFresh(true)
  }

  // FEAT-spotify-library-sync — the special bucket's sync surface (state banners,
  // per-album badge map, listened-album hint, manual-sync poll) lives in a
  // dedicated hook (REFACTOR Step 4b). It repaints the board via `refresh` once a
  // real sync advances last_synced_at.
  const { libState, libAlbumMap, listenedAlbumIds, syncing, runLibrarySync } = useSpotifyLibrary(refresh)

  // Clear all drag state the instant a drop completes its op. Needed in addition
  // to the document-level reset above because card drop handlers stopPropagation
  // (so the document `drop` never fires) and a moved item's original node unmounts
  // before its own `dragend` — either of which would leave it stuck at 0.45.
  function endDrag() {
    setDraggingId(null)
    setDraggingBucket(null)
    setDragKind(null)
    setDropTarget(null)
    dnd = null
  }

  const ops: Ops = {
    tree: tree ?? [],
    // Copy a 최근 들은 앨범 tile into a real bucket. Optimistic: splice a temp
    // tile in on drop so it appears instantly, then reconcile with the server —
    // swap temp → canonical item on success, drop temp on 409 (already there) /
    // failure. Previously this awaited the round-trip before painting (~200–
    // 500ms lag), which read as "버킷 반영이 느리다".
    copyAlbum(albumId, toBucketId) {
      endDrag()
      if (tree == null)
        return
      const tempId = `temp:${Date.now()}:${albumId}`
      const src = recent?.find(a => a.albumId === albumId) ?? findAlbumByAlbumId(tree, albumId)
      setTree((prev) => {
        if (prev == null)
          return prev
        const t = clone(prev)
        const dst = findBucket(t, toBucketId)
        if (dst && !dst.albums.some(a => a.albumId === albumId)) {
          dst.albums.push({
            itemId: tempId,
            itemType: 'album',
            albumId,
            trackId: null,
            reviewTargetId: null,
            artistId: null,
            title: src?.title ?? '…',
            artist: src?.artist ?? '',
            cover: src?.cover ?? null,
            year: src?.year ?? null,
            alreadyReviewed: src?.alreadyReviewed ?? false,
            postId: src?.postId ?? null,
            researchSelected: false,
          })
        }
        return t
      })
      api.addBucketItem(toBucketId, albumId)
        .then(({ item, conflict }) => {
          setTree((prev) => {
            if (prev == null)
              return prev
            const t = clone(prev)
            const dst = findBucket(t, toBucketId)
            if (!dst)
              return t
            const i = dst.albums.findIndex(a => a.itemId === tempId)
            if (i < 0)
              return t
            if (conflict || !item) {
              dst.albums.splice(i, 1) // already present elsewhere / no row → drop the temp
            }
            else {
              dst.albums[i] = item // promote temp → canonical (real itemId)
            }
            return t
          })
          if (!conflict && item)
            markNew(item.itemId) // tag the FINAL server id; hoisted out of the updater (keep setState updaters pure)
        })
        .catch(() => void refresh())
    },
    // Move/reorder an album, inserting before `beforeItemId` (null = append).
    // Persists via PUT /reorder with the affected bucket(s)' new item order.
    insertAlbum(itemId, fromBucketId, toBucketId, beforeItemId, bakeOrder) {
      endDrag()
      if (tree == null)
        return
      const t = clone(tree)
      const src = findBucket(t, fromBucketId)
      const dst = findBucket(t, toBucketId)
      if (!src || !dst)
        return
      // Bake the destination's stored order to its current display order first, so a
      // reorder performed from a sorted/grouped view lands where it looks (the caller
      // then resets that bucket's view to manual). The bake list is the full set, so
      // no album is dropped; ids absent from it (shouldn't happen) sort to the front.
      if (bakeOrder && bakeOrder.length > 0) {
        const rank = new Map(bakeOrder.map((id, i) => [id, i]))
        dst.albums.sort((a, b) => (rank.get(a.itemId) ?? -1) - (rank.get(b.itemId) ?? -1))
      }
      const idx = src.albums.findIndex(a => a.itemId === itemId)
      if (idx < 0)
        return
      const [moved] = src.albums.splice(idx, 1)
      const bi = beforeItemId ? dst.albums.findIndex(a => a.itemId === beforeItemId) : -1
      if (bi < 0)
        dst.albums.push(moved)
      else
        dst.albums.splice(bi, 0, moved)
      setTree(t)
      // Tag ONLY a genuine cross-bucket move-in. Same-bucket (fromBucketId ===
      // toBucketId) is the reorder path and must NOT get a NEW dot.
      if (fromBucketId !== toBucketId)
        markNew(itemId)
      const payload = fromBucketId === toBucketId ?
        [{ id: toBucketId, item_ids: dst.albums.map(a => a.itemId) }] :
        [{ id: fromBucketId, item_ids: src.albums.map(a => a.itemId) }, { id: toBucketId, item_ids: dst.albums.map(a => a.itemId) }]
      api.reorderItems(payload).catch(() => void refresh())
    },
    moveBucketInto(bucketId, targetId) {
      endDrag()
      if (tree == null)
        return
      const src = findBucket(tree, bucketId)
      if (targetId && src && subtreeHas(src, targetId))
        return
      const siblings = targetId ? (findBucket(tree, targetId)?.children ?? []) : tree
      const position = siblings.length
      const t = clone(tree)
      const rm = removeBucketNode(t, bucketId)
      if (!rm)
        return
      if (targetId == null) {
        t.push(rm)
      }
      else {
        const dst = findBucket(t, targetId)
        ;(dst ? dst.children : t).push(rm)
      }
      setTree(t)
      // Don't reconcile with the server snapshot: the optimistic splice already
      // reflects the move, and a whole-tree overwrite would clobber any concurrent
      // optimistic edit (rename/color/add) made during the round-trip (BB-1). Each
      // such edit persists via its own PUT; on error the .catch refreshes/rolls back.
      api.moveBucket(bucketId, targetId, position)
        .catch(() => void refresh())
    },
    // Reposition a bucket among `parentId`'s children, before `beforeId` (null =
    // append). Drives both reorder (drop in a sibling gap) and un-nest (drop in a
    // top-level gap, parentId null). Optimistic splice only — no server-snapshot
    // reconcile (see BB-1 note in moveBucketInto).
    moveBucketTo(bucketId, parentId, beforeId) {
      endDrag()
      if (tree == null || bucketId === beforeId)
        return
      const src = findBucket(tree, bucketId)
      if (parentId != null && src && (parentId === bucketId || subtreeHas(src, parentId)))
        return
      const t = clone(tree)
      const rm = removeBucketNode(t, bucketId)
      if (!rm)
        return
      const list = parentId == null ? t : findBucket(t, parentId)?.children
      if (!list)
        return
      const idx = beforeId ? list.findIndex(b => b.id === beforeId) : -1
      const position = idx < 0 ? list.length : idx
      if (idx < 0)
        list.push(rm)
      else
        list.splice(idx, 0, rm)
      setTree(t)
      api.moveBucket(bucketId, parentId, position)
        .catch(() => void refresh())
    },
    addBucket(parentId, type = 'general') {
      if (tree == null)
        return
      const position = parentId ? (findBucket(tree, parentId)?.children.length ?? 0) : tree.length
      api.createBucket(type === 'artist' ? '새 아티스트 버킷' : '새 버킷', type)
        .then((created) => {
          if (parentId == null) {
            setTree(prev => [...(prev ?? []), created])
            return undefined
          }
          // Optimistically nest the new bucket under the parent on the LATEST tree,
          // then persist the parent assignment — but don't overwrite the tree with the
          // server snapshot (would clobber concurrent optimistic edits, BB-1).
          setTree((prev) => {
            if (prev == null)
              return prev
            const t = clone(prev)
            const parent = findBucket(t, parentId)
            if (parent)
              parent.children.push(created)
            return t
          })
          return api.moveBucket(created.id, parentId, position).then(() => undefined)
        })
        .catch(() => void refresh())
    },
    rename(id, name) {
      if (tree == null)
        return
      const t = clone(tree)
      const b = findBucket(t, id)
      if (b)
        b.name = name
      setTree(t)
      api.renameBucket(id, name).catch(() => void refresh())
    },
    setColor(id, color) {
      if (tree == null)
        return
      const t = clone(tree)
      const b = findBucket(t, id)
      if (b)
        b.color = color
      setTree(t)
      api.setBucketColor(id, color).catch(() => void refresh())
    },
    // FEAT-public-bucket-multiuser Scope A — opt-in public visibility. Optimistic;
    // on failure the .catch refreshes (rolls back). The backend refuses to publish
    // the spotify_library bucket (400) → refresh would restore its real state, but
    // the board hides the toggle for it so that path isn't reachable from the UI.
    setIsPublic(id, isPublic) {
      if (tree == null)
        return
      const t = clone(tree)
      const b = findBucket(t, id)
      if (b)
        b.isPublic = isPublic
      setTree(t)
      api.setBucketIsPublic(id, isPublic).catch(() => void refresh())
    },
    requestAdd(bucketId, bucketName, bucketType) {
      setAddingTo({ id: bucketId, name: bucketName, type: bucketType })
    },
    expandSource(bucketId, source) {
      api.expandSourceArtists(bucketId, source)
        .then((out) => {
          const added = out.added.length
          const skipped = out.skipped.length
          if (added === 0 && skipped === 0)
            setFlash('참여 아티스트가 없어요')
          else if (added === 0)
            setFlash(`이미 담긴 아티스트예요 · ${skipped}명 중복`)
          else
            setFlash(`참여 아티스트 ${added}명 담음${skipped ? ` · ${skipped}명 중복 건너뜀` : ''}`)
          // New membership rows aren't echoed individually — reload to render them.
          if (added > 0)
            void refresh()
        })
        .catch(() => setFlash('아티스트 확장에 실패했어요'))
    },
    // FEAT-album-research-notes — set the bucket's auto-research scope.
    // Optimistic; the backend auto-enqueues note-less (checked) items on the
    // all/selected transition. The cover badges auto-load when mode != 'off' so
    // they pick up the new 'queued' rows on their next poll.
    setResearchMode(bucketId, mode) {
      if (tree == null)
        return
      const t = clone(tree)
      const b = findBucket(t, bucketId)
      if (b)
        b.researchMode = mode
      setTree(t)
      api.setBucketResearchMode(bucketId, mode).catch(() => void refresh())
    },
    // Toggle a per-item research opt-in (meaningful in 'selected' mode). Checking
    // an item auto-enqueues it server-side through the dedupe gate.
    setItemSelected(bucketId, itemId, selected) {
      if (tree == null)
        return
      const t = clone(tree)
      const a = findBucket(t, bucketId)?.albums.find(x => x.itemId === itemId)
      if (a)
        a.researchSelected = selected
      setTree(t)
      api.setItemResearchSelected(bucketId, itemId, selected).catch(() => void refresh())
    },
    openResearch(albumId, title) {
      setResearchTarget({ albumId, title })
    },
  }
  // Keep the reverse-DnD (PB_BOARD_DROP) listener reading the LIVE tree + ops without
  // re-subscribing every render (ops is a fresh object per render).
  opsRef.current = ops

  // Drop an album on the trash dock: optimistic splice + DELETE, then stash a
  // recoverable entry. Restore re-adds it via the normal item route.
  function trashAlbum(itemId: string, fromBucketId: string) {
    endDrag()
    if (tree == null)
      return
    const found = findAlbum(tree, itemId)
    // Defense in depth (callers already gate on albumId): the trash can only restore
    // album members via re-add, so never trash a non-album row — it would DELETE
    // server-side and then be unrecoverable on 복원.
    if (found && !found.album.albumId)
      return
    const t = clone(tree)
    const src = findBucket(t, fromBucketId)
    if (src) {
      const i = src.albums.findIndex(a => a.itemId === itemId)
      if (i >= 0)
        src.albums.splice(i, 1)
    }
    setTree(t)
    if (found)
      setTrash(prev => [{ tid: itemId, album: found.album, fromBucketId, fromName: found.bucketName }, ...prev])
    api.deleteBucketItem(fromBucketId, itemId).catch(() => void refresh())
  }

  // Restore: re-add to the original bucket (or the first root if it's gone). A
  // 409 means it's already back — either way the trash entry is cleared.
  function restoreTrash(tid: string) {
    const entry = trash.find(x => x.tid === tid)
    if (!entry || tree == null)
      return
    const target = findBucket(tree, entry.fromBucketId) ? entry.fromBucketId : tree[0]?.id
    if (!target) {
      setTrash(prev => prev.filter(x => x.tid !== tid))
      return
    }
    const restoreId = entry.album.albumId
    if (!restoreId) {
      setTrash(prev => prev.filter(x => x.tid !== tid))
      return
    }
    api.addBucketItem(target, restoreId)
      .then(({ item }) => {
        if (item) {
          setTree((prev) => {
            if (prev == null)
              return prev
            const t = clone(prev)
            findBucket(t, target)?.albums.push(item)
            return t
          })
        }
        setTrash(prev => prev.filter(x => x.tid !== tid))
      })
      .catch(() => void refresh())
  }

  function confirmBucketDelete() {
    if (pendingBucketDelete == null || tree == null) {
      setPendingBucketDelete(null)
      return
    }
    const { id } = pendingBucketDelete
    const t = clone(tree)
    removeBucketNode(t, id)
    setTree(t)
    setPendingBucketDelete(null)
    api.deleteBucket(id).catch(() => void refresh())
  }

  async function onAddAlbum(album: { id: string, title: string }): Promise<AddOutcome> {
    if (!addingTo)
      return { status: 'error', message: '버킷을 찾을 수 없습니다' }
    try {
      const { item, conflict } = await api.addBucketItem(addingTo.id, album.id)
      if (conflict)
        return { status: 'conflict' }
      if (item && tree != null) {
        const t = clone(tree)
        findBucket(t, addingTo.id)?.albums.push(item)
        setTree(t)
      }
      return { status: 'added', alreadyReviewed: item?.alreadyReviewed ?? false }
    }
    catch {
      return { status: 'error', message: '담기 실패' }
    }
  }

  // FEAT-my-buckit-artist: add a single artist (from the search modal) to an Artist
  // bucket. Mirrors onAddAlbum — optimistic push of the returned member row, 409 →
  // conflict ('이미 담겨 있어요').
  async function onAddArtist(artist: { id: string, name: string }): Promise<AddOutcome> {
    if (!addingTo)
      return { status: 'error', message: '버킷을 찾을 수 없습니다' }
    try {
      const { item, conflict } = await api.addBucketArtist(addingTo.id, artist.id)
      if (conflict)
        return { status: 'conflict' }
      if (item && tree != null) {
        const t = clone(tree)
        findBucket(t, addingTo.id)?.albums.push(item)
        setTree(t)
      }
      return { status: 'added', alreadyReviewed: false }
    }
    catch {
      return { status: 'error', message: '담기 실패' }
    }
  }

  // FEAT-my-buckit-artist Step 4: close the create menu then create a root bucket
  // of the chosen type.
  function createBucketOfType(type: 'general' | 'artist') {
    setCreateMenuOpen(false)
    ops.addBucket(null, type)
  }

  if (error && tree == null) {
    return (
      <div>
        <SectionTitle title="My Buckit" />
        <div className="panel" style={{ padding: 32, textAlign: 'center' }}>
          <span className="meta">버킷을 불러오지 못했습니다</span>
        </div>
      </div>
    )
  }

  // Props shared by every card / list in the tree — bundled so BucketList can
  // forward them with one spread.
  const shared: SharedProps = { ops, onOpen, ratings, libState: libAlbumMap, listenedAlbumIds, dropTarget, setDropTarget, draggingId, setDraggingId, draggingBucket, setDraggingBucket, setDragKind, dragKind, bucketViews, setBucketViews, researchStatus, openAlbumSheet: setAlbumSheet, openBucketSheet: setBucketSheet, newItemIds }
  // FEAT-my-buckit-artist Step 4: the tree narrowed by the board-level type filter.
  const visibleTree = pruneByType(normalTree, boardType)

  return (
    <div>
      <SectionTitle
	kicker={tree == null ? '불러오는 중…' : `${normalTree.length}개 버킷`}
	title="My Buckit"
	right={(
          <div style={{ display: 'flex', gap: 8 }}>
            <button
	type="button"
	className="btn"
	aria-label="Pocket Buckit 열기/닫기"
	aria-expanded={pocketOpen}
	title="Pocket Buckit 열기/닫기"
	onClick={() => window.dispatchEvent(new CustomEvent(PB_TOGGLE_EVENT))}
            >
              🪣 Pocket
            </button>
            <button type="button" className="btn" onClick={() => setTrashOpen(true)}>
              🗑 휴지통
              {trash.length ? ` · ${trash.length}` : ''}
            </button>
            <div ref={createMenuRef} style={{ position: 'relative' }}>
              <button type="button" className="btn btn-solid" disabled={tree == null} aria-haspopup="menu" aria-expanded={createMenuOpen} onClick={() => setCreateMenuOpen(o => !o)}>＋ 버킷</button>
              {createMenuOpen && (
                <div role="menu" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 20, minWidth: 168, background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 8, boxShadow: '0 8px 26px rgba(26,26,26,.18)', padding: 5 }}>
                  <button type="button" role="menuitem" className="lf-menu-row" style={CREATE_MENU_ROW} onClick={() => createBucketOfType('general')}>＋ General 버킷</button>
                  <button type="button" role="menuitem" className="lf-menu-row" style={CREATE_MENU_ROW} onClick={() => createBucketOfType('artist')}>＋ Artist 버킷 · 아티스트 전용</button>
                </div>
              )}
            </div>
          </div>
        )}
      />
      {/* FEAT-my-buckit-artist Step 4: board-level type filter. Narrows the tree to
          buckets of the chosen type (ancestors preserved); 전체 shows everything,
          incl. system buckets. */}
      {tree != null && normalTree.length > 0 && (
        <div role="group" aria-label="버킷 종류 필터" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '0 0 16px' }}>
          {([['all', '전체'], ['general', 'General'], ['artist', 'Artist']] as const).map(([v, l]) => (
            <button
	key={v}
	type="button"
	className="chip"
	aria-pressed={boardType === v}
	onClick={() => setBoardType(v)}
	style={boardType === v ? { background: 'var(--color-text)', color: 'var(--color-bg)', borderColor: 'var(--color-text)' } : undefined}
            >
              {l}
            </button>
          ))}
        </div>
      )}
      {recent != null && recent.length > 0 && (
        <div
	className="panel crate-spotify"
	style={{ padding: 0, marginBottom: 22 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 14px', borderBottom: '1px solid var(--color-border-soft)' }}>
            <span className="serif" style={{ fontSize: 16, fontWeight: 500, whiteSpace: 'nowrap' }}>최근 들은 앨범</span>
            <span className="meta" style={{ color: 'var(--color-spotify)' }}>SPOTIFY 연동</span>
          </div>
          <div style={{ display: 'flex', gap: 14, padding: 14, overflowX: 'auto', alignItems: 'flex-start' }}>
            {recent.map(a => (
              <div key={a.itemId} style={{ flex: '0 0 116px', width: 116 }}>
                <AlbumChip album={a} bucketId={RECENT_ID} rated={false} score={null} onOpen={onOpen} copySource draggingId={draggingId} setDraggingId={setDraggingId} setDragKind={setDragKind} onTouchActions={() => setAlbumSheet({ album: a, bucketId: RECENT_ID, copySource: true, fromLib: false })} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Spotify 라이브러리 — the special kind='spotify_library' bucket, pulled
          out of the normal crate tree and rendered here as its own section just
          below the recent strip. Drag albums in/out to set the bucket INTENT
          only (copyAlbum / trash via the shared ops) — NO synchronous Spotify
          call; the 동기화 button enqueues the worker reconcile (rule #9). */}
      {tree != null && (
        <div className="panel crate-spotify" style={{ padding: 0, marginBottom: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 14px', borderBottom: '1px solid var(--color-border-soft)' }}>
            <span className="serif" style={{ fontSize: 16, fontWeight: 500, whiteSpace: 'nowrap' }}>Spotify 라이브러리</span>
            <span className="meta" style={{ color: 'var(--color-spotify)' }}>SPOTIFY 동기화</span>
            <button
	type="button"
	className="btn"
	disabled={syncing}
	onClick={() => void runLibrarySync()}
	style={{ marginLeft: 'auto' }}
            >
              {syncing ? '동기화 중…' : '동기화'}
            </button>
          </div>

          {libState?.needs_reauth && (
            <div className="mono" style={{ padding: '9px 14px', fontSize: 11.5, letterSpacing: '0.03em', color: '#fff', background: 'var(--color-accent)' }}>
              Spotify 재인증 필요
            </div>
          )}
          {libState != null && libState.writes_enabled === false && (
            <div className="mono" style={{ padding: '9px 14px', fontSize: 11.5, letterSpacing: '0.03em', color: 'oklch(0.42 0.10 70)', background: 'oklch(0.95 0.04 80)', borderBottom: '1px solid var(--color-border-soft)' }}>
              검토 모드: Spotify에 실제 반영 안 됨
            </div>
          )}

          <div style={{ padding: 14 }}>
            {libBucket && countAlbums(libBucket) > 0 ?
              (
                <BucketList items={[libBucket]} parentId={null} depth={0} shared={shared} />
              ) :
              (
                <div className="mono" style={{ fontSize: 11.5, color: 'var(--color-faded)', border: '1px dashed var(--color-border)', borderRadius: 6, padding: 24, textAlign: 'center', letterSpacing: '0.04em' }}>
                  동기화를 누르면 Spotify 라이브러리의 앨범을 불러옵니다
                </div>
              )}
          </div>
        </div>
      )}

      {tree == null && (
        <div className="lf-skel-stack" aria-busy="true" aria-label="불러오는 중" style={{ gap: 18 }}>
          {[0, 1].map(s => (
            <div key={s} className="panel" style={{ padding: 16 }}>
              <div className="lf-skeleton" style={{ height: 18, width: 160, marginBottom: 14 }} />
              <div style={{ display: 'flex', gap: 12 }}>
                {Array.from({ length: 5 }, (_, i) => (
                  <div key={i} className="lf-skeleton" style={{ width: 96, height: 96, flex: '0 0 96px' }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tree != null && normalTree.length === 0 && (
        <div className="panel" style={{ padding: 40, textAlign: 'center' }}>
          <span className="meta">버킷 없음</span>
        </div>
      )}

      {tree != null && normalTree.length > 0 && visibleTree.length > 0 && (
        <BucketList items={visibleTree} parentId={null} depth={0} shared={shared} />
      )}
      {tree != null && normalTree.length > 0 && visibleTree.length === 0 && (
        <div className="panel" style={{ padding: 32, textAlign: 'center' }}>
          <span className="meta">{boardType === 'artist' ? 'Artist 버킷이 없어요' : '해당 종류의 버킷이 없어요'}</span>
        </div>
      )}

      {/* trash dock — a single center-bottom card, mounted only while dragging an
          album or bucket. PORTALED to <body>: .lf-rise (the tab-content wrapper)
          keeps a filled identity transform after its entrance animation
          (matrix(1,0,0,1,0,0) ≠ none), which makes it the containing block for
          position:fixed — so rendering in-tree pinned the dock to lf-rise's box
          instead of the viewport. Portaling escapes that. No backdrop/blur: the
          buckets behind stay crisp so you can keep dropping onto them. */}
      {(dragKind === 'album' || dragKind === 'bucket') && typeof document !== 'undefined' && createPortal(
        <TrashDock
	trashCount={trash.length}
	onTrashAlbum={trashAlbum}
	onTrashBucket={(id) => {
            const b = tree ? findBucket(tree, id) : null
            setPendingBucketDelete({ id, name: b?.name ?? '' })
          }}
        />,
        document.body,
      )}

      {addingTo && addingTo.type === 'artist' && (
        <AddArtistModal
	bucketName={addingTo.name}
	existingArtistIds={new Set((tree && findBucket(tree, addingTo.id)?.albums.map(a => a.artistId).filter((id): id is string => id != null)) ?? [])}
	onAdd={onAddArtist}
	onClose={() => setAddingTo(null)}
        />
      )}
      {addingTo && addingTo.type !== 'artist' && (
        <AddAlbumModal
	bucketName={addingTo.name}
	existingAlbumIds={new Set((tree && findBucket(tree, addingTo.id)?.albums.map(a => a.albumId).filter((id): id is string => id != null)) ?? [])}
	onAdd={onAddAlbum}
	onClose={() => setAddingTo(null)}
        />
      )}

      {trashOpen && (
        <TrashDrawer
	trash={trash}
	onRestore={restoreTrash}
	onPurge={tid => setTrash(prev => prev.filter(x => x.tid !== tid))}
	onEmpty={() => setTrash([])}
	onClose={() => setTrashOpen(false)}
        />
      )}

      {pendingBucketDelete && (
        <div className="qb-modal-scrim" onClick={() => setPendingBucketDelete(null)} role="presentation">
          <div ref={confirmModalRef} className="qb-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="버킷 삭제 확인" style={{ maxWidth: 400 }}>
            <header className="qb-modal-head">
              <div>
                <div className="qb-modal-kicker">버킷 삭제</div>
                <h3 className="qb-modal-title">이 버킷을 삭제할까요?</h3>
              </div>
              <button type="button" className="qb-modal-close" onClick={() => setPendingBucketDelete(null)} aria-label="닫기">✕</button>
            </header>
            <div style={{ padding: 'var(--space-4) var(--space-5) var(--space-5)' }}>
              <p className="sans" style={{ fontSize: 13.5, color: 'var(--color-subtle)', lineHeight: 1.65, margin: 0 }}>
                <span className="serif italic" style={{ color: 'var(--color-text)' }}>{pendingBucketDelete.name || '이 버킷'}</span>
                {' '}
                과(와) 그 하위 버킷·담긴 앨범이 함께 삭제됩니다. 평론 기록에는 영향을 주지 않습니다.
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
                <button type="button" className="btn" onClick={() => setPendingBucketDelete(null)}>취소</button>
                <button type="button" className="btn btn-solid" onClick={confirmBucketDelete}>삭제</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {researchTarget && (
        <div className="rsh-modal-scrim" onClick={() => setResearchTarget(null)} role="presentation">
          <section ref={researchPanelRef} className="rsh-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="리서치 노트">
            <header className="rsh-modal-head">
              <div>
                <p className="rsh-modal-kicker">리서치 노트</p>
                <h2 className="rsh-modal-title">{researchTarget.title}</h2>
              </div>
              <button type="button" className="rsh-modal-close" onClick={() => setResearchTarget(null)} aria-label="닫기">✕</button>
            </header>
            <div className="rsh-modal-body">
              <ResearchNote albumId={researchTarget.albumId} variant="doc" />
            </div>
          </section>
        </div>
      )}

      {/* ── touch fallback (coarse pointers) — album / bucket action sheets +
          the shared bucket picker. These mirror the drag paths: every action
          runs the SAME ops a drop would. Reorder-before-a-specific-cover is
          dropped on touch (append is fine). Desktop never opens these (the
          ⋯ triggers are coarse-pointer-only). */}
      {albumSheet && (
        <ActionSheet
	title={albumSheet.album.title}
	subtitle={albumSheet.album.artist}
	onClose={() => setAlbumSheet(null)}
	actions={(() => {
            const s = albumSheet
            const list: SheetAction[] = []
            // FEAT-member-player 6b — the bucket-row "이 앨범 재생" entry (deferred
            // here from front #302 by the file-ownership split). Connect
            // active-device play with the member token; the play click is the only
            // trigger (rule #9 — the sole server hit is the async token mint), and
            // outcomes land in the board's transient toast.
            if (s.album.albumId && s.album.itemType === 'album') {
              const albumId = s.album.albumId
              list.push({
                label: '이 앨범 재생 ▶',
                onClick: () => {
                  setAlbumSheet(null)
                  void sendConnectPlay({ kind: 'album', albumId, title: s.album.title }).then((r) => {
                    if (r.ok) {
                      setFlash('Spotify에서 앨범 재생을 시작했어요.')
                      return
                    }
                    if (r.reason === 'no-active-device') {
                      setFlash('재생 중인 Spotify 기기가 없어요. Spotify에서 먼저 재생을 시작해 주세요.')
                      return
                    }
                    if (r.reason === 'no-capability') {
                      setFlash('이 컨트롤은 Spotify Premium 계정에서 사용할 수 있어요.')
                      return
                    }
                    if (r.reason === 'unresolvable') {
                      setFlash('이 앨범은 Spotify에서 재생할 수 없어요.')
                      return
                    }
                    if (r.reason === 'token' && r.status === 'disconnected') {
                      setFlash('Spotify를 연동하면 이 앨범을 재생할 수 있어요.')
                      return
                    }
                    setFlash('재생에 실패했어요. 잠시 후 다시 시도해 주세요.')
                  })
                },
              })
            }
            if (s.copySource || s.fromLib) {
              list.push({
                label: '버킷에 추가',
                onClick: () => {
                  setAlbumSheet(null)
                  setPicker({
                    title: '버킷에 추가',
                    onPick: (to) => {
                      if (to && s.album.albumId)
                        ops.copyAlbum(s.album.albumId, to)
                      setPicker(null)
                    },
                  })
                },
              })
            }
            else {
              list.push({
                label: '다른 버킷으로 이동',
                onClick: () => {
                  setAlbumSheet(null)
                  setPicker({
                    title: '다른 버킷으로 이동',
                    skip: b => b.id === s.bucketId,
                    onPick: (to) => {
                      if (to && to !== s.bucketId)
                        ops.insertAlbum(s.album.itemId, s.bucketId, to, null)
                      setPicker(null)
                    },
                  })
                },
              })
            }
            // 휴지통: normal items, and myblog_added library items (a 기존/preexisting
            // library album can't be trashed — mirrors TrashDock.accepts()). `s.album.albumId`
            // gates out non-album members that the trash can't restore (would vanish on 복원).
            if (!s.copySource && !(s.fromLib && s.source === 'preexisting') && !!s.album.albumId) {
              list.push({
                label: '휴지통으로',
                danger: true,
                onClick: () => {
                  trashAlbum(s.album.itemId, s.bucketId)
                  setAlbumSheet(null)
                },
              })
            }
            return list
          })()}
        />
      )}

      {bucketSheet && (
        <ActionSheet
	title={bucketSheet.name}
	subtitle="버킷 동작"
	onClose={() => setBucketSheet(null)}
	actions={[
            {
              label: '이동 / 중첩',
              onClick: () => {
                const b = bucketSheet
                setBucketSheet(null)
                setPicker({
                  title: '이동 / 중첩할 위치',
                  allowRoot: true,
                  // Can't nest a bucket into itself or its own subtree.
                  skip: t => subtreeHas(b, t.id),
                  onPick: (to) => {
                    if (to == null)
                      ops.moveBucketTo(b.id, null, null)
                    else
                      ops.moveBucketInto(b.id, to)
                    setPicker(null)
                  },
                })
              },
            },
            {
              label: '삭제',
              danger: true,
              onClick: () => {
                setPendingBucketDelete({ id: bucketSheet.id, name: bucketSheet.name })
                setBucketSheet(null)
              },
            },
          ]}
        />
      )}

      {picker && tree && (
        <BucketPickerSheet
	title={picker.title}
	tree={normalTree}
	skip={picker.skip}
	allowRoot={picker.allowRoot}
	onPick={picker.onPick}
	onClose={() => setPicker(null)}
        />
      )}

      {/* FEAT-my-buckit-artist: source-expansion feedback toast (참여 아티스트 N명…). */}
      {flash && typeof document !== 'undefined' && createPortal(
        <div role="status" style={{ position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)', zIndex: 101, background: 'var(--color-text)', color: 'var(--color-bg)', borderRadius: 6, padding: '10px 16px', fontSize: 13, boxShadow: '0 6px 22px rgba(26,26,26,.28)' }}>
          {flash}
        </div>,
        document.body,
      )}
    </div>
  )
}
