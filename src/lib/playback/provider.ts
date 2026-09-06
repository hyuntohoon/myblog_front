import type { PlayerCommand, PlayerCommandOutcome, PlayIntent, PlayOutcome } from '@lib/spotifyPlayback'
import * as spotify from '@lib/spotifyPlayback'
import * as youtube from '@lib/youtubePlayback'
import { playbackOwnership } from './ownership'
import { resolveUriDetailed } from './uris'

export interface ProviderState {
  provider: 'spotify' | 'youtube'
  trackId: string | null
  title: string | null
  videoId: string | null
  needsMapping: boolean
  mappingTrackId: string | null
  mappingTitle: string | null
}

const EMPTY: ProviderState = {
  provider: 'spotify',
  trackId: null,
  title: null,
  videoId: null,
  needsMapping: false,
  mappingTrackId: null,
  mappingTitle: null,
}
let current: ProviderState = { ...EMPTY }
let generation = 0
let startingYouTube = false
let pendingStart: { attempt: number, cancel: () => void } | null = null
const YOUTUBE_START_TIMEOUT_MS = 10000
const listeners = new Set<() => void>()

function patch(update: Partial<ProviderState>): void {
  current = { ...current, ...update }
  for (const listener of listeners) listener()
}

export const providerStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  getSnapshot: () => current,
  getServerSnapshot: () => EMPTY,
}

export function getActiveProvider(): ProviderState['provider'] {
  return current.provider
}

export function getYouTubeNowPlaying(): youtube.YouTubeNowPlaying | null {
  return current.provider === 'youtube' ? youtube.getNowPlaying() : null
}

export function clearMappingPrompt(): void {
  patch({ needsMapping: false, mappingTrackId: null, mappingTitle: null })
}

/** Closing/navigation cancels pending work as well as stopping the visible player. */
export function closeYouTubePlayer(): void {
  generation++
  cancelPendingStart()
  youtube.setYouTubeHost(null)
  patch({ provider: 'spotify', trackId: null, title: null, videoId: null })
}

export function __resetProviderState(): void {
  generation++
  cancelPendingStart()
  current = { ...EMPTY }
}

const CANCELLED: PlayOutcome = { ok: false, reason: 'transient', message: '재생 요청이 취소됐어요' }

function cancelPendingStart(): void {
  pendingStart?.cancel()
  pendingStart = null
  startingYouTube = false
}

/** A destroyed iframe (or a blocked API script) may never call back. */
async function startYouTube(attempt: number, videoId: string, title?: string): Promise<PlayOutcome> {
  startingYouTube = true
  let cancel!: () => void
  const cancelled = new Promise<PlayOutcome>((resolve) => {
    cancel = () => resolve(CANCELLED)
  })
  const pending = { attempt, cancel }
  pendingStart = pending
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<PlayOutcome>((resolve) => {
    timer = setTimeout(() => {
      resolve({ ok: false, reason: 'transient', message: 'YouTube 플레이어 응답이 없어요. 잠시 후 다시 눌러주세요' })
      if (attempt === generation)
        closeYouTubePlayer()
    }, YOUTUBE_START_TIMEOUT_MS)
  })
  const startup = async (): Promise<PlayOutcome> => {
    try {
      // Do not enter the adapter's uncancellable loader wait. If loading later
      // completes after close/timeout, this generation gate prevents creation.
      await youtube.loadIframeApi()
      if (attempt !== generation)
        return CANCELLED
      const outcome = await youtube.play({ kind: 'track', videoId, title })
      if (attempt !== generation) {
        // A stale onReady can mutate the adapter's singleton even after destroy.
        // Stop a mismatched player rather than adopt that abandoned request.
        if (current.provider !== 'youtube')
          youtube.setYouTubeHost(null)
        else if (youtube.getNowPlaying()?.videoId !== current.videoId)
          closeYouTubePlayer()
        return CANCELLED
      }
      return outcome
    }
    catch {
      return { ok: false, reason: 'transient', message: 'YouTube 플레이어를 불러오지 못했어요' }
    }
  }
  try {
    return await Promise.race([startup(), cancelled, deadline])
  }
  finally {
    clearTimeout(timer)
    if (pendingStart === pending) {
      pendingStart = null
      startingYouTube = false
    }
  }
}

async function waitForHost(attempt: number): Promise<boolean> {
  const deadline = Date.now() + 1000
  while (Date.now() < deadline) {
    if (attempt !== generation || youtube.getYouTubeHost())
      break
    await new Promise(resolve => setTimeout(resolve, 16))
  }
  return attempt === generation && youtube.getYouTubeHost() !== null
}

/**
 * A rejected pause can mean Spotify was already paused. Verify silence fresh.
 * The lyrics reader collapses playing podcasts/ads into idle and deduplicates
 * in-flight reads, so it cannot prove that Spotify is silent after this pause.
 */
async function verifySpotifySilent(): Promise<boolean> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<boolean>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort()
      resolve(false)
    }, 5000)
  })
  const read = async (): Promise<boolean> => {
    try {
      const token = await spotify.getStreamingToken()
      if (!token.ok || controller.signal.aborted)
        return false
      const response = await fetch('https://api.spotify.com/v1/me/player', {
        headers: { Authorization: `Bearer ${token.token}` },
        signal: controller.signal,
      })
      if (response.status === 204)
        return true
      if (!response.ok)
        return false
      const body: unknown = await response.json()
      return body !== null && typeof body === 'object' && 'is_playing' in body && body.is_playing === false
    }
    catch {
      return false
    }
  }
  try {
    // Token minting and body parsing can also stall; aborting fetch alone does
    // not settle either wait. A late token must not start a read after expiry.
    return await Promise.race([read(), deadline])
  }
  finally {
    clearTimeout(timeout)
  }
}

/**
 * Only explicit catalog-track presses can select YouTube. A null result means
 * the caller must execute its existing Spotify path, including its queue rules.
 */
export async function tryPlayYouTubeTrack(intent: Extract<PlayIntent, { kind: 'track' }>): Promise<PlayOutcome | null> {
  // The IFrame adapter cannot accept another start before its first onReady.
  // Reject before advancing generation so the accepted request still completes.
  if (startingYouTube)
    return { ok: false, reason: 'transient', message: '영상을 여는 중이에요. 잠시 후 다시 눌러주세요' }
  const attempt = ++generation
  let resolution
  try {
    resolution = await resolveUriDetailed(intent.trackId, 'youtube')
  }
  catch {
    // An unavailable resolver does not remove the incumbent Spotify play path.
    resolution = { kind: 'transient' } as const
  }
  if (attempt !== generation)
    return CANCELLED
  if (resolution.kind !== 'uri') {
    if (resolution.kind === 'gone')
      patch({ needsMapping: true, mappingTrackId: intent.trackId, mappingTitle: intent.title ?? null })
    else clearMappingPrompt()
    return null
  }
  const videoId = youtube.videoIdFromUri(resolution.uri)
  if (!videoId)
    return null

  if (!await playbackOwnership.ensureOwner())
    return { ok: false, reason: 'transient', message: '재생 권한을 가져오지 못했어요. 다시 눌러주세요' }
  if (attempt !== generation)
    return CANCELLED
  if (current.provider === 'spotify') {
    const paused = await spotify.sendPlayerCommand({ kind: 'pause' })
    if (attempt !== generation)
      return CANCELLED
    // No connected/active Spotify device means there is no sound to stop.
    // A transport failure must not produce two simultaneous players.
    const absentDevice = !paused.ok && paused.reason === 'no-active-device'
    const absentAccount = !paused.ok && paused.reason === 'token' && ['disconnected', 'dormant', 'unauthorized'].includes(paused.status)
    const absent = absentDevice || absentAccount
    if (!paused.ok && !absent) {
      const silent = await verifySpotifySilent()
      if (attempt !== generation)
        return CANCELLED
      if (!silent)
        return { ok: false, reason: 'transient', message: 'Spotify 재생을 멈추지 못했어요. 잠시 후 다시 눌러주세요' }
    }
  }
  patch({ provider: 'youtube', trackId: intent.trackId, title: intent.title ?? null, videoId,    needsMapping: false, mappingTrackId: null, mappingTitle: null })
  if (!await waitForHost(attempt)) {
    if (attempt !== generation)
      return CANCELLED
    closeYouTubePlayer()
    return { ok: false, reason: 'transient', message: 'YouTube 플레이어를 열 수 없어요. 창 너비를 480px 이상으로 넓혀 다시 눌러주세요' }
  }
  const outcome = await startYouTube(attempt, videoId, intent.title)
  if (attempt !== generation) {
    // A delayed IFrame callback must not resurrect a closed player's state.
    if (current.provider !== 'youtube')
      youtube.setYouTubeHost(null)
    return outcome.ok ? CANCELLED : outcome
  }
  if (!outcome.ok && outcome.reason === 'unavailable')
    patch({ needsMapping: true, mappingTrackId: intent.trackId, mappingTitle: intent.title ?? null })
  return outcome
}

function prepareSpotify(): void {
  generation++
  cancelPendingStart()
  if (current.provider === 'youtube') {
    youtube.setYouTubeHost(null)
    patch({ provider: 'spotify', trackId: null, title: null, videoId: null })
  }
}

export async function play(intent: PlayIntent): Promise<PlayOutcome> {
  if (intent.kind === 'track') {
    const mapped = await tryPlayYouTubeTrack(intent)
    if (mapped)
      return mapped
  }
  // Albums, explicit tails, and contexts are always Spotify-owned.
  prepareSpotify()
  return spotify.play(intent)
}

export async function sendPlayerCommand(cmd: PlayerCommand): Promise<PlayerCommandOutcome> {
  if (cmd.kind === 'play-context' || cmd.kind === 'play-uris') {
    prepareSpotify()
    return spotify.sendPlayerCommand(cmd)
  }
  if (current.provider === 'spotify')
    return spotify.sendPlayerCommand(cmd)
  if (cmd.kind === 'play' || cmd.kind === 'pause' || cmd.kind === 'seek')
    return youtube.sendPlayerCommand(cmd)
  return { ok: false, reason: 'no-capability' }
}

export async function sendPlaybackMode(cmd: Parameters<typeof spotify.sendPlaybackMode>[0]): Promise<spotify.PlaybackModeOutcome> {
  return current.provider === 'youtube' ? youtube.sendPlaybackMode() : spotify.sendPlaybackMode(cmd)
}

export async function listDevices(): Promise<spotify.DeviceListOutcome> {
  return current.provider === 'youtube' ? youtube.listDevices() : spotify.listDevices()
}

export async function transferPlayback(...args: Parameters<typeof spotify.transferPlayback>): Promise<spotify.TransferOutcome> {
  return current.provider === 'youtube' ? youtube.transferPlayback() : spotify.transferPlayback(...args)
}

export type TrackLikedOutcome = spotify.TrackLikedOutcome | { ok: false, reason: 'no-capability' }
export type SetTrackLikedOutcome = spotify.SetTrackLikedOutcome | { ok: false, reason: 'no-capability' }

export async function getTrackLiked(trackId: string): Promise<TrackLikedOutcome> {
  return current.provider === 'youtube' ? youtube.getTrackLiked() : spotify.getTrackLiked(trackId)
}

export async function setTrackLiked(trackId: string, liked: boolean): Promise<SetTrackLikedOutcome> {
  return current.provider === 'youtube' ? youtube.setTrackLiked() : spotify.setTrackLiked(trackId, liked)
}
