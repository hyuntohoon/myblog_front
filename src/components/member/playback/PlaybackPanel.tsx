import type { RefObject } from 'react'
import type { BoardAlbum, BoardBucket } from '@lib/buckets'
import type { PlaybackSessionState } from '@lib/playback/session'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { deleteBucketItem } from '@lib/buckets'
import { fetchAlbumDetail, getCachedAlbumDetail } from '@lib/albumDetail'
import { useClockEstimate } from '@lib/clockEstimate'
import { INITIAL_DOCK, useDockTear } from '@lib/dockTear'
import { openAlbum } from '@lib/entityEvents'
import { playbackQueue } from '@lib/playback/queue'
import { playbackSession } from '@lib/playback/session'
import { bucketStore, useBucketStore } from '@lib/pocketBuckit/bucketStore'
import { useDismissable } from '@lib/useDismissable'
import { useScrollLock } from '@lib/useScrollLock'

const DOCK_WIDTH = 380
const FLOAT_WIDTH = 420
const FLOAT_HEIGHT = 760
const FLOAT_MARGIN = 8

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

function albumIdFor(row: BoardAlbum | null): string | null {
  return row?.trackAlbumId ?? row?.albumId ?? null
}

export function openPlaybackAlbum(row: BoardAlbum | null): void {
  const albumId = albumIdFor(row)
  if (!row || !albumId)
    return
  openAlbum({ albumId, artist: row.artist, cover: row.cover, year: row.year })
}

export function PlaybackIdentity({ row, compact = false }: { row: BoardAlbum | null, compact?: boolean }) {
  const title = row?.title ?? '—'
  return (
    <div className={`pbp-identity${compact ? ' is-compact' : ''}`}>
      <div className="pbp-cover" aria-hidden={!row}>
        {row?.cover ?
          <img src={row.cover} alt="" /> :
          <span>{title.slice(0, 2)}</span>}
      </div>
      <div className="pbp-current-copy">
        <div className="pbp-current-title">{title}</div>
        <div className="pbp-current-artist">{row?.artist ?? '—'}</div>
      </div>
    </div>
  )
}

export function PlaybackTransport({ state }: { state: PlaybackSessionState }) {
  return (
    <div className="pbp-transport" role="group" aria-label="재생 제어">
      <button type="button" onClick={() => void playbackSession.previous()} disabled={state.busy || !state.currentItemId} aria-label="이전 곡">‹</button>
      <button type="button" className="pbp-play-toggle" onClick={() => void playbackSession.togglePlay()} disabled={state.busy || !state.currentItemId} aria-label={state.playing ? '일시정지' : '재생'}>
        {state.playing ? 'Ⅱ' : '▶'}
      </button>
      <button type="button" onClick={() => void playbackSession.next()} disabled={state.busy || !state.currentItemId} aria-label="다음 곡">›</button>
    </div>
  )
}

export function PlaybackEntries({ current, state, onOpenLyrics, onOpenTrackInfo }: PlaybackEntryProps & { current: BoardAlbum | null, state: PlaybackSessionState }) {
  return (
    <div className="pbp-entries" role="group" aria-label="현재 곡 정보">
      <button type="button" onClick={() => onOpenLyrics(current, state)}>가사</button>
      <button type="button" onClick={() => onOpenTrackInfo(current, state)}>트랙 정보</button>
      <button type="button" onClick={() => openPlaybackAlbum(current)}>앨범 정보</button>
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

function withoutQueueItem(tree: BoardBucket[], bucketId: string, itemId: string): BoardBucket[] {
  return tree.map(bucket => ({
    ...bucket,
    albums: bucket.id === bucketId ? bucket.albums.filter(row => row.itemId !== itemId) : bucket.albums,
    children: bucket.children.length ? withoutQueueItem(bucket.children, bucketId, itemId) : bucket.children,
  }))
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
    bucketStore.setTree(withoutQueueItem(bucketStore.getTree(), bucket.id, itemId))
  }
  catch {
    // The server did not confirm the membership change; leave the shared tree intact.
  }
}

export function PlaybackQueue({ model, limit, removable = false }: { model: PlaybackViewModel, limit?: number, removable?: boolean }) {
  const rows = limit == null ? model.queue : model.queue.slice(0, limit)
  return (
    <div className="pbp-queue" aria-label="재생 대기열">
      {rows.map((row, index) => {
        const current = row.itemId === model.state.currentItemId
        return (
          <div className="pbp-queue-row" data-current={current || undefined} key={row.itemId}>
            <button type="button" className="pbp-queue-play" onClick={() => void playbackSession.playAt(row.itemId)} disabled={model.state.busy}>
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
  return (
    <>
      <PlaybackIdentity row={model.current} />
      <PlaybackProgress model={model} />
      <PlaybackTransport state={model.state} />
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
  const [tab, setTab] = useState<'queue' | 'lyrics' | 'track' | 'album'>('queue')
  useDismissable(true, onClose, panelRef, { trapFocus: true })
  useScrollLock()

  const choose = (next: typeof tab) => {
    setTab(next)
    if (next === 'lyrics')
      entries.onOpenLyrics(model.current, model.state)
    else if (next === 'track')
      entries.onOpenTrackInfo(model.current, model.state)
    else if (next === 'album')
      openPlaybackAlbum(model.current)
  }

  return (
    <section ref={panelRef} className="pbp-panel is-mobile" role="dialog" aria-modal="true" aria-label="재생 대기열 플레이어">
      <div className="pbp-head">
        <span className="pbp-head-title">재생 대기열</span>
        <button type="button" className="pbp-close" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <div className="pbp-mobile-tabs" role="tablist" aria-label="플레이어 보기">
        {([
          ['queue', '대기열'],
          ['lyrics', '가사'],
          ['track', '트랙'],
          ['album', '앨범'],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => choose(id)}>{label}</button>
        ))}
      </div>
      <div className="pbp-body">
        <PlaybackIdentity row={model.current} />
        <PlaybackProgress model={model} />
        <PlaybackTransport state={model.state} />
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

  useEffect(() => {
    document.documentElement.style.setProperty('--pbp-dock-w', dock.docked ? `${DOCK_WIDTH}px` : '0px')
    return () => document.documentElement.style.setProperty('--pbp-dock-w', '0px')
  }, [dock.docked])

  return (
    <>
      <div ref={slotRef} className="pbp-dock-slot" aria-hidden="true">
        <div className={`pbp-dock-hint${dock.dragging && !dock.docked ? ' is-shown' : ''}${dock.expect ? ' is-expect' : ''}`}>여기에 도킹</div>
      </div>
      <section ref={panelRef} className={`pbp-panel${dock.docked ? ' is-docked' : ' is-float'}`} role="region" aria-label="재생 대기열 플레이어">
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
