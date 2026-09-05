// FEAT-pocket-buckit Step 5b — Spotify Web Playback client.
//
// Design (owner-decided 2026-06-24, "A+"):
//   - v1 streaming token is SINGLE-OWNER, SERVER-MINTED. The browser asks the
//     backend (`GET /api/playback/spotify-token`, Cognito-JWT) for a short-lived
//     access token minted from the owner's `streaming_refresh_token` in the
//     `myblog/spotify` secret. (Provisioned 2026-06-25 — the route now returns 200;
//     the live play path below is active for the owner on a Premium session.)
//   - The SDK script + the token mint are LAZY: they fire ONLY inside an explicit
//     `requestPlayback()` call (a real play action). Importing this module, the
//     tray mount, an anonymous visitor, and a public review page must NEVER pull
//     `spotify-player.js` or mint a token. (rule #9 — no synchronous Spotify call
//     on a user-facing endpoint; the only server hit is the async token mint.)
//   - FUTURE-READY SEAMS (no multi-user code built now): token acquisition lives
//     behind the single `getStreamingToken()` function — a later per-listener
//     OAuth flow (a new `spotifyAuth.ts`, NOT a change to Cognito `auth.ts`) swaps
//     only that source, callers unchanged. Identity is provider-neutral
//     (`PlaybackTarget`), resolved to a provider URI at play time via the
//     `resolveProviderUri` seam. No `owner_id` / singleton assumption is baked in.
import type { components } from '@lib/api.gen'
import { getAuthHeader, isLoggedIn, refreshAccessToken } from '@lib/auth'

type SpotifyStreamingTokenResponse = components['schemas']['Backend_SpotifyStreamingTokenResponse']
type PlaybackResolveResponse = components['schemas']['Backend_PlaybackResolveResponse']

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string | undefined
const TOKEN_PATH = '/api/playback/spotify-token'
const RESOLVE_PATH = '/api/playback/resolve'
const SDK_SRC = 'https://sdk.scdn.co/spotify-player.js'
const PLAYER_BASE = 'https://api.spotify.com/v1/me/player'
const LIBRARY_TRACKS = 'https://api.spotify.com/v1/me/tracks'

/** Cross-island signal emitted after a Connect target starts successfully. */
export const MYBLOG_PLAYBACK_CHANGED = 'myblog:playback-changed'

// ── playback target identity ─────────────────────────────────────────────────
// CORRECTED 2026-09-05 (FEAT-youtube-playback-provider Step A1). This block used
// to read "Membership stores ISRC / artist+title, resolved to a provider id at
// play time", repeating a FEAT-pocket-buckit D3 claim that never shipped.
//
// What membership actually stores is `review_bucket_items.track_id`, a foreign
// key to the catalog `tracks.id` — on all 29 production playback rows. The type
// below says so itself: `trackId` is required and `isrc`/`artist` are optional
// display hints, not the identity. There is no ISRC-or-artist+title resolution
// step here and there never was.
//
// That is false IN OUR FAVOUR: adding a second provider needs nothing unwound.
// The provider is a property of the PLAY ATTEMPT, not of the track — the same
// queue row plays either way, and `GET /api/playback/resolve` takes an optional
// `provider` param (defaulting to spotify) to say which one is being asked for.
export type PlaybackTarget =
	| { kind: 'album', albumId: string, title?: string } |
	{ kind: 'track', trackId: string, title?: string, isrc?: string, artist?: string }

// ── streaming-capability state (generic, NOT owner-specific) ──────────────────
//   ready        — a live token + a connected Premium device (post-provisioning)
//   dormant      — the token route returned 503 (playback not configured server-side)
//   disconnected — the token route returned 404: this member has no connected
//                  Spotify integration (member-player Step 2 mint contract —
//                  also what a revoked row returns after its first 502)
//   unauthorized — caller is not signed in (no token mint attempted)
//   unsupported  — non-Premium / the SDK could not initialise a device
//   error        — a transient token/network/provider failure
export type StreamingStatus = 'ready' | 'dormant' | 'disconnected' | 'unauthorized' | 'unsupported' | 'error'

export interface PlaybackOutcome {
  status: StreamingStatus
  /** Korean, user-facing, neutral (never leaks owner/account specifics). */
  message: string
}

type TokenResult =
	| { ok: true, token: string, expiresAt: number } |
	{ ok: false, status: Exclude<StreamingStatus, 'ready'>, httpStatus?: number }

// ── token seam (the single swappable source) ──────────────────────────────────
let cachedToken: { token: string, expiresAt: number } | null = null
let inflightMint: Promise<TokenResult> | null = null

/**
 * Acquire a short-lived Spotify streaming access token.
 *
 * Per-member since member-player Step 2 (the route mints from the caller's own
 * row-scoped refresh token; the owner path is a special case server-side) — a
 * plain authed GET rather than `apiFetch`: a 401 refreshes Cognito once and
 * retries the mint, but a failed refresh never triggers `goLogin` (a play
 * button must never navigate the page away). An anonymous caller short-circuits to `unauthorized` WITHOUT a
 * network call, so a public review page never mints a token for a visitor.
 * Concurrent callers (card mount + live read fire together) share one in-flight
 * mint instead of racing two.
 */
export async function getStreamingToken(): Promise<TokenResult> {
  if (!isLoggedIn())
    return { ok: false, status: 'unauthorized' }

  if (cachedToken && cachedToken.expiresAt > Date.now() + 5000)
    return { ok: true, token: cachedToken.token, expiresAt: cachedToken.expiresAt }

  if (!BASE)
    return { ok: false, status: 'error' }

  if (inflightMint)
    return inflightMint

  inflightMint = mintOnce()
  try {
    return await inflightMint
  }
  finally {
    inflightMint = null
  }
}

async function mintOnce(): Promise<TokenResult> {
  const initialHeaders = getAuthHeader()
  let res: Response
  try {
    res = await fetch(`${BASE}${TOKEN_PATH}`, { headers: { ...initialHeaders } })
  }
  catch {
    return { ok: false, status: 'error' }
  }

  // This endpoint is protected by the API Gateway Cognito authorizer. Unlike
  // apiFetch, playback must not redirect away from a play click, but it still
  // needs the same one-time expired-access-token recovery. If another request
  // refreshed storage while this mint was in flight, retry with that token
  // instead of starting a redundant refresh.
  if (res.status === 401) {
    let retryHeaders = getAuthHeader()
    if (retryHeaders.Authorization === initialHeaders.Authorization) {
      const refreshed = await refreshAccessToken()
      if (!refreshed)
        return { ok: false, status: 'unauthorized', httpStatus: 401 }
      retryHeaders = getAuthHeader()
    }
    try {
      res = await fetch(`${BASE}${TOKEN_PATH}`, { headers: { ...retryHeaders } })
    }
    catch {
      return { ok: false, status: 'error' }
    }
  }

  if (res.status === 503)
    return { ok: false, status: 'dormant', httpStatus: 503 }
  // 404 = this member has no connected ('connected'-status) Spotify integration
  // (member-player Step 2 route contract) — a capability state, not an error.
  if (res.status === 404)
    return { ok: false, status: 'disconnected', httpStatus: 404 }
  if (res.status === 401 || res.status === 403)
    return { ok: false, status: 'unauthorized', httpStatus: res.status }
  if (!res.ok)
    return { ok: false, status: 'error', httpStatus: res.status }

  let body: SpotifyStreamingTokenResponse
  try {
    body = (await res.json()) as SpotifyStreamingTokenResponse
  }
  catch {
    return { ok: false, status: 'error' }
  }
  if (!body?.access_token)
    return { ok: false, status: 'error' }

  cachedToken = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 0) * 1000 }
  return { ok: true, token: cachedToken.token, expiresAt: cachedToken.expiresAt }
}

// ── lazy SDK loader (fires only from the live-token branch of requestPlayback) ─
interface SpotifyListenerPayload { device_id?: string, message?: string }
interface SpotifyPlaybackState {
  paused: boolean
  /** Playhead, in ms. Read since ARCH-playback-authority-convergence Step 1 — see the listener. */
  position?: number
  track_window: { current_track: { id: string | null } }
}
interface SpotifyPlayerAddListener {
  (event: 'player_state_changed', cb: (state: SpotifyPlaybackState | null) => void): boolean
  (event: string, cb: (payload: SpotifyListenerPayload) => void): boolean
}
interface SpotifyPlayer {
  connect: () => Promise<boolean>
  disconnect: () => void
  addListener: SpotifyPlayerAddListener
}
interface SpotifyNamespace {
  Player: new (opts: {
    name: string
    getOAuthToken: (cb: (token: string) => void) => void
    volume?: number
  }) => SpotifyPlayer
}

declare global {
  interface Window {
    Spotify?: SpotifyNamespace
    onSpotifyWebPlaybackSDKReady?: () => void
  }
}

let sdkPromise: Promise<SpotifyNamespace> | null = null

/** True once `spotify-player.js` has been injected — the negative-test signal. */
export function isSdkLoaded(): boolean {
  if (typeof document === 'undefined')
    return false
  return !!document.querySelector('script[data-spotify-sdk]')
}

function ensureSdk(): Promise<SpotifyNamespace> {
  if (sdkPromise)
    return sdkPromise
  sdkPromise = new Promise<SpotifyNamespace>((resolve, reject) => {
    if (window.Spotify) {
      resolve(window.Spotify)
      return
    }
    window.onSpotifyWebPlaybackSDKReady = () => {
      if (window.Spotify)
        resolve(window.Spotify)
      else reject(new Error('spotify sdk ready without namespace'))
    }
    const script = document.createElement('script')
    script.src = SDK_SRC
    script.async = true
    script.dataset.spotifySdk = 'true'
    script.addEventListener('error', () => reject(new Error('spotify sdk failed to load')))
    document.head.appendChild(script)
  })
  return sdkPromise
}

let player: SpotifyPlayer | null = null
let deviceId: string | null = null
/**
 * Last track id this tab's own in-page (rung 2) SDK device reported, so
 * `player_state_changed` can tell "the track changed" from "the SDK re-fired
 * with nothing new" (it does, e.g. on volume/position-only updates).
 */
let lastSdkTrackId: string | null = null
/**
 * Last playhead this tab's own SDK device reported, so the listener can see a
 * track RESTART — the one playback transition that changes nothing about identity.
 */
let lastSdkPositionMs = 0
/**
 * A backwards jump of at least this much, landing near the start, is a new playback
 * epoch rather than a scrub. Sized to separate "restarted" from "the member nudged
 * the playhead": ordinary seeks land anywhere, a repeat lands at ~0.
 */
const EPOCH_RESTART_MS = 5_000
/**
 * Which rung last produced sound, or null before any play this session.
 *
 * Only meaningful as "where the last successful play went" — Spotify may move
 * playback elsewhere without telling us (D28: no polling, so we do not watch for
 * it). Transport commands use it to decide whether to address our own device
 * explicitly; a stale value costs one 404, never a wrong device.
 */
let activeRung: PlayRung | null = null

/** The in-page device id, or null if this tab has never been raised as a device. */
export function getInPageDeviceId(): string | null {
  return deviceId
}

/** The rung that last produced sound this session. */
export function getActiveRung(): PlayRung | null {
  return activeRung
}

function notifyPlaybackChanged(): void {
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(MYBLOG_PLAYBACK_CHANGED))
}

/**
 * Lazy-load the SDK and connect a Premium device, returning its device_id.
 * Reached ONLY once a live token exists (post-provisioning). A non-Premium
 * account surfaces as `account_error` → rejects, mapped to `unsupported`.
 */
async function ensureConnectedDevice(token: string): Promise<string> {
  if (deviceId)
    return deviceId
  const Spotify = await ensureSdk()
  return new Promise<string>((resolve, reject) => {
    const p = new Spotify.Player({
      name: 'Buckit',
      volume: 0.8,
      // The SDK calls this on connect AND whenever it needs a fresh token (near expiry /
      // on 401), so re-mint via getStreamingToken() — which caches with a 5s skew, so
      // steady-state calls are cheap — to survive a session longer than expires_in
      // (~3600s, OQ3). On a re-mint failure, best-effort hand back the initial token (if it
      // has itself expired the SDK call still fails, but that's no worse than not answering).
      getOAuthToken: cb => void getStreamingToken().then(r => cb(r.ok ? r.token : token)),
    })
    p.addListener('ready', ({ device_id }) => {
      if (device_id) {
        player = p
        deviceId = device_id
        resolve(device_id)
      }
    })
    p.addListener('initialization_error', () => reject(new Error('init_error')))
    p.addListener('authentication_error', () => reject(new Error('auth_error')))
    p.addListener('account_error', () => reject(new Error('account_error')))
    // Rung 2 has a real push signal for "the track changed" that rung 1 (Connect
    // remote) simply does not — the SDK fires this on every state change,
    // including a natural end-of-track auto-advance. Only act on an actual track
    // change (the SDK also fires on position/volume-only updates), and route it
    // through the SAME `MYBLOG_PLAYBACK_CHANGED` plumbing every other trigger
    // uses — not a new signal, so the session's existing race-safe `adoptLive()`
    // handles it identically to any other confirmed change. Not polling: this is
    // a push event, fired zero times when nothing changes.
    p.addListener('player_state_changed', (state) => {
      const trackId = state?.track_window?.current_track?.id ?? null
      const positionMs = typeof state?.position === 'number' ? state.position : lastSdkPositionMs
      // REPEAT-ONE (ARCH-playback-authority-convergence Step 1). Identity alone
      // cannot see A → A: with repeat set to `track`, the song ends and starts
      // again with the same id, this listener returned early, no
      // `MYBLOG_PLAYBACK_CHANGED` was dispatched, and every consumer's clock stayed
      // parked on the last line for the whole second play. A playback EPOCH is
      // `trackId` *plus* position continuity — so a same-track state whose playhead
      // has jumped backwards to ~0 is a change, and is announced as one.
      const sameTrack = trackId !== null && trackId === lastSdkTrackId
      const rewound = lastSdkPositionMs - positionMs >= EPOCH_RESTART_MS
      const restarted = sameTrack && rewound && positionMs < EPOCH_RESTART_MS
      lastSdkPositionMs = positionMs
      if (trackId === lastSdkTrackId && !restarted)
        return
      lastSdkTrackId = trackId
      notifyPlaybackChanged()
    })
    void p.connect()
  })
}

/**
 * SEAM — resolve a provider-neutral target to a Spotify URI at play time
 * (FEAT-spotify-streaming-playback Step 2/3).
 *
 * Both ▶ sites pass only a DB id, so this calls the backend resolve endpoint
 * (`GET /api/playback/resolve?type=&id=` → `{ uri }`), which reads the catalog's stored
 * `spotify_id` (a direct DB read, no Spotify search). It is an edge_guard-only endpoint
 * (CloudFront injects x-origin-verify); a plain fetch keeps a play click outside
 * `apiFetch`'s redirect-on-failed-refresh behavior (matching the token flow's
 * no-navigation guarantee).
 */
async function resolveProviderUri(target: PlaybackTarget): Promise<string> {
  if (!BASE)
    throw new Error('resolve-no-base')
  const id = target.kind === 'album' ? target.albumId : target.trackId
  const url = `${BASE}${RESOLVE_PATH}?type=${target.kind}&id=${encodeURIComponent(id)}`
  const res = await fetch(url, { headers: { ...getAuthHeader() } })
  if (!res.ok)
    throw new Error(`resolve-failed-${res.status}`)
  const body = (await res.json()) as PlaybackResolveResponse
  if (!body?.uri)
    throw new Error('resolve-empty')
  return body.uri
}

const STATUS_MESSAGE: Record<Exclude<StreamingStatus, 'ready'>, string> = {
  dormant: 'Spotify Premium 재생이 아직 연결되지 않았어요. 소유자가 스트리밍을 설정하면 켜집니다.',
  disconnected: 'Spotify를 연동하면 재생할 수 있어요. 설정에서 연결해 주세요.',
  unauthorized: '로그인 후 Spotify Premium이 연결되면 재생할 수 있어요.',
  unsupported: 'Spotify Premium 계정이 필요해요. (미리듣기는 추후 지원)',
  error: '재생 토큰을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.',
}

function messageFor(status: Exclude<StreamingStatus, 'ready'>): string {
  return STATUS_MESSAGE[status]
}

// ── the play ladder (member-player Step 5) ───────────────────────────────────
// ONE entry every play surface calls. Before Step 5 the site had two unrelated
// play paths split by build date: `requestPlayback` (SDK, sent device_id, cold
// start worked) and `sendConnectPlay` (Connect remote, deliberately omitted
// device_id, 404'd on cold start). Everything the owner actually used was on the
// second, hence "재생 시작이 안 된다".
//
// The two paths differ by **exactly one query parameter**. Both PUT the same body
// to /v1/me/player/play; only `device_id` differs. So the ladder is not a merge of
// two subsystems — it is one request with a fallback on the parameter:
//
//   rung 1  no device_id      → whatever Connect device is active (DEFAULT)
//   rung 2  device_id=<ours>  → raise this tab as the 'Buckit' device
//   rung 3  neither possible  → notice + "Spotify에서 열기"
//
// Rung 1 first is a correctness argument, not a preference: the Web Playback SDK
// caps at AAC 256 kbps and Spotify Lossless excludes the web player, so remote
// control costs zero audio quality while rung 2 always costs some (RFC D, 2026-08-02).
//
// Rung selection is attempt-then-fallback, NOT a `GET /me/player/devices` probe
// first: the 404 the old path already returned *is* the "no active device" signal,
// so the happy path stays at one request and D28 (no polling) holds by construction.

/**
 * What to play. `album`/`track` carry DB ids resolved at play time (the provider
 * stays switchable); `context`/`uris` are already provider URIs — the lyrics queue
 * jump resolves those itself and must keep its exact tail semantics.
 */
export type PlayIntent =
	| { kind: 'album', albumId: string, title?: string } |
	{ kind: 'track', trackId: string, title?: string, isrc?: string, artist?: string } |
  /** Jump inside the running album/playlist, keeping that context alive. */
	{ kind: 'context', contextUri: string, offsetUri: string } |
  /** Explicit track list — REPLACES the context, so always send the whole tail. */
	{ kind: 'uris', uris: string[] }

/** Which rung actually produced sound. */
export type PlayRung = 'remote' | 'in-page'

/** `degraded` is true on rung 2 — the caller must say the audio is quality-limited. */
export interface PlaySuccess { ok: true, rung: PlayRung, degraded: boolean, message: string }
/** `status`/`httpStatus` are present only for `reason: 'token'`. */
export interface PlayFailure {
	ok: false
	reason: 'no-capability' | 'unresolvable' | 'unavailable' | 'transient' | 'token'
	status?: Exclude<StreamingStatus, 'ready'>
	httpStatus?: number
	message: string
}
export type PlayOutcome = PlaySuccess | PlayFailure

const REMOTE_MESSAGE = '재생을 시작했어요.'
/** Rung 2 is a fallback, not a peer — the UI must not present it as equivalent. */
export const IN_PAGE_MESSAGE = '이 브라우저에서 재생 중 (음질 제한)'

/** The play body for an intent. Throws `resolve-*` when a DB id has no Spotify id. */
async function playBodyFor(intent: PlayIntent): Promise<object> {
  if (intent.kind === 'context')
    return { context_uri: intent.contextUri, offset: { uri: intent.offsetUri } }
  if (intent.kind === 'uris')
    return { uris: intent.uris }
  const uri = await resolveProviderUri(intent)
  return intent.kind === 'album' ? { context_uri: uri } : { uris: [uri] }
}

/** One PUT /me/player/play. `deviceId` omitted = rung 1, present = rung 2. */
async function putPlay(token: string, body: object, deviceId?: string): Promise<Response> {
  const url = deviceId ?
    `${PLAYER_BASE}/play?device_id=${encodeURIComponent(deviceId)}` :
    `${PLAYER_BASE}/play`
  return fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * Start playback, climbing the ladder. Never throws.
 *
 * Token FIRST, before anything else: a dormant (503) or disconnected (404) account
 * short-circuits before the catalog resolve AND before the ~1 MB SDK download, so the
 * negative test (no `spotify-player.js` after a play that cannot possibly sound) holds
 * exactly as it did for the old `requestPlayback`.
 */
export async function play(intent: PlayIntent): Promise<PlayOutcome> {
  // Visitors short-circuit before the token mint and before the catalog resolve.
  if (!isLoggedIn())
    return { ok: false, reason: 'token', status: 'unauthorized', message: messageFor('unauthorized') }

  const first = await getStreamingToken()
  if (!first.ok)
    return { ok: false, reason: 'token', status: first.status, httpStatus: first.httpStatus, message: messageFor(first.status) }

  let body: object
  try {
    body = await playBodyFor(intent)
  }
  catch {
    return { ok: false, reason: 'unresolvable', message: '이 항목은 Spotify에서 재생할 수 없어요.' }
  }

  // ── rung 1: whatever Connect device is already active ──────────────────────
  // Two attempts: a 401 mid-session means the minted token aged out server-side
  // despite the 5 s cache skew — drop the cache and re-mint once.
  let sawNoDevice = false
  for (let attempt = 0; attempt < 2; attempt++) {
    const tok = attempt === 0 ? first : await getStreamingToken()
    if (!tok.ok)
      return { ok: false, reason: 'token', status: tok.status, httpStatus: tok.httpStatus, message: messageFor(tok.status) }
    let res: Response
    try {
      res = await putPlay(tok.token, body)
    }
    catch {
      return { ok: false, reason: 'transient', message: messageFor('error') }
    }
    if (res.ok) {
      activeRung = 'remote'
      notifyPlaybackChanged()
      return { ok: true, rung: 'remote', degraded: false, message: REMOTE_MESSAGE }
    }
    if (res.status === 401 && attempt === 0) {
      cachedToken = null
      continue
    }
    // 404 = no active device. THIS is the cold start the whole step exists to fix:
    // before Step 5 it was a dead end; now it is the hand-off to rung 2.
    if (res.status === 404) {
      sawNoDevice = true
      break
    }
    if (res.status === 403)
      return { ok: false, reason: 'no-capability', message: '이 컨트롤은 Spotify Premium 계정에서 사용할 수 있어요.' }
    return { ok: false, reason: 'transient', message: messageFor('error') }
  }
  if (!sawNoDevice)
    return { ok: false, reason: 'transient', message: messageFor('error') }

  // ── rung 2: raise this tab as the 'Buckit' device ──────────────────────────
  const tok = await getStreamingToken()
  if (!tok.ok)
    return { ok: false, reason: 'token', status: tok.status, httpStatus: tok.httpStatus, message: messageFor(tok.status) }

  let device: string
  try {
    device = await ensureConnectedDevice(tok.token)
  }
  catch (e) {
    // Only account_error (the SDK requires Premium) means "you cannot do this" —
    // rung 3. auth_error / init_error / a failed SDK script load are transient, so a
    // Premium listener on a flaky network is never wrongly told to upgrade.
    const reason = e instanceof Error ? e.message : ''
    if (reason === 'account_error')
      return { ok: false, reason: 'no-capability', message: messageFor('unsupported') }
    return { ok: false, reason: 'transient', message: messageFor('error') }
  }

  let res: Response
  try {
    res = await putPlay(tok.token, body, device)
  }
  catch {
    return { ok: false, reason: 'transient', message: messageFor('error') }
  }
  if (res.ok) {
    activeRung = 'in-page'
    notifyPlaybackChanged()
    return { ok: true, rung: 'in-page', degraded: true, message: IN_PAGE_MESSAGE }
  }
  // 403/404 here is a restriction or a market-unavailable item — never a false 'started'.
  if (res.status === 403 || res.status === 404)
    return { ok: false, reason: 'unavailable', message: '이 트랙은 현재 계정/지역에서 재생할 수 없어요.' }
  return { ok: false, reason: 'transient', message: messageFor('error') }
}

// ── Connect remote transport (member-player Step 3, D1 full tier) ─────────────
// Client-side `PUT /v1/me/player/{play|pause|seek}` against the member's ACTIVE
// device (Spotify Connect remote — no device_id, no SDK download). Same
// sanctioned pattern as the calls above: the only server hit is the async token
// mint (rule #9 holds). Callers run the 403-probe capability model (owner
// decision 5): `no-capability` (403 Premium/scope, 404 no active device)
// degrades the session to the fallback tier.

export type PlayerCommand =
	| { kind: 'play' } |
	{ kind: 'pause' } |
	{ kind: 'seek', positionMs: number } |
  /**
   * Jump to a track INSIDE the current album/playlist, keeping that context
   * alive so Spotify keeps playing past it.
   */
	{ kind: 'play-context', contextUri: string, offsetUri: string } |
  /**
   * Play an explicit track list. REPLACES the playback context — always send
   * the whole tail you want kept, never a lone track.
   */
	{ kind: 'play-uris', uris: string[] } |
	{ kind: 'next' } |
	{ kind: 'previous' } |
  // ── Step 6e playback modes ────────────────────────────────────────────────
  // Same grant as the rest of the transport (`user-modify-playback-state`), so no
  // re-consent. Unlike play/pause these are DEVICE-DEPENDENT: plenty of real
  // Connect targets (speakers, TVs, car heads) accept transport but reject volume,
  // which Spotify answers 403 — the same code as "not Premium". Callers must not
  // read a volume 403 as a capability loss; see `sendPlaybackMode`.
	{ kind: 'shuffle', on: boolean } |
	{ kind: 'repeat', mode: RepeatMode } |
	{ kind: 'volume', percent: number }

/** `context` repeats the album/playlist, `track` repeats one song. */
export type RepeatMode = 'off' | 'context' | 'track'

export type PlayerCommandOutcome =
	| { ok: true } |
  /**
   * 403 — the account or the grant cannot do this. DURABLE: nothing the member
   * does in this tab makes it work, so a caller may disable on it.
   */
	{ ok: false, reason: 'no-capability' } |
  /**
   * 404 — Spotify has no active device to send the command to. RECOVERABLE, and
   * that is the whole point of separating it from `no-capability`: opening the
   * Spotify app, or starting playback anywhere, makes the very same command
   * work. Folding it into `no-capability` is what made a member who simply had
   * no player open look permanently un-Premium (E1).
   */
	{ ok: false, reason: 'no-active-device' } |
	{ ok: false, reason: 'token', status: Exclude<StreamingStatus, 'ready'>, httpStatus?: number } |
	{ ok: false, reason: 'transient' }

/** One transport command to the member's active device. Never throws. */
export async function sendPlayerCommand(cmd: PlayerCommand): Promise<PlayerCommandOutcome> {
  // Address our own device explicitly while rung 2 owns the sound. Spotify treats
  // the in-page device as active once played to, so this is belt-and-braces — but
  // without it, a transport command racing a device change 404s and the bar reads
  // as "no capability" when the real answer is "wrong device".
  const own = activeRung === 'in-page' && deviceId ? deviceId : null
  const q = own ? `device_id=${encodeURIComponent(own)}` : ''
  const withQ = (base: string, existing?: string) => {
    const parts = [existing, q].filter(Boolean)
    return parts.length ? `${base}?${parts.join('&')}` : base
  }
  const url = cmd.kind === 'seek' ?
    withQ(`${PLAYER_BASE}/seek`, `position_ms=${Math.max(0, Math.round(cmd.positionMs))}`) :
    cmd.kind === 'play-context' || cmd.kind === 'play-uris' ?
      withQ(`${PLAYER_BASE}/play`) :
      cmd.kind === 'shuffle' ?
        withQ(`${PLAYER_BASE}/shuffle`, `state=${cmd.on}`) :
        cmd.kind === 'repeat' ?
          withQ(`${PLAYER_BASE}/repeat`, `state=${cmd.mode}`) :
          cmd.kind === 'volume' ?
            withQ(`${PLAYER_BASE}/volume`, `volume_percent=${Math.min(100, Math.max(0, Math.round(cmd.percent)))}`) :
            withQ(`${PLAYER_BASE}/${cmd.kind}`)
  const method = cmd.kind === 'next' || cmd.kind === 'previous' ? 'POST' : 'PUT'
  const body = cmd.kind === 'play-context' ?
    JSON.stringify({ context_uri: cmd.contextUri, offset: { uri: cmd.offsetUri } }) :
    cmd.kind === 'play-uris' ?
      JSON.stringify({ uris: cmd.uris }) :
      undefined
  // OQ4 ANSWERED 2026-08-03 (owner, FEAT-lyrics-viewer-playback): a successful
  // transport command dispatches MYBLOG_PLAYBACK_CHANGED, so a command issued on
  // one surface reaches the others. Until now only `sendConnectPlay` dispatched —
  // which is why FEAT-lyrics-sync-precision's `'command'` residual series had
  // never observed a transport command at all, only "an album was started".
  //
  // Modes are deliberately EXCLUDED. The event means "the playhead or the track
  // moved"; shuffle/repeat/volume move neither, NowPlaying already reconciles them
  // optimistically off the next one-shot, and the lyrics viewer — which has no
  // volume control — would pay one wasted read per slider move.
  const notifies = cmd.kind !== 'shuffle' && cmd.kind !== 'repeat' && cmd.kind !== 'volume'
  // Up to two attempts: a 401 mid-session means the minted token aged out
  // server-side despite the 5s cache skew — drop the cache and re-mint once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const tok = await getStreamingToken()
    if (!tok.ok)
      return { ok: false, reason: 'token', status: tok.status, httpStatus: tok.httpStatus }
    let res: Response
    try {
      res = await fetch(url, body ?
        {
          method,
          body,
          headers: { Authorization: `Bearer ${tok.token}`, 'Content-Type': 'application/json' },
        } :
        { method, headers: { Authorization: `Bearer ${tok.token}` } })
    }
    catch {
      return { ok: false, reason: 'transient' }
    }
    if (res.ok) {
      if (notifies)
        notifyPlaybackChanged()
      return { ok: true }
    }
    if (res.status === 401 && attempt === 0) {
      cachedToken = null
      continue
    }
    // SPLIT (ARCH-playback-authority-convergence Step 3). These two codes were
    // one reason until now, and the comment 100 lines up already said why that
    // was wrong ("a transport command racing a device change 404s and the bar
    // reads as 'no capability' when the real answer is 'wrong device'").
    if (res.status === 403)
      return { ok: false, reason: 'no-capability' }
    if (res.status === 404)
      return { ok: false, reason: 'no-active-device' }
    return { ok: false, reason: 'transient' }
  }
  return { ok: false, reason: 'transient' }
}

// ── 6e playback modes ────────────────────────────────────────────────────────

export type PlaybackModeOutcome =
	| { ok: true } |
	/** The command is fine; THIS device just does not support it (e.g. volume). */
	{ ok: false, reason: 'unsupported-on-device' } |
	{ ok: false, reason: 'no-capability' | 'no-active-device' | 'token' | 'transient' }

/**
 * Shuffle / repeat / volume.
 *
 * A thin wrapper over `sendPlayerCommand` that exists for one reason: **a 403 here
 * does not mean what a 403 on play/pause means.** Many real Connect targets accept
 * transport but reject volume (speakers with fixed output, TVs, car heads), and
 * Spotify answers that with the same 403 it uses for "not Premium". Routing it
 * through the shared 403-probe would degrade the whole session's tier over a
 * device quirk — hiding play/pause because a speaker has no volume API.
 *
 * So volume 403 is reported as `unsupported-on-device` and callers must NOT feed it
 * to `rememberSpotifyTransportProbe`. Shuffle/repeat keep the normal reading, since
 * those are Premium features rather than device features.
 */
export async function sendPlaybackMode(cmd: Extract<PlayerCommand, { kind: 'shuffle' | 'repeat' | 'volume' }>): Promise<PlaybackModeOutcome> {
  const r = await sendPlayerCommand(cmd)
  if (r.ok)
    return { ok: true }
  if (r.reason === 'token')
    return { ok: false, reason: 'token' }
  // Step 3: `no-active-device` was already in this outcome's union and had no
  // producer, because `sendPlayerCommand` never returned it. Now it does, and it
  // passes through unchanged for volume too — a missing device is a missing
  // device whatever the command, never "this speaker has no volume knob".
  if (r.reason === 'no-active-device')
    return { ok: false, reason: 'no-active-device' }
  if (r.reason === 'no-capability') {
    if (cmd.kind === 'volume')
      return { ok: false, reason: 'unsupported-on-device' }
    return { ok: false, reason: 'no-capability' }
  }
  return { ok: false, reason: 'transient' }
}

// ── 6c queue ─────────────────────────────────────────────────────────────────

export type QueueOutcome =
	| { ok: true } |
	{ ok: false, reason: 'no-active-device' | 'no-capability' | 'unresolvable' | 'token' | 'transient', message: string }

/**
 * Append one TRACK to the active device's queue ("다음에 듣기").
 *
 * **Tracks only, and that is an API constraint, not a design choice.** The RFC filed
 * 6c as riding "the same surfaces as 6b", but every 6b surface is album-level and
 * `POST /me/player/queue` documents its uri as *"Must be a track or an episode uri"*
 * — an album would have to be fanned out into one request per track, which is
 * unbounded work behind a single tap. So this takes a track and the album surfaces
 * keep 재생 only.
 *
 * No ladder here either: queueing onto a device that is not playing is meaningless,
 * so a 404 stays a 404 and the caller says "start playing first" rather than silently
 * raising an in-page device to hold a queue nobody is listening to.
 */
export async function queueTrack(target: { trackId: string, title?: string }): Promise<QueueOutcome> {
  if (!isLoggedIn())
    return { ok: false, reason: 'token', message: messageFor('unauthorized') }

  const first = await getStreamingToken()
  if (!first.ok)
    return { ok: false, reason: 'token', message: messageFor(first.status) }

  let uri: string
  try {
    uri = await resolveProviderUri({ kind: 'track', trackId: target.trackId })
  }
  catch {
    return { ok: false, reason: 'unresolvable', message: '이 트랙은 Spotify에서 재생할 수 없어요.' }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const tok = attempt === 0 ? first : await getStreamingToken()
    if (!tok.ok)
      return { ok: false, reason: 'token', message: messageFor(tok.status) }
    let res: Response
    try {
      res = await fetch(`${PLAYER_BASE}/queue?uri=${encodeURIComponent(uri)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok.token}` },
      })
    }
    catch {
      return { ok: false, reason: 'transient', message: messageFor('error') }
    }
    if (res.ok)
      return { ok: true }
    if (res.status === 401 && attempt === 0) {
      cachedToken = null
      continue
    }
    if (res.status === 404)
      return { ok: false, reason: 'no-active-device', message: '재생 중일 때만 대기열에 넣을 수 있어요. 먼저 재생을 시작해 주세요.' }
    if (res.status === 403)
      return { ok: false, reason: 'no-capability', message: '대기열은 Spotify Premium 계정에서 사용할 수 있어요.' }
    return { ok: false, reason: 'transient', message: messageFor('error') }
  }
  return { ok: false, reason: 'transient', message: messageFor('error') }
}

// ── device picker (member-player Step 5, pulled out of the 6e bundle) ────────
// "스포티파이처럼 클릭을 통해서 변경" (owner, 2026-08-02). Read-on-open only —
// the list is fetched when the picker opens, never polled (D28).

export interface PlaybackDevice {
  id: string
  name: string
  type: string
  isActive: boolean
  /** True for the 'Buckit' device this tab raised — the quality-limited one. */
  isInPage: boolean
}

export type DeviceListOutcome =
	| { ok: true, devices: PlaybackDevice[] } |
	{ ok: false, reason: 'no-capability' | 'transient' | 'token' }

interface SpotifyDevicePayload { id?: string | null, name?: string, type?: string, is_active?: boolean }

/** List the account's Connect devices. Never throws. */
export async function listDevices(): Promise<DeviceListOutcome> {
  if (!isLoggedIn())
    return { ok: false, reason: 'token' }
  for (let attempt = 0; attempt < 2; attempt++) {
    const tok = await getStreamingToken()
    if (!tok.ok)
      return { ok: false, reason: 'token' }
    let res: Response
    try {
      res = await fetch(`${PLAYER_BASE}/devices`, { headers: { Authorization: `Bearer ${tok.token}` } })
    }
    catch {
      return { ok: false, reason: 'transient' }
    }
    if (res.ok) {
      try {
        const body = (await res.json()) as { devices?: SpotifyDevicePayload[] }
        const ours = deviceId
        const devices = (body.devices ?? []).flatMap((d) => {
          if (!d.id)
            return []
          return [{
            id: d.id,
            name: d.name ?? '알 수 없는 기기',
            type: d.type ?? '',
            isActive: d.is_active === true,
            isInPage: !!ours && d.id === ours,
          }]
        })
        return { ok: true, devices }
      }
      catch {
        return { ok: false, reason: 'transient' }
      }
    }
    if (res.status === 401 && attempt === 0) {
      cachedToken = null
      continue
    }
    if (res.status === 403)
      return { ok: false, reason: 'no-capability' }
    return { ok: false, reason: 'transient' }
  }
  return { ok: false, reason: 'transient' }
}

export type TransferOutcome =
	| { ok: true } |
	{ ok: false, reason: 'no-capability' | 'transient' | 'token' }

/**
 * Move playback to `targetDeviceId`, keeping it playing.
 *
 * `raiseInPageFirst` exists because the in-page device does not exist until the SDK
 * has connected — picking "이 브라우저" from a cold list must create the device before
 * transferring to it, or the transfer 404s against an id that was never real.
 */
export async function transferPlayback(targetDeviceId: string, opts?: { raiseInPageFirst?: boolean }): Promise<TransferOutcome> {
  if (!isLoggedIn())
    return { ok: false, reason: 'token' }
  const first = await getStreamingToken()
  if (!first.ok)
    return { ok: false, reason: 'token' }

  let id = targetDeviceId
  if (opts?.raiseInPageFirst) {
    try {
      id = await ensureConnectedDevice(first.token)
    }
    catch (e) {
      const reason = e instanceof Error ? e.message : ''
      return { ok: false, reason: reason === 'account_error' ? 'no-capability' : 'transient' }
    }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const tok = attempt === 0 ? first : await getStreamingToken()
    if (!tok.ok)
      return { ok: false, reason: 'token' }
    let res: Response
    try {
      res = await fetch(PLAYER_BASE, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${tok.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_ids: [id], play: true }),
      })
    }
    catch {
      return { ok: false, reason: 'transient' }
    }
    if (res.ok) {
      activeRung = deviceId && id === deviceId ? 'in-page' : 'remote'
      notifyPlaybackChanged()
      return { ok: true }
    }
    if (res.status === 401 && attempt === 0) {
      cachedToken = null
      continue
    }
    if (res.status === 403)
      return { ok: false, reason: 'no-capability' }
    return { ok: false, reason: 'transient' }
  }
  return { ok: false, reason: 'transient' }
}

// ── Liked Songs (member-player Step 6d) ─────────────────────────────────────
// Library permission is intentionally separate from the Premium transport
// capability. Spotify Free accounts may save tracks, so a library 403 has its
// own outcome and must never degrade player controls.

type LibraryFailure =
	| { ok: false, reason: 'library-scope-missing' } |
	{ ok: false, reason: 'token', status: Exclude<StreamingStatus, 'ready'>, httpStatus?: number } |
	{ ok: false, reason: 'transient' }

export type TrackLikedOutcome = { ok: true, liked: boolean } | LibraryFailure
export type SetTrackLikedOutcome = { ok: true } | LibraryFailure

/** Read one Spotify track's saved state. Never throws. */
export async function getTrackLiked(trackId: string): Promise<TrackLikedOutcome> {
  const url = `${LIBRARY_TRACKS}/contains?ids=${encodeURIComponent(trackId)}`
  for (let attempt = 0; attempt < 2; attempt++) {
    const tok = await getStreamingToken()
    if (!tok.ok)
      return { ok: false, reason: 'token', status: tok.status, httpStatus: tok.httpStatus }
    let res: Response
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${tok.token}` } })
    }
    catch {
      return { ok: false, reason: 'transient' }
    }
    if (res.ok) {
      try {
        const values = (await res.json()) as boolean[]
        return { ok: true, liked: values[0] === true }
      }
      catch {
        return { ok: false, reason: 'transient' }
      }
    }
    if (res.status === 401 && attempt === 0) {
      cachedToken = null
      continue
    }
    if (res.status === 403)
      return { ok: false, reason: 'library-scope-missing' }
    return { ok: false, reason: 'transient' }
  }
  return { ok: false, reason: 'transient' }
}

/** Optimistically-called save/remove mutation for one Spotify track. */
export async function setTrackLiked(trackId: string, liked: boolean): Promise<SetTrackLikedOutcome> {
  const url = `${LIBRARY_TRACKS}?ids=${encodeURIComponent(trackId)}`
  for (let attempt = 0; attempt < 2; attempt++) {
    const tok = await getStreamingToken()
    if (!tok.ok)
      return { ok: false, reason: 'token', status: tok.status, httpStatus: tok.httpStatus }
    let res: Response
    try {
      res = await fetch(url, {
        method: liked ? 'PUT' : 'DELETE',
        headers: { Authorization: `Bearer ${tok.token}` },
      })
    }
    catch {
      return { ok: false, reason: 'transient' }
    }
    if (res.ok)
      return { ok: true }
    if (res.status === 401 && attempt === 0) {
      cachedToken = null
      continue
    }
    if (res.status === 403)
      return { ok: false, reason: 'library-scope-missing' }
    return { ok: false, reason: 'transient' }
  }
  return { ok: false, reason: 'transient' }
}

/** Tear down the connected player + clear the in-memory token/device caches. */
export function __resetPlaybackState(): void {
  lastSdkPositionMs = 0
  player?.disconnect()
  cachedToken = null
  player = null
  deviceId = null
  activeRung = null
  sdkPromise = null
  lastSdkTrackId = null
}
