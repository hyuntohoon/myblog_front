// FEAT-spotify-library-sync — the member board's Spotify-library surface, pulled
// out of BucketBoard.tsx by REFACTOR-frontend-member-surface Step 4b. Owns the
// special bucket's sync state (banners + per-album source/state map), the
// listened-album archive (cover hint), and the sync poll.
//
// FEAT-spotify-library-autosync: the sync now runs on every board ENTRY (mount
// while active, or the tab becoming active again) instead of only from the 동기화
// button. What keeps that from stacking Spotify reads is the server's run-row gate
// (POST answers queued / in_flight / debounced — one outstanding job at a time,
// and a POST right after a finish is a no-op); the client adds only what the
// server cannot see: one loop per hook, no POST from a hidden page, a poll that
// pauses while hidden, stops when the board leaves, and dies with the component.
//
// The board's tree refresh (bucketStore) is injected as `onSynced` so this hook
// stays decoupled from the store — after a real sync advances last_synced_at, it
// calls back to repaint the board with the newly pulled albums/badges.
import type { SpotifyLibraryAlbumState, SpotifyLibraryState } from './spotify.api'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getSpotifyLibraryState, listListenedAlbums, syncSpotifyLibrary } from './spotify.api'

// Poll cadence while the server reports the pass in flight. The cap only bounds
// THIS loop; the server's 5-minute stale window is what frees a lost request.
const POLL_MS = 2000
const POLL_CAP = 45

export interface SpotifyLibrarySurface {
  /** Sync state — banners (needs_reauth / writes_enabled) + the album source/state rows. */
  libState: SpotifyLibraryState | null
  /** album_id → sync row, for the cover state badge + saved-time sort (derived from libState). */
  libAlbumMap: Map<string, SpotifyLibraryAlbumState>
  /** The member's cumulative listened-album set, for the "이미 들음 → 평론 가능" hint. */
  listenedAlbumIds: Set<string>
  /** True while a sync (automatic or manual) is being waited on. */
  syncing: boolean
  /** Request a sync, poll until the server says it finished, then repaint via onSynced. */
  runLibrarySync: () => Promise<void>
}

/** Resolve after `ms`, then keep waiting while the page is hidden. */
function sleepVisible(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      if (typeof document === 'undefined' || !document.hidden) {
        resolve()
        return
      }
      const onVis = () => {
        if (!document.hidden) {
          document.removeEventListener('visibilitychange', onVis)
          resolve()
        }
      }
      document.addEventListener('visibilitychange', onVis)
    }, ms)
  })
}

/**
 * @param onSynced Repaints the board (bucketStore) after a pass changed the library.
 * @param isOwner SEC-member-listening-data-boundary Step 1. Every read this hook
 * makes is owner-global: `GET /api/buckets/spotify-library/state` was already
 * `require_owner`, and `GET /api/library/listened-albums` became so in this step.
 * Both the entry sync and the manual sync are refused for a non-owner.
 *
 * This is the surface the RFC's own table missed. The comment below used to
 * reason "the board only ever mounts on the self-dashboard, so this is inherently
 * own-view-only" — and that is precisely the assumption this RFC exists to
 * disprove: `SelfDashboard` mounts for EVERY signed-in member, while the data
 * behind it is the owner's. Before the server gate, a member opening My Buckit
 * fetched the owner's 200 listened albums and stamped their OWN bucket covers
 * "이미 들음" from the owner's history.
 *
 * Gating it here rather than leaning on the 403 is deliberate: the backend PR's
 * rollback is "revert the PR", and a client that still asks would silently resume
 * leaking the moment it were reverted.
 * @param active The board is the visible dashboard tab. Becoming active is an
 * "entry" and requests a sync; leaving stops the poll.
 */
export function useSpotifyLibrary(onSynced: () => Promise<void>, isOwner: boolean, active = true): SpotifyLibrarySurface {
  const [libState, setLibState] = useState<SpotifyLibraryState | null>(null)
  const [syncing, setSyncing] = useState(false)

  // FEAT-bucket-identity Direction B — the OWNER's cumulative listened-album set
  // (album_id → "이미 들음"), fetched ONCE on mount to quietly hint which
  // not-yet-reviewed bucket covers are primed for a review. Owner-only: the set is
  // read from an owner-global table, so for anyone else it stays empty and the
  // covers are simply un-hinted. Empty set on any error (401/403/404/network) too —
  // a transient failure never blocks the board.
  const [listenedAlbumIds, setListenedAlbumIds] = useState<Set<string>>(() => new Set())

  const mountedRef = useRef(true)
  const activeRef = useRef(active)
  const loopRef = useRef(false)
  const onSyncedRef = useRef(onSynced)
  activeRef.current = active
  onSyncedRef.current = onSynced
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // album_id → Spotify-library sync row, for the cover state badge + saved-time sort.
  const libAlbumMap = useMemo(() => {
    const m = new Map<string, SpotifyLibraryAlbumState>()
    for (const a of libState?.albums ?? [])
      m.set(a.album_id, a)
    return m
  }, [libState])

  // FEAT-bucket-identity Direction B — fetch the listened-album archive ONCE on
  // mount (no polling) for the "이미 들음 → 평론 가능" cover hint. Quiet no-op on
  // any error: 401/404/network just leaves the set empty (no hint, never blocks).
  useEffect(() => {
    if (!isOwner)
      return
    let alive = true
    listListenedAlbums()
      .then((items) => {
        if (!alive)
          return
        const ids = new Set<string>()
        for (const it of items) {
          if (it.album_id)
            ids.add(it.album_id)
        }
        setListenedAlbumIds(ids)
      })
      .catch(() => { /* non-fatal — covers render without the listened hint */ })
    return () => {
      alive = false
    }
  }, [isOwner])

  // POST (enqueue only — rule #9, no synchronous Spotify call), read the state, and
  // while the server says the pass is in flight, poll it. The board is repainted
  // only when last_synced_at moved — it advances exclusively on rows a pass
  // changed, so a steady library costs no tree refetch. Best-effort throughout:
  // any failure clears the spinner and leaves the last good state in place.
  const runLibrarySync = useCallback(async (): Promise<void> => {
    // Owner-only action (`POST /api/buckets/spotify-library/sync` is require_owner).
    if (!isOwner || loopRef.current)
      return
    loopRef.current = true
    setSyncing(true)
    try {
      let status: string | null = null
      try {
        status = (await syncSpotifyLibrary()).status
      }
      catch { /* still read the state below — the board needs it either way */ }
      if (!mountedRef.current)
        return
      let state = await getSpotifyLibraryState()
      if (!mountedRef.current)
        return
      const changedBefore = state.last_synced_at
      setLibState(state)
      if (status === 'debounced' || status == null)
        return
      for (let i = 0; i < POLL_CAP && state.sync_in_flight; i++) {
        await sleepVisible(POLL_MS)
        if (!mountedRef.current || !activeRef.current)
          return
        state = await getSpotifyLibraryState()
        if (!mountedRef.current)
          return
        setLibState(state)
      }
      if (!state.sync_in_flight && state.last_synced_at !== changedBefore)
        await onSyncedRef.current()
    }
    catch { /* non-fatal — clear the spinner, leave existing state in place */ }
    finally {
      loopRef.current = false
      if (mountedRef.current)
        setSyncing(false)
    }
  }, [isOwner])

  // Entry sync: once per entry (mount while active / the tab turning active). A
  // hidden page does not POST until it is shown.
  useEffect(() => {
    if (!isOwner || !active)
      return
    if (typeof document !== 'undefined' && document.hidden) {
      const onVis = () => {
        if (!document.hidden) {
          document.removeEventListener('visibilitychange', onVis)
          void runLibrarySync()
        }
      }
      document.addEventListener('visibilitychange', onVis)
      return () => document.removeEventListener('visibilitychange', onVis)
    }
    void runLibrarySync()
  }, [isOwner, active, runLibrarySync])

  return { libState, libAlbumMap, listenedAlbumIds, syncing, runLibrarySync }
}
