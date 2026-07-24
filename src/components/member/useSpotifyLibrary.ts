// FEAT-spotify-library-sync — the member board's Spotify-library surface, pulled
// out of BucketBoard.tsx by REFACTOR-frontend-member-surface Step 4b. Owns the
// special bucket's sync state (banners + per-album source/state map), the
// listened-album archive (cover hint), and the manual-sync poll. Behavior
// unchanged: same fetch-once-on-mount effects, same debounced-sync poll loop.
//
// The board's tree refresh (bucketStore) is injected as `onSynced` so this hook
// stays decoupled from the store — after a real sync advances last_synced_at, it
// calls back to repaint the board with the newly pulled albums/badges.
import type { SpotifyLibraryAlbumState, SpotifyLibraryState } from './spotify.api'
import { useEffect, useMemo, useState } from 'react'
import { getSpotifyLibraryState, listListenedAlbums, syncSpotifyLibrary } from './spotify.api'

export interface SpotifyLibrarySurface {
  /** Sync state — banners (needs_reauth / writes_enabled) + the album source/state rows. */
  libState: SpotifyLibraryState | null
  /** album_id → sync row, for the cover source/state badges (derived from libState). */
  libAlbumMap: Map<string, SpotifyLibraryAlbumState>
  /** The member's cumulative listened-album set, for the "이미 들음 → 평론 가능" hint. */
  listenedAlbumIds: Set<string>
  /** True while a manual sync is in flight (drives the 동기화 button spinner). */
  syncing: boolean
  /** Enqueue the worker reconcile, poll until it lands, then repaint via onSynced. */
  runLibrarySync: () => Promise<void>
}

export function useSpotifyLibrary(onSynced: () => Promise<void>): SpotifyLibrarySurface {
  // The special bucket's sync state (banners + per-album source/state map) and
  // whether a manual sync is in flight.
  const [libState, setLibState] = useState<SpotifyLibraryState | null>(null)
  const [syncing, setSyncing] = useState(false)

  // FEAT-bucket-identity Direction B — the member's cumulative listened-album set
  // (album_id → "이미 들음"), fetched ONCE on mount to quietly hint which
  // not-yet-reviewed bucket covers are primed for a review. The board only ever
  // mounts on the self-dashboard, so this is inherently own-view-only. Empty set
  // on any error (401/404/network) — a transient failure simply leaves the covers
  // un-hinted (never blocks the board).
  const [listenedAlbumIds, setListenedAlbumIds] = useState<Set<string>>(() => new Set())

  // album_id → Spotify-library sync row, for the cover source/state badges.
  const libAlbumMap = useMemo(() => {
    const m = new Map<string, SpotifyLibraryAlbumState>()
    for (const a of libState?.albums ?? [])
      m.set(a.album_id, a)
    return m
  }, [libState])

  // Load the Spotify-library sync state (banners + per-album source/state map).
  // Worker-fed; the GET never calls Spotify (rule #9). A transient failure just
  // leaves the section unbadged — it never blocks the crate board.
  useEffect(() => {
    let alive = true
    getSpotifyLibraryState()
      .then(s => alive && setLibState(s))
      .catch(() => { /* non-fatal — board renders without badges */ })
    return () => {
      alive = false
    }
  }, [])

  // FEAT-bucket-identity Direction B — fetch the listened-album archive ONCE on
  // mount (no polling) for the "이미 들음 → 평론 가능" cover hint. Quiet no-op on
  // any error: 401/404/network just leaves the set empty (no hint, never blocks).
  useEffect(() => {
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
  }, [])

  // 동기화 — model on refreshRecent(): POST enqueues the worker reconcile (rule
  // #9, no synchronous Spotify call), then POLL /spotify-library/state until
  // last_synced_at advances past the pre-sync value (cap ~10 polls / ~20s), then
  // refetch the board + state so the new badges/pulled albums paint. A
  // 'debounced' response (a sync ran <30s ago) skips the poll. Best-effort: any
  // failure just clears the spinner — the next mount/poll reconciles.
  async function runLibrarySync(): Promise<void> {
    if (syncing)
      return
    setSyncing(true)
    const before = libState?.last_synced_at ?? null
    try {
      const { status } = await syncSpotifyLibrary()
      if (status === 'debounced') {
        setLibState(await getSpotifyLibraryState())
        return
      }
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 2000))
        const next = await getSpotifyLibraryState()
        setLibState(next)
        if (next.last_synced_at && next.last_synced_at !== before) {
          await onSynced()
          break
        }
      }
    }
    catch { /* non-fatal — clear the spinner, leave existing state in place */ }
    finally {
      setSyncing(false)
    }
  }

  return { libState, libAlbumMap, listenedAlbumIds, syncing, runLibrarySync }
}
