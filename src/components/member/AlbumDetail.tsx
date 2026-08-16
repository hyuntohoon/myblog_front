// Member dashboard — album detail / memo modal (centered).
//
// Opened from member-dashboard surfaces via SelfDashboard's openDetail handler. The experience is
// derived from where it was opened (DetailTarget.writable + a bucket-item handle):
//   · memo  — ARCH-bucket-album-modal-unification Step 1: ANY writable bucket album
//             with a bucket-item handle (bucketId + itemId) opens the unified "쓰레기통"
//             memo window (FEAT-editor-buckit Step 3), regardless of publish state.
//             It surfaces all three "my relationship to this album" write surfaces:
//             평가 (live star + one-liner, PUT /api/reviews/albums/{id}), 메모 (freeform
//             note → review_bucket_items.note + "오늘 밤 키우기" → prep_tonight,
//             debounced-autosaved, no save button), and 리서치 노트 (album_research,
//             collapsible). A published album additionally shows the "이미 발행됨"
//             banner. A single "전체 에디터에서 작성" link keeps the path to /write.
//   · info  — non-writable surfaces (Spotify 라이브러리, 최근 들은, sample tracks) or a
//             writable album opened without a bucket-item handle: cover + metadata +
//             tracklist, read-only.
import type { LyricsSheetMeta } from './lyrics/LyricsSheet'
import type { ContextPanelTab, ContextPanelTrack } from './panel/ContextPanel'
import type { CSSProperties } from 'react'
import type { AlbumDetail as AlbumDetailResp, MusicArtist, MusicTrack } from '@lib/albumDetail'
import type { DockState } from '@lib/dockTear'
import type { DetailTarget, MemberReview } from '@lib/member'
import type { Rect, SizeConstraints } from '@lib/surfaceGeometry'
import type { OnOpenLyrics } from '../album/AlbumDetailView'
import type { TrackRowActions } from '../shared/TrackRow'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { updateBucketItemMemo } from '@lib/buckets'
import { INITIAL_DOCK } from '@lib/dockTear'
import { fetchAlbumDetail, getCachedAlbumDetail } from '@lib/albumDetail'
import { memberRef } from '@lib/entityDrag'
import { notifyAlbumStateChanged } from '@lib/entityEvents'
import { reviewHref } from '@lib/entityLinks'
import { playbackSession } from '@lib/playback/session'
import { PB_DND_END_EVENT, PB_DND_START_EVENT } from '@lib/pocketBuckit/events'
import { rememberSpotifyTransportProbe } from '@lib/spotifyCapability'
import { clampSurfacePosition, readStoredRect, resizeSurfaceRect, SURFACE_RESIZE_EDGES, useMovableSurface, useResizableSurface, writeStoredRect } from '@lib/surfaceGeometry'
import { useDismissable } from '@lib/useDismissable'
import { useIsMobileHost } from '@lib/useIsMobileHost'
import { useScrollLock } from '@lib/useScrollLock'
import HalfStarInput from '../album/HalfStarInput'
import { fetchMyAlbumStates, putMyAlbumState, RATING_COMMENT_MAX, RatingRateLimitError } from '../album/reviews.api'
import { AlbumDetailView, Header } from '../album/AlbumDetailView'
import { AlbumCard } from '../shared/AlbumCard'
import { GenreLink } from '../shared/GenreLink'
import { TrackRow } from '../shared/TrackRow'
import { ContextPanel } from './panel/ContextPanel'
import { AddToBucketMenu } from './pocket/AddToBucketMenu'
import { fmtTime, Stars } from './ui'

type Mode = 'info' | 'edit'

export function AlbumDetail({ album, reviews, onClose, onMemoSaved, onOpenLyrics }: { album: DetailTarget, reviews: MemberReview[], onClose: () => void, onMemoSaved?: (itemId: string, memo: { note: string | null, prepTonight: boolean }) => void, onOpenLyrics?: OnOpenLyrics }) {
  // "Published" here means a real post page exists. Runtime member rating rows
  // (merge PR2) carry slug '' — they must NOT hijack the memo/edit decision, or
  // a member who merely rated a bucket album would lose the MemoWindow
  // authoring path. Owner/build-time rows always carry a slug, so the owner dashboard is
  // unaffected. (Informational surfaces — rating chips, 평론 tab — still show
  // slug-less rows; only this matcher is post-gated.)
  const published = album.albumId ? reviews.find(r => r.slug !== '' && r.albumIds.includes(album.albumId!)) : undefined

  // ARCH-bucket-album-modal-unification Step 1: a writable 평론 버킷 album that
  // carries its bucket-item handle always opens the unified memo "쓰레기통" window —
  // regardless of publish state, so a bucket-tile click is never state-dependent.
  // Without the handle (unexpected on a bucket surface) it degrades to the
  // read-only info modal.
  if (album.writable && album.albumId && album.bucketId && album.itemId)
    return <MemoWindow album={album} onClose={onClose} onMemoSaved={onMemoSaved} published={published} />

  // Non-writable surfaces (Spotify 라이브러리, 최근 들은, sample tracks) and the rare
  // writable-but-no-handle fallback keep the read-only/edit standard modal untouched
  // by this RFC (its scope is the bucket-item-handle path above).
  const mode: Mode = (published && album.writable) ? 'edit' : 'info'
  return <StandardModal album={album} mode={mode} published={published} onClose={onClose} onOpenLyrics={onOpenLyrics} />
}

// ARCH-entity-interaction-v2 Step 5 — the modal `.scrim` (`z-index: var(--z-
// panel)=90`) sits above `PocketTray` (`--z-pocket:70`+2≈72), so a drag
// started on a TrackRow in either modal below has no live drop target:
// dragover lands on the scrim, never reaches the tray underneath. Rather than
// permanently removing the scrim (which would also kill click-outside-to-
// close and background dimming for the modal's whole lifetime), this only
// drops the scrim's `pointer-events` for the duration of an actual drag —
// listening to the SAME window events every granted TrackRow already
// dispatches (`PB_DND_START_EVENT`/`PB_DND_END_EVENT`), no new plumbing. The
// modal card is not interactive mid-drag anyway (the pointer is down and
// moving), so losing pointer-events on the whole scrim subtree for that
// window is not a regression.
function useDragScrimPassthrough(): boolean {
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    const onStart = () => setDragging(true)
    const onEnd = () => setDragging(false)
    window.addEventListener(PB_DND_START_EVENT, onStart)
    window.addEventListener(PB_DND_END_EVENT, onEnd)
    return () => {
      window.removeEventListener(PB_DND_START_EVENT, onStart)
      window.removeEventListener(PB_DND_END_EVENT, onEnd)
    }
  }, [])
  return dragging
}

// ── standard 600px modal (info / edit) ───────────────────────────────────────
function StandardModal({ album, mode, published, onClose, onOpenLyrics }: { album: DetailTarget, mode: Mode, published?: MemberReview, onClose: () => void, onOpenLyrics?: OnOpenLyrics }) {
  const cardRef = useRef<HTMLDivElement>(null)
  // ESC + focus trap + focus restore (mounted-when-open → open=true).
  useDismissable(true, onClose, cardRef, { inertBackground: true })
  // Freeze the page behind the scrim (else the profile scrolls under the modal).
  useScrollLock()

  // ARCH-entity-interaction-v2 Step 5 — TrackRow's `add` grant. Mirrors
  // ReviewTrackAdder's pending-intent shape (same AddToBucketMenu, same
  // per-request `seq` so re-filing the SAME track remounts the menu and
  // autoOpen fires again), minus the window-event indirection — this modal
  // and the tracklist share one React tree, so a plain callback is enough.
  const addSeq = useRef(0)
  const [pendingAdd, setPendingAdd] = useState<{ trackId: string, title: string, seq: number } | null>(null)
  const onAddTrack = useCallback((trackId: string, title: string) => {
    addSeq.current += 1
    setPendingAdd({ trackId, title, seq: addSeq.current })
  }, [])

  // ARCH-entity-interaction-v2 Step 5 — TrackRow's `play` grant. Same primitive
  // and toast shape as `AlbumOverlay`'s per-track ▶ (`replaceQueueAndPlay`,
  // `kind: 'track'`) — this modal previously had no play affordance at all, so
  // there is no existing notice mechanism here to fold into; the toast is
  // ported verbatim rather than invented fresh.
  const noticeTimer = useRef<number | null>(null)
  const [playNotice, setPlayNotice] = useState<{ label: string, undo: (() => void) | null } | null>(null)
  const showPlayNotice = useCallback((label: string, undo: (() => void) | null = null) => {
    setPlayNotice({ label, undo })
    if (noticeTimer.current != null)
      window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setPlayNotice(null), 4200)
  }, [])
  useEffect(() => () => {
    if (noticeTimer.current != null)
      window.clearTimeout(noticeTimer.current)
  }, [])
  const onPlayTrack = useCallback((trackId: string, title: string) => {
    void playbackSession.replaceQueueAndPlay({ kind: 'track', trackId, title }).then((outcome) => {
      const undo = outcome.undo
      const runUndo = undo ? () => void undo().then(r => showPlayNotice(r.message)) : null
      if (outcome.ok) {
        rememberSpotifyTransportProbe('available')
        showPlayNotice(outcome.message, runUndo)
        return
      }
      if (outcome.play?.ok === false) {
        if (outcome.play.reason === 'no-capability')
          rememberSpotifyTransportProbe('no-capability')
        if (outcome.play.reason === 'token' && outcome.play.status === 'disconnected') {
          showPlayNotice('Spotify를 연동하면 이 곡을 재생할 수 있어요.', runUndo)
          return
        }
      }
      showPlayNotice(outcome.message, runUndo)
    })
  }, [showPlayNotice])

  const dragPassthrough = useDragScrimPassthrough()

  return (
    <div
	className="scrim"
	style={{ justifyContent: 'center', alignItems: 'center', padding: 24, ...(dragPassthrough ? { pointerEvents: 'none' as const } : {}) }}
	onClick={onClose}
	role="presentation"
    >
      <div
	ref={cardRef}
	className="lf-modal-card"
	onClick={e => e.stopPropagation()}
	role="dialog"
	aria-modal="true"
	aria-label="앨범 상세"
	style={{ position: 'relative', width: '100%', maxWidth: 600, maxHeight: '86vh', overflowY: 'auto', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 12, boxShadow: '0 34px 80px rgba(0,0,0,.42)', padding: '30px 30px 26px', pointerEvents: 'auto' }}
      >
        <button type="button" className="iconbtn" onClick={onClose} aria-label="닫기" style={{ position: 'absolute', top: 16, right: 16, width: 30, height: 30, borderColor: 'var(--color-border-soft)', zIndex: 2 }}>✕</button>
        {album.albumId ?
          <AlbumDetailView albumId={album.albumId} title={album.album} artist={album.artist} cover={album.cover} year={album.year} onOpenLyrics={onOpenLyrics} onAddTrack={onAddTrack} onPlayTrack={onPlayTrack} enableDrag hideArtists={mode === 'edit'} topSlot={mode === 'edit' ? <PublishedBanner published={published} /> : undefined} /> :
          <MinimalBody album={album} />}
      </div>
      {pendingAdd && (
        <AddToBucketMenu
	key={pendingAdd.seq}
	item={{ itemType: 'track', trackId: pendingAdd.trackId, title: pendingAdd.title }}
	autoOpen
	render={() => null}
	onResolved={() => setPendingAdd(null)}
        />
      )}
      {playNotice && createPortal(
        <div className="rise" role="status" style={{ position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)', zIndex: 200, padding: '11px 16px', borderRadius: 7, background: 'var(--color-text)', color: 'var(--color-bg)', boxShadow: '0 16px 40px rgba(0,0,0,.3)', maxWidth: 'min(90vw, 560px)' }}>
          <span className="sans" style={{ fontSize: 13 }}>{playNotice.label}</span>
          {playNotice.undo && (
            <button
	type="button"
	className="sans"
	onClick={() => {
                playNotice.undo?.()
                setPlayNotice(null)
              }}
	style={{ marginLeft: 12, background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', fontSize: 13, textDecoration: 'underline', cursor: 'pointer' }}
            >
              되돌리기
            </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}

// ── published banner (edit-mode top slot) ──────────────────
function PublishedBanner({ published }: { published?: MemberReview }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 20, padding: '12px 14px', border: '1px solid var(--color-border)', borderRadius: 6, background: 'var(--color-paper)' }}>
      <span className="meta" style={{ color: 'var(--color-accent)' }}>이미 발행된 평론</span>
      {published?.rating != null && <Stars score={published.rating} size={14} />}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        {published?.slug && <a href={reviewHref(published.slug)} className="chip" style={{ textDecoration: 'none' }}>평론 보기</a>}
        {published?.postId && <a href={`/write?id=${published.postId}`} className="chip" style={{ textDecoration: 'none' }}>수정</a>}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// FEAT-editor-buckit Step 3 — the memo "쓰레기통" window
//
// A dedicated 2-column overlay for a writable 평론 버킷 album: album identity on the
// left, one freeform memo + the "오늘 밤 키우기" gate on the right. Overwrite model,
// debounced autosave to the bucket-item PATCH — no save button. Ported from the
// design (memo.jsx / memo.css); it is "쓰레기통, not form". The localStorage store of
// the prototype is replaced here by the Step 2 backend field (note / prep_tonight).
// ══════════════════════════════════════════════════════════════════════════════

type SavePhase = 'idle' | 'saving' | 'saved' | 'error'

const MEMO_GEOMETRY_KEY = 'lf_memo_geo'

function memoConstraints(): SizeConstraints {
	return {
		minWidth: 640,
		minHeight: 420,
		maxWidth: Math.min(1600, window.innerWidth - 64),
		maxHeight: window.innerHeight - 48,
	}
}

function defaultMemoRect(): Rect {
	const width = 1140
	const height = Math.min(window.innerHeight - 96, 860)
	return {
		left: (window.innerWidth - width) / 2,
		top: Math.max(24, (window.innerHeight - height) / 2),
		width,
		height,
	}
}

function initialMemoRect(): Rect {
	const initial = { ...defaultMemoRect(), ...readStoredRect(MEMO_GEOMETRY_KEY) }
	return resizeSurfaceRect(initial, 'se', { dx: 0, dy: 0 }, memoConstraints(), { width: window.innerWidth, height: window.innerHeight })
}

function memoDockWidth(contentWidth: number): number {
	return Math.max(320, Math.min(560, contentWidth * 0.39))
}

// PATCH-backed memo state: text → note, grow → prep_tonight. Each edit resets a
// 650ms debounce; on fire — OR on unmount — it sends the LATEST refs (coalesced)
// and bumps a seq so only the most-recent in-flight response drives the indicator.
// The backend field is set-only + idempotent, so each PATCH carries full state (last
// write wins). Flushing on unmount means a type/toggle-then-close (incl. ESC) within
// the debounce window is never silently dropped — autosave with no save button.
function useBucketMemo(album: DetailTarget, onMemoSaved?: (itemId: string, memo: { note: string | null, prepTonight: boolean }) => void) {
  const [text, setText] = useState(album.note ?? '')
  const [grow, setGrow] = useState(album.prepTonight ?? false)
  const [save, setSave] = useState<SavePhase>((album.note ?? '').trim() || album.prepTonight ? 'saved' : 'idle')
  const textRef = useRef(album.note ?? '')
  const growRef = useRef(album.prepTonight ?? false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef(false)
  const seq = useRef(0)

  // Send the latest state now. `live` = still mounted → drive the indicator; on
  // unmount we fire-and-forget so no setState lands after teardown. No pending
  // edit (or no handle) → no-op, so closing without editing never PATCHes.
  const flush = useCallback((live: boolean) => {
    const { bucketId, itemId } = album
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (!pending.current || !bucketId || !itemId)
      return
    pending.current = false
    // Only PATCH the fields that actually changed from the seed. Sending the full
    // pair every time lets a stale seed clobber a field the user never touched —
    // e.g. editing the note after reopening on a stale prepTonight=false would
    // reset a saved prep_tonight=true. The backend treats omitted fields as
    // no-change (UpdateBucketItemRequest, exclude_unset).
    const patch: { note?: string | null, prep_tonight?: boolean } = {}
    if (textRef.current !== (album.note ?? ''))
      patch.note = textRef.current
    if (growRef.current !== (album.prepTonight ?? false))
      patch.prep_tonight = growRef.current
    if (Object.keys(patch).length === 0) {
      if (live)
        setSave('saved')
      return
    }
    // Keep the board's in-memory item fresh so reopening the modal seeds the
    // saved values, not the stale snapshot the modal was opened from.
    onMemoSaved?.(itemId, { note: textRef.current, prepTonight: growRef.current })
    const mySeq = ++seq.current
    const sent = updateBucketItemMemo(bucketId, itemId, patch)
    if (!live) {
      sent.catch(() => {})
      return
    }
    sent
      .then(() => {
        if (mySeq === seq.current)
          setSave('saved')
      })
      .catch(() => {
        if (mySeq === seq.current)
          setSave('error')
      })
  }, [album, onMemoSaved])

  const schedule = useCallback(() => {
    pending.current = true
    setSave('saving')
    if (timer.current)
      clearTimeout(timer.current)
    timer.current = setTimeout(() => flush(true), 650)
  }, [flush])

  const onText = useCallback((v: string) => {
    textRef.current = v
    setText(v)
    schedule()
  }, [schedule])

  const onToggle = useCallback(() => {
    growRef.current = !growRef.current
    setGrow(growRef.current)
    schedule()
  }, [schedule])

  // Flush any pending edit on unmount (ESC / close / navigation) — never drop it.
  useEffect(() => () => flush(false), [flush])

  return { text, grow, save, onText, onToggle }
}

// crescent-moon glyph for the "오늘 밤 키우기" switch
function CrescentMoon({ size = 16, filled = false }: { size?: number, filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ display: 'block', transition: 'transform .3s cubic-bezier(.2,.7,.2,1)' }}>
      <path d="M20.5 14.8A8.5 8.5 0 1 1 10.2 3.6 6.7 6.7 0 0 0 20.5 14.8Z" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={filled ? 0 : 1.7} strokeLinejoin="round" />
    </svg>
  )
}

// ambient autosave indicator — quiet dot + label (no blocking spinner)
function SaveStateDot({ phase }: { phase: SavePhase }) {
  const label = phase === 'saving' ? '저장 중' : phase === 'saved' ? '저장됨' : phase === 'error' ? '저장 안 됨' : ''
  const dot = phase === 'error' ? 'var(--color-accent)' : phase === 'saving' ? 'var(--color-faded)' : 'var(--color-subtle)'
  return (
    <span
	className="mono"
	aria-live="polite"
	style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, letterSpacing: '.08em', color: phase === 'error' ? 'var(--color-accent)' : 'var(--color-faded)', opacity: phase === 'idle' ? 0 : 1, transition: 'opacity .3s' }}
    >
      <span style={{ width: 5, height: 5, borderRadius: 5, background: dot, animation: phase === 'saving' ? 'memo-pulse 1s ease-in-out infinite' : 'none' }} />
      {label}
    </span>
  )
}

// the single freeform memo body — borderless serif over paper
function MemoBody({ value, onChange, autoFocus, minHeight }: { value: string, onChange: (v: string) => void, autoFocus?: boolean, minHeight: number }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (autoFocus && ref.current)
      ref.current.focus()
  }, [autoFocus])
  return (
    <textarea
	ref={ref}
	className="memo-area"
	value={value}
	onChange={e => onChange(e.target.value)}
	placeholder="떠오른 대로 던져둬."
	aria-label="메모"
	spellCheck={false}
	style={{ minHeight }}
    />
  )
}

// "오늘 밤 키우기" toggle — full-width row, reads as a switch; ON = 밤(night)
function GrowToggle({ on, onToggle }: { on: boolean, onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onToggle} className={`memo-grow${on ? ' on' : ''}`}>
      <span className="memo-grow-ico" aria-hidden><CrescentMoon size={17} filled={on} /></span>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, minWidth: 0 }}>
        <span className="memo-grow-label">오늘 밤 키우기</span>
        <span className="memo-grow-sub">{on ? '오늘 밤, 초고로 키울게요' : '자는 동안 초고로'}</span>
      </span>
      <span className="memo-grow-track" aria-hidden><span className="memo-grow-knob" /></span>
    </button>
  )
}

// soft hint when the gate is on but nothing's written yet (not a block/warning)
function GrowEmptyHint({ show }: { show: boolean }) {
  if (!show)
    return null
  return (
    <div className="serif italic" style={{ fontSize: 13, color: 'var(--color-faded)', lineHeight: 1.5, padding: '9px 0 2px', animation: 'memo-rise .3s both' }}>
      아직 키울 게 없어요. 한 줄만 던져두면 돼요.
    </div>
  )
}

// up to 4 distinct artist genres → reading-material chips on the left column
function uniqueGenres(artists: MusicArtist[]): string[] {
  const seen = new Set<string>()
  for (const ar of artists) {
    for (const g of ar.genres) {
      if (g)
        seen.add(g)
    }
  }
  return [...seen].slice(0, 4)
}

type PairedMemoTrackActions = TrackRowActions & {
  add: NonNullable<TrackRowActions['add']>
  drag: NonNullable<TrackRowActions['drag']>
}

function memoTrackActions({ track, album, cover, onOpenLyrics, onAddTrack }: {
  track: MusicTrack
  album: DetailTarget
  cover: string | null | undefined
  onOpenLyrics: OnOpenLyrics
  onAddTrack: (trackId: string, title: string) => void
}): PairedMemoTrackActions {
  const openLyrics: Pick<TrackRowActions, 'openLyrics'> = {}
  if (track.spotify_id) {
    openLyrics.openLyrics = {
      fire: () => onOpenLyrics(track.spotify_id!, { track: track.title, artist: album.artist, album: album.album, cover }),
      title: '가사 보기',
    }
  }
  return {
    ...openLyrics,
    add: () => onAddTrack(track.id, track.title),
    drag: { ref: memberRef({ trackId: track.id, albumId: album.albumId ?? null }), origin: { kind: 'external', copies: true } },
  }
}

/**
 * Memo-owned adapter. AlbumCard receives display data only; the paired track
 * add/drag operations remain closed over the MemoWindow host. The
 * PairedMemoTrackActions return type makes Rule #14 a compile-time invariant
 * at this adapter boundary instead of another call-site convention.
 */
export function MemoAlbumCardAdapter({ album, data, onOpenLyrics, onAddTrack, belowCard }: {
  album: DetailTarget
  data: AlbumDetailResp | null
  onOpenLyrics: OnOpenLyrics
  onAddTrack: (trackId: string, title: string) => void
  /**
   * ARCH-bucket-album-modal-unification Step 1 — rendered between the album
   * card and the tracklist (published banner + live rating block).
   */
  belowCard?: React.ReactNode
}) {
  const a = data?.album
  const meta: string[] = []
  if (a?.album_type)
    meta.push(a.album_type.toUpperCase())
  if (a?.release_date)
    meta.push(a.release_date)
  if (a?.label)
    meta.push(a.label)
  const tags = uniqueGenres(data?.artists ?? [])
  const cover = a?.cover_url ?? album.cover ?? null

  return (
    <>
      <div className="memo-album-card">
        <AlbumCard
	data={{
            catalogAlbumId: album.albumId ?? null,
            spotifyAlbumId: null,
            title: album.album,
            artist: album.artist ?? null,
            artistId: data?.artists[0]?.id ?? null,
            cover,
            // Keep the full release date in the contextual line, as before.
            year: null,
          }}
	layout="grid"
	eyebrow={<span className="kicker">앨범</span>}
	secondaryLine={(
            <span className="memo-album-card__context">
              {meta.length > 0 && <span className="memo-album-card__meta mono">{meta.join(' · ')}</span>}
              {tags.length > 0 && (
                <span className="memo-tags memo-album-card__tags">
                  {tags.map(t => <span key={t} className="memo-tag">{t}</span>)}
                </span>
              )}
            </span>
          )}
        />
      </div>

      {belowCard}

      {data && data.tracks.length > 0 && (
        <>
          <div style={{ margin: '16px 0 9px', borderTop: '1px solid var(--color-border-soft)' }} />
          <div className="meta" style={{ letterSpacing: '.12em' }}>{`트랙리스트 · ${data.tracks.length}곡`}</div>
          <div className="memo-tracks">
            {data.tracks.map((track, i) => {
              const len = track.duration_sec != null ? fmtTime(track.duration_sec) : ''
              const no = String(track.track_no ?? 0).padStart(2, '0')
              return (
                <TrackRow
	key={track.id}
	no={no}
	title={track.title}
	cells={len ? <span className="mono" style={{ fontSize: 10, color: 'var(--color-faded)', fontVariantNumeric: 'tabular-nums' }}>{len}</span> : undefined}
	actions={memoTrackActions({ track, album, cover, onOpenLyrics, onAddTrack })}
	gridTemplate="22px minmax(0,1fr) auto auto"
	style={{ padding: '6px 2px', borderBottom: i === data.tracks.length - 1 ? 'none' : '1px solid var(--color-border-soft)' }}
                />
              )
            })}
          </div>
        </>
      )}
    </>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// ARCH-bucket-album-modal-unification Step 1 — live 평가 (rating) block
//
// Replaces the dead "미평가" placeholder. Self-contained (own fetch/write), reusing
// the SAME PUT /api/reviews/albums/{id} path as the public AlbumRatingBlock, not the
// whole component — this panel has no room for public aggregate stats, a review
// list, or a login CTA (the memo window is authed-only by construction). Seeds from
// fetchMyAlbumStates(albumId) rather than the `reviews` prop: MemberReview (built
// from published-post frontmatter) never carries `comment`.
//
// OQ2 (RFC "does a star click save immediately, or need an explicit save?") —
// resolved immediate-write + undo, matching FEAT-album-review-authoring's "가볍게"
// premise and the toast/undo pattern already used by StandardModal's play notice.
function MemoRatingBlock({ albumId }: { albumId: string | undefined }) {
	const [state, setState] = useState<{ rating: number | null, comment: string } | null>(null)
	const [saving, setSaving] = useState(false)
	const [err, setErr] = useState<string | null>(null)
	const commentRef = useRef('')
	const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
	const [undo, setUndo] = useState<{ prev: number | null } | null>(null)
	const undoTimer = useRef<number | null>(null)

	useEffect(() => {
		if (!albumId)
			return
		let alive = true
		fetchMyAlbumStates(albumId).then((states) => {
			if (!alive)
				return
			const s = states[0]
			commentRef.current = s?.comment ?? ''
			setState({ rating: s?.rating ?? null, comment: s?.comment ?? '' })
		})
		return () => {
			alive = false
		}
	}, [albumId])

	useEffect(() => () => {
		if (debounce.current)
			clearTimeout(debounce.current)
		if (undoTimer.current != null)
			window.clearTimeout(undoTimer.current)
	}, [])

	// A null rating cannot carry a comment (DB CHECK) — clearing the rating always
	// clears the comment too, regardless of what the caller passed.
	async function commit(changes: Partial<{ rating: number | null, comment: string | null }>) {
		if (!albumId)
			return
		const payload = changes.rating === null ? { ...changes, comment: null } : changes
		setSaving(true)
		setErr(null)
		try {
			const res = await putMyAlbumState(albumId, payload)
			commentRef.current = res?.comment ?? ''
			setState({ rating: res?.rating ?? null, comment: res?.comment ?? '' })
			notifyAlbumStateChanged({ albumId, reviewCandidate: res?.review_candidate ?? false, rating: res?.rating ?? null })
		}
		catch (e) {
			setErr(e instanceof RatingRateLimitError ? '오늘 남길 수 있는 평가 수를 초과했습니다.' : '저장하지 못했습니다.')
		}
		finally {
			setSaving(false)
		}
	}

	function onStar(v: number) {
		const prev = state?.rating ?? null
		setState(s => ({ rating: v, comment: s?.comment ?? '' }))
		void commit({ rating: v })
		setUndo({ prev })
		if (undoTimer.current != null)
			window.clearTimeout(undoTimer.current)
		undoTimer.current = window.setTimeout(() => setUndo(null), 4200)
	}

	function onUndo() {
		if (!undo)
			return
		const prev = undo.prev
		setUndo(null)
		if (undoTimer.current != null)
			window.clearTimeout(undoTimer.current)
		setState(s => ({ rating: prev, comment: s?.comment ?? '' }))
		void commit({ rating: prev })
	}

	function onComment(v: string) {
		commentRef.current = v
		setState(s => ({ rating: s?.rating ?? null, comment: v }))
		if (debounce.current)
			clearTimeout(debounce.current)
		debounce.current = setTimeout(() => void commit({ comment: commentRef.current.trim() || null }), 650)
	}

	if (!albumId || !state)
		return null

	return (
		<div className="memo-rating">
			<div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
				{/* HalfStarInput's own default (30px → 15×30px half-star hit zones) is under
				    typical touch-target guidance; sized up for this modal's real touch use. */}
				<HalfStarInput value={state.rating ?? 0} onChange={onStar} size={38} />
				<span className="mono" style={{ fontSize: 12, color: 'var(--color-subtle)' }}>
					{state.rating != null ? state.rating.toFixed(1) : '평가하기'}
				</span>
				{saving && <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-faded)' }}>저장 중</span>}
				{undo && !saving && (
					<button type="button" onClick={onUndo} className="mono" style={{ fontSize: 10.5, background: 'none', border: 'none', padding: 0, color: 'var(--color-subtle)', textDecoration: 'underline', cursor: 'pointer' }}>
						되돌리기
					</button>
				)}
			</div>
			<input
				type="text"
				value={state.comment}
				onChange={e => onComment(e.target.value)}
				maxLength={RATING_COMMENT_MAX}
				disabled={state.rating == null}
				placeholder={state.rating == null ? '별점을 먼저 남겨주세요' : '한 줄 감상 (선택)'}
				aria-label="한 줄 감상"
				className="sans memo-rating-comment"
			/>
			{err && <div className="sans" style={{ fontSize: 11.5, color: 'var(--color-danger, #c0392b)' }}>{err}</div>}
		</div>
	)
}

function MemoWindow({ album, onClose, onMemoSaved, published }: { album: DetailTarget, onClose: () => void, onMemoSaved?: (itemId: string, memo: { note: string | null, prepTonight: boolean }) => void, published?: MemberReview }) {
  const cardRef = useRef<HTMLDivElement>(null)
  // ESC + focus trap + focus restore. autoFocus off so MemoBody's own autoFocus
  // owns initial focus (the textarea, not the ✕) — zero-friction 쓰레기통 intent.
  useDismissable(true, onClose, cardRef, { autoFocus: false, inertBackground: true })
  // Freeze the page behind the scrim (else the profile scrolls under the modal).
  useScrollLock()

  // The memo window owns one shared lyrics/research context panel. It opens in
  // the dock on desktop and floats on mobile; tab changes never remount panes.
  const mobile = useIsMobileHost()
  const [panelOpen, setPanelOpen] = useState(album.focusResearch ?? false)
  const [tab, setTab] = useState<ContextPanelTab>(album.focusResearch ? 'research' : 'lyrics')
  const [track, setTrack] = useState<ContextPanelTrack | null>(null)
  const [dock, setDock] = useState<DockState>(INITIAL_DOCK)
  const patchDock = useCallback((p: Partial<DockState>) => setDock(d => ({ ...d, ...p })), [])
  const openLyrics = useCallback((trackId: string, meta?: LyricsSheetMeta) => {
    setTrack({ trackId, meta })
    setTab('lyrics')
    setPanelOpen((open) => {
      if (!open)
        setDock(INITIAL_DOCK)
      return true
    })
  }, [])
  const openResearch = useCallback(() => {
    setTab('research')
    setPanelOpen((open) => {
      if (!open)
        setDock(INITIAL_DOCK)
      return true
    })
  }, [])
  const closePanel = () => setPanelOpen(false)
  const dockCapable = panelOpen && !mobile
  const slotReserved = dockCapable && (dock.docked || dock.dragging)
  const [contentRect, setContentRect] = useState<Rect>(initialMemoRect)
  const [surfaceMounted, setSurfaceMounted] = useState(false)
  const dockWidth = memoDockWidth(contentRect.width)
  const outerWidth = contentRect.width + (slotReserved ? dockWidth : 0)

  useLayoutEffect(() => {
	setSurfaceMounted(!mobile)
  }, [mobile])

  useEffect(() => {
	if (mobile)
		return
	const onResize = () => {
		setContentRect((current) => {
			const fitted = resizeSurfaceRect(current, 'se', { dx: 0, dy: 0 }, memoConstraints(), { width: window.innerWidth, height: window.innerHeight })
			const position = clampSurfacePosition(fitted, { width: fitted.width + (slotReserved ? memoDockWidth(fitted.width) : 0), height: fitted.height }, { width: window.innerWidth, height: window.innerHeight })
			const next = { ...fitted, ...position }
			writeStoredRect(MEMO_GEOMETRY_KEY, next)
			return next
		})
	}
	window.addEventListener('resize', onResize)
	return () => window.removeEventListener('resize', onResize)
  }, [mobile, slotReserved])

  const getContentRect = useCallback(() => contentRect, [contentRect])
  const commitContentRect = useCallback((rect: Rect) => {
	setContentRect(rect)
	writeStoredRect(MEMO_GEOMETRY_KEY, rect)
  }, [])
  const resizeHandleProps = useResizableSurface({
	panelRef: cardRef,
	enabled: !mobile && surfaceMounted,
	constraints: memoConstraints,
	getRect: getContentRect,
	// Freezes the dock-column width at its pre-drag value for the whole gesture
	// instead of recomputing memoDockWidth(rect.width) live: since dockWidth is a
	// ~0.39 function of content width, recomputing it every pointermove made the
	// docked right edge race ahead of the cursor (content grows by dx, dock grows
	// by another ~0.39·dx on top) — freezing it makes the edge track 1:1 during
	// the drag; the dock column itself only re-derives on commit (next render).
	onLiveResize: (rect) => {
		if (cardRef.current)
			cardRef.current.style.width = `${rect.width + (slotReserved ? dockWidth : 0)}px`
	},
	onCommit: commitContentRect,
  })
  const getOuterRect = useCallback((): Rect => ({ ...contentRect, width: outerWidth }), [contentRect, outerWidth])
  const moveHandlers = useMovableSurface({
	panelRef: cardRef,
	enabled: !mobile && surfaceMounted,
	getRect: getOuterRect,
	onCommit: (rect) => {
		const next = { ...contentRect, left: rect.left, top: rect.top }
		setContentRect(next)
		writeStoredRect(MEMO_GEOMETRY_KEY, { left: next.left, top: next.top })
	},
  })

  // album identity for the left column — same fetch/cache as the standard modal
  const seed = album.albumId ? getCachedAlbumDetail(album.albumId) : null
  const [data, setData] = useState<AlbumDetailResp | null>(seed)
  useEffect(() => {
    if (!album.albumId)
      return
    let alive = true
    fetchAlbumDetail(album.albumId)
      .then((json) => {
        if (alive && json)
          setData(json)
      })
    return () => {
      alive = false
    }
  }, [album.albumId])

  const { text, grow, save, onText, onToggle } = useBucketMemo(album, onMemoSaved)
  const empty = text.trim().length === 0
  const addSeq = useRef(0)
  const [pendingAdd, setPendingAdd] = useState<{ trackId: string, title: string, seq: number } | null>(null)
  const onAddTrack = useCallback((trackId: string, title: string) => {
    addSeq.current += 1
    setPendingAdd({ trackId, title, seq: addSeq.current })
  }, [])
  const dragPassthrough = useDragScrimPassthrough()

  const focusResearchOnMount = useRef(album.focusResearch).current
  useEffect(() => {
    if (focusResearchOnMount)
      openResearch()
    // Intentionally once on mount: focusResearch is a one-shot open intent from
    // the click that opened this modal, not a value to keep re-syncing against.
  }, [focusResearchOnMount, openResearch])

  return (
    <div
	className="scrim"
	style={{ justifyContent: 'center', alignItems: 'center', padding: 24, ...(dragPassthrough ? { pointerEvents: 'none' as const } : {}) }}
	onClick={onClose}
	role="presentation"
    >
      <div
	ref={cardRef}
	className={`memo-modal memo-modal-lg${grow ? ' is-night' : ''}${dockCapable ? ' has-dock' : ''}${surfaceMounted && !mobile ? ' is-surface-mounted' : ''}`}
	onClick={e => e.stopPropagation()}
	role="dialog"
	aria-modal="true"
	aria-label={album.album}
	style={mobile || !surfaceMounted ?
		{ maxHeight: '92vh', overflowY: 'auto', animation: 'lf-rise .26s both', pointerEvents: 'auto' } :
		{
			left: contentRect.left,
			top: contentRect.top,
			width: outerWidth,
			height: contentRect.height,
			maxHeight: 'none',
			overflowY: 'auto',
			animation: 'none',
			pointerEvents: 'auto',
			'--lys-dock-w': `${dockWidth}px`,
		} as CSSProperties}
      >
       <div className="memo-dock-main">
        <button type="button" className="memo-x memo-x-abs" onClick={onClose} aria-label="닫기">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>

        <div className="memo-lg-bar" {...moveHandlers}>
          <span className="kicker">버킷 · 앨범 메모</span>
        </div>

        <div className="memo-lg-grid">
          {/* left — album identity (the subject of the memo, not an aside) */}
          <div className="memo-info">
            <MemoAlbumCardAdapter
	album={album}
	data={data}
	onOpenLyrics={openLyrics}
	onAddTrack={onAddTrack}
	belowCard={(
                <>
                  {published && <PublishedBanner published={published} />}
                  <MemoRatingBlock albumId={album.albumId} />
                </>
              )}
            />
          </div>

          {/* right — the memo (쓰레기통) */}
          <section className="memo-main">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
              <span className="kicker">버킷 · 메모</span>
              <span className="serif italic" style={{ fontSize: 12.5, color: 'var(--color-faded)' }}>떠오른 대로 던져두는 곳</span>
            </div>
            <MemoBody value={text} onChange={onText} autoFocus minHeight={300} />
            <GrowEmptyHint show={grow && empty} />
            <div className="memo-modal-foot">
              <GrowToggle on={grow} onToggle={onToggle} />
              <SaveStateDot phase={save} />
            </div>
            <div className="memo-write-link">
              <a href={`/write?album=${album.albumId}`}>전체 에디터에서 작성 →</a>
            </div>
            {album.albumId && (
              <button type="button" className="memo-context-open mono" onClick={openResearch}>리서치 노트 열기</button>
            )}
          </section>
        </div>
       </div>

        {/* Reserved dock column (the context panel is placed over it). Collapses
            to 0 when the panel floats, so
            the memo reclaims the space; re-opens as a dashed drop target while a
            floating panel is being dragged. */}
        {dockCapable && (
          <div className={`lys-dock-slot${slotReserved ? '' : ' is-collapsed'}`} aria-hidden="true">
            <div className={`lys-dock-hint${dock.dragging && !dock.docked ? ' is-shown' : ''}${dock.expect ? ' is-expect' : ''}`}>여기에 도킹</div>
          </div>
        )}
		{!mobile && surfaceMounted && SURFACE_RESIZE_EDGES.map(edge => (
			<div
				key={edge}
				className={`surface-resize-handle is-${edge}`}
				data-resize-edge={edge}
				aria-hidden="true"
				{...resizeHandleProps(edge)}
			/>
		))}
      </div>

      {panelOpen && album.albumId && (
        <>
          {!mobile && <div className={`lys-float-dim${dock.dragging && !dock.docked ? ' is-shown' : ''}`} aria-hidden="true" />}
          <ContextPanel
	albumId={album.albumId}
	track={track}
	tab={tab}
	onTabChange={setTab}
	onClose={closePanel}
	hostRef={cardRef}
	dock={dock}
	patch={patchDock}
	mobile={mobile}
          />
        </>
      )}
      {pendingAdd && (
        <AddToBucketMenu
	key={pendingAdd.seq}
	item={{ itemType: 'track', trackId: pendingAdd.trackId, title: pendingAdd.title }}
	autoOpen
	render={() => null}
	onResolved={() => setPendingAdd(null)}
        />
      )}
    </div>
  )
}

// ── minimal body (no real albumId — sample tracks / reviews) ─────────────────
function MinimalBody({ album }: { album: DetailTarget }) {
  const hasMeta = Boolean(album.track || album.genre || album.year)
  return (
    <>
      <Header cover={album.cover} title={album.track || album.album} artist={album.artist} meta={[]} kicker={album.track ? '트랙' : '앨범'} />
      <div style={{ marginTop: 22, paddingTop: 20, borderTop: '1px solid var(--color-border-soft)' }}>
        {album.rating != null ?
          <Stars score={album.rating} size={18} /> :
          <span className="unrated">미평가</span>}
        <div className="sans" style={{ fontSize: 13.5, color: 'var(--color-subtle)', marginTop: 10, lineHeight: 1.7 }}>
          {hasMeta ?
            (
              <>
                {album.track && `수록: ${album.album}`}
                {album.track && (album.genre || album.year) && ' · '}
                {album.genre && <GenreLink label={album.genre} />}
                {album.genre && album.year && ' · '}
                {album.year && `${album.year}년`}
              </>
            ) :
            '추가 정보 없음'}
        </div>
      </div>
    </>
  )
}
