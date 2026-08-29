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

export type OwnershipMessage =
	| { type: 'claimed', from: string } |
	{ type: 'released', from: string } |
	{ type: 'challenge', from: string, nonce: string } |
	{ type: 'alive', from: string, nonce: string } |
	{ type: 'state', from: string, state: unknown } |
	{ type: 'command', from: string, cmd: unknown } |
	{ type: 'sync-request', from: string }

type OutboundMessage = OwnershipMessage extends infer Message ?
  Message extends OwnershipMessage ?
    Omit<Message, 'from'> :
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
  const message = value as { type?: unknown, from?: unknown }
  if (typeof message.from !== 'string')
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
  postBus({ ...message, from: tabId } as OwnershipMessage)
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

if (inBrowser) {
  stopBus = onBus(handleMessage)
  startWatchdog()
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
