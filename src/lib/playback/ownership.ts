import { getAuthIdentity, subscribeAuthIdentity } from '@lib/authIdentity'

export const HEARTBEAT_MS = 5_000
export const STALE_MS = 15_000
export const CHALLENGE_MS = 1_000

const LEASE_KEY = 'pb:playback-owner'
const BUS_KEY = 'pb:playback-bus'
const CHANNEL_NAME = 'myblog:playback'

export interface PlaybackOwnershipState {
  tabId: string
  isOwner: boolean
  ownerTabId: string | null
  ownerPresent: boolean
}

/**
 * May this tab OFFER a playback mutation at all?
 *
 * False in exactly one case: this tab is a mirror whose owner is on rung 2, where
 * the audio is inside that other tab and moving it here means taking the lease. On
 * rung 1 the audio is on a Connect device in no tab at all, so every tab stays a
 * usable remote (T4) — the session forwards those presses to the owner.
 *
 * Lives HERE, rather than in `PlaybackPanel.tsx` where it was defined until
 * ARCH-playback-authority-convergence Step 1, because it is an ownership question
 * and every playback surface has to be able to ask it. That was not a cosmetic
 * move: `LyricsViewer` could not reasonably import a 600-line panel module, so it
 * asked nobody and shipped a transport that bypassed the gate the Global Player
 * enforces two inches away. Taking the three fields structurally (rather than
 * importing `PlaybackSessionState`) keeps this module free of a dependency on the
 * session that depends on it.
 */
export function canControlPlayback(state: {
  isOwner: boolean
  ownerPresent: boolean
  ownerRung: 'remote' | 'in-page' | null
}): boolean {
  return state.isOwner || !state.ownerPresent || state.ownerRung !== 'in-page'
}

/**
 * Every message carries the account that sent it (FIX-auth-identity-lifecycle Step 1).
 *
 * The bus is a BroadcastChannel / localStorage bus shared by every tab on this origin,
 * and tabs on the same origin need not be the same account: a switch in one tab leaves
 * the others running under the old one until they notice. Without `acct`, tab A's
 * `command` and `state` messages are indistinguishable from tab B's, so account A could
 * drive — and read the now-playing state of — account B's session. The stamp makes that
 * a droppable message rather than a trusted one.
 */
export interface OwnershipEnvelope {
	from: string
	/** Cognito `sub` (or sentinel) of the tab that sent this. */
	acct: string
}

export type OwnershipMessage =
	| ({ type: 'claimed' } & OwnershipEnvelope) |
	({ type: 'released' } & OwnershipEnvelope) |
	({ type: 'challenge', nonce: string } & OwnershipEnvelope) |
	({ type: 'alive', nonce: string } & OwnershipEnvelope) |
	({ type: 'state', state: unknown } & OwnershipEnvelope) |
	({ type: 'command', cmd: unknown } & OwnershipEnvelope) |
	({ type: 'sync-request' } & OwnershipEnvelope)

type OutboundMessage = OwnershipMessage extends infer Message ?
  Message extends OwnershipMessage ?
    Omit<Message, 'from' | 'acct'> :
    never :
  never

/**
 * An envelope before `post()` stamps the sending account onto it. Distributes over the
 * union — a plain `Omit<OwnershipMessage, 'acct'>` collapses the variants into their
 * common fields and loses `cmd` / `state` / `nonce`.
 */
export type UnstampedOwnershipMessage = OwnershipMessage extends infer Message ?
  Message extends OwnershipMessage ?
    Omit<Message, 'acct'> :
    never :
  never

export interface OwnershipTransport {
  post: (message: OwnershipMessage) => void
  onMessage: (cb: (message: OwnershipMessage) => void) => () => void
  close?: () => void
}

interface Lease {
  tabId: string
  heartbeatAt: number
}

interface PendingChallenge {
  nonce: string
  ownerTabId: string
  timer: number
}

const inBrowser = typeof window !== 'undefined'

function createTabId(): string {
  if (!inBrowser)
    return ''
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID()
  return `pb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

const tabId = createTabId()
const listeners = new Set<() => void>()
const messageListeners = new Set<(message: OwnershipMessage) => void>()

function readLease(): Lease | null {
  if (!inBrowser)
    return null
  try {
    const raw = window.localStorage.getItem(LEASE_KEY)
    if (!raw)
      return null
    const value = JSON.parse(raw) as Partial<Lease>
    return typeof value.tabId === 'string' && typeof value.heartbeatAt === 'number' ?
      { tabId: value.tabId, heartbeatAt: value.heartbeatAt } :
      null
  }
  catch {
    return null
  }
}

function writeLease(): void {
  if (!inBrowser)
    return
  try {
    window.localStorage.setItem(LEASE_KEY, JSON.stringify({ tabId, heartbeatAt: Date.now() } satisfies Lease))
  }
  catch {
    // Ownership remains useful inside this tab even when storage is unavailable.
  }
}

function removeOwnLease(): void {
  if (!inBrowser)
    return
  try {
    if (readLease()?.tabId === tabId)
      window.localStorage.removeItem(LEASE_KEY)
  }
  catch {
    // A closing page has no recovery path if storage is unavailable.
  }
}

function isOwnershipMessage(value: unknown): value is OwnershipMessage {
  if (!value || typeof value !== 'object')
    return false
  const message = value as { type?: unknown, from?: unknown, acct?: unknown }
  if (typeof message.from !== 'string')
    return false
  // Keeps this predicate honest rather than doing the filtering: everything downstream
  // reads `message.acct` as a `string`, so an envelope without one must not be narrowed
  // to `OwnershipMessage`. Dropping the UNSTAMPED message is `handleMessage`'s doing —
  // `undefined` matches no account — and a mutation that deletes this line changes no
  // observable behaviour today. It is here so that stays true of the next reader too.
  if (typeof message.acct !== 'string')
    return false
  return ['claimed', 'released', 'challenge', 'alive', 'state', 'command', 'sync-request'].includes(String(message.type))
}

function createBroadcastTransport(): OwnershipTransport {
  const channel = new BroadcastChannel(CHANNEL_NAME)
  return {
    post(message) {
      channel.postMessage(message)
    },
    onMessage(cb) {
      const handler = (event: MessageEvent<unknown>) => {
        if (isOwnershipMessage(event.data))
          cb(event.data)
      }
      channel.addEventListener('message', handler)
      return () => channel.removeEventListener('message', handler)
    },
    close() {
      channel.close()
    },
  }
}

function createStorageTransport(): OwnershipTransport {
  let seq = 0
  return {
    post(message) {
      try {
        const previous = JSON.parse(window.localStorage.getItem(BUS_KEY) ?? 'null') as { seq?: unknown } | null
        const previousSeq = typeof previous?.seq === 'number' ? previous.seq : 0
        seq = Math.max(seq + 1, previousSeq + 1, Date.now())
        window.localStorage.setItem(BUS_KEY, JSON.stringify({ seq, payload: message }))
      }
      catch {
        // The fallback cannot signal another tab when storage is unavailable.
      }
    },
    onMessage(cb) {
      const handler = (event: StorageEvent) => {
        if (event.key !== BUS_KEY || !event.newValue)
          return
        try {
          const envelope = JSON.parse(event.newValue) as { payload?: unknown }
          if (isOwnershipMessage(envelope.payload))
            cb(envelope.payload)
        }
        catch {
          // Ignore malformed messages from an older or unrelated client.
        }
      }
      window.addEventListener('storage', handler)
      return () => window.removeEventListener('storage', handler)
    },
  }
}

function createDefaultTransport(): OwnershipTransport | null {
  if (!inBrowser)
    return null
  return typeof BroadcastChannel === 'function' ?
    createBroadcastTransport() :
    createStorageTransport()
}

const initialLease = readLease()
const EMPTY: PlaybackOwnershipState = {
  tabId,
  isOwner: false,
  ownerTabId: initialLease?.tabId ?? null,
  ownerPresent: initialLease !== null,
}

let current = EMPTY
let transport = createDefaultTransport()
let stopBus: (() => void) | null = null
let heartbeatTimer: number | null = null
let watchdogTimer: number | null = null
let challenge: PendingChallenge | null = null

function emit(): void {
  for (const cb of listeners) cb()
}

function patch(next: Partial<PlaybackOwnershipState>): void {
  const value = { ...current, ...next }
  const unchanged = [
    value.isOwner === current.isOwner,
    value.ownerTabId === current.ownerTabId,
    value.ownerPresent === current.ownerPresent,
  ].every(Boolean)
  if (unchanged) {
    return
  }
  current = value
  emit()
}

function postBus(message: OwnershipMessage): void {
  transport?.post(message)
}

function onBus(cb: (message: OwnershipMessage) => void): () => void {
  return transport?.onMessage(cb) ?? (() => {})
}

function clearChallenge(): void {
  if (!challenge)
    return
  window.clearTimeout(challenge.timer)
  challenge = null
}

function stopHeartbeat(): void {
  if (heartbeatTimer === null)
    return
  window.clearInterval(heartbeatTimer)
  heartbeatTimer = null
}

function heartbeat(): void {
  if (!current.isOwner)
    return
  const lease = readLease()
  if (lease && lease.tabId !== tabId) {
    stopHeartbeat()
    patch({ isOwner: false, ownerTabId: lease.tabId, ownerPresent: true })
    return
  }
  writeLease()
}

function startHeartbeat(): void {
  stopHeartbeat()
  heartbeatTimer = window.setInterval(heartbeat, HEARTBEAT_MS)
}

function post(message: OutboundMessage): void {
  if (!inBrowser)
    return
  postBus({ ...message, from: tabId, acct: getAuthIdentity() } as OwnershipMessage)
}

function claim(): void {
  if (!inBrowser)
    return
  clearChallenge()
  writeLease()
  post({ type: 'claimed' })
  startHeartbeat()
  patch({ isOwner: true, ownerTabId: tabId, ownerPresent: true })
}

function release(): void {
  if (!inBrowser || !current.isOwner)
    return
  stopHeartbeat()
  clearChallenge()
  removeOwnLease()
  post({ type: 'released' })
  patch({ isOwner: false, ownerTabId: null, ownerPresent: false })
}

function handleMessage(message: OwnershipMessage): void {
  if (message.from === tabId)
    return
  // A message from another ACCOUNT is not ours to act on, at any layer: it must not
  // move this tab's lease, and it must not reach the session listeners below either
  // (a `state` message from the old account would repaint the new one's now-playing).
  if (message.acct !== getAuthIdentity())
    return

  if (message.type === 'claimed') {
    clearChallenge()
    stopHeartbeat()
    patch({ isOwner: false, ownerTabId: message.from, ownerPresent: true })
  }
  else if (message.type === 'released') {
    if (current.ownerTabId === message.from) {
      clearChallenge()
      patch({ ownerTabId: null, ownerPresent: false })
    }
  }
  else if (message.type === 'challenge' && current.isOwner) {
    // The answer is posted directly from the message handler: timers are throttled
    // in hidden tabs, while channel handlers remain prompt.
    post({ type: 'alive', nonce: message.nonce })
  }
  else if (message.type === 'alive') {
    const answered = challenge?.nonce === message.nonce && challenge.ownerTabId === message.from
    if (answered) {
      clearChallenge()
      patch({ ownerTabId: message.from, ownerPresent: true })
    }
  }

  for (const cb of messageListeners) cb(message)
}

function inspectLease(): void {
  if (current.isOwner || challenge)
    return
  const lease = readLease()
  if (!lease) {
    patch({ ownerTabId: null, ownerPresent: false })
    return
  }
  patch({ ownerTabId: lease.tabId, ownerPresent: true })
  if (Date.now() - lease.heartbeatAt <= STALE_MS)
    return

  const nonce = createTabId()
  const timer = window.setTimeout(() => {
    if (challenge?.nonce !== nonce)
      return
    challenge = null
    claim()
  }, CHALLENGE_MS)
  challenge = { nonce, ownerTabId: lease.tabId, timer }
  post({ type: 'challenge', nonce })
}

function startWatchdog(): void {
  if (!inBrowser || watchdogTimer !== null)
    return
  watchdogTimer = window.setInterval(inspectLease, HEARTBEAT_MS)
}

function replaceTransport(next: OwnershipTransport | null): void {
  stopBus?.()
  transport?.close?.()
  transport = next
  stopBus = onBus(handleMessage)
}

/**
 * FIX-auth-identity-lifecycle Step 1 — the account boundary for playback ownership.
 *
 * Releasing is the whole action here. If this tab held the lease it drops it (and tells
 * the others), and either way the local ownership view resets so nothing carries the
 * previous account's owner across. Transport and queue correctness are NOT touched:
 * they belong to ARCH-playback-authority-convergence, and this step deliberately stops
 * at the boundary rather than absorbing them.
 *
 * The lease key itself stays origin-scoped for the same reason — re-keying it per
 * account is an ownership-model change, and one owner per origin remains the right
 * rule: two accounts in one browser still share one pair of speakers.
 */
function resetForAccountChange(): void {
  release()
  clearChallenge()
  stopHeartbeat()
  const lease = readLease()
  current = {
    tabId,
    isOwner: false,
    ownerTabId: lease?.tabId ?? null,
    ownerPresent: lease !== null,
  }
  emit()
}

if (inBrowser) {
  stopBus = onBus(handleMessage)
  startWatchdog()
  subscribeAuthIdentity(resetForAccountChange)
  // `pagehide` only, deliberately not `beforeunload`: it fires on every path that
  // `beforeunload` does, and a registered `beforeunload` listener makes the page
  // ineligible for the back/forward cache in some browsers. Adding one here would
  // be a navigation-performance regression introduced by a playback feature, in
  // exchange for nothing — the release already happened.
  window.addEventListener('pagehide', release)
}

export const playbackOwnership = {
  subscribe(cb: () => void): () => void {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
  getSnapshot(): PlaybackOwnershipState {
    return current
  },
  getServerSnapshot(): PlaybackOwnershipState {
    return EMPTY
  },
  claim,
  async ensureOwner(): Promise<boolean> {
    if (!inBrowser)
      return false
    if (!current.isOwner)
      claim()
    return true
  },
  release,
  post,
  onMessage(cb: (message: OwnershipMessage) => void): () => void {
    messageListeners.add(cb)
    return () => messageListeners.delete(cb)
  },
  __reset(): void {
    if (!inBrowser)
      return
    stopHeartbeat()
    clearChallenge()
    removeOwnLease()
    const lease = readLease()
    current = {
      tabId,
      isOwner: false,
      ownerTabId: lease?.tabId ?? null,
      ownerPresent: lease !== null,
    }
    emit()
  },
}

/** Replace only the cross-tab bus; lease storage and watchdog timing stay real. */
export function __setTransport(next: OwnershipTransport | null): void {
  if (!inBrowser)
    return
  replaceTransport(next)
}
