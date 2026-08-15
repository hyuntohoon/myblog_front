// ARCH-global-playback-experience Step 5 — the persistent compact playback
// surface (Open question 1, owner decision 2026-08-15: option (b)). A thin
// site-wide strip, mounted alongside `PocketTray` inside `PocketBuckit`'s
// always-mounted root so it shares that root's `transition:persist` (no
// remount / audio interruption across a client-side navigation — the same
// guarantee `FEAT-member-player` Step 5b proved for the underlying session)
// and its `PocketBuckitProvider` context, without a second always-mounted
// React root.
//
// No new player logic: identity + transport are the exact `PlaybackIdentity`/
// `PlaybackTransport` building blocks `PlaybackMini`/`PlaybackPanel` already
// render, reading the same `session.ts` singleton. Clicking the bar opens the
// Playback Bucket's existing mini drawer via `usePocket()` — the identical
// path the tray's own tile already uses — never a new queue or a new session.
import type { PlaybackSessionState } from '@lib/playback/session'
import { useEffect } from 'react'
import { findPlaybackBucket } from '@lib/playback/queue'
import { useBucketStore } from '@lib/pocketBuckit/bucketStore'
import { usePocket } from '../pocket/PocketBuckitProvider'
import { canControlPlayback, PlaybackIdentity, PlaybackTransport, usePlaybackViewModel } from './PlaybackPanel'

// Survey reference (`FEAT-playback-bucket-player` Step 6): SoundCloud 48px /
// Apple Music 54–61px / Genius 80–107px at 390. Sits at the compact end of
// that range — identity + transport only, no queue.
export const PERSISTENT_BAR_HEIGHT_PX = 56

/** `session.ts` reports something sounding — queue-matched or not. */
export function isPersistentBarVisible(state: PlaybackSessionState): boolean {
  return state.currentItemId != null || state.external != null
}

export function PlaybackPersistentBar() {
  const model = usePlaybackViewModel()
  const store = useBucketStore()
  const { setOpen, openDrawer } = usePocket()
  const visible = isPersistentBarVisible(model.state)

  // Mirrors the `--pbp-dock-w` contract `PlaybackPanel` already sets on
  // `<html>` (`layout.astro`'s own comment: "This shell is the one content
  // owner that yields that width") — `.site-shell` reads this one the same
  // way, so the page reserves the bar's height instead of it overlapping
  // whatever is at the top of the route.
  useEffect(() => {
    document.documentElement.style.setProperty('--pb-bar-h', visible ? `${PERSISTENT_BAR_HEIGHT_PX}px` : '0px')
    return () => document.documentElement.style.setProperty('--pb-bar-h', '0px')
  }, [visible])

  if (!visible)
    return null

  const bucketId = findPlaybackBucket(store.tree)?.id ?? null
  const openPlayer = () => {
    setOpen(true)
    if (bucketId)
      openDrawer(bucketId)
  }
  const canControl = canControlPlayback(model.state)

  return (
    <div className="pb-persistent-bar" role="region" aria-label="재생 중">
      <button type="button" className="pb-persistent-bar-identity" onClick={openPlayer} aria-label="재생 패널 열기">
        <PlaybackIdentity row={model.current} external={model.state.external} compact />
      </button>
      <PlaybackTransport state={model.state} canControl={canControl} />
    </div>
  )
}

export default PlaybackPersistentBar
