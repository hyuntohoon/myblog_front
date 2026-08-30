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
import type { LivePlayback } from '@components/member/lyrics/playback.api'
import type { QueueEntry } from '@components/member/lyrics/queue.api'
import type { JumpContext, JumpOutcome } from '@components/member/lyrics/queueJump'
import type { TailRow } from './uris'
import type { ClockAnchor } from '@lib/clockEstimate'
import type { PlaybackDevice, PlaybackModeOutcome, PlayerCommandOutcome, PlayFailure, PlayOutcome, PlayRung, RepeatMode, SetTrackLikedOutcome, TransferOutcome } from '@lib/spotifyPlayback'
import type { OwnershipMessage } from './ownership'
import { addBucketPlayback, deleteBucketItem, expandAlbumTracks } from '@lib/buckets'
import { bucketStore } from '@lib/pocketBuckit/bucketStore'
import { getStreamingToken, getTrackLiked, IN_PAGE_MESSAGE, listDevices, MYBLOG_PLAYBACK_CHANGED, play, sendPlaybackMode, sendPlayerCommand, setTrackLiked, transferPlayback } from '@lib/spotifyPlayback'
import { rememberSpotifyLibraryProbe, rememberSpotifyTransportProbe } from '@lib/spotifyCapability'
import { readLivePlayback } from '@components/member/lyrics/playback.api'
import { jumpToQueueIndex } from '@components/member/lyrics/queueJump'
import { confirmTransport } from './confirmTransport'
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
  /** Artwork from the same live read; client-only and safe to mirror across tabs. */
  albumCoverUrl: string | null
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

export type CapabilityTier = 'full' | 'fallback'
export type LikedState = 'unknown' | 'loading' | 'liked' | 'unliked' | 'scope-missing'
export type ReconnectState = boolean
export type PlaybackModeCommand =
	{ kind: 'shuffle', on: boolean } |
	{ kind: 'repeat', mode: RepeatMode } |
	{ kind: 'volume', percent: number }

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
  capabilityTier: CapabilityTier
  devices: PlaybackDevice[] | null
  activeDeviceId: string | null
  shuffle: boolean | null
  repeat: RepeatMode | null
  volumePercent: number | null
  liked: LikedState
  reconnect: ReconnectState
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

/**
 * A mutation a mirror tab may ask the owner to perform on its behalf.
 *
 * ARCH-playback-authority-convergence Step 1 added `mode` and `transfer`. Before
 * it, `setMode()` and `transferTo()` simply did not consult `gate()` at all — so a
 * mirror tab whose Global Player transport was disabled could still change shuffle,
 * repeat and volume, and could move the device. The worst shape was "이 브라우저":
 * it raises an in-page SDK device in whichever tab runs it, so a mirror running it
 * produced a SECOND SDK device while the lease stayed in the other tab — exactly
 * the state ownership exists to make impossible.
 *
 * `transfer` deliberately carries no `raiseInPageFirst`. Raising THIS tab as the
 * device is inherently local — forwarding it to the owner would raise the wrong
 * tab — so that path takes the lease outright instead (see `transferTo`).
 */
type SessionCommand =
	| { kind: 'play-at', itemId: string } |
	{ kind: 'toggle-play' } |
	{ kind: 'seek', positionMs: number } |
	{ kind: 'next' } |
	{ kind: 'previous' } |
	{ kind: 'mode', cmd: PlaybackModeCommand } |
	{ kind: 'transfer', deviceId: string } |
	/**
	 * A tap on a row of SPOTIFY's own queue (the lyrics viewer's 대기열 screen) —
	 * not the Playback Bucket, which `play-at` covers. It carries its payload
	 * because the target list is Spotify's and this session cannot reconstruct it.
	 */
	{ kind: 'queue-jump', items: QueueEntry[], index: number, context: JumpContext | null }

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
  shuffle: boolean | null
  repeat: RepeatMode | null
  volumePercent: number | null
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
  capabilityTier: 'fallback',
  devices: null,
  activeDeviceId: null,
  shuffle: null,
  repeat: null,
  volumePercent: null,
  liked: 'unknown',
  reconnect: false,
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

/**
 * ARCH-playback-authority-convergence Step 2 — the queue execution invariant's
 * state. Declared here, ahead of `patch()` rather than beside the block that owns
 * it further down, because `patch()` re-bases the signature on a row change.
 *
 * `issuedTail` is the tail signature Spotify is believed to be executing;
 * `queueDirty` says a future-tail mutation is not represented in it yet. See the
 * block header at `futureTailSignature` for what any of that means.
 */
let issuedTail: string | null = null
let queueDirty = false
let reissueTimer: ReturnType<typeof setTimeout> | null = null

function patch(p: Partial<PlaybackSessionState>): void {
  const previousItemId = current.currentItemId
  current = { ...current, ...p }
  if (current.isOwner)
    current = { ...current, ownerRung: current.rung }
  // ARCH-playback-authority-convergence Step 2. Spotify's executing list advances
  // in lockstep with ours at every natural boundary, so when the current row moves
  // the tail it is executing is exactly the tail we can now see — re-base the
  // signature or the very next store write (the completed row's own DELETE) would
  // read as a member edit and reissue for nothing. Skipped while a reissue is still
  // owed: that debt survives a track change, and clearing it here would drop a
  // mutation the member made while paused.
  if (current.currentItemId !== previousItemId && !queueDirty)
    rebaseIssuedTail()
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
let capabilityInflight: Promise<void> | null = null
let likedTrackId: string | null = null
let libraryBusy = false
let modeBusy = false
let playbackChangeAdoption: Promise<LivePlayback | null> | null = null
/** Set when an event arrives while a reconcile is in flight — see `reconcileFromEvent`. */
let adoptionDirty = false

const RECONNECT_FLAG = 'np-spotify-reconnect'

function readReconnectFlag(): boolean {
  try {
    return sessionStorage.getItem(RECONNECT_FLAG) === '1'
  }
  catch {
    return false
  }
}

function writeReconnectFlag(on: boolean): void {
  try {
    if (on)
      sessionStorage.setItem(RECONNECT_FLAG, '1')
    else sessionStorage.removeItem(RECONNECT_FLAG)
  }
  catch { /* private mode — the hint just doesn't persist */ }
}

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
    shuffle: current.shuffle,
    repeat: current.repeat,
    volumePercent: current.volumePercent,
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
    shuffle: state.shuffle,
    repeat: state.repeat,
    volumePercent: state.volumePercent,
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

/**
 * The same rows, but keeping each track id BOUND to the membership it came from.
 *
 * `trackIdsFrom` throws the correspondence away, which is fine for the prefetch
 * (it only warms a cache) and was catastrophic for the play path — see
 * `resolveTail`'s own header and `playFrom` below.
 */
function tailRowsFrom(rows: BoardAlbum[]): TailRow[] {
  return rows.flatMap(r => (r.trackId ? [{ itemId: r.itemId, trackId: r.trackId }] : []))
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
  // IDENTITY-ALIGNED (ARCH-playback-authority-convergence Step 1). `resolveTail`
  // used to hand back a filtered `string[]`, so a head that could not resolve made
  // Spotify start at row n+1 while this function went on to record row n as
  // current — session identity and audio disagreeing from the very first note, with
  // nothing anywhere able to notice. The tail now carries its item ids, and what is
  // adopted below is the row that ACTUALLY started.
  const tail = await resolveTail(tailRowsFrom(rows.slice(index)))
  if (tail.resolved.length === 0) {
    const unresolvable: PlayFailure = { ok: false, reason: 'unresolvable', message: '이 곡을 재생할 수 없어요.' }
    authoritativePatch({ busy: false, notice: noticeForFailure(unresolvable) })
    return unresolvable
  }
  const started = tail.resolved[0]
  const r = await play({ kind: 'uris', uris: tail.resolved.map(row => row.uri) })
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
  // The row the member pressed could not be resolved, so playback legitimately
  // started somewhere else in their queue. Saying so is the difference between a
  // skipped track and a mysterious one (principle: no silent failures).
  const skippedHead = started.itemId !== head.itemId
  authoritativePatch({
    busy: false,
    currentItemId: started.itemId,
    playing: true,
    rung: r.rung,
    degraded: r.degraded,
    anchor: { ms: 0, wallMs: performance.now() },
    durationMs: null,
    // Rung 2 MUST say it is degraded — the shipped ladder makes that the caller's
    // obligation and both forms are callers. `IN_PAGE_MESSAGE` is that sentence.
    notice: skippedHead ?
      { tone: 'info', message: '이 곡은 재생할 수 없어 다음 곡부터 재생해요' } :
      r.degraded ? { tone: 'degraded', message: IN_PAGE_MESSAGE } : null,
  })
  // A direct, index-based play is certain by construction — there is no guessing
  // involved, so any ambiguity carried over from a prior track-id match no longer
  // applies.
  anchorAmbiguous = false
  // What Spotify is executing is, by construction, the visible tail from `index`.
  // Any reissue debt that built up before this play is settled by the play itself.
  rebaseIssuedTail()
  scheduleBoundaryCheck()
  return r
}

// ── ARCH-playback-authority-convergence Step 2 — the queue execution invariant ──
//
// INVARIANT: *the order visible in the Playback Bucket is the order that plays next.*
//
// It did not hold before this. `playFrom` issues `play({kind:'uris', …})` once, and
// from that instant Spotify owns a frozen copy of the list; every later reorder,
// delete and append reached the tree, the store and the screen, and reached the
// player never. A member could drag a track to the top, watch the row move, and hear
// the old order play out to the end.
//
// The execution model is the RFC's option B: on a future-tail mutation, REISSUE
// `[current, …newTail]` and seek the playhead back to where it was. It is the only
// candidate that behaves identically on rung 1 (Connect remote — what the owner
// actually uses, and where there is no push signal at all) and rung 2. The rejected
// alternatives are recorded in the RFC: one-track-at-a-time app-controlled
// continuation turns a missed boundary into silence and breaks Spotify-side
// repeat/shuffle, and Spotify's native queue API has neither reorder nor delete so
// it cannot represent this queue at all.
//
// The reissue costs a brief (~200–400ms) restart of the sounding track, because
// Spotify's `play` has no "replace the tail, keep playing" form. That is OQ1, and
// the owner answered it on 2026-08-30: accept the glitch, apply every mutation
// live. The alternative — letting reorder and delete take effect only from the next
// track — silently breaks the very invariant this step exists to establish.
//
// Two things keep the glitch off the common path: only the rows AFTER the current
// one are in the signature (reordering already-played rows is free), and a reissue
// while PAUSED is deferred to the next resume rather than performed, since starting
// audio nobody asked for is worse than the wait.

/**
 * Coalescing window for queue mutations, not a protocol constant — nothing about
 * Spotify or the network is being estimated here, so it is not the kind of number
 * this RFC insists on measuring. It exists because one member gesture can land as
 * several store writes (an optimistic reflow, then the refetch a rejected
 * `PUT /reorder` forces; a held arrow key stepping a row down one position at a
 * time), and each extra reissue is one extra audible restart. Its only cost is
 * that much latency before the new order is live.
 */
const QUEUE_REISSUE_DEBOUNCE_MS = 300

/**
 * A reissue could not be delivered, so the visible order is — for now — NOT the
 * order that will play. Saying so is the difference between a queue that lies and
 * a queue that admits it (the RFC's own "no silent failures").
 */
const QUEUE_REISSUE_FAILED = '대기열 순서를 재생기에 반영하지 못했어요. 잠시 후 다시 시도해 주세요'

/** A takeover that could not move the audio must not move the lease either. */
const TAKEOVER_FAILED = '재생 제어를 가져오지 못했어요. 잠시 후 다시 시도해 주세요'

/**
 * The rows that will play AFTER the current one, as a comparable signature.
 *
 * Null when nothing is anchored to the queue — idle, or `external` playback that
 * our list is not driving. There is no "plays next" for the queue to be
 * authoritative about in either state, so there is nothing to reissue.
 *
 * Rows BEFORE the current one are deliberately excluded: moving or deleting a row
 * the member has already heard cannot change what plays next, and charging them an
 * audible restart for it would be a glitch with nothing bought.
 */
function futureTailSignature(): string | null {
  const i = rowIndex(current.currentItemId)
  if (i < 0)
    return null
  return queueRows().slice(i + 1).map(r => r.itemId).join('\n')
}

function clearReissue(): void {
  if (reissueTimer !== null) {
    clearTimeout(reissueTimer)
    reissueTimer = null
  }
}

/** Declare the visible tail and the executing tail to be the same list. */
function rebaseIssuedTail(): void {
  issuedTail = futureTailSignature()
  queueDirty = false
  clearReissue()
}

function armReissue(): void {
  clearReissue()
  reissueTimer = setTimeout(() => {
    reissueTimer = null
    // Paused between the mutation and the timer: the debt stays owed and comes due
    // on the next resume (`togglePlay`), which is the deferral OQ1 kept. Ownership
    // is re-checked HERE and not only where the timer was armed, because it can
    // change inside the window — and a mirror that starts writing playback is the
    // state Step 1 exists to forbid.
    if (queueDirty && current.playing && current.isOwner)
      void reissueFromCurrent()
  }, QUEUE_REISSUE_DEBOUNCE_MS)
}

/**
 * The queue changed under us. Called for EVERY write to the shared tree, which is
 * the point: the queue is a projection over `bucketStore` (see `queue.ts`'s header),
 * so subscribing to the store catches reorder, delete, drop-append, album expansion
 * and the Pocket menu at once — where hooking each of the six call sites would leave
 * the seventh, added later, silently outside the invariant.
 */
function onQueueChanged(): void {
  const signature = futureTailSignature()
  if (signature === null) {
    // Nothing queue-anchored is sounding. Anything owed was owed for a row that is
    // no longer current, so it is not owed any more.
    issuedTail = null
    queueDirty = false
    clearReissue()
    return
  }
  // A mirror never writes playback (Step 1's whole point). Keeping the baseline in
  // step with what it can see means that if this tab later becomes the owner it
  // starts level, rather than firing a reissue for edits the real owner already
  // executed.
  if (!current.isOwner) {
    issuedTail = signature
    queueDirty = false
    return
  }
  if (signature === issuedTail)
    return
  queueDirty = true
  if (current.playing)
    armReissue()
}

/**
 * Reissue `[current, …visible tail]` and put the playhead back.
 *
 * Used by the debounced mutation path, by the deferred resume, and by `takeOver()` —
 * one mechanic, so "what Spotify is executing" can only ever be established one way.
 *
 * Deliberately NOT owner-gated itself: the two reactive callers check ownership
 * before they call, while `takeOver()` runs this from a tab that is not the owner
 * yet — issuing the tail from here IS the move the lease then follows.
 */
async function reissueFromCurrent(): Promise<boolean> {
  if (current.busy) {
    // A play or transport call owns the session right now. Reissuing across it
    // would race two writes over one player; wait one window and look again.
    armReissue()
    return false
  }
  const rows = queueRows()
  const i = rowIndex(current.currentItemId)
  if (i < 0) {
    issuedTail = null
    queueDirty = false
    return false
  }
  const signature = futureTailSignature()
  patch({ busy: true })
  const tail = await resolveTail(tailRowsFrom(rows.slice(i)))
  const head = tail.resolved[0]
  if (!head || head.itemId !== current.currentItemId) {
    // The sounding row would not be the head of the reissue, so issuing it would
    // move the member to a different track to fix an ORDER — a cure worse than the
    // disease. Leave audio alone and leave `issuedTail` where it was, so the next
    // genuine edit tries again; retrying this one on a timer would be the polling
    // loop D28 forbids.
    authoritativePatch({ busy: false, notice: { tone: 'error', message: QUEUE_REISSUE_FAILED, reason: 'unresolvable' } })
    queueDirty = false
    return false
  }
  // Read the playhead as LATE as possible — after the resolve, immediately before
  // the write that stops it — and deliberately from before the round trip rather
  // than after: the reissue lands a beat later, so this target is a hair early. A
  // few hundred ms of rewind is a re-heard syllable; the same error the other way
  // is a skipped one.
  const resumeMs = Math.max(0, Math.round(positionNow()))
  const r = await play({ kind: 'uris', uris: tail.resolved.map(row => row.uri) })
  if (!r.ok) {
    authoritativePatch({ busy: false, notice: noticeForFailure(r) })
    queueDirty = false
    return false
  }
  authoritativePatch({
    busy: false,
    playing: true,
    rung: r.rung,
    degraded: r.degraded,
    anchor: { ms: 0, wallMs: performance.now() },
    durationMs: null,
    notice: r.degraded ? { tone: 'degraded', message: IN_PAGE_MESSAGE } : null,
  })
  anchorAmbiguous = false
  issuedTail = signature
  clearReissue()
  // A mutation that landed WHILE the reissue was in flight is still unrepresented.
  // `patch` above cannot have re-based it away (the row did not change), so compare
  // against what we actually issued rather than trusting the flag.
  queueDirty = futureTailSignature() !== signature
  if (queueDirty)
    armReissue()
  if (resumeMs > 0) {
    // The shipped seek — its own re-anchor, its `localWriteSeq` guard and its
    // confirmation read are exactly what a restored position needs, and writing a
    // second seek path here is the "a second play path by accident" risk in its
    // other form.
    await seekTo(resumeMs)
  }
  else {
    scheduleBoundaryCheck()
  }
  return true
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
async function adoptLive(beforeApply?: Promise<unknown>): Promise<LivePlayback | null> {
  // Adoption is a WRITE to the session, sourced from a Spotify read. Only the owner
  // performs it: if every tab adopted independently they would be two writers racing
  // over one state, each overwriting the other's broadcast with its own slightly
  // older read, and the progress line would jitter between two anchors taken at
  // different instants. A mirror gets the same information for free — the owner
  // broadcasts the adopted state — so the read is not merely redundant, it is
  // harmful. With no owner at all, this tab is the only reader and proceeds.
  if (!current.isOwner && current.ownerPresent)
    return null

  // The row this tab believes is sounding, BEFORE the read — captured now so a
  // completion can be detected against what we knew, not against whatever a
  // concurrent local write may have since changed it to. (Inlined rather than
  // `playbackSession.currentRow()` — that binding is defined later in the file.)
  const previousRowIndex = rowIndex(current.currentItemId)
  const previousRow = previousRowIndex < 0 ? null : queueRows()[previousRowIndex]
  const seqAtStart = localWriteSeq
  const livePromise = readLivePlayback()
  const [live] = await Promise.all([livePromise, beforeApply])

  // A newer AUTHORITATIVE local write landed while this read was in flight — e.g.
  // this very read was triggered by `MYBLOG_PLAYBACK_CHANGED` off our own command,
  // and the read lands inside Spotify's ack→apply window with the PREVIOUS state.
  // Discard rather than apply: the fresher local write is already correct, and an
  // adoption is a read, never the tie-breaker over an action. See `localWriteSeq`.
  if (localWriteSeq !== seqAtStart)
    return null

  // `unavailable` is a token/network failure, NOT "nothing is playing". Treating it
  // as silence would make a transient blip wipe a perfectly good current track —
  // the same distinction `readLivePlayback`'s own docstring insists on.
  if (live.state === 'unavailable')
    return live

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
    likedTrackId = null
    patch({
      playing: false,
      external: null,
      currentItemId: null,
      activeDeviceId: null,
      shuffle: null,
      repeat: null,
      volumePercent: null,
      liked: 'unknown',
    })
    anchorAmbiguous = false
    return live
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
    patch({
      currentItemId: row.itemId,
      external: null,
      playing,
      anchor,
      durationMs: live.durationMs,
      activeDeviceId: live.deviceId ?? null,
      shuffle: live.shuffle,
      repeat: live.repeat,
      volumePercent: live.volumePercent,
    })
    anchorAmbiguous = ambiguous
    loadLiked(live.trackId)
    scheduleBoundaryCheck()
    return live
  }
  anchorAmbiguous = false
  patch({
    currentItemId: null,
    external: {
      title: live.track,
      artist: live.artist,
      albumCoverUrl: live.albumCoverUrl,
      spotifyTrackId: live.trackId,
      spotifyAlbumId: live.albumSpotifyId,
      deviceName: live.deviceName,
    },
    playing,
    anchor,
    durationMs: live.durationMs,
    activeDeviceId: live.deviceId ?? null,
    shuffle: live.shuffle,
    repeat: live.repeat,
    volumePercent: live.volumePercent,
  })
  loadLiked(live.trackId)
  scheduleBoundaryCheck()
  return live
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

async function resolveCapability(): Promise<void> {
  if (capabilityInflight)
    return capabilityInflight
  capabilityInflight = (async () => {
    const r = await getStreamingToken()
    if (r.ok) {
      patch({ capabilityTier: 'full', reconnect: false })
      writeReconnectFlag(false)
    }
    else {
      const reconnect = r.httpStatus === 502 || (r.status === 'disconnected' && readReconnectFlag())
      patch({ capabilityTier: 'fallback', reconnect })
      if (r.httpStatus === 502)
        writeReconnectFlag(true)
    }
  })().finally(() => {
    capabilityInflight = null
  })
  return capabilityInflight
}

function recordControlFailure(r: Exclude<PlayerCommandOutcome, { ok: true }>): void {
  if (r.reason === 'no-capability') {
    rememberSpotifyTransportProbe('no-capability')
    patch({ capabilityTier: 'fallback' })
  }
  else if (r.reason === 'token') {
    const reconnect = r.httpStatus === 502 ? true : current.reconnect
    patch({ capabilityTier: 'fallback', reconnect })
    if (r.httpStatus === 502)
      writeReconnectFlag(true)
  }
}

function loadLiked(trackId: string): void {
  if (likedTrackId === trackId)
    return
  likedTrackId = trackId
  patch({ liked: 'loading' })
  void getTrackLiked(trackId).then((r) => {
    if (likedTrackId !== trackId)
      return
    if (r.ok) {
      patch({ liked: r.liked ? 'liked' : 'unliked' })
      rememberSpotifyLibraryProbe('available')
    }
    else if (r.reason === 'library-scope-missing') {
      patch({ liked: 'scope-missing' })
      rememberSpotifyLibraryProbe('scope-missing')
    }
    else {
      patch({ liked: 'unknown' })
    }
  })
}

/** `currentSpotifyTrackId()` as a URI, for comparing against a live read. */
function currentSpotifyUri(): string | null {
  const id = currentSpotifyTrackId()
  return id ? `spotify:track:${id}` : null
}

function currentSpotifyTrackId(): string | null {
  if (current.external)
    return current.external.spotifyTrackId
  const i = rowIndex(current.currentItemId)
  const row = i < 0 ? null : queueRows()[i]
  if (!row?.trackId)
    return null
  const uri = cachedUri(row.trackId)
  return uri?.startsWith('spotify:track:') ? uri.slice('spotify:track:'.length) : null
}

async function toggleLiked(): Promise<SetTrackLikedOutcome | null> {
  const trackId = currentSpotifyTrackId()
  if (!trackId || likedTrackId !== trackId || libraryBusy || (current.liked !== 'liked' && current.liked !== 'unliked'))
    return null
  const before = current.liked
  const nextLiked = before !== 'liked'
  libraryBusy = true
  patch({ liked: nextLiked ? 'liked' : 'unliked' })
  try {
    const r = await setTrackLiked(trackId, nextLiked)
    if (likedTrackId !== trackId)
      return r
    if (r.ok) {
      rememberSpotifyLibraryProbe('available')
    }
    else if (r.reason === 'library-scope-missing') {
      patch({ liked: 'scope-missing' })
      rememberSpotifyLibraryProbe('scope-missing')
    }
    else {
      // Optimistic rollback for token/network/provider failures.
      patch({ liked: before })
    }
    return r
  }
  finally {
    libraryBusy = false
  }
}

async function setMode(cmd: PlaybackModeCommand): Promise<PlaybackModeOutcome | null> {
  // GATED (ARCH-playback-authority-convergence Step 1). Shuffle, repeat and volume
  // are playback mutations exactly as much as ⏯ is, and they were the one family
  // that never consulted ownership — so a mirror tab with a disabled transport
  // could still reach across and change them. A mirror forwards to the owner, same
  // as every other command; the owner acts locally.
  if (!current.isOwner && !await gate({ kind: 'mode', cmd }))
    return null
  if (modeBusy)
    return null
  modeBusy = true
  const before = {
    shuffle: current.shuffle,
    repeat: current.repeat,
    volumePercent: current.volumePercent,
  }
  let optimisticPatch: Partial<PlaybackSessionState>
  if (cmd.kind === 'shuffle')
    optimisticPatch = { shuffle: cmd.on }
  else if (cmd.kind === 'repeat')
    optimisticPatch = { repeat: cmd.mode }
  else
    optimisticPatch = { volumePercent: cmd.percent }
  authoritativePatch(optimisticPatch)
  try {
    const r = await sendPlaybackMode(cmd)
    if (r.ok)
      return r
    if (r.reason === 'unsupported-on-device') {
      // Roll back to the exact pre-write value; null is only one possible device value.
      authoritativePatch({ volumePercent: before.volumePercent })
    }
    else if (r.reason === 'no-capability') {
      rememberSpotifyTransportProbe('no-capability')
      patch({ capabilityTier: 'fallback' })
    }
    else {
      // The old card reconciled transient/token failures with its ordinary one-shot.
      void syncFromLive()
    }
    return r
  }
  finally {
    modeBusy = false
  }
}

async function refreshDevices() {
  patch({ devices: null })
  const r = await listDevices()
  if (r.ok) {
    patch({
      devices: r.devices,
      activeDeviceId: r.devices.find(device => device.isActive)?.id ?? null,
    })
  }
  return r
}

async function transferTo(deviceId: string, opts?: { raiseInPageFirst?: boolean }): Promise<TransferOutcome> {
  // GATED (ARCH-playback-authority-convergence Step 1), and the two halves are
  // gated DIFFERENTLY on purpose.
  //
  // "이 브라우저" raises an in-page SDK device in whichever tab runs it. Forwarding
  // that to the owner would raise the WRONG tab, and running it ungated in a mirror
  // produced the exact state ownership exists to forbid: two SDK devices, with the
  // lease on neither of the ones the member is looking at. It is also the most
  // explicit "make sound HERE" there is — the same reasoning `replaceQueueAndPlay`
  // uses — so it takes the lease outright rather than asking.
  //
  // A transfer to a real Connect device moves audio out of every tab, so it is an
  // ordinary forwardable command.
  if (opts?.raiseInPageFirst) {
    if (!await playbackOwnership.ensureOwner())
      return { ok: false, reason: 'transient' }
  }
  else if (!current.isOwner && !await gate({ kind: 'transfer', deviceId })) {
    return { ok: false, reason: 'transient' }
  }
  const r = await transferPlayback(deviceId, opts)
  if (!r.ok)
    return r
  if (!opts?.raiseInPageFirst) {
    patch({
      activeDeviceId: deviceId,
      devices: current.devices?.map(device => ({ ...device, isActive: device.id === deviceId })) ?? null,
    })
  }
  else {
    // The SDK chooses the cold-start in-page id internally, so re-list once to
    // learn its real id instead of storing a synthetic value as activeDeviceId.
    await refreshDevices()
  }
  return r
}

/**
 * Move the shared playhead and make the session anchor authoritative immediately.
 *
 * The provider write has no response body, so an actively-playing seek performs
 * one confirmation read after the optimistic re-anchor. A paused seek is already
 * exact and does not pay for that read. `authoritativePatch` bumps `localWriteSeq`
 * before confirmation starts, so an older event-driven read cannot overwrite the
 * target; a newer local write likewise makes the confirmation discard itself.
 */
async function seekTo(ms: number, onReanchored?: () => void): Promise<PlayerCommandOutcome | null> {
  const target = Math.max(0, Math.round(ms))
  if (current.busy)
    return null
  if (!current.currentItemId && !current.external)
    return null
  if (!current.isOwner && !await gate({ kind: 'seek', positionMs: target }))
    return null

  patch({ busy: true })
  const result = await sendPlayerCommand({ kind: 'seek', positionMs: target })
  if (!result.ok) {
    recordControlFailure(result)
    authoritativePatch({ busy: false, notice: noticeForCommand(result) })
    return result
  }

  rememberSpotifyTransportProbe('available')
  authoritativePatch({
    busy: false,
    anchor: { ms: target, wallMs: performance.now() },
    notice: current.degraded ? { tone: 'degraded', message: IN_PAGE_MESSAGE } : null,
  })
  const seekWriteSeq = localWriteSeq
  onReanchored?.()
  scheduleBoundaryCheck()
  if (current.playing) {
    // `sendPlayerCommand` dispatches MYBLOG_PLAYBACK_CHANGED synchronously before
    // resolving. That listener's adoption therefore started before the
    // authoritative anchor above and may still own readLivePlayback's single-flight
    // promise. Drain it first: treating it as the confirmation would let a
    // pre-write provider snapshot overwrite the optimistic target.
    const preWriteAdoption = playbackChangeAdoption
    if (preWriteAdoption)
      await preWriteAdoption
    // A newer local action won while the echo drained. Its state is authoritative;
    // do not launch a seek confirmation that belongs to the superseded write.
    if (current.playing && localWriteSeq === seekWriteSeq)
      await syncFromLive()
  }
  return result
}

/**
 * Adopt whatever is actually sounding.
 *
 * Prefetches first so the URI match can succeed: `rowForSpotifyTrack` is cache-only
 * by design, and without warm URIs a track that IS in the queue would be
 * misreported as external on the very first read.
 */
async function syncFromLive(): Promise<void> {
  const prefetched = prefetchUris(trackIdsFrom(queueRows()))
  await adoptLive(prefetched)
}

/**
 * The Spotify track id the session currently believes is sounding, whatever the
 * anchor happens to be — external reads carry one directly, a queue-matched row
 * goes through the cache-only reverse lookup.
 */
function liveUriOf(live: LivePlayback | null): string | null {
  if (!live || live.state === 'idle' || live.state === 'unavailable' || !live.trackId)
    return null
  return `spotify:track:${live.trackId}`
}

export type QueueJumpResult =
	| { ok: true } |
	/** Handed to the owning tab; this tab does nothing more. */
	{ ok: false, reason: 'forwarded' } |
	{ ok: false, reason: 'nothing-to-send' | 'no-capability' | 'token' | 'transient' } |
	/**
	 * The command was accepted and Spotify never reported the target track. The
	 * session has ALREADY reconciled itself to whatever is really playing; this
	 * reason exists so the surface that asked can say so rather than sit on an
	 * optimistic guess.
	 */
	{ ok: false, reason: 'unconfirmed' }

const JUMP_CONFIRM_TRIES = 4
const JUMP_CONFIRM_GAP_MS = 500

/**
 * Tap a row of Spotify's own queue.
 *
 * This lived inside `LyricsViewer` until ARCH-playback-authority-convergence Step 1,
 * which is why the viewer needed `awaitingTrack`, `confirmJump` and an optimistic
 * `trackId` of its own — and why the failure mode was permanent. `confirmJump`
 * DISCARDED `confirmTransport`'s boolean, so exhausting the budget left the viewer
 * showing B while Spotify played A, with nothing left to correct it.
 *
 * Here, every confirmation attempt is an `adoptLive()`, so the session is
 * continuously reconciled to the truth whether or not the jump lands. Giving up is
 * therefore not a divergence any more — it is a session that already believes the
 * right thing, plus a caller that gets told the tap did not take.
 */
async function jumpToSpotifyQueue(items: QueueEntry[], index: number, context: JumpContext | null): Promise<QueueJumpResult> {
  const target = items[index]
  if (!target?.uri)
    return { ok: false, reason: 'nothing-to-send' }
  if (!current.isOwner && !await gate({ kind: 'queue-jump', items, index, context }))
    return { ok: false, reason: 'forwarded' }

  patch({ busy: true })
  const r: JumpOutcome = await jumpToQueueIndex(items, index, context)
  if (!r.ok) {
    const reason = r.reason === 'nothing-to-send' ? 'nothing-to-send' : r.reason
    authoritativePatch({
      busy: false,
      notice: reason === 'nothing-to-send' ?
        null :
        noticeForCommand({ ok: false, reason } as Exclude<PlayerCommandOutcome, { ok: true }>),
    })
    return { ok: false, reason }
  }

  // Optimistic, and authoritative for the same reason `togglePlay` is: the command
  // we just issued is the most direct evidence there is, and `MYBLOG_PLAYBACK_CHANGED`
  // has already fired into Spotify's ack→apply window.
  //
  // `rung`/`degraded` come from the ladder that just ran, exactly as in `playFrom`.
  // Dropping them (the shape this had when the jump lived in `LyricsViewer`) meant a
  // cold-start jump — rung 1 answers `NO_ACTIVE_DEVICE`, rung 2 raises this tab as
  // the SDK device — left `rung: null` on the shared state: no 음질 제한 notice, and
  // every mirror tab reading `ownerRung: null` decided it could still control
  // playback. That is the ownership gate this step exists to close, half-open.
  authoritativePatch({
    busy: false,
    playing: true,
    rung: r.rung,
    degraded: r.degraded,
    notice: r.degraded ? { tone: 'degraded', message: IN_PAGE_MESSAGE } : null,
  })
  const wanted = `spotify:track:${target.id}`
  let last: LivePlayback | null = null
  const settled = await confirmTransport(
    async () => {
      last = await adoptLive()
    },
    () => liveUriOf(last) === wanted,
    { tries: JUMP_CONFIRM_TRIES, gapMs: JUMP_CONFIRM_GAP_MS },
  )
  if (settled)
    return { ok: true }
  // The budget is spent. The reads above have already written whatever is really
  // playing, so nothing is left dangling — say it plainly and stop.
  patch({ notice: { tone: 'error', message: '그 곡으로 넘어가지 못했어요. 잠시 후 다시 시도해 주세요', reason: 'transient' } })
  return { ok: false, reason: 'unconfirmed' }
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
    return currentSpotifyTrackId()
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
    // ARCH-playback-authority-convergence Step 2. A future-tail mutation made while
    // paused was DEFERRED, not dropped — reissuing then would have started audio the
    // member did not ask for. Resuming is when that debt comes due, and paying it
    // with the reissue IS the resume: `play({uris:[current, …tail]})` starts sound
    // and `seekTo` puts the playhead back, so the first thing heard after ▶ already
    // follows the order on screen. A plain resume here would play the stale order.
    if (!current.playing && queueDirty && current.isOwner && rowIndex(current.currentItemId) >= 0) {
      if (await reissueFromCurrent())
        return
      // The reissue could not be delivered and has said so. Fall through to the
      // ordinary resume: refusing to start playback because an ORDER could not be
      // applied would be a worse failure than the stale order it is protecting.
    }
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

  resolveCapability,

  recordControlFailure,

  loadLiked,

  toggleLiked,

  setMode,

  seekTo,

  jumpToSpotifyQueue,

  refreshDevices,

  transferTo,

  setDevice(device: PlaybackDevice | null): void {
    patch({ device })
  },

  dismissNotice(): void {
    patch({ notice: null })
  },

  /**
   * Move playback authority to THIS tab.
   *
   * ARCH-playback-authority-convergence Step 2 reverses the order: the lease now
   * FOLLOWS the move instead of preceding it. What shipped took the lease first and
   * then looked for a row to play, which meant that during `external` playback —
   * where `rowIndex` is -1 by construction — the lease moved and the audio did not.
   * The member pressed 재생 제어 가져오기, the banner went away, and nothing they
   * could see had changed hands. A takeover that fails now leaves the previous
   * owner intact rather than orphaning the session between two tabs.
   *
   * What "move" means depends on where the sound actually IS, which `ownerRung`
   * already records:
   *   · queue-anchored → reissue our own tail from here, playhead preserved. This
   *     tab becomes the issuer, which is what authority over a queue consists of.
   *   · external on the in-page rung → the audio lives inside the OTHER TAB's SDK
   *     device and dies with its lease, so it has to be transferred here first.
   *   · external on a Connect device → the audio is on a speaker or a phone; it
   *     belongs to the account, not to any tab. Nothing needs to move, and moving
   *     it anyway would drag the member from their speaker into a quality-limited
   *     browser device they never asked for, discarding the album context with it.
   */
  async takeOver(): Promise<void> {
    const i = rowIndex(current.currentItemId)
    if (i >= 0) {
      if (!await reissueFromCurrent())
        return
      await playbackOwnership.ensureOwner()
      return
    }
    if (current.external && current.ownerRung === 'in-page') {
      const r = await transferPlayback('', { raiseInPageFirst: true })
      if (!r.ok) {
        patch({ notice: { tone: 'error', message: TAKEOVER_FAILED, reason: r.reason } })
        return
      }
      await playbackOwnership.ensureOwner()
      await refreshDevices()
      await syncFromLive()
      return
    }
    // Nothing is sounding, or it is sounding somewhere no tab owns. The claim IS
    // the whole action; adopting afterwards is what makes this tab's transport
    // describe the same playback the old owner's did.
    if (!await playbackOwnership.ensureOwner())
      return
    if (current.external)
      await syncFromLive()
  },

  /** Test seam. */
  __reset(): void {
    clearBoundaryCheck()
    clearReissue()
    issuedTail = null
    queueDirty = false
    anchorAmbiguous = false
    capabilityInflight = null
    likedTrackId = null
    libraryBusy = false
    modeBusy = false
    playbackChangeAdoption = null
    adoptionDirty = false
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
  const endingUri = currentSpotifyUri()
  boundaryTimer = setTimeout(() => {
    boundaryTimer = null
    if (current.isOwner && current.rung === 'remote')
      void confirmCompletion(endingUri)
  }, delay)
}

/**
 * ARCH-playback-authority-convergence Step 1 — the natural boundary gets the same
 * bounded burst every explicit transport already had.
 *
 * The single read this replaces lost exactly the race `confirmTransport` was
 * written for, and lost it silently: Spotify answers `GET /me/player` with the
 * PREVIOUS track for a beat after it has moved on, that stale read looks like an
 * ordinary same-track read, and nothing asks again. An explicit ⏭ had a
 * confirmation loop since 2026-08-02; the natural end of a track — the far more
 * common transition — did not.
 *
 * "Settled" is three outcomes, not one, because a track can legitimately end into
 * any of them:
 *   · a DIFFERENT track is playing — ordinary advance;
 *   · `idle` — the queue ran out, or playback stopped;
 *   · the SAME track at a position near zero — repeat-one restarted it. That is a
 *     new playback epoch even though the identity never changed, and treating it as
 *     "not settled yet" would spin the whole budget on a correct answer.
 *
 * Still not polling (D28): it runs once per track boundary, behind a real end, and
 * it stops the moment Spotify agrees.
 */
const COMPLETION_CONFIRM_TRIES = 4
const COMPLETION_CONFIRM_GAP_MS = 500
/**
 * A same-track read below this position, after the track was expected to END, is a
 * restart rather than a stale read — nothing else puts a playhead back near zero at
 * a boundary. Generous on purpose: it only has to separate "≈0" from "≈duration".
 */
const EPOCH_RESTART_MS = 5_000

async function confirmCompletion(endingUri: string | null): Promise<void> {
  let last: LivePlayback | null = null
  await confirmTransport(
    async () => {
      last = await adoptLive()
    },
    () => {
      const live: LivePlayback | null = last
      if (!live || live.state === 'unavailable')
        return false
      if (live.state === 'idle')
        return true
      const uri = liveUriOf(live)
      if (endingUri == null || uri !== endingUri)
        return true
      // Same track. Only a rewound playhead means a new epoch (repeat-one);
      // still sitting at the end means Spotify simply has not advanced yet.
      return (live.progressMs ?? 0) < EPOCH_RESTART_MS
    },
    { tries: COMPLETION_CONFIRM_TRIES, gapMs: COMPLETION_CONFIRM_GAP_MS },
  )
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
  else if (command.kind === 'seek')
    await playbackSession.seekTo(command.positionMs)
  else if (command.kind === 'next')
    await playbackSession.next()
  else if (command.kind === 'previous')
    await playbackSession.previous()
  else if (command.kind === 'mode')
    await playbackSession.setMode(command.cmd)
  else if (command.kind === 'transfer')
    await playbackSession.transferTo(command.deviceId)
  else
    await playbackSession.jumpToSpotifyQueue(command.items, command.index, command.context)
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
// ARCH-playback-authority-convergence Step 2 — every queue mutation lands here.
// Registered at module scope for the same reason the transport echo below is: the
// session is a singleton and both player forms share it.
bucketStore.subscribe(onQueueChanged)
if (!current.isOwner)
  playbackOwnership.post({ type: 'sync-request' })

/**
 * LEADING + TRAILING coalescing of the transport echo
 * (ARCH-playback-authority-convergence Step 1).
 *
 * The event says "something changed", not what — so ASK. What is new is that the
 * LAST change can no longer be lost. Before this, every event fired its own
 * `adoptLive()`, and `readLivePlayback()`'s single-flight dedupe then folded a
 * burst onto whichever read happened to be in flight: A → ⏭ B → ⏭ C inside one
 * round trip produced ONE read, started before B and C existed, and the session
 * settled on A or B and never asked again. (The lyrics viewer had the same bug in
 * its own shape — a 1.5s leading-edge floor with no trailing call.)
 *
 * So: the first event reconciles immediately; any event arriving while that
 * reconcile is in flight only sets `dirty`; and when it lands, a dirty flag buys
 * exactly ONE more read. Bounded by construction — a burst of any length costs two
 * reads, and the second is guaranteed to have started after the last event.
 */
function reconcileFromEvent(): void {
  if (playbackChangeAdoption) {
    adoptionDirty = true
    return
  }
  const adoption = adoptLive()
  playbackChangeAdoption = adoption
  void adoption.finally(() => {
    if (playbackChangeAdoption === adoption)
      playbackChangeAdoption = null
    if (adoptionDirty) {
      adoptionDirty = false
      reconcileFromEvent()
    }
  })
}

// ── transport echo ───────────────────────────────────────────────────────────
// `MYBLOG_PLAYBACK_CHANGED` fires for Connect plays AND (since front #342) for
// transport commands, so another surface pausing the same account is reflected here
// rather than leaving the panel claiming it is still playing. Registered once, at
// module scope, because the session is a singleton and both forms share it.
if (typeof window !== 'undefined')
  window.addEventListener(MYBLOG_PLAYBACK_CHANGED, reconcileFromEvent)
