// FEAT-pocket-buckit Step 5b — Spotify Web Playback client.
//
// Design (owner-decided 2026-06-24, "A+"):
//   - v1 streaming token is SINGLE-OWNER, SERVER-MINTED. The browser asks the
//     backend (`GET /api/playback/spotify-token`, Cognito-JWT) for a short-lived
//     access token minted from the owner's `streaming_refresh_token` in the
//     `myblog/spotify` secret. The route is 503-DORMANT until the owner
//     provisions that key, so only the dormant path is reachable today.
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

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string | undefined
const TOKEN_PATH = '/api/playback/spotify-token'
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
      // TODO(live path): the player closes over this token; when the live path is
      // provisioned, re-mint via getStreamingToken() here so it survives expires_in.
      getOAuthToken: cb => cb(token),
    })
    p.addListener('ready', ({ device_id }) => {
      if (device_id) {
        player = p
        deviceId = device_id
        resolve(device_id)
      }
    })
    p.addListener('initialization_error', ({ message }) => reject(new Error(message ?? 'init error')))
    p.addListener('authentication_error', ({ message }) => reject(new Error(message ?? 'auth error')))
    p.addListener('account_error', ({ message }) => reject(new Error(message ?? 'account error')))
    void p.connect()
  })
}

/**
 * SEAM — resolve a provider-neutral target to a Spotify URI at play time.
 *
 * NOT yet implementable: the bucket-item / tracklist shapes surface `albumId` /
 * `trackId` (DB ids) but NO Spotify URI or ISRC, so there is no provider id to
 * play. A real implementation needs a backend/Spotify-search resolve step that
 * does not exist yet. Kept explicit (rather than faked) so the dependency is
 * visible; reached only after a live token, so it never fires in the dormant v1.
 */
async function resolveProviderUri(_target: PlaybackTarget): Promise<string> {
  throw new Error('provider-uri-resolution-not-implemented')
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

  // Live-token path (future-ready; unreachable until the owner provisions the
  // `streaming_refresh_token`). Lazy SDK load + device connect happen only here.
  let device: string
  try {
    device = await ensureConnectedDevice(tok.token)
  }
  catch {
    return { status: 'unsupported', message: messageFor('unsupported') }
  }

  try {
    const uri = await resolveProviderUri(target)
    await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(device)}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${tok.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(target.kind === 'track' ? { uris: [uri] } : { context_uri: uri }),
    })
    return { status: 'ready', message: '재생을 시작했어요.' }
  }
  catch {
    // Live token, but the provider-URI resolve seam (resolveProviderUri) isn't
    // built yet — no Spotify URI/ISRC is surfaced on items. Distinct wording from
    // the 503 dormant so a future PROVISIONED run isn't misread as a token bug.
    return { status: 'dormant', message: '재생 연결을 준비 중이에요. (트랙 식별 기능은 다음 단계)' }
  }
}

/** Tear down the connected player + clear the in-memory token/device caches. */
export function __resetPlaybackState(): void {
  player?.disconnect()
  cachedToken = null
  player = null
  deviceId = null
}
