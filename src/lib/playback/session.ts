// FEAT-playback-bucket-player Step 6 — the playback SESSION.
//
// One observable singleton in the `bucketStore` idiom, subscribed by both player
// forms. The rule that shapes this whole file: **the session holds only what the
// bucket tree does not**. Current item, play state, position anchor, rung/degraded,
// device, capability tier. NOT the queue — that is `lib/playback/queue.ts`'s
// projection over `bucketStore`, and duplicating it here would recreate exactly the
// drift `bucketStore` was built to end (three independent tree copies, Step 5's
// header comment spells it out).
//
// Every play/transport call goes through the shipped ladder (`@lib/spotifyPlayback`).
// This module never touches the provider player endpoint — defining it outside
// `lib/spotifyPlayback.ts` is a Step 6 review gate, because "a second play path by
// accident" is the RFC's first named risk.
//
// It also never calls `queueTrack()`. Starting at position n re-issues our own tail
// (`play({kind:'uris', …})`), so Spotify's queue is never written and there is no
// divergence to reconcile — T2, and the non-goal says it out loud so a later session
// does not "simplify" it back.
import type { BoardAlbum, BoardBucket } from '@lib/buckets'
import type { ClockAnchor } from '@lib/clockEstimate'
import type { PlaybackDevice, PlayerCommandOutcome, PlayFailure, PlayRung } from '@lib/spotifyPlayback'
import { deleteBucketItem } from '@lib/buckets'
import { bucketStore } from '@lib/pocketBuckit/bucketStore'
import { IN_PAGE_MESSAGE, MYBLOG_PLAYBACK_CHANGED, play, sendPlayerCommand } from '@lib/spotifyPlayback'
import { playbackQueue } from './queue'
import { prefetchUris, resolveTail } from './uris'

/** How the last play/transport attempt ended, as ONE sentence the forms render verbatim. */
export interface SessionNotice {
  tone: 'info' | 'degraded' | 'error'
  message: string
  /** Present on failure — the shipped taxonomy, never a new string. */
  reason?: PlayFailure['reason']
}

export interface PlaybackSessionState {
  /** The row we believe is sounding, by `review_bucket_items.id`. Null = nothing started. */
  currentItemId: string | null
  playing: boolean
  /** Position anchor, shared with the lyrics viewer (`@lib/clockEstimate`). */
  anchor: ClockAnchor | null
  durationMs: number | null
  /** Which rung produced sound, and whether the caller must say it is quality-limited. */
  rung: PlayRung | null
  degraded: boolean
  device: PlaybackDevice | null
  /** One sentence about the last attempt. Cleared on the next successful action. */
  notice: SessionNotice | null
  /** A play/transport call is in flight — the forms disable transport rather than double-fire. */
  busy: boolean
}

const EMPTY: PlaybackSessionState = {
  currentItemId: null,
  playing: false,
  anchor: null,
  durationMs: null,
  rung: null,
  degraded: false,
  device: null,
  notice: null,
  busy: false,
}

let current: PlaybackSessionState = EMPTY
const listeners = new Set<() => void>()

function emit(): void {
  for (const cb of listeners) cb()
}

function patch(p: Partial<PlaybackSessionState>): void {
  current = { ...current, ...p }
  emit()
}

/** The queue, live off the shared store. Never cached here — see the header. */
function queueRows(): BoardAlbum[] {
  return playbackQueue().items
}

function rowIndex(itemId: string | null): number {
  if (!itemId)
    return -1
  return queueRows().findIndex(r => r.itemId === itemId)
}

/** A row is playable only if it carries a track id — the server guarantees it, but a bad row must not crash a play. */
function trackIdsFrom(rows: BoardAlbum[]): string[] {
  return rows.flatMap(r => (r.trackId ? [r.trackId] : []))
}

/** Remove one membership from a nested tree after its DELETE has been confirmed. */
function withoutItem(tree: BoardBucket[], bucketId: string, itemId: string): BoardBucket[] {
  return tree.map(b => ({
    ...b,
    albums: b.id === bucketId ? b.albums.filter(a => a.itemId !== itemId) : b.albums,
    children: b.children.length ? withoutItem(b.children, bucketId, itemId) : b.children,
  }))
}

function noticeForFailure(f: PlayFailure): SessionNotice {
  // `play()` already wrote one Korean sentence per reason. Re-wording them here
  // would fork the copy and is exactly what the RFC forbids ("none becomes a
  // generic 재생 실패"), so the message passes through untouched.
  return { tone: 'error', message: f.message, reason: f.reason }
}

/**
 * Transport failures, unlike play failures, carry NO sentence — `PlayerCommandOutcome`
 * is `reason` only. So the copy has to come from somewhere, and the somewhere is the
 * shipped player bar (`NowPlaying.handleControlFailure`), verbatim. Writing a fresh
 * sentence here would put two different messages on the same failure depending on
 * which surface the member happened to be looking at.
 */
function noticeForCommand(r: Exclude<PlayerCommandOutcome, { ok: true }>): SessionNotice {
  if (r.reason === 'no-capability')
    return { tone: 'error', message: '이 계정/기기에선 재생 제어를 사용할 수 없어요', reason: 'no-capability' }
  if (r.reason === 'token')
    return { tone: 'error', message: '제어에 실패했어요. 잠시 후 다시 시도해 주세요', reason: 'token' }
  return { tone: 'error', message: '제어에 실패했어요. 잠시 후 다시 시도해 주세요', reason: 'transient' }
}

/**
 * Play the tail starting at `index`, and adopt it as the current item.
 *
 * ALWAYS the whole tail: `uris` REPLACES Spotify's context, so sending a lone track
 * would silently discard every queued row after it (`queueJump.ts` protects the same
 * property and says so in the same words).
 */
async function playFrom(index: number): Promise<void> {
  const rows = queueRows()
  const head = rows[index]
  if (!head)
    return
  patch({ busy: true })
  const uris = await resolveTail(trackIdsFrom(rows.slice(index)))
  if (uris.length === 0) {
    patch({
      busy: false,
      notice: { tone: 'error', message: '이 곡을 재생할 수 없어요.', reason: 'unresolvable' },
    })
    return
  }
  const r = await play({ kind: 'uris', uris })
  if (!r.ok) {
    // T2: a play failure PRESERVES the queue. Nothing is removed, nothing is
    // reordered — the rows stay exactly as they were and only the notice changes.
    patch({ busy: false, notice: noticeForFailure(r) })
    return
  }
  patch({
    busy: false,
    currentItemId: head.itemId,
    playing: true,
    rung: r.rung,
    degraded: r.degraded,
    anchor: { ms: 0, wallMs: performance.now() },
    durationMs: null,
    // Rung 2 MUST say it is degraded — the shipped ladder makes that the caller's
    // obligation and both forms are callers. `IN_PAGE_MESSAGE` is that sentence.
    notice: r.degraded ? { tone: 'degraded', message: IN_PAGE_MESSAGE } : null,
  })
}

export const playbackSession = {
  subscribe(cb: () => void): () => void {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
  getSnapshot(): PlaybackSessionState {
    return current
  },
  /** SSR — both forms are client-only, so this only guards hydration. */
  getServerSnapshot(): PlaybackSessionState {
    return EMPTY
  },

  /** The row the session believes is sounding, or null. Resolved against the LIVE tree. */
  currentRow(): BoardAlbum | null {
    const i = rowIndex(current.currentItemId)
    return i < 0 ? null : queueRows()[i]
  },

  /**
   * A drop landed. T2's whole drop rule lives here:
   *   · nothing current  → the first dropped track starts immediately;
   *   · playing OR PAUSED → append only, never interrupt.
   *
   * Paused counts as busy on purpose — resuming someone's paused queue because they
   * dropped a track is the interruption the rule exists to prevent.
   *
   * The write has ALREADY happened when this is called (write first, play after), so
   * a play failure here cannot roll the write back — and must not try to.
   */
  async onDropped(): Promise<void> {
    if (current.currentItemId !== null)
      return // playing or paused → append only
    const rows = queueRows()
    if (rows.length === 0)
      return
    await playFrom(0)
  },

  /** Play from a specific row (a tap on the queue). Re-issues our own tail from there. */
  async playAt(itemId: string): Promise<void> {
    const i = queueRows().findIndex(r => r.itemId === itemId)
    if (i >= 0)
      await playFrom(i)
  },

  async togglePlay(): Promise<void> {
    if (!current.currentItemId)
      return
    patch({ busy: true })
    const r = await sendPlayerCommand({ kind: current.playing ? 'pause' : 'play' })
    if (!r.ok) {
      patch({ busy: false, notice: noticeForCommand(r) })
      return
    }
    patch({
      busy: false,
      playing: !current.playing,
      // Freeze the clock where it stands on pause; re-anchor from there on resume.
      // Same trick NowPlaying uses — no extra read just to learn a position we know.
      anchor: current.anchor ? { ms: positionNow(), wallMs: performance.now() } : null,
      // Rung 2's quality limit is a session fact, not a one-action toast. Keep its
      // shipped sentence through successful transport changes until a full-quality
      // play replaces the session.
      notice: current.degraded ? { tone: 'degraded', message: IN_PAGE_MESSAGE } : null,
    })
  },

  /** Skip forward. Completion and an explicit skip are the same transition for the queue. */
  async next(): Promise<void> {
    await advance('skip')
  },

  async previous(): Promise<void> {
    const i = rowIndex(current.currentItemId)
    if (i > 0)
      await playFrom(i - 1)
  },

  /**
   * The track finished. T2: its row is DELETED and the next becomes current.
   *
   * Only ever called from a CONFIRMED track change — never from a timer reaching
   * duration. Auto-removal is destructive (the RFC names it as a risk), and a bad
   * "finished" signal would delete a row the user still wanted.
   */
  async onCompleted(): Promise<void> {
    await advance('completed')
  },

  /**
   * A row was removed by the user. If it was the current one, advance to what took
   * its place (and keep playing if we were playing) — T2's "removing the current
   * item advances".
   */
  async onRemoved(itemId: string): Promise<void> {
    if (itemId !== current.currentItemId)
      return
    const wasPlaying = current.playing
    const rows = queueRows()
    const i = rows.findIndex(r => r.itemId === itemId)
    const { bucket } = playbackQueue()
    // The DELETE endpoint does not mutate bucketStore. Remove the confirmed
    // membership here, while its old index is still knowable, so that index now
    // addresses the successor rather than replaying the deleted row.
    if (bucket && i >= 0)
      bucketStore.setTree(withoutItem(bucketStore.getTree(), bucket.id, itemId))
    const after = queueRows()
    const nextIdx = i >= 0 ? i : 0
    if (nextIdx < after.length && wasPlaying) {
      await playFrom(nextIdx)
      return
    }
    patch({ currentItemId: null, playing: false, anchor: null, rung: null, degraded: false })
  },

  /** Warm the tail's URIs while the user is looking at the queue, so a tap costs no request. */
  prefetch(): void {
    void prefetchUris(trackIdsFrom(queueRows()))
  },

  setDevice(device: PlaybackDevice | null): void {
    patch({ device })
  },

  dismissNotice(): void {
    patch({ notice: null })
  },

  /** Test seam. */
  __reset(): void {
    current = EMPTY
    emit()
  },
}

/** Current estimated position, in ms, from the anchor. */
function positionNow(): number {
  const a = current.anchor
  if (!a)
    return 0
  return current.playing ? a.ms + (performance.now() - a.wallMs) : a.ms
}

/**
 * Move off the current row.
 *
 * `completed` deletes the finished row first (T2), `skip` leaves it in place — a
 * user pressing ⏭ is navigating, not discarding. Both then play whatever now sits
 * at the current position.
 */
async function advance(cause: 'completed' | 'skip'): Promise<void> {
  const rows = queueRows()
  const i = rowIndex(current.currentItemId)
  if (i < 0)
    return

  if (cause === 'completed') {
    const done = rows[i]
    const { bucket } = playbackQueue()
    if (bucket && done) {
      try {
        await deleteBucketItem(bucket.id, done.itemId)
        // Membership delete only — the source album/track is untouched. The
        // non-destructive-membership invariant still holds.
        bucketStore.setTree(
          bucketStore.getTree().map(b =>
            b.id === bucket.id ? { ...b, albums: b.albums.filter(a => a.itemId !== done.itemId) } : b,
          ),
        )
      }
      catch {
        // The row could not be removed. Advance anyway rather than replaying the
        // finished track — a stuck delete must not trap playback on one song.
      }
    }
  }

  const after = queueRows()
  // After a completion the finished row is gone, so index `i` IS the next track.
  // After a skip it is still there, so the next track is `i + 1`.
  const nextIdx = cause === 'completed' ? i : i + 1
  if (nextIdx >= after.length) {
    patch({ currentItemId: null, playing: false, anchor: null, rung: null, degraded: false })
    return
  }
  await playFrom(nextIdx)
}

// ── transport echo ───────────────────────────────────────────────────────────
// `MYBLOG_PLAYBACK_CHANGED` fires for Connect plays AND (since front #342) for
// transport commands, so another surface pausing the same account is reflected here
// rather than leaving the panel claiming it is still playing. Registered once, at
// module scope, because the session is a singleton and both forms share it.
if (typeof window !== 'undefined') {
  window.addEventListener(MYBLOG_PLAYBACK_CHANGED, () => {
    // Deliberately narrow: the event says "something changed", not what. Re-reading
    // live state belongs to the surfaces that already do a one-shot read; here it
    // only invalidates the anchor so the progress line stops asserting a position it
    // can no longer vouch for.
    if (current.currentItemId)
      patch({ anchor: current.anchor ? { ms: positionNow(), wallMs: performance.now() } : null })
  })
}
