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
import type { BoardAlbum } from '@lib/buckets'
import type { ClockAnchor } from '@lib/clockEstimate'
import type { PlaybackDevice, PlayerCommandOutcome, PlayFailure, PlayOutcome, PlayRung } from '@lib/spotifyPlayback'
import { addBucketPlayback, deleteBucketItem, expandAlbumTracks } from '@lib/buckets'
import { bucketStore } from '@lib/pocketBuckit/bucketStore'
import { IN_PAGE_MESSAGE, MYBLOG_PLAYBACK_CHANGED, play, sendPlayerCommand } from '@lib/spotifyPlayback'
import { readLivePlayback } from '@components/member/lyrics/playback.api'
import { playbackQueue, withoutQueueItems } from './queue'
import { cachedUri, prefetchUris, resolveTail } from './uris'

/** How the last play/transport attempt ended, as ONE sentence the forms render verbatim. */
export interface SessionNotice {
  tone: 'info' | 'degraded' | 'error'
  message: string
  /** Present on failure — the shipped taxonomy, never a new string. */
  reason?: PlayFailure['reason']
}

/**
 * Something is playing that is NOT one of our queue rows — started from an album
 * page, another surface, the phone, a speaker, anywhere.
 *
 * This exists because the RFC's own non-goal says it must: *"the Buckit list is
 * authoritative for what we enqueued; **Spotify is authoritative for what is
 * playing**"*. Step 6 shipped only the first half — the panel could describe
 * nothing but playback it had started itself, so the owner found (2026-08-03) that
 * playing an album had no relationship to the queue and that the panel could not
 * control whatever was actually sounding.
 *
 * Being outside the queue never disables transport. A player that can see what is
 * playing but refuses to pause it is the bug, not the feature.
 */
export interface ExternalNowPlaying {
  title: string | null
  artist: string | null
  /** Spotify track id, so a later queue read can still match it to a row. */
  spotifyTrackId: string | null
  deviceName: string | null
}

export interface PlaybackSessionState {
  /** The row we believe is sounding, by `review_bucket_items.id`. Null = nothing started. */
  currentItemId: string | null
  /**
   * Set when live playback could NOT be matched to a queue row. Mutually exclusive
   * with `currentItemId` — the panel renders whichever is present, and the transport
   * behaves identically either way.
   */
  external: ExternalNowPlaying | null
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
  external: null,
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
async function playFrom(index: number): Promise<PlayOutcome | null> {
  const rows = queueRows()
  const head = rows[index]
  if (!head)
    return null
  patch({ busy: true })
  const uris = await resolveTail(trackIdsFrom(rows.slice(index)))
  if (uris.length === 0) {
    const unresolvable: PlayFailure = { ok: false, reason: 'unresolvable', message: '이 곡을 재생할 수 없어요.' }
    patch({ busy: false, notice: noticeForFailure(unresolvable) })
    return unresolvable
  }
  const r = await play({ kind: 'uris', uris })
  if (!r.ok) {
    // T2: a play failure PRESERVES the queue. Nothing is removed, nothing is
    // reordered — the rows stay exactly as they were and only the notice changes.
    patch({ busy: false, notice: noticeForFailure(r) })
    return r
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
  return r
}

/**
 * Find the queue row whose track is `spotifyTrackId`, using URIs already resolved
 * by `lib/playback/uris.ts`.
 *
 * Deliberately cache-ONLY (`cachedUri`, never `resolveUri`): matching must not fire
 * a request per row, and an unmatched row simply falls through to the external
 * branch, which is a correct outcome rather than a failure. The panel prefetches the
 * visible queue anyway, so by the time this runs the URIs are usually known.
 */
function rowForSpotifyTrack(spotifyTrackId: string | null): BoardAlbum | null {
  if (!spotifyTrackId)
    return null
  const uri = `spotify:track:${spotifyTrackId}`
  return queueRows().find(r => r.trackId && cachedUri(r.trackId) === uri) ?? null
}

/**
 * Ask Spotify what is actually playing and adopt it.
 *
 * ONE read, never a loop — D28 (no polling) is upheld: this runs when the panel
 * opens and when `MYBLOG_PLAYBACK_CHANGED` fires, both of which are 1:1 with a user
 * action or a track boundary.
 *
 * Adoption is deliberately non-destructive to the queue: it changes what the session
 * believes is sounding, never the rows. A track playing from somewhere else does
 * not get appended, removed, or reordered into our list.
 */
async function adoptLive(): Promise<void> {
  const live = await readLivePlayback()

  // `unavailable` is a token/network failure, NOT "nothing is playing". Treating it
  // as silence would make a transient blip wipe a perfectly good current track —
  // the same distinction `readLivePlayback`'s own docstring insists on.
  if (live.state === 'unavailable')
    return

  if (live.state === 'idle') {
    patch({ playing: false, external: null })
    return
  }

  // `paused` carries the full track payload and MUST be adopted, not folded into
  // idle: someone pausing on their phone should leave this panel showing that track
  // with a working ▶, which is the whole point of adopting external playback.
  // (`NowPlaying` folded paused into idle until 2026-08-03 and cleared its own card
  // in response to its own pause — the same trap.)
  const playing = live.state === 'playing'
  // Anchor on `readAtMs`, not `performance.now()`: Spotify stamps the position
  // somewhere inside the request window, and that field is the measured midpoint.
  // Using "whenever we got around to it" is what makes a progress line drift.
  const anchor: ClockAnchor | null = typeof live.progressMs === 'number' ?
    { ms: live.progressMs, wallMs: live.readAtMs } :
    null

  const row = rowForSpotifyTrack(live.trackId)
  if (row) {
    patch({ currentItemId: row.itemId, external: null, playing, anchor, durationMs: live.durationMs })
    return
  }
  patch({
    currentItemId: null,
    external: {
      title: live.track,
      artist: live.artist,
      spotifyTrackId: live.trackId,
      deviceName: live.deviceName,
    },
    playing,
    anchor,
    durationMs: live.durationMs,
  })
}

// ── replacing the queue ──────────────────────────────────────────────────────
// The owner's finding after using Step 6 (2026-08-03): "playing an album has no
// relationship to the queue", and "it has to work from a track too". Both were the
// same shape as the third finding the first half of this step already fixed —
// every ▶ in the product went straight to `play()` and never touched the session,
// so the queue described one thing while the speakers played another.
//
// The decision (owner, same day): **▶ REPLACES the queue and plays it.** Not
// append, not "play without touching the queue" — the thing you pressed becomes
// the queue. Which makes every play in the product pass through one place, so the
// panel is right by construction rather than by adoption.
//
// Replacing is destructive, so it comes with an Undo (the shipped bucket-local
// idiom — `AddToBucketMenu`'s toast + 되돌리기 — never a confirm dialog; this RFC
// closed OQ3 by choosing exactly that trade).

/** What a ▶ press means. A strict subset of `PlayIntent`, so it needs no conversion. */
export type ReplaceIntent =
	| { kind: 'album', albumId: string, title?: string } |
	{ kind: 'track', trackId: string, title?: string }

/** What the caller's existing toast needs: one sentence, and an Undo when one applies. */
export interface ReplaceOutcome {
  ok: boolean
  message: string
  /** Non-null only when a non-empty queue was actually displaced. */
  undo: (() => Promise<UndoOutcome>) | null
  /** The ladder's own outcome, when a play was attempted — call sites already branch on it. */
  play: PlayOutcome | null
}

export interface UndoOutcome { ok: boolean, message: string }

const REPLACE_FAILED = '재생 대기열을 바꾸지 못했어요'
const UNDO_FAILED = '이전 대기열을 되돌리지 못했어요'
/** Reused verbatim from the board's album-expansion path — one sentence per situation. */
const NO_TRACKS = '이 앨범은 아직 트랙 정보가 없어요'

interface QueueRewrite {
  /** Rows that appeared. Empty ⇒ nothing was written AND nothing was deleted. */
  added: BoardAlbum[]
  /** Track ids of the rows being displaced, in order — the Undo payload. */
  displacedTrackIds: string[]
  /** The displaced rows' DELETEs, still in flight. Resolves with how many failed. */
  settle: Promise<number>
}

/**
 * Make the queue hold whatever `append` writes, and nothing else.
 *
 * **Write first, delete second — never the other way round.** There is no bulk
 * delete (a replacement is N+1 requests) and any of them can fail. Deleting first
 * would put that failure window on an EMPTY queue: old rows gone, new rows never
 * written, nothing to play and nothing left to undo. Appending first means the
 * worst case is a queue holding both lists — visibly wrong, but nothing is lost,
 * which is the half of T2's "failures preserve" rule that actually matters.
 */
async function rewriteQueue(bucketId: string, append: () => Promise<void>): Promise<QueueRewrite> {
  const before = queueRows()
  const beforeIds = before.map(r => r.itemId)
  const displacedTrackIds = trackIdsFrom(before)

  await append()

  // The write happened server-side; the new rows' item ids only exist there.
  await bucketStore.ensureFresh(true)
  const added = queueRows().filter(r => !beforeIds.includes(r.itemId))
  if (added.length === 0)
    return { added, displacedTrackIds, settle: Promise.resolve(0) }

  // Show the replacement NOW. The deletes below are the slow part, and nobody
  // should have to watch their old queue drain a row at a time while the new one
  // is already playing.
  bucketStore.setTree(withoutQueueItems(bucketStore.getTree(), bucketId, beforeIds))
  return { added, displacedTrackIds, settle: deleteRows(bucketId, beforeIds) }
}

/**
 * Delete the displaced rows, ONE AT A TIME.
 *
 * Sequential rather than concurrent on purpose: `position` is server-assigned, and
 * firing N deletes at a list the server is simultaneously renumbering is a race
 * nobody here has measured. The latency is invisible — audio is already playing by
 * the time this runs. A failure means the optimistic prune above lied, so the truth
 * is refetched rather than left as a pretty fiction.
 */
async function deleteRows(bucketId: string, itemIds: string[]): Promise<number> {
  let failed = 0
  for (const id of itemIds) {
    try {
      await deleteBucketItem(bucketId, id)
    }
    catch {
      failed += 1
    }
  }
  if (failed > 0)
    await bucketStore.ensureFresh(true)
  return failed
}

/** The append half of a ▶: an album expands to its tracks in album order, a track is one row. */
async function appendIntent(bucketId: string, intent: ReplaceIntent): Promise<void> {
  if (intent.kind === 'album') {
    await expandAlbumTracks(bucketId, intent.albumId)
    return
  }
  await addBucketPlayback(bucketId, intent.trackId)
}

/**
 * Re-append a snapshot's tracks. Sequential, because `position` is append order —
 * restoring a queue concurrently would scramble the very order it is restoring.
 */
async function appendTracks(bucketId: string, trackIds: string[]): Promise<void> {
  for (const id of trackIds)
    await addBucketPlayback(bucketId, id)
}

function replacedMessage(intent: ReplaceIntent, count: number, failedDeletes: number, degraded: boolean): string {
  const head = intent.kind === 'album' ?
    `재생 대기열을 이 앨범 ${count}곡으로 바꿨어요` :
    '재생 대기열을 이 곡으로 바꿨어요'
  // Rung 2's quality limit was said by the surfaces this replaces; keep saying it.
  const tail = degraded ? ` · ${IN_PAGE_MESSAGE}` : ''
  return failedDeletes > 0 ? `${head} · 이전 ${failedDeletes}곡은 지우지 못했어요${tail}` : `${head}${tail}`
}

/**
 * Put the displaced queue back.
 *
 * The same primitive pointed the other way: append the snapshot, delete whatever
 * the replacement left. It deliberately does NOT restart the old audio. The harm
 * being undone is the lost queue; cutting off the album the member just started
 * would be a second surprise, not a reversal of the first. Instead the session
 * re-reads live playback, so the panel honestly reports the now-unqueued track as
 * playing outside the queue — the state the first half of this step shipped for.
 */
async function undoReplace(bucketId: string, trackIds: string[]): Promise<UndoOutcome> {
  try {
    const rewrite = await rewriteQueue(bucketId, () => appendTracks(bucketId, trackIds))
    if (rewrite.added.length === 0)
      return { ok: false, message: UNDO_FAILED }
    await rewrite.settle
    // The restored rows are NEW memberships, so the id the session was holding
    // addresses a row that no longer exists. Clear it before asking what is live.
    patch({ currentItemId: null })
    await syncFromLive()
    return { ok: true, message: '이전 재생 대기열로 되돌렸어요' }
  }
  catch {
    return { ok: false, message: UNDO_FAILED }
  }
}

/**
 * Adopt whatever is actually sounding.
 *
 * Prefetches first so the URI match can succeed: `rowForSpotifyTrack` is cache-only
 * by design, and without warm URIs a track that IS in the queue would be
 * misreported as external on the very first read.
 */
async function syncFromLive(): Promise<void> {
  await prefetchUris(trackIdsFrom(queueRows()))
  await adoptLive()
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

  /**
   * A ▶ was pressed on an album or a track: that becomes the queue, and it plays.
   *
   * The single entry every ▶ in the product routes through, which is the point —
   * before this, three surfaces called `play()` directly and the queue had no idea.
   *
   * Ordering, and why it is this way:
   *   1. read the tree (the surfaces owning a ▶ may never have loaded it, and the
   *      Playback Bucket is minted lazily on that first read);
   *   2. append the replacement, refresh, prune the old rows optimistically;
   *   3. **play from the new head** — audio starts before the deletes finish;
   *   4. settle the deletes, then hand back an Undo.
   *
   * The Undo is offered only after step 4 on purpose: it re-adds the old tracks and
   * deletes the new ones, so letting it run while the original deletes are still in
   * flight would race two rewrites over one list and could leave duplicates.
   */
  async replaceQueueAndPlay(intent: ReplaceIntent): Promise<ReplaceOutcome> {
    patch({ busy: true, notice: null })
    try {
      await bucketStore.ensureFresh()
      const { bucket } = playbackQueue()
      if (!bucket) {
        // No Playback Bucket ⇒ no queue to replace (the account is not playback
        // eligible). Still play: they asked for sound, and refusing here would be a
        // regression against the behaviour these call sites shipped with.
        const r = await play(intent)
        patch({ busy: false, notice: r.ok ? null : noticeForFailure(r) })
        return { ok: r.ok, message: r.message, undo: null, play: r }
      }

      const rewrite = await rewriteQueue(bucket.id, () => appendIntent(bucket.id, intent))
      if (rewrite.added.length === 0) {
        // Nothing was written, so nothing was deleted — the queue is untouched.
        const message = intent.kind === 'album' ? NO_TRACKS : REPLACE_FAILED
        patch({ busy: false, notice: { tone: 'error', message } })
        return { ok: false, message, undo: null, play: null }
      }

      const outcome = await playFrom(0)
      const failedDeletes = await rewrite.settle
      const undo = rewrite.displacedTrackIds.length > 0 ?
        () => undoReplace(bucket.id, rewrite.displacedTrackIds) :
        null

      if (!outcome || !outcome.ok) {
        // The queue WAS replaced — that write succeeded and stands. Only the play
        // failed, so its own sentence is what the member needs, and the Undo is
        // still offered because their old queue is still gone.
        return { ok: false, message: outcome?.message ?? REPLACE_FAILED, undo, play: outcome }
      }
      return {
        ok: true,
        message: replacedMessage(intent, rewrite.added.length, failedDeletes, outcome.degraded),
        undo,
        play: outcome,
      }
    }
    catch {
      // A write threw before any delete ran, so the queue is exactly as it was.
      patch({ busy: false, notice: { tone: 'error', message: REPLACE_FAILED } })
      return { ok: false, message: REPLACE_FAILED, undo: null, play: null }
    }
  },

  async togglePlay(): Promise<void> {
    // Anything we can SEE, we can control. Gating this on `currentItemId` was the
    // shipped bug: a track playing from an album page or a phone showed up nowhere
    // and could not be paused from here. External playback is a first-class subject
    // of the transport, not a read-only curiosity.
    if (!current.currentItemId && !current.external)
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
      bucketStore.setTree(withoutQueueItems(bucketStore.getTree(), bucket.id, [itemId]))
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

  /** Adopt whatever is actually playing — call when a player surface becomes visible. */
  syncFromLive,

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
    // The event says "something changed", not what — so ASK. This used to only
    // re-anchor the clock, which meant a play started anywhere else (an album page,
    // the phone, a speaker) left the panel describing whatever it had started last,
    // or nothing at all. One read, fired by an event that is already 1:1 with a real
    // transition, so D28 (no polling) still holds.
    void adoptLive()
  })
}
