import type { components } from './api.gen'
import { apiFetch } from './api'
import { invalidateUri } from './playback/uris'

export type YouTubeCandidate = components['schemas']['Music_YouTubeCandidateItem']
export type YouTubeCandidates = components['schemas']['Music_YouTubeCandidateSearchResult']

const MUSIC = import.meta.env.PUBLIC_API_URL as string | undefined
const BACKEND = import.meta.env.PUBLIC_BACKEND_API_URL as string | undefined

export async function youtubeMappingError(response: Response | null): Promise<string> {
  if (!response)
    return '연결하지 못했어요. 잠시 후 다시 시도해 주세요.'
  if (response.status === 403)
    return '이 트랙을 내 버킷에 담은 뒤 영상을 고를 수 있어요.'
  if (response.status === 429) {
    const body = await response.json().catch(() => null) as { detail?: string } | null
    const quotaExhausted = typeof body?.detail === 'string' && body.detail.startsWith('youtube_quota_exhausted')
    const retry = response.headers.get('Retry-After')
    const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? Math.max(0, Math.ceil((Date.parse(retry) - Date.now()) / 1000)) : null
    if (quotaExhausted || (seconds !== null && seconds > 60))
      return '오늘의 YouTube 검색 한도에 도달했어요. 한도가 초기화된 뒤 다시 시도해 주세요.'
    return seconds !== null && Number.isFinite(seconds) ?
      `요청이 잠시 몰렸어요. ${Math.max(1, seconds)}초 후 다시 시도해 주세요.` :
      '요청이 잠시 몰렸어요. 잠시 후 다시 시도해 주세요.'
  }
  if (response.status === 503)
    return 'YouTube 연결을 잠시 사용할 수 없어요. 나중에 다시 시도해 주세요.'
  if (response.status === 422) {
    const body = await response.json().catch(() => null) as { detail?: string | { code?: string } } | null
    const code = typeof body?.detail === 'string' ? body.detail : body?.detail?.code
    if (code?.startsWith('youtube_video_unusable'))
      return '이 영상은 삭제되었거나 여기서 재생할 수 없어요. 다른 영상을 골라 주세요.'
    return '이 영상을 연결할 수 없어요. 다른 영상을 골라 주세요.'
  }
  return '요청을 처리하지 못했어요. 다시 시도해 주세요.'
}

export async function searchYouTubeCandidates(trackId: string, signal: AbortSignal): Promise<YouTubeCandidates | string> {
  const response = await apiFetch(`${MUSIC ?? ''}/api/music/search/youtube-candidates?${new URLSearchParams({ track_id: trackId, limit: '5' })}`, { signal })
  if (!response?.ok)
    return youtubeMappingError(response)
  return response.json() as Promise<YouTubeCandidates>
}

export async function changeYouTubeMapping(trackId: string, videoId: string | null, signal: AbortSignal): Promise<string | null> {
  const response = await apiFetch(`${BACKEND ?? ''}/api/playback/track/${encodeURIComponent(trackId)}/youtube-mapping`, {
    method: videoId === null ? 'DELETE' : 'PUT',
    ...(videoId === null ? {} : { body: JSON.stringify({ video_id: videoId }) }),
    signal,
  })
  // Cancellation cannot prove that the server did not commit the write.
  if (signal.aborted && !response?.ok)
    invalidateUri(trackId, 'youtube')
  if (!response?.ok)
    return youtubeMappingError(response)
  // Even if the dialog closed during a successful write, its old URI is stale.
  invalidateUri(trackId, 'youtube')
  return null
}
