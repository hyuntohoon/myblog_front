import type { YouTubeMappingDetail } from '@lib/playback/youtubeEvents'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { clearMappingPrompt, providerStore } from '@lib/playback/provider'
import { playbackSession } from '@lib/playback/session'
import { OPEN_YOUTUBE_MAPPING } from '@lib/playback/youtubeEvents'
import { YouTubeMappingPicker } from './YouTubeMappingPicker'
import { YouTubePlayerDock } from './YouTubePlayerDock'

export function YouTubeSurfaces() {
  const provider = useSyncExternalStore(providerStore.subscribe, providerStore.getSnapshot, providerStore.getServerSnapshot)
  const [mapping, setMapping] = useState<YouTubeMappingDetail | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const choose = (trackId: string, title: string) => {
    playbackSession.stopYouTube()
    clearMappingPrompt()
    setNotice(null)
    setMapping({ trackId, title })
  }
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<YouTubeMappingDetail>).detail
      if (!detail?.trackId)
        return
      playbackSession.stopYouTube()
      clearMappingPrompt()
      setNotice(null)
      setMapping(detail)
    }
    window.addEventListener(OPEN_YOUTUBE_MAPPING, open)
    return () => window.removeEventListener(OPEN_YOUTUBE_MAPPING, open)
  }, [])
  return (
    <>
      {provider.provider === 'youtube' && <YouTubePlayerDock onChooseVideo={() => choose(provider.trackId!, provider.title ?? '이 곡')} />}
      {provider.needsMapping && provider.mappingTrackId && (
        <aside className="yt-mapping-notice" role="status">
          <p>저장된 YouTube 영상을 재생할 수 없어요.</p>
          <button type="button" onClick={() => choose(provider.mappingTrackId!, provider.mappingTitle ?? '이 곡')}>다른 영상 고르기</button>
          <button type="button" onClick={clearMappingPrompt} aria-label="영상 안내 닫기">닫기</button>
        </aside>
      )}
      {notice && provider.provider !== 'youtube' && (
        <aside className="yt-mapping-notice" role="status">
          <p>{notice}</p>
          <button type="button" onClick={() => setNotice(null)} aria-label="영상 변경 안내 닫기">닫기</button>
        </aside>
      )}
      {mapping && (
        <YouTubeMappingPicker
	key={mapping.trackId}
	trackId={mapping.trackId}
	trackTitle={mapping.title}
	hasMapping
	onClose={() => setMapping(null)}
	onChanged={(change) => {
          setNotice(change === 'confirmed' ? 'YouTube 영상을 연결했어요. 재생 버튼을 눌러 들어보세요.' : 'YouTube 연결을 해제했어요.')
          setMapping(null)
        }}
        />
      )}
    </>
  )
}
