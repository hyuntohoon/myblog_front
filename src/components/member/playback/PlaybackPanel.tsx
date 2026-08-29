import type { RefObject } from 'react'
import type { BoardAlbum } from '@lib/buckets'
import type { ExternalNowPlaying, PlaybackSessionState } from '@lib/playback/session'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { deleteBucketItem, reorderItems } from '@lib/buckets'
import { fetchAlbumDetail, getCachedAlbumDetail } from '@lib/albumDetail'
import { useClockEstimate } from '@lib/clockEstimate'
import { INITIAL_DOCK, useDockTear } from '@lib/dockTear'
import { openAlbum } from '@lib/entityEvents'
import { playbackQueue, withoutQueueItems, withReorderedQueueItems } from '@lib/playback/queue'
import { playbackSession } from '@lib/playback/session'
import { canControlPlayback } from '@lib/playback/ownership'
import { bucketStore, useBucketStore } from '@lib/pocketBuckit/bucketStore'
import { resolveDbAlbumId } from '@lib/spotifyCatalog'
import { useDismissable } from '@lib/useDismissable'
import { useScrollLock } from '@lib/useScrollLock'

const DOCK_WIDTH = 380
const FLOAT_WIDTH = 420
const FLOAT_HEIGHT = 760
const FLOAT_MARGIN = 8

/** `GlobalPlaybackBar`'s queue button reads this via `aria-controls`. */
export const GLOBAL_PLAYBACK_PANEL_ID = 'global-playback-panel'

export type PlaybackEntryHandler = (row: BoardAlbum | null, state: PlaybackSessionState) => void

export interface PlaybackEntryProps {
  onOpenLyrics: PlaybackEntryHandler
  onOpenTrackInfo: PlaybackEntryHandler
}

interface PlaybackViewModel {
  state: PlaybackSessionState
  queue: BoardAlbum[]
  current: BoardAlbum | null
  elapsedMs: number
  durationMs: number | null
}

/** Both the mini and expanded forms subscribe to the same session and tree projection. */
export function usePlaybackViewModel(): PlaybackViewModel {
  const state = useSyncExternalStore(
    playbackSession.subscribe,
    playbackSession.getSnapshot,
    playbackSession.getServerSnapshot,
  )
  const store = useBucketStore()
  const queue = useMemo(() => playbackQueue().items, [store.tree])
  const current = useMemo(
    () => queue.find(row => row.itemId === state.currentItemId) ?? null,
    [queue, state.currentItemId],
  )
  const currentAlbumId = albumIdFor(current)
  const [resolvedCover, setResolvedCover] = useState<string | null>(null)
  useEffect(() => {
    if (!current || current.cover || !currentAlbumId) {
      setResolvedCover(current?.cover ?? null)
      return
    }
    let alive = true
    const cached = getCachedAlbumDetail(currentAlbumId)
    setResolvedCover(cached?.album.cover_url ?? null)
    void fetchAlbumDetail(currentAlbumId).then((detail) => {
      if (alive)
        setResolvedCover(detail?.album.cover_url ?? null)
    })
    return () => {
      alive = false
    }
  }, [current, currentAlbumId])
  const displayCurrent = useMemo(
    () => current && resolvedCover ? { ...current, cover: resolvedCover } : current,
    [current, resolvedCover],
  )
  const durationMs = state.durationMs ?? (current?.durationSec != null ? current.durationSec * 1000 : null)
  const elapsed = useClockEstimate(state.anchor, state.playing, durationMs)
  const queueKey = queue.map(row => `${row.itemId}:${row.trackId ?? ''}`).join('|')

  useEffect(() => {
    playbackSession.prefetch()
  }, [queueKey])

  // Adopt whatever is actually sounding the moment a player surface appears.
  //
  // Without this the panel could only ever describe playback IT had started, so
  // opening it while a track ran from an album page — or from the phone — showed a
  // stale row or nothing at all, with a dead transport beside it. One read on mount;
  // afterwards `MYBLOG_PLAYBACK_CHANGED` keeps it honest. Never a timer (D28).
  useEffect(() => {
    void playbackSession.syncFromLive()
  }, [])

  return { state, queue, current: displayCurrent, elapsedMs: elapsed ?? 0, durationMs }
}

function formatMs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms))
    return '—'
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function formatDuration(row: BoardAlbum): string {
  return row.durationSec == null ? '—' : formatMs(row.durationSec * 1000)
}

// Any unknown-duration row makes the sum itself unknowable, not just short by that
// one row — degrades the whole total to '—' rather than a silently-undercounted
// number, matching the per-row '—' fallback above.
function formatTotalDuration(rows: BoardAlbum[]): string {
  if (rows.length === 0 || rows.some(row => row.durationSec == null))
    return '—'
  return formatMs(rows.reduce((sum, row) => sum + (row.durationSec ?? 0) * 1000, 0))
}

function albumIdFor(row: BoardAlbum | null): string | null {
  return row?.trackAlbumId ?? row?.albumId ?? null
}

/**
 * `앨범 정보` for a queue row works from the row alone (`albumIdFor`). Playback
 * that never touched our queue (`external` — started elsewhere) has no
 * `BoardAlbum`, so before this fix the button silently no-opped for exactly the
 * playback the RFC's own adoption feature (#348) exists to describe — "album
 * info fails depending on how playback started". `ExternalNowPlaying` now
 * carries the Spotify album id (`adoptLive`, from the same one-shot read that
 * was already fetching it and dropping it), so it resolves through the SAME
 * `by-spotify` catalog lookup `NowPlaying`'s live artist/album links already use
 * — no new endpoint.
 */
export function openPlaybackAlbum(row: BoardAlbum | null, external?: ExternalNowPlaying | null): void {
  const albumId = albumIdFor(row)
  if (row && albumId) {
    openAlbum({ albumId, artist: row.artist, cover: row.cover, year: row.year })
    return
  }
  if (!row && external?.spotifyAlbumId) {
    void resolveDbAlbumId(external.spotifyAlbumId).then((id) => {
      if (id)
        openAlbum({ albumId: id, artist: external.artist ?? undefined })
    })
  }
}

/**
 * The current track — from a queue row, or from playback that is happening OUTSIDE
 * the queue (an album page, the phone, a speaker).
 *
 * The external branch is not a degraded state and is not styled as one: it is the
 * honest answer to "what is playing", and the transport beside it works. It only
 * says where it came from, because "왜 이 곡이 대기열에 없지" is the question a
 * member would otherwise be left holding.
 */
export function PlaybackIdentity({ row, external, compact = false }: {
  row: BoardAlbum | null
  external?: ExternalNowPlaying | null
  compact?: boolean
}) {
  const title = row?.title ?? external?.title ?? '—'
  const artist = row?.artist ?? external?.artist ?? '—'
  const cover = row?.cover ?? external?.albumCoverUrl ?? null
  return (
    <div className={`pbp-identity${compact ? ' is-compact' : ''}`}>
      <div className="pbp-cover" aria-hidden={!row && !external}>
        {cover ?
          <img src={cover} alt="" /> :
          <span>{title.slice(0, 2)}</span>}
      </div>
      <div className="pbp-current-copy">
        <div className="pbp-current-title">{title}</div>
        <div className="pbp-current-artist">{artist}</div>
        {external && (
          <div className="pbp-current-outside">
            {external.deviceName ? `${external.deviceName}에서 재생 중 · 대기열 밖` : '대기열 밖에서 재생 중'}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Re-exported, not defined here. The predicate moved to `lib/playback/session.ts`
 * (ARCH-playback-authority-convergence Step 1) so surfaces that cannot import this
 * panel — the lyrics viewer above all — can ask the same question instead of
 * shipping transport that bypasses the gate. This binding stays because every
 * existing importer takes it from here.
 */
export { canControlPlayback }

export function PlaybackTransport({ state, canControl }: { state: PlaybackSessionState, canControl: boolean }) {
  return (
    <div className="pbp-transport" role="group" aria-label="재생 제어">
      <button type="button" onClick={() => void playbackSession.previous()} disabled={!canControl || state.busy || (!state.currentItemId && !state.external)} aria-label="이전 곡">‹</button>
      <button type="button" className="pbp-play-toggle" onClick={() => void playbackSession.togglePlay()} disabled={!canControl || state.busy || (!state.currentItemId && !state.external)} aria-label={state.playing ? '일시정지' : '재생'}>
        {state.playing ? 'Ⅱ' : '▶'}
      </button>
      <button type="button" onClick={() => void playbackSession.next()} disabled={!canControl || state.busy || (!state.currentItemId && !state.external)} aria-label="다음 곡">›</button>
    </div>
  )
}

export function PlaybackOwnerBanner({ state }: { state: PlaybackSessionState }) {
  // Exactly the inverse of `canControlPlayback` — the one case transport is
  // withheld is the one case there is something to offer instead.
  if (canControlPlayback(state))
    return null
  return (
    <div className="pbp-owner-banner" role="status">
      <span>다른 탭에서 재생 중이에요</span>
      <button type="button" onClick={() => void playbackSession.takeOver()}>이 탭에서 재생하기</button>
    </div>
  )
}

export function PlaybackEntries({ current, state, onOpenLyrics, onOpenTrackInfo }: PlaybackEntryProps & { current: BoardAlbum | null, state: PlaybackSessionState }) {
  return (
    <div className="pbp-entries" role="group" aria-label="현재 곡 정보">
      <button type="button" onClick={() => onOpenLyrics(current, state)}>가사</button>
      <button type="button" onClick={() => onOpenTrackInfo(current, state)}>트랙 정보</button>
      <button type="button" onClick={() => openPlaybackAlbum(current, state.external)}>앨범 정보</button>
    </div>
  )
}

export function PlaybackNotices({ state, queue }: { state: PlaybackSessionState, queue: BoardAlbum[] }) {
  const retryId = state.currentItemId ?? queue[0]?.itemId ?? null
  return (
    <>
      {state.degraded && state.notice?.tone === 'degraded' && (
        <div className="pbp-notice is-degraded" role="status">{state.notice.message}</div>
      )}
      {state.notice?.tone === 'error' && (
        <div className="pbp-notice is-error" role="alert">
          <span>{state.notice.message}</span>
          <button type="button" disabled={!retryId || state.busy} onClick={() => retryId && void playbackSession.playAt(retryId)}>다시 시도</button>
        </div>
      )}
    </>
  )
}

async function removeQueueItem(itemId: string): Promise<void> {
  const { bucket } = playbackQueue()
  if (!bucket)
    return
  try {
    await deleteBucketItem(bucket.id, itemId)
    await playbackSession.onRemoved(itemId)
    // Non-current removals are outside the session transition; apply the confirmed
    // membership delete here. Current removal already did this, so the pass is idempotent.
    bucketStore.setTree(withoutQueueItems(bucketStore.getTree(), bucket.id, [itemId]))
  }
  catch {
    // The server did not confirm the membership change; leave the shared tree intact.
  }
}

/**
 * Persist a new row order for the queue: optimistic local reflow, then the
 * `PUT /reorder` round-trip. On failure, force a real refetch rather than leaving
 * the optimistic order stuck out of sync with the server (unlike `removeQueueItem`,
 * a rejected reorder has no safe "just leave it" fallback — the visible order would
 * silently lie about what plays next).
 */
async function persistQueueOrder(bucketId: string, itemIds: string[]): Promise<void> {
  bucketStore.setTree(withReorderedQueueItems(bucketStore.getTree(), bucketId, itemIds))
  try {
    await reorderItems([{ id: bucketId, item_ids: itemIds }])
  }
  catch {
    void bucketStore.ensureFresh(true)
  }
}

type QueueDropPlace = 'before' | 'after'

export function PlaybackQueue({ model, limit, removable = false }: { model: PlaybackViewModel, limit?: number, removable?: boolean }) {
  const rows = limit == null ? model.queue : model.queue.slice(0, limit)
  // Reorder/summary/play-all only apply to the full, untruncated queue — the
  // 3-row `PlaybackMini` preview stays a plain preview, matching its existing
  // "다음 N곡 더" truncation hint rather than growing a second summary concept.
  const full = limit == null
  const reorderable = full && rows.length > 1
  const listRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ itemId: string, startY: number, moved: boolean } | null>(null)
  const dropRef = useRef<{ overId: string | null, place: QueueDropPlace } | null>(null)
  const pendingFocusId = useRef<string | null>(null)
  const [drag, setDrag] = useState<{ itemId: string, overId: string | null, place: QueueDropPlace } | null>(null)
  const [liveMsg, setLiveMsg] = useState('')

  useEffect(() => {
    const id = pendingFocusId.current
    if (!id)
      return
    pendingFocusId.current = null
    listRef.current?.querySelector<HTMLButtonElement>(`[data-item-id="${id}"] .pbp-queue-handle`)?.focus()
  }, [rows])

  const commitReorder = (itemId: string, overId: string | null, place: QueueDropPlace) => {
    const bucketId = playbackQueue().bucket?.id
    if (!bucketId)
      return
    const ids = rows.map(row => row.itemId)
    const from = ids.indexOf(itemId)
    if (from < 0)
      return
    ids.splice(from, 1)
    const overIdx = overId ? ids.indexOf(overId) : -1
    if (overIdx < 0)
      ids.push(itemId)
    else
      ids.splice(place === 'after' ? overIdx + 1 : overIdx, 0, itemId)
    void persistQueueOrder(bucketId, ids)
  }

  const onHandleDown = (e: React.PointerEvent, itemId: string) => {
    dragRef.current = { itemId, startY: e.clientY, moved: false }
    dropRef.current = null
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onHandleMove = (e: React.PointerEvent) => {
    const s = dragRef.current
    if (!s)
      return
    if (!s.moved && Math.abs(e.clientY - s.startY) < 6)
      return
    s.moved = true
    const list = listRef.current
    if (!list)
      return
    const wraps = Array.from(list.querySelectorAll<HTMLElement>('[data-item-id]'))
    let overId: string | null = null
    let place: QueueDropPlace = 'before'
    for (const w of wraps) {
      const r = w.getBoundingClientRect()
      if (e.clientY >= r.top && e.clientY <= r.bottom) {
        overId = w.dataset.itemId ?? null
        place = e.clientY < r.top + r.height / 2 ? 'before' : 'after'
        break
      }
    }
    if (!overId && wraps.length) {
      const first = wraps[0].getBoundingClientRect()
      if (e.clientY < first.top) {
        overId = wraps[0].dataset.itemId ?? null
        place = 'before'
      }
      else {
        overId = wraps[wraps.length - 1].dataset.itemId ?? null
        place = 'after'
      }
    }
    const drop = { overId: overId === s.itemId ? null : overId, place }
    dropRef.current = drop
    setDrag({ itemId: s.itemId, overId: drop.overId, place: drop.place })
  }
  const onHandleUp = () => {
    const s = dragRef.current
    dragRef.current = null
    const drop = dropRef.current
    dropRef.current = null
    setDrag(null)
    if (s?.moved && drop?.overId)
      commitReorder(s.itemId, drop.overId, drop.place)
  }
  // A `pointercancel` (a system gesture or notification steals the pointer mid-drag)
  // is not a drop — clear the drag state without committing, or the drop-target
  // highlight is left stuck on whatever row was last hovered.
  const onHandleCancel = () => {
    dragRef.current = null
    dropRef.current = null
    setDrag(null)
  }
  const onHandleKey = (e: React.KeyboardEvent, itemId: string) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')
      return
    e.preventDefault()
    const idx = rows.findIndex(row => row.itemId === itemId)
    const target = e.key === 'ArrowUp' ? idx - 1 : idx + 1
    if (idx < 0 || target < 0 || target >= rows.length)
      return
    pendingFocusId.current = itemId
    setLiveMsg(`${rows[idx].title}을(를) ${e.key === 'ArrowUp' ? '위' : '아래'}로 옮겼어요`)
    commitReorder(itemId, rows[target].itemId, e.key === 'ArrowUp' ? 'before' : 'after')
  }

  return (
    <div className="pbp-queue" aria-label="재생 대기열">
      {full && rows.length > 0 && (
        <div className="pbp-queue-summary">
          <span>{`${rows.length}곡 · ${formatTotalDuration(rows)} 총 재생 시간`}</span>
          <button type="button" className="pbp-queue-playall" onClick={() => void playbackSession.playAt(rows[0].itemId)} disabled={model.state.busy}>전체재생</button>
        </div>
      )}
      {reorderable && <span className="pbp-sr-only" role="status" aria-live="polite">{liveMsg}</span>}
      <div ref={listRef} className="pbp-queue-rows">
        {rows.map((row, index) => {
          const current = row.itemId === model.state.currentItemId
          return (
            <div
	className="pbp-queue-row"
	data-current={current || undefined}
	data-item-id={row.itemId}
	data-drag-over={drag?.overId === row.itemId ? drag.place : undefined}
	key={row.itemId}
            >
              {reorderable && (
                <button
	type="button"
	className="pbp-queue-handle"
	aria-label={`${row.title} 순서 변경, 위/아래 화살표로 이동`}
	onPointerDown={e => onHandleDown(e, row.itemId)}
	onPointerMove={onHandleMove}
	onPointerUp={onHandleUp}
	onPointerCancel={onHandleCancel}
	onKeyDown={e => onHandleKey(e, row.itemId)}
                >
                  ⠿
                </button>
              )}
              <button type="button" className="pbp-queue-play" onClick={() => void playbackSession.playAt(row.itemId)} disabled={model.state.busy}>
                <span className="pbp-queue-cover" aria-hidden="true">
                  {row.cover ?
                    <img src={row.cover} alt="" /> :
                    <span>{row.title.slice(0, 2)}</span>}
                </span>
                <span className="pbp-queue-position" aria-label={current ? '현재 곡' : `${index + 1}번`}>
                  {current ?
                    (
                      <span className="pbp-eq" data-playing={model.state.playing || undefined} aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                    ) :
                    String(index + 1).padStart(2, '0')}
                </span>
                <span className="pbp-queue-title">{row.title}</span>
                <span className="pbp-queue-duration">{formatDuration(row)}</span>
              </button>
              {removable && (
                <button type="button" className="pbp-queue-remove" onClick={() => void removeQueueItem(row.itemId)} aria-label={`${row.title} 대기열에서 제거`}>×</button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PlaybackProgress({ model }: { model: PlaybackViewModel }) {
  const ratio = model.durationMs && model.durationMs > 0 ? Math.min(1, model.elapsedMs / model.durationMs) : 0
  return (
    <div className="pbp-progress">
      <span>{formatMs(model.elapsedMs)}</span>
      <span className="pbp-progress-track"><i style={{ width: `${ratio * 100}%` }} /></span>
      <span>{formatMs(model.durationMs)}</span>
    </div>
  )
}

function PlaybackContents({ entries, mobileTabs = false }: { entries: PlaybackEntryProps, mobileTabs?: boolean }) {
  const model = usePlaybackViewModel()
  const canControl = canControlPlayback(model.state)
  return (
    <>
      <PlaybackIdentity row={model.current} external={model.state.external} />
      <PlaybackProgress model={model} />
      <PlaybackOwnerBanner state={model.state} />
      <PlaybackTransport state={model.state} canControl={canControl} />
      {!mobileTabs && <PlaybackEntries current={model.current} state={model.state} {...entries} />}
      <PlaybackNotices state={model.state} queue={model.queue} />
      <PlaybackQueue model={model} removable />
    </>
  )
}

function useMobilePanel(): boolean {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)')
    const update = () => setMobile(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return mobile
}

function MobilePlaybackPanel({ onClose, ...entries }: PlaybackEntryProps & { onClose: () => void }) {
  const panelRef = useRef<HTMLElement>(null)
  const model = usePlaybackViewModel()
  const canControl = canControlPlayback(model.state)
  useDismissable(true, onClose, panelRef, { trapFocus: true, inertBackground: true })
  useScrollLock()

  return (
    <section id={GLOBAL_PLAYBACK_PANEL_ID} ref={panelRef} className="pbp-panel is-mobile" role="dialog" aria-modal="true" aria-label="재생 대기열 플레이어">
      <div className="pbp-head">
        <span className="pbp-head-title">재생 대기열</span>
        <button type="button" className="pbp-close" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      {/*
        `대기열` is the only view this sheet actually renders — 가사/트랙/앨범 are
        entry points into OTHER surfaces (the live lyrics viewer, a future track
        surface, the album overlay), the same as the desktop panel's
        `PlaybackEntries` buttons. They used to be marked up as `role="tab"` with
        `aria-selected`, which claimed an in-place content switch that never
        happened — every tab rendered the identical queue body underneath
        (confirmed symptom: mobile tabs not showing their own content). Plain
        action buttons here say exactly what they do.
      */}
      <div className="pbp-mobile-tabs" role="group" aria-label="플레이어 진입">
        <span className="pbp-mobile-tab-current" aria-current="true">대기열</span>
        <button type="button" onClick={() => entries.onOpenLyrics(model.current, model.state)}>가사</button>
        <button type="button" onClick={() => entries.onOpenTrackInfo(model.current, model.state)}>트랙 정보</button>
        <button type="button" onClick={() => openPlaybackAlbum(model.current, model.state.external)}>앨범 정보</button>
      </div>
      <div className="pbp-body">
        <PlaybackIdentity row={model.current} external={model.state.external} />
        <PlaybackProgress model={model} />
        <PlaybackOwnerBanner state={model.state} />
        <PlaybackTransport state={model.state} canControl={canControl} />
        <PlaybackNotices state={model.state} queue={model.queue} />
        <PlaybackQueue model={model} removable />
      </div>
    </section>
  )
}

function DesktopPlaybackPanel({ onClose, ...entries }: PlaybackEntryProps & { onClose: () => void }) {
  const slotRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const [dock, setDock] = useState(INITIAL_DOCK)
  const patchDock = useCallback((patch: Partial<typeof INITIAL_DOCK>) => setDock(value => ({ ...value, ...patch })), [])
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  useDismissable(true, onClose, panelRef, { trapFocus: false, autoFocus: false })

  const dockRect = useCallback(() => {
    const rect = slotRef.current?.getBoundingClientRect()
    return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null
  }, [])
  const floatSize = useCallback(() => ({
    width: Math.min(FLOAT_WIDTH, window.innerWidth - FLOAT_MARGIN * 2),
    height: Math.min(FLOAT_HEIGHT, window.innerHeight - FLOAT_MARGIN * 2),
  }), [])
  const clampPos = useCallback((left: number, top: number, width: number, height: number) => ({
    left: Math.max(FLOAT_MARGIN, Math.min(window.innerWidth - width - FLOAT_MARGIN, left)),
    top: Math.max(FLOAT_MARGIN, Math.min(window.innerHeight - height - FLOAT_MARGIN, top)),
  }), [])
  const restRect = useCallback(() => {
    const size = floatSize()
    return {
      ...size,
      left: Math.max(FLOAT_MARGIN, window.innerWidth - size.width - 28),
      top: Math.max(FLOAT_MARGIN, (window.innerHeight - size.height) / 2),
    }
  }, [floatSize])
  const inSlot = useCallback((x: number, y: number) => {
    const rect = slotRef.current?.getBoundingClientRect()
    return !!rect && x >= rect.left - 28 && x <= rect.right + 28 && y >= rect.top - 28 && y <= rect.bottom + 28
  }, [])
  const { handlers, togglePlacement } = useDockTear({
    panelRef,
    hostRef: slotRef as RefObject<HTMLElement | null>,
    dock,
    patch: patchDock,
    dockRect,
    floatSize,
    restRect,
    clampPos,
    inSlot,
    reducedMotion: reduced,
  })

  // Same `astro:after-swap` restore as `GlobalPlaybackBar`'s `--global-player-h` —
  // ClientRouter's `swapRootAttributes` strips this custom property off <html> on
  // every navigation, and nothing else re-applies it.
  useEffect(() => {
    const apply = () => {
      document.documentElement.style.setProperty('--pbp-dock-w', dock.docked ? `${DOCK_WIDTH}px` : '0px')
    }
    apply()
    document.addEventListener('astro:after-swap', apply)
    return () => {
      document.removeEventListener('astro:after-swap', apply)
      document.documentElement.style.setProperty('--pbp-dock-w', '0px')
    }
  }, [dock.docked])

  return (
    <>
      <div ref={slotRef} className="pbp-dock-slot" aria-hidden="true">
        <div className={`pbp-dock-hint${dock.dragging && !dock.docked ? ' is-shown' : ''}${dock.expect ? ' is-expect' : ''}`}>여기에 도킹</div>
      </div>
      <section id={GLOBAL_PLAYBACK_PANEL_ID} ref={panelRef} className={`pbp-panel${dock.docked ? ' is-docked' : ' is-float'}`} role="region" aria-label="재생 대기열 플레이어">
        <div className="pbp-head" {...handlers}>
          <span className="pbp-head-title">재생 대기열</span>
          <span className="pbp-head-actions">
            <button type="button" className="pbp-place" onClick={togglePlacement}>{dock.docked ? '⇱ 분리' : '⇲ 도킹'}</button>
            <button type="button" className="pbp-close" onClick={onClose} aria-label="닫기">✕</button>
          </span>
        </div>
        <div className="pbp-body">
          <PlaybackContents entries={entries} />
        </div>
      </section>
    </>
  )
}

export function PlaybackPanel(props: PlaybackEntryProps & { onClose: () => void }) {
  return useMobilePanel() ? <MobilePlaybackPanel {...props} /> : <DesktopPlaybackPanel {...props} />
}

export default PlaybackPanel
