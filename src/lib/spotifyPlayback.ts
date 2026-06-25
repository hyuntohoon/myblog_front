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
import { getAuthHeader, isLoggedIn } from '@lib/auth'

type SpotifyStreamingTokenResponse = components['schemas']['Backend_SpotifyStreamingTokenResponse']
type PlaybackResolveResponse = components['schemas']['Backend_PlaybackResolveResponse']

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string | undefined
const TOKEN_PATH = '/api/playback/spotify-token'
const RESOLVE_PATH = '/api/playback/resolve'
const SDK_SRC = 'https://sdk.scdn.co/spotify-player.js'

// ── provider-neutral identity ────────────────────────────────────────────────
// Membership stores ISRC / artist+title, resolved to a provider id at play time
// (so the provider stays switchable — YouTube fallback deferred, not built).
export type PlaybackTarget =
	| { kind: 'album', albumId: string, title?: string } |
	{ kind: 'track', trackId: string, title?: string, isrc?: string, artist?: string }

// ── streaming-capability state (generic, NOT owner-specific) ──────────────────
//   ready        — a live token + a connected Premium device (post-provisioning)
//   dormant      — the token route returned 503 (owner has not provisioned yet)
//   unauthorized — caller is not signed in (no token mint attempted)
//   unsupported  — non-Premium / the SDK could not initialise a device
//   error        — a transient token/network failure
export type StreamingStatus = 'ready' | 'dormant' | 'unauthorized' | 'unsupported' | 'error'

export interface PlaybackOutcome {
  status: StreamingStatus
  /** Korean, user-facing, neutral (never leaks owner/account specifics). */
  message: string
}

type TokenResult =
	| { ok: true, token: string, expiresAt: number } |
	{ ok: false, status: Exclude<StreamingStatus, 'ready'> }

// ── token seam (the single swappable source) ──────────────────────────────────
let cachedToken: { token: string, expiresAt: number } | null = null

/**
 * Acquire a short-lived Spotify streaming access token.
 *
 * v1: server-minted, single-owner — a plain authed GET (NOT `apiFetch`, so a
 * play click never triggers the refresh→`goLogin` redirect; a play button must
 * never navigate the page away). An anonymous caller short-circuits to
 * `unauthorized` WITHOUT a network call, so a public review page never mints a
 * token for a visitor.
 *
 * FUTURE: a per-listener variant swaps only this function body.
 */
export async function getStreamingToken(): Promise<TokenResult> {
  if (!isLoggedIn())
    return { ok: false, status: 'unauthorized' }

  if (cachedToken && cachedToken.expiresAt > Date.now() + 5000)
    return { ok: true, token: cachedToken.token, expiresAt: cachedToken.expiresAt }

  if (!BASE)
    return { ok: false, status: 'error' }

  let res: Response
  try {
    res = await fetch(`${BASE}${TOKEN_PATH}`, { headers: { ...getAuthHeader() } })
  }
  catch {
    return { ok: false, status: 'error' }
  }

  if (res.status === 503)
    return { ok: false, status: 'dormant' }
  if (res.status === 401 || res.status === 403)
    return { ok: false, status: 'unauthorized' }
  if (!res.ok)
    return { ok: false, status: 'error' }

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
interface SpotifyPlayer {
  connect: () => Promise<boolean>
  disconnect: () => void
  addListener: (event: string, cb: (payload: SpotifyListenerPayload) => void) => boolean
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
 * (CloudFront injects x-origin-verify); a plain fetch — NOT `apiFetch` — so a play click
 * never triggers the 401→`goLogin` redirect (matches `getStreamingToken`).
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
  unauthorized: '로그인 후 Spotify Premium이 연결되면 재생할 수 있어요.',
  unsupported: 'Spotify Premium 계정이 필요해요. (미리듣기는 추후 지원)',
  error: '재생 토큰을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.',
}

function messageFor(status: Exclude<StreamingStatus, 'ready'>): string {
  return STATUS_MESSAGE[status]
}

/**
 * The explicit play action — the ONLY entry that mints a token or loads the SDK.
 *
 * Order matters: token FIRST. In dormant v1 the 503 short-circuits BEFORE the SDK
 * is pulled, so a dormant play makes one async token call and no 1MB SDK download
 * — and the negative test (no `spotify-player.js` after a dormant play) holds.
 */
export async function requestPlayback(target: PlaybackTarget): Promise<PlaybackOutcome> {
  const tok = await getStreamingToken()
  if (!tok.ok)
    return { status: tok.status, message: messageFor(tok.status) }

  // Live-token path. Lazy SDK load + device connect happen only here (post Step 1 the
  // token route returns 200, so this is now reachable for the owner on a Premium session).
  let device: string
  try {
    device = await ensureConnectedDevice(tok.token)
  }
  catch (e) {
    // Only account_error (non-Premium — the Web Playback SDK requires Premium) maps to
    // 'unsupported' (the Premium message). auth_error (bad token), init_error (device init),
    // and an SDK-script load failure are transient/unknown → 'error', so a Premium user on a
    // flaky network is never wrongly told they need a Premium account. Both distinct from
    // dormant (the 503 provisioning state, short-circuited above).
    const reason = e instanceof Error ? e.message : ''
    const status: Exclude<StreamingStatus, 'ready'> = reason === 'account_error' ? 'unsupported' : 'error'
    return { status, message: messageFor(status) }
  }

  let uri: string
  try {
    uri = await resolveProviderUri(target)
  }
  catch {
    // No resolvable Spotify id for this item (resolve 404) or the resolve call failed —
    // distinct from dormant (a provisioning state, already short-circuited above).
    return { status: 'unsupported', message: '이 항목은 Spotify에서 재생할 수 없어요.' }
  }

  let playRes: Response
  try {
    playRes = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(device)}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${tok.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(target.kind === 'track' ? { uris: [uri] } : { context_uri: uri }),
    })
  }
  catch {
    return { status: 'error', message: messageFor('error') }
  }
  // 403/404 from the play call = restriction or the track is unavailable in the account's
  // market (OQ5) — surface a clear notice rather than a false 'started'.
  if (!playRes.ok) {
    if (playRes.status === 403 || playRes.status === 404)
      return { status: 'unsupported', message: '이 트랙은 현재 계정/지역에서 재생할 수 없어요.' }
    return { status: 'error', message: messageFor('error') }
  }
  return { status: 'ready', message: '재생을 시작했어요.' }
}

/** Tear down the connected player + clear the in-memory token/device caches. */
export function __resetPlaybackState(): void {
  player?.disconnect()
  cachedToken = null
  player = null
  deviceId = null
}
