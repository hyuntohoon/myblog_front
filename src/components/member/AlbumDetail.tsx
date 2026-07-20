// Member dashboard — album detail / memo modal (centered).
//
// Opened from member-dashboard surfaces via SelfDashboard's openDetail handler. The experience is
// derived from where it was opened (DetailTarget.writable) and whether the album
// already has a published review (matched against `reviews` by albumId):
//   · memo  — a writable 평론 버킷 album with no review yet AND a bucket-item handle
//             (bucketId + itemId): the "쓰레기통" memo window (FEAT-editor-buckit Step
//             3) — one freeform note (→ review_bucket_items.note) + the "오늘 밤 키우기"
//             gate (→ prep_tonight), debounced-autosaved (no save button). It replaces
//             the old inline draft composer; a single "전체 에디터에서 작성" link keeps
//             the path to /write.
//   · info  — non-writable surfaces (Spotify 라이브러리, 최근 들은, sample tracks):
//             cover + metadata + tracklist, read-only.
//   · edit  — a bucket album that already has a published review: read-only detail
//             with an "이미 발행됨" banner → 평론 보기 (/review/{slug}) + 수정 (/write?id).
import type { DockState } from './lyrics/DockableLyricsSheet'
import type { LyricsSheetMeta } from './lyrics/LyricsSheet'
import type { AlbumDetail as AlbumDetailResp, MusicArtist } from '@lib/albumDetail'
import type { DetailTarget, MemberReview } from '@lib/member'
import type { OnOpenLyrics } from '../album/AlbumDetailView'
import { useCallback, useEffect, useRef, useState } from 'react'
import { updateBucketItemMemo } from '@lib/buckets'
import { fetchAlbumDetail, getCachedAlbumDetail } from '@lib/albumDetail'
import { reviewHref } from '@lib/entityLinks'
import { useDismissable } from '@lib/useDismissable'
import { useScrollLock } from '@lib/useScrollLock'
import { AlbumDetailView, Header } from '../album/AlbumDetailView'
import { GenreLink } from '../shared/GenreLink'
import { DockableLyricsSheet, INITIAL_DOCK } from './lyrics/DockableLyricsSheet'
import { LyricsSheet } from './lyrics/LyricsSheet'
import { AlbumArt, fmtTime, Seg, Stars } from './ui'

// The memo window is a dock host: below this width (mobile) header-drag would
// fight scrolling, so the sheet opens as a plain float instead of docking.
function useIsMobileHost(): boolean {
	const [mobile, setMobile] = useState(false)
	useEffect(() => {
		const mq = window.matchMedia('(max-width: 767px)')
		const on = () => setMobile(mq.matches)
		on()
		mq.addEventListener('change', on)
		return () => mq.removeEventListener('change', on)
	}, [])
	return mobile
}

type Mode = 'info' | 'edit'

export function AlbumDetail({ album, reviews, onClose, onMemoSaved, onOpenLyrics }: { album: DetailTarget, reviews: MemberReview[], onClose: () => void, onMemoSaved?: (itemId: string, memo: { note: string | null, prepTonight: boolean }) => void, onOpenLyrics?: OnOpenLyrics }) {
  // "Published" here means a real post page exists. Runtime member rating rows
  // (merge PR2) carry slug '' — they must NOT hijack the memo/edit decision, or
  // a member who merely rated a bucket album would lose the MemoWindow
  // authoring path. Owner/build-time rows always carry a slug, so the owner dashboard is
  // unaffected. (Informational surfaces — rating chips, 평론 tab — still show
  // slug-less rows; only this matcher is post-gated.)
  const published = album.albumId ? reviews.find(r => r.slug !== '' && r.albumIds.includes(album.albumId!)) : undefined

  // FEAT-editor-buckit Step 3: a writable, not-yet-published 평론 버킷 album that
  // carries its bucket-item handle opens the memo "쓰레기통" window. Without the
  // handle (unexpected on a bucket surface) it degrades to the read-only info modal.
  if (album.writable && !published && album.albumId && album.bucketId && album.itemId)
    return <MemoWindow album={album} onClose={onClose} onMemoSaved={onMemoSaved} />

  // edit when published + writable; otherwise read-only info (covers non-writable
  // surfaces AND the rare writable-but-no-handle fallback).
  const mode: Mode = (published && album.writable) ? 'edit' : 'info'
  return <StandardModal album={album} mode={mode} published={published} onClose={onClose} onOpenLyrics={onOpenLyrics} />
}

// ── standard 600px modal (info / edit) ───────────────────────────────────────
function StandardModal({ album, mode, published, onClose, onOpenLyrics }: { album: DetailTarget, mode: Mode, published?: MemberReview, onClose: () => void, onOpenLyrics?: OnOpenLyrics }) {
  const cardRef = useRef<HTMLDivElement>(null)
  // ESC + focus trap + focus restore (mounted-when-open → open=true).
  useDismissable(true, onClose, cardRef)
  // Freeze the page behind the scrim (else the profile scrolls under the modal).
  useScrollLock()

  return (
    <div
	className="scrim"
	style={{ justifyContent: 'center', alignItems: 'center', padding: 24 }}
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
	style={{ position: 'relative', width: '100%', maxWidth: 600, maxHeight: '86vh', overflowY: 'auto', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 12, boxShadow: '0 34px 80px rgba(0,0,0,.42)', padding: '30px 30px 26px' }}
      >
        <button type="button" className="iconbtn" onClick={onClose} aria-label="닫기" style={{ position: 'absolute', top: 16, right: 16, width: 30, height: 30, borderColor: 'var(--color-border-soft)', zIndex: 2 }}>✕</button>
        {album.albumId ?
          <AlbumDetailView albumId={album.albumId} title={album.album} artist={album.artist} cover={album.cover} year={album.year} onOpenLyrics={onOpenLyrics} hideArtists={mode === 'edit'} topSlot={mode === 'edit' ? <PublishedBanner published={published} /> : undefined} /> :
          <MinimalBody album={album} />}
      </div>
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

const MEMO_SIZES = [{ v: 'm', label: '보통' }, { v: 'l', label: '크게' }, { v: 'xl', label: '최대' }]

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

function MemoWindow({ album, onClose, onMemoSaved }: { album: DetailTarget, onClose: () => void, onMemoSaved?: (itemId: string, memo: { note: string | null, prepTonight: boolean }) => void }) {
  const cardRef = useRef<HTMLDivElement>(null)
  // ESC + focus trap + focus restore. autoFocus off so MemoBody's own autoFocus
  // owns initial focus (the textarea, not the ✕) — zero-friction 쓰레기통 intent.
  useDismissable(true, onClose, cardRef, { autoFocus: false })
  // Freeze the page behind the scrim (else the profile scrolls under the modal).
  useScrollLock()

  // FEAT-lyrics-sheet PR 2 — the memo window is the sheet's dock host. A track
  // opens the sheet docked into the reserved right column (desktop) or as a
  // plain float (mobile). The sheet lives here so tearing /
  // docking never crosses a remount boundary and reloads its lyrics.
  const mobile = useIsMobileHost()
  const [sheet, setSheet] = useState<{ trackId: string, meta?: LyricsSheetMeta } | null>(null)
  const [dock, setDock] = useState<DockState>(INITIAL_DOCK)
  const patchDock = useCallback((p: Partial<DockState>) => setDock(d => ({ ...d, ...p })), [])
  const openSheet = (trackId: string, meta?: LyricsSheetMeta) => {
    setDock(INITIAL_DOCK)
    setSheet({ trackId, meta })
  }
  const closeSheet = () => setSheet(null)
  const dockCapable = sheet != null && !mobile
  const slotReserved = dockCapable && (dock.docked || dock.dragging)

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

  const [size, setSize] = useState<string>(() => {
    try {
      return localStorage.getItem('lf_memo_size') || 'l'
    }
    catch {
      return 'l'
    }
  })
  const changeSize = (s: string) => {
    setSize(s)
    try {
      localStorage.setItem('lf_memo_size', s)
    }
    catch {
      /* private mode — size just won't persist */
    }
  }

  const { text, grow, save, onText, onToggle } = useBucketMemo(album, onMemoSaved)
  const empty = text.trim().length === 0

  const a = data?.album
  const meta: string[] = []
  if (a?.album_type)
    meta.push(a.album_type.toUpperCase())
  if (a?.release_date)
    meta.push(a.release_date)
  if (a?.label)
    meta.push(a.label)
  const tags = uniqueGenres(data?.artists ?? [])

  return (
    <div
	className="scrim"
	style={{ justifyContent: 'center', alignItems: 'center', padding: 24 }}
	onClick={onClose}
	role="presentation"
    >
      <div
	ref={cardRef}
	className={`memo-modal memo-modal-lg size-${size}${grow ? ' is-night' : ''}${dockCapable ? ' has-dock' : ''}`}
	onClick={e => e.stopPropagation()}
	role="dialog"
	aria-modal="true"
	aria-labelledby="memo-dialog-title"
	style={{ maxHeight: '92vh', overflowY: 'auto', animation: 'lf-rise .26s both' }}
      >
       <div className="memo-dock-main">
        <button type="button" className="memo-x memo-x-abs" onClick={onClose} aria-label="닫기">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>

        <div className="memo-lg-bar">
          <span className="kicker">버킷 · 앨범 메모</span>
          <div style={{ marginLeft: 'auto' }}>
            <Seg value={size} options={MEMO_SIZES} onChange={changeSize} />
          </div>
        </div>

        <div className="memo-lg-grid">
          {/* left — album identity (the subject of the memo, not an aside) */}
          <div className="memo-info">
            <div className="memo-cover-wrap"><AlbumArt url={a?.cover_url ?? album.cover} label={album.album} size={220} /></div>
            <div className="kicker" style={{ marginBottom: 7 }}>앨범</div>
            <h2 id="memo-dialog-title" className="serif italic" style={{ fontSize: 25, fontWeight: 500, lineHeight: 1.12, letterSpacing: '-.01em', margin: 0 }}>{album.album}</h2>
            {album.artist && <div className="sans" style={{ fontSize: 14, color: 'var(--color-subtle)', marginTop: 5 }}>{album.artist}</div>}
            {meta.length > 0 && <div className="mono" style={{ fontSize: 11, letterSpacing: '.04em', color: 'var(--color-faded)', marginTop: 8, lineHeight: 1.5 }}>{meta.join(' · ')}</div>}
            <div style={{ marginTop: 12 }}><span className="unrated">미평가</span></div>
            {tags.length > 0 && (
              <div className="memo-tags" style={{ marginTop: 14 }}>
                {tags.map(t => <span key={t} className="memo-tag">{t}</span>)}
              </div>
            )}
            {data && data.tracks.length > 0 && (
              <>
                <div style={{ margin: '16px 0 9px', borderTop: '1px solid var(--color-border-soft)' }} />
                <div className="meta" style={{ letterSpacing: '.12em' }}>{`트랙리스트 · ${data.tracks.length}곡`}</div>
                <div className="memo-tracks">
                  {data.tracks.map((t) => {
                    // FEAT-lyrics-sheet: a track with a spotify_id opens the
                    // lyrics sheet (the bucket-album entry that was missing —
                    // the memo window replaced the shared TrackRow, so its rows
                    // had no 가사 affordance). Without an id there is nothing to
                    // query, so the row stays a plain read-only line.
                    const sid = t.spotify_id
                    const len = t.duration_sec != null ? fmtTime(t.duration_sec) : ''
                    const no = String(t.track_no ?? 0).padStart(2, '0')
                    if (sid) {
                      return (
                        <button
	type="button"
	key={t.id}
	className="memo-trow memo-trow-btn"
	title="가사 보기"
	onClick={() => openSheet(sid, { track: t.title, artist: album.artist, album: album.album, cover: a?.cover_url ?? album.cover })}
                        >
                          <span className="memo-trow-no">{no}</span>
                          <span className="memo-trow-title">{t.title}</span>
                          <span className="memo-trow-len">{len}</span>
                        </button>
                      )
                    }
                    return (
                      <div key={t.id} className="memo-trow">
                        <span className="memo-trow-no">{no}</span>
                        <span className="memo-trow-title">{t.title}</span>
                        <span className="memo-trow-len">{len}</span>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
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
          </section>
        </div>
       </div>

        {/* FEAT-lyrics-sheet PR 2 — reserved dock column (the sheet is placed over
            it by DockableLyricsSheet). Collapses to 0 when the sheet floats, so
            the memo reclaims the space; re-opens as a dashed drop target while a
            floating sheet is being dragged. */}
        {dockCapable && (
          <div className={`lys-dock-slot${slotReserved ? '' : ' is-collapsed'}`} aria-hidden="true">
            <div className={`lys-dock-hint${dock.dragging && !dock.docked ? ' is-shown' : ''}${dock.expect ? ' is-expect' : ''}`}>여기에 도킹</div>
          </div>
        )}
      </div>

      {sheet && (mobile ?
        <LyricsSheet key={sheet.trackId} spotifyTrackId={sheet.trackId} meta={sheet.meta} onClose={closeSheet} /> :
        (
            <>
              <div className={`lys-float-dim${dock.docked ? '' : ' is-shown'}`} aria-hidden="true" />
              <DockableLyricsSheet key={sheet.trackId} spotifyTrackId={sheet.trackId} meta={sheet.meta} onClose={closeSheet} hostRef={cardRef} dock={dock} patch={patchDock} />
            </>
          ))}
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
