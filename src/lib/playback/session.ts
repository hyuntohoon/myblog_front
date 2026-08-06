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
import type { OwnershipMessage } from './ownership'
import { addBucketPlayback, deleteBucketItem, expandAlbumTracks } from '@lib/buckets'
import { bucketStore } from '@lib/pocketBuckit/bucketStore'
import { IN_PAGE_MESSAGE, MYBLOG_PLAYBACK_CHANGED, play, sendPlayerCommand } from '@lib/spotifyPlayback'
import { readLivePlayback } from '@components/member/lyrics/playback.api'
import { playbackOwnership } from './ownership'
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
  /**
   * Spotify album id — carried through so 앨범 정보 works for playback that never
   * touched our queue (started elsewhere, so there is no `BoardAlbum` row and
   * thus no DB album id). Resolved via the existing `resolveDbAlbumId`
   * (`@lib/spotifyCatalog`, `by-spotify`) rather than a new lookup.
   */
  spotifyAlbumId: string | null
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
  /** Only the owner owns the in-page SDK device and writes playback state. */
  isOwner: boolean
  ownerPresent: boolean
  /** The rung on which the owning tab last produced sound. */
  ownerRung: PlayRung | null
}

type SessionCommand =
	| { kind: 'play-at', itemId: string } |
	{ kind: 'toggle-play' } |
	{ kind: 'next' } |
	{ kind: 'previous' }

interface BroadcastSessionState {
  currentItemId: string | null
  /**
   * Carried across tabs for the same reason `currentItemId` is: after #348 the
   * session can be describing playback that matches no queue row, and that is the
   * only field saying so. Leaving it out would make a mirror render "nothing is
   * playing" while the owner is showing a track — worse than before mirroring,
   * because the mirror looks confidently wrong rather than empty.
   */
  external: ExternalNowPlaying | null
  playing: boolean
  anchor: { ms: number, anchorEpochMs: number } | null
  durationMs: number | null
  rung: PlayRung | null
  degraded: boolean
  device: PlaybackDevice | null
  notice: SessionNotice | null
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
  isOwner: false,
  ownerPresent: false,
  ownerRung: null,
}

const initialOwnership = playbackOwnership.getSnapshot()
let current: PlaybackSessionState = {
  ...EMPTY,
  isOwner: initialOwnership.isOwner,
  ownerPresent: initialOwnership.ownerPresent,
}
const listeners = new Set<() => void>()

function emit(): void {
  for (const cb of listeners) cb()
}

function patch(p: Partial<PlaybackSessionState>): void {
  current = { ...current, ...p }
  if (current.isOwner)
    current = { ...current, ownerRung: current.rung }
  emit()
  if (current.isOwner)
    broadcastState()
}

/**
 * Bumped by every LOCAL, authoritative write — a command WE issued and got an ok
 * back for (`playFrom`, `togglePlay`, `advance`, `onRemoved`). NOT bumped by
 * `adoptLive`'s own patch, which is a READ, not an action.
 *
 * This is the fix for the race the RFC's own Step 6b decisions log left open
 * ("our own transport races its own adoption... owner decision pending"):
 * `MYBLOG_PLAYBACK_CHANGED` fires the instant our command is ACKNOWLEDGED, but
 * `adoptLive()`'s subsequent `GET /me/player` can still land inside Spotify's
 * ack→apply window and read the PREVIOUS state — a stale answer arriving after
 * a fresher local write. Rather than guess how wide that window is (this RFC's
 * own rule: constants are measured, not guessed), a read simply discards itself
 * if a newer authoritative write happened while it was in flight — correct at
 * any window width, including one that varies per request.
 */
let localWriteSeq = 0

/**
 * BUG-26(a): true when the row currently anchored by `currentItemId` was matched
 * against a track id that more than one queue row shares (D8 legally allows
 * duplicate tracks in the queue, and Spotify's API gives no occurrence-instance id
 * to tell them apart). Set/cleared only where identity is actually (re)established:
 * `playFrom()` clears it (a direct index-based play is certain by construction),
 * `adoptLive()`'s track-id match sets it whenever more than one row still shares
 * the matched track — even across reads that keep landing on the same row via
 * continuity, since the duplicate coexisting is what makes the NEXT transition
 * away untrustworthy, not just this one. Consulted only by `adoptLive()`'s delete
 * gate — see BUG-26 there.
 */
let anchorAmbiguous = false

/**
 * BUG-23: `replaceQueueAndPlay()` chains onto this so a second ▶ press waits for
 * an in-flight one to fully settle (write, play, AND its deletes) before it takes
 * its own `rewriteQueue` snapshot. Without it, two overlapping presses — the
 * untested double-click race `AlbumOverlay.tsx`'s own comment already accepted —
 * each snapshot the SAME pre-press tree, so the second press's own diff wrongly
 * includes rows the first press had already added; `playFrom(0)` then names the
 * FIRST press's track as current no matter which press actually landed last. A
 * narrower fix that only guards the final `authoritativePatch` (this bug's
 * original recommendation in `ARCH-album-card-contract-and-composition.md` §19)
 * does NOT close this — confirmed by a delayed-promise regression test — because
 * the corruption happens upstream, in the snapshot itself. `.catch()` before
 * chaining so one press's rejection never wedges every later press behind it.
 */
let replaceChain: Promise<unknown> = Promise.resolve()

function authoritativePatch(p: Partial<PlaybackSessionState>): void {
  localWriteSeq += 1
  patch(p)
}

function broadcastState(): void {
  // `performance.now()` has a different origin in every document. Convert the
  // anchor wall time to epoch time before it crosses the tab boundary.
  const anchor = current.anchor ?
    {
        ms: current.anchor.ms,
        anchorEpochMs: Date.now() - (performance.now() - current.anchor.wallMs),
      } :
    null
  const state: BroadcastSessionState = {
    currentItemId: current.currentItemId,
    external: current.external,
    playing: current.playing,
    anchor,
    durationMs: current.durationMs,
    rung: current.rung,
    degraded: current.degraded,
    device: current.device,
    notice: current.notice,
  }
  playbackOwnership.post({ type: 'state', state })
}

function applyBroadcastState(payload: unknown): void {
  const state = payload as BroadcastSessionState
  // `performance.now()` has a different origin in every document. Rebuild the
  // sender's epoch anchor in this document's performance timeline.
  const anchor = state.anchor ?
    {
        ms: state.anchor.ms,
        wallMs: performance.now() - (Date.now() - state.anchor.anchorEpochMs),
      } :
    null
  patch({
    currentItemId: state.currentItemId,
    external: state.external,
    playing: state.playing,
    anchor,
    durationMs: state.durationMs,
    rung: state.rung,
    degraded: state.degraded,
    device: state.device,
    notice: state.notice,
    ownerRung: state.rung,
  })
}

async function gate(command: SessionCommand): Promise<boolean> {
  // Ownership decides who owns the SDK device and issues transport. It never
  // decides who may read or edit the queue: the queue is `bucketStore`'s
  // projection and stays fully interactive in every tab.
  if (current.isOwner)
    return true
  if (current.ownerPresent) {
    // Forward to the owner whatever rung it is on. Forwarding never raises a
    // second SDK device — that is the thing ownership exists to prevent — it
    // just asks the tab that already holds the device to act. Gating the
    // forward on rung would silently drop the command in every state where the
    // rung is not yet known: `advance()` resets `rung` to null when the queue
    // empties, so two tabs where one has played and stopped would leave the
    // other's drop doing nothing at all, in either tab. The rung decides what
    // this tab may OFFER (see `canControlPlayback`), not what it may ask for.
    playbackOwnership.post({ type: 'command', cmd: command })
    return false
  }
  return playbackOwnership.ensureOwner()
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
    authoritativePatch({ busy: false, notice: noticeForFailure(unresolvable) })
    return unresolvable
  }
  const r = await play({ kind: 'uris', uris })
  if (!r.ok) {
    // T2: a play failure PRESERVES the queue. Nothing is removed, nothing is
    // reordered — the rows stay exactly as they were and only the notice changes.
    authoritativePatch({ busy: false, notice: noticeForFailure(r) })
    return r
  }
  // AUTHORITATIVE: this is the local action's own confirmed result. `play()` just
  // dispatched `MYBLOG_PLAYBACK_CHANGED` (synchronously, before returning here),
  // which may already have kicked off an `adoptLive()` read — bumping the seq
  // HERE, before that read can land, is what makes it discard itself instead of
  // overwriting this with a stale answer.
  authoritativePatch({
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
  // A direct, index-based play is certain by construction — there is no guessing
  // involved, so any ambiguity carried over from a prior track-id match no longer
  // applies.
  anchorAmbiguous = false
  scheduleBoundaryCheck()
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
 *
 * BUG-26(a): the queue intentionally allows duplicate tracks (D8), and Spotify's API
 * gives no occurrence-instance id — so when more than one row shares the live track,
 * there is no signal that tells them apart. `anchorItemId` (the row already believed
 * current) is the only thing that can narrow it: if it is still among the matches,
 * the track simply has not changed under us and it is still that same occurrence.
 * Absent that, this falls back to the first match — a display-only best-effort guess,
 * never a claim of certainty — and callers MUST read `ambiguous` before trusting the
 * result for anything destructive (see `adoptLive()`'s delete gate).
 */
function rowForSpotifyTrack(
  spotifyTrackId: string | null,
  anchorItemId: string | null,
): { row: BoardAlbum | null, ambiguous: boolean } {
  if (!spotifyTrackId)
    return { row: null, ambiguous: false }
  const uri = `spotify:track:${spotifyTrackId}`
  const matches = queueRows().filter(r => r.trackId && cachedUri(r.trackId) === uri)
  if (matches.length === 0)
    return { row: null, ambiguous: false }
  if (matches.length === 1)
    return { row: matches[0], ambiguous: false }
  // Multiple rows share this track. Ambiguity is a property of the QUEUE (a
  // duplicate coexists), not of this one read — it stays true even when continuity
  // picks the same row again, because the next transition AWAY from it is exactly
  // where a wrong guess would otherwise cause a destructive delete.
  const anchored = anchorItemId ? matches.find(r => r.itemId === anchorItemId) : undefined
  return { row: anchored ?? matches[0], ambiguous: true }
}

// `BOUNDARY_BUFFER_MS` is a first-pass estimate (Spotify's own ack→apply lag,
// observed elsewhere in this RFC, plus margin), not a measured constant in the
// Step 7 sense — flagged in the RFC as a follow-up to measure for real. Used both
// by the rung-1 boundary-check scheduler below and, as of BUG-26, as `adoptLive()`'s
// own completion tolerance.
const BOUNDARY_BUFFER_MS = 1_500

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
  // Adoption is a WRITE to the session, sourced from a Spotify read. Only the owner
  // performs it: if every tab adopted independently they would be two writers racing
  // over one state, each overwriting the other's broadcast with its own slightly
  // older read, and the progress line would jitter between two anchors taken at
  // different instants. A mirror gets the same information for free — the owner
  // broadcasts the adopted state — so the read is not merely redundant, it is
  // harmful. With no owner at all, this tab is the only reader and proceeds.
  if (!current.isOwner && current.ownerPresent)
    return

  // The row this tab believes is sounding, BEFORE the read — captured now so a
  // completion can be detected against what we knew, not against whatever a
  // concurrent local write may have since changed it to. (Inlined rather than
  // `playbackSession.currentRow()` — that binding is defined later in the file.)
  const previousRowIndex = rowIndex(current.currentItemId)
  const previousRow = previousRowIndex < 0 ? null : queueRows()[previousRowIndex]
  const seqAtStart = localWriteSeq
  const live = await readLivePlayback()

  // A newer AUTHORITATIVE local write landed while this read was in flight — e.g.
  // this very read was triggered by `MYBLOG_PLAYBACK_CHANGED` off our own command,
  // and the read lands inside Spotify's ack→apply window with the PREVIOUS state.
  // Discard rather than apply: the fresher local write is already correct, and an
  // adoption is a read, never the tie-breaker over an action. See `localWriteSeq`.
  if (localWriteSeq !== seqAtStart)
    return

  // `unavailable` is a token/network failure, NOT "nothing is playing". Treating it
  // as silence would make a transient blip wipe a perfectly good current track —
  // the same distinction `readLivePlayback`'s own docstring insists on.
  if (live.state === 'unavailable')
    return

  // The row we thought was playing is no longer live — natural completion (or a
  // skip away from it that did not go through this session, e.g. another surface).
  // T2: "completion removes" the finished row. This is the ONE place that fires the
  // removal, replacing the never-called `onCompleted()` path — it is reached only
  // from a CONFIRMED read, never a timer reaching duration, which is exactly the bar
  // the RFC's own comment on `onCompleted` sets.
  //
  // BUG-26(b): a URI change is NOT the same claim as "the row finished". A
  // phone/native-client skip, or another surface changing the track mid-song, looks
  // identical to natural completion here — so before deleting, confirm the row's own
  // last-known position actually reached its end (within `BOUNDARY_BUFFER_MS`, the
  // same tolerance the boundary-check scheduler already uses for "close enough").
  // BUG-26(a): and if `previousRow` was itself only an ambiguous guess among
  // duplicate-track rows (`anchorAmbiguous`), it cannot be trusted to BE the row
  // that just finished at all — deleting it could destroy a never-played occurrence
  // while the one that actually played lingers, uncounted, in the queue.
  if (previousRow?.trackId) {
    const previousUri = cachedUri(previousRow.trackId)
    const liveUri = live.state !== 'idle' && live.trackId ? `spotify:track:${live.trackId}` : null
    if (previousUri && liveUri !== previousUri) {
      const fallbackDurationMs = previousRow.durationSec != null ? previousRow.durationSec * 1000 : null
      const previousDurationMs = current.durationMs ?? fallbackDurationMs
      const completed = previousDurationMs != null && positionNow() >= previousDurationMs - BOUNDARY_BUFFER_MS
      if (completed && !anchorAmbiguous) {
        const { bucket } = playbackQueue()
        if (bucket) {
          try {
            await deleteBucketItem(bucket.id, previousRow.itemId)
            bucketStore.setTree(withoutQueueItems(bucketStore.getTree(), bucket.id, [previousRow.itemId]))
          }
          catch {
            // Could not remove it — leave the row in place. The next adoption
            // (mount, or the next event) re-evaluates from scratch rather than
            // retrying here, so a transient delete failure never blocks playback.
          }
        }
      }
    }
  }

  if (live.state === 'idle') {
    patch({ playing: false, external: null, currentItemId: null })
    anchorAmbiguous = false
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

  // Row lookup runs against the (possibly just-shrunk) live queue, so a completed
  // row can never be "found" again — the deletion above always lands first.
  // `current.currentItemId` is still `previousRow`'s id here (nothing has patched
  // it yet this call) — passing it as the anchor is what lets a live track that
  // hasn't actually changed stay resolved to the SAME occurrence instead of
  // re-guessing via first-match every read (BUG-26a).
  const { row, ambiguous } = rowForSpotifyTrack(live.trackId, current.currentItemId)
  if (row) {
    patch({ currentItemId: row.itemId, external: null, playing, anchor, durationMs: live.durationMs })
    anchorAmbiguous = ambiguous
    scheduleBoundaryCheck()
    return
  }
  anchorAmbiguous = false
  patch({
    currentItemId: null,
    external: {
      title: live.track,
      artist: live.artist,
      spotifyTrackId: live.trackId,
      spotifyAlbumId: live.albumSpotifyId,
      deviceName: live.deviceName,
    },
    playing,
    anchor,
    durationMs: live.durationMs,
  })
  scheduleBoundaryCheck()
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
    authoritativePatch({ currentItemId: null })
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
   * Spotify track id for whatever the session believes is sounding, or null.
   * `external` already carries one; a queue-matched row only has the DB id, so
   * it goes through the same cache-only reverse lookup `rowForSpotifyTrack`
   * uses in the other direction — never triggers a resolve, so a cold cache is
   * a null here rather than a request (ARCH-entity-interaction-domain-audit
   * Step 3c: this is how a consumer, e.g. the lyrics viewer, confirms the
   * session's anchor is actually for the track it has open before trusting it).
   */
  currentSpotifyTrackId(): string | null {
    if (current.external)
      return current.external.spotifyTrackId
    const row = playbackSession.currentRow()
    if (!row?.trackId)
      return null
    const uri = cachedUri(row.trackId)
    return uri?.startsWith('spotify:track:') ? uri.slice('spotify:track:'.length) : null
  },

  /**
   * A drop landed. T2's whole drop rule lives here:
   *   · nothing current  → the first dropped track starts immediately;
   *   · playing OR PAUSED, queue-anchored OR external → append only, never interrupt.
   *
   * Paused counts as busy on purpose — resuming someone's paused queue because they
   * dropped a track is the interruption the rule exists to prevent.
   *
   * BUG-29: `currentItemId` alone is null for BOTH "nothing playing" and "something
   * IS playing, just not from our queue" (`external`) — the same distinction
   * `togglePlay()`/`externalAdvance()` already treat as first-class. A drop landing
   * during genuinely external playback must append, not interrupt it.
   *
   * The write has ALREADY happened when this is called (write first, play after), so
   * a play failure here cannot roll the write back — and must not try to.
   */
  async onDropped(): Promise<void> {
    if (current.currentItemId !== null || current.external !== null)
      return // playing or paused, queue-anchored or external → append only
    const rows = queueRows()
    if (rows.length === 0)
      return
    await playbackSession.playAt(rows[0].itemId)
  },

  /** Play from a specific row (a tap on the queue). Re-issues our own tail from there. */
  async playAt(itemId: string): Promise<void> {
    const i = queueRows().findIndex(r => r.itemId === itemId)
    if (i >= 0 && (current.isOwner || await gate({ kind: 'play-at', itemId })))
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
    // BUG-23: this press waits for any still-in-flight press ahead of it — see
    // `replaceChain`. Queued here, before the lease/tree work below, so a second
    // press's `rewriteQueue` snapshot can never be taken while an earlier press's
    // own snapshot-to-settle window is still open.
    const run = async (): Promise<ReplaceOutcome> => {
      // ▶ is the most explicit "make sound HERE" there is, and this path can reach
      // rung 2, which raises *this* tab as the SDK device. So it takes the lease
      // rather than forwarding: T4 makes an explicit claim unconditional precisely
      // so a deliberate press is never argued with. Forwarding instead would also
      // strand the Undo — the toast belongs to the tab that pressed, and its rows
      // were replaced by this tab's own rewrite.
      await playbackOwnership.ensureOwner()
      patch({ busy: true, notice: null })
      try {
        await bucketStore.ensureFresh()
        const { bucket } = playbackQueue()
        if (!bucket) {
          // No Playback Bucket ⇒ no queue to replace (the account is not playback
          // eligible). Still play: they asked for sound, and refusing here would be a
          // regression against the behaviour these call sites shipped with.
          const r = await play(intent)
          authoritativePatch({ busy: false, notice: r.ok ? null : noticeForFailure(r) })
          return { ok: r.ok, message: r.message, undo: null, play: r }
        }

        const rewrite = await rewriteQueue(bucket.id, () => appendIntent(bucket.id, intent))
        if (rewrite.added.length === 0) {
          // Nothing was written, so nothing was deleted — the queue is untouched.
          const message = intent.kind === 'album' ? NO_TRACKS : REPLACE_FAILED
          authoritativePatch({ busy: false, notice: { tone: 'error', message } })
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
        authoritativePatch({ busy: false, notice: { tone: 'error', message: REPLACE_FAILED } })
        return { ok: false, message: REPLACE_FAILED, undo: null, play: null }
      }
    }
    const settled = replaceChain.catch(() => undefined).then(run)
    replaceChain = settled
    return settled
  },

  async togglePlay(): Promise<void> {
    // Anything we can SEE, we can control. Gating this on `currentItemId` was the
    // shipped bug: a track playing from an album page or a phone showed up nowhere
    // and could not be paused from here. External playback is a first-class subject
    // of the transport, not a read-only curiosity.
    if (!current.currentItemId && !current.external)
      return
    if (!current.isOwner && !await gate({ kind: 'toggle-play' }))
      return
    patch({ busy: true })
    const r = await sendPlayerCommand({ kind: current.playing ? 'pause' : 'play' })
    if (!r.ok) {
      authoritativePatch({ busy: false, notice: noticeForCommand(r) })
      return
    }
    const nowPlaying = !current.playing
    // AUTHORITATIVE — this is exactly the RFC's own recorded bug ("start playback
    // and the panel shows ▶, pause and it snaps back to Ⅱ"): `sendPlayerCommand`
    // already dispatched `MYBLOG_PLAYBACK_CHANGED` before returning here, which may
    // already be mid-flight on a stale `adoptLive()` read. Bumping the seq now is
    // what makes that read discard itself instead of overwriting this.
    authoritativePatch({
      busy: false,
      playing: nowPlaying,
      // Freeze the clock where it stands on pause; re-anchor from there on resume.
      // Same trick NowPlaying uses — no extra read just to learn a position we know.
      anchor: current.anchor ? { ms: positionNow(), wallMs: performance.now() } : null,
      // Rung 2's quality limit is a session fact, not a one-action toast. Keep its
      // shipped sentence through successful transport changes until a full-quality
      // play replaces the session.
      notice: current.degraded ? { tone: 'degraded', message: IN_PAGE_MESSAGE } : null,
    })
    if (nowPlaying)
      scheduleBoundaryCheck()
    else
      clearBoundaryCheck()
  },

  /** Skip forward. Completion and an explicit skip are the same transition for the queue. */
  async next(): Promise<void> {
    if (!current.currentItemId && current.external)
      return externalAdvance('next')
    if (current.isOwner || await gate({ kind: 'next' }))
      await advance('skip')
  },

  async previous(): Promise<void> {
    if (!current.currentItemId && current.external)
      return externalAdvance('previous')
    const i = rowIndex(current.currentItemId)
    if (i > 0 && (current.isOwner || await gate({ kind: 'previous' })))
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
      await playbackSession.playAt(after[nextIdx].itemId)
      return
    }
    clearBoundaryCheck()
    authoritativePatch({ currentItemId: null, playing: false, anchor: null, rung: null, degraded: false })
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

  async takeOver(): Promise<void> {
    if (!await playbackOwnership.ensureOwner())
      return
    const i = rowIndex(current.currentItemId)
    if (i >= 0)
      await playFrom(i)
  },

  /** Test seam. */
  __reset(): void {
    clearBoundaryCheck()
    anchorAmbiguous = false
    const ownership = playbackOwnership.getSnapshot()
    current = {
      ...EMPTY,
      isOwner: ownership.isOwner,
      ownerPresent: ownership.ownerPresent,
    }
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

// ── rung-1 boundary check ──────────────────────────────────────────────────────
// Rung 2 (in-page SDK) gets a real push signal for "the track changed" —
// `player_state_changed`, wired in `spotifyPlayback.ts`. Rung 1 (Connect remote —
// the RFC's own words: "everything the owner actually uses is on this row") gets
// NONE: the device is not in this tab, so nothing here fires when a track ends
// naturally on it. D28 forbids a polling loop, not a single scheduled read at a
// known boundary — T3 already licenses "reads that are 1:1 with... a track
// boundary". This schedules exactly one `setTimeout` per track (cleared and
// re-armed at every real boundary: play, pause, skip, adopt), never a repeating
// interval, and the read it fires is the ordinary `adoptLive()` every other
// trigger uses — which verifies against a real read before treating anything as
// finished, so a wrong guess here costs one redundant read, not a false removal.
//
// `BOUNDARY_BUFFER_MS` is defined above `adoptLive()` now (BUG-26 reuses it there).
let boundaryTimer: ReturnType<typeof setTimeout> | null = null

function clearBoundaryCheck(): void {
  if (boundaryTimer !== null) {
    clearTimeout(boundaryTimer)
    boundaryTimer = null
  }
}

function scheduleBoundaryCheck(): void {
  clearBoundaryCheck()
  if (!current.isOwner || current.rung !== 'remote' || !current.playing)
    return
  const i = rowIndex(current.currentItemId)
  const row = i < 0 ? null : queueRows()[i]
  const duration = current.durationMs ?? (row?.durationSec != null ? row.durationSec * 1000 : null)
  if (duration == null)
    return
  const remaining = duration - positionNow()
  const delay = Math.max(500, remaining + BOUNDARY_BUFFER_MS)
  boundaryTimer = setTimeout(() => {
    boundaryTimer = null
    if (current.isOwner && current.rung === 'remote')
      void adoptLive()
  }, delay)
}

/**
 * BUG-27: next()/previous() during `external` playback (playing, but not anchored
 * to a queue row — `currentItemId` is null in this state too, same as truly idle).
 * There is no row to advance to, so the only correct action is the same raw
 * transport command `togglePlay()` already sends for this state — "anything we can
 * SEE, we can control" applies to skip exactly as much as it does to pause.
 */
async function externalAdvance(cause: 'next' | 'previous'): Promise<void> {
  if (!current.isOwner && !await gate({ kind: cause }))
    return
  patch({ busy: true })
  const r = await sendPlayerCommand({ kind: cause })
  authoritativePatch({ busy: false, notice: r.ok ? null : noticeForCommand(r) })
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
    clearBoundaryCheck()
    authoritativePatch({ currentItemId: null, playing: false, anchor: null, rung: null, degraded: false })
    return
  }
  await playFrom(nextIdx)
}

async function executeCommand(command: SessionCommand): Promise<void> {
  if (!current.isOwner)
    return
  if (command.kind === 'play-at')
    await playbackSession.playAt(command.itemId)
  else if (command.kind === 'toggle-play')
    await playbackSession.togglePlay()
  else if (command.kind === 'next')
    await playbackSession.next()
  else
    await playbackSession.previous()
}

function syncOwnership(): void {
  const ownership = playbackOwnership.getSnapshot()
  const wasOwner = current.isOwner
  const ownerArrived = !current.ownerPresent && ownership.ownerPresent
  const ownerRung = ownership.isOwner ?
    current.rung :
    ownership.ownerPresent ?
      (wasOwner ? current.rung : current.ownerRung) :
      null
  patch({
    isOwner: ownership.isOwner,
    ownerPresent: ownership.ownerPresent,
    ownerRung,
  })
  // Only the owner schedules a boundary check (same reasoning as `adoptLive`
  // being owner-only) — losing ownership must not leave a stale timer armed to
  // fire in a tab that is now a mirror.
  if (!ownership.isOwner)
    clearBoundaryCheck()
  else if (wasOwner !== ownership.isOwner)
    scheduleBoundaryCheck()
  if (!ownership.isOwner && (wasOwner || ownerArrived))
    playbackOwnership.post({ type: 'sync-request' })
}

function handleOwnershipMessage(message: OwnershipMessage): void {
  if (message.type === 'state') {
    const owner = playbackOwnership.getSnapshot()
    if (!current.isOwner && owner.ownerTabId === message.from)
      applyBroadcastState(message.state)
  }
  else if (message.type === 'command') {
    void executeCommand(message.cmd as SessionCommand)
  }
  else if (message.type === 'sync-request' && current.isOwner) {
    broadcastState()
  }
}

playbackOwnership.subscribe(syncOwnership)
playbackOwnership.onMessage(handleOwnershipMessage)
if (!current.isOwner)
  playbackOwnership.post({ type: 'sync-request' })

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
