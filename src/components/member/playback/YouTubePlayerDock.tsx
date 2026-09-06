import { useEffect, useRef, useSyncExternalStore } from 'react'
import { playbackSession } from '@lib/playback/session'
import { providerStore } from '@lib/playback/provider'
import { getLastErrorCode, setYouTubeHost } from '@lib/youtubePlayback'
import '@styles/youtube-player.css'

function viewportFits(): boolean {
  if (typeof window === 'undefined')
    return false
  // Scrollbars consume layout width even when innerWidth still includes them.
  const availableWidth = document.documentElement.clientWidth || window.innerWidth
  return availableWidth >= 480 && window.innerHeight >= 410
}

/** No overlays: attribution and app controls are outside the 16:9 frame. */
export function YouTubePlayerDock({ onChooseVideo }: { onChooseVideo: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const provider = useSyncExternalStore(providerStore.subscribe, providerStore.getSnapshot, providerStore.getServerSnapshot)
  const state = useSyncExternalStore(playbackSession.subscribe, playbackSession.getSnapshot, playbackSession.getServerSnapshot)
  const fits = viewportFits()
  useEffect(() => {
    if (document.visibilityState === 'hidden') {
      playbackSession.stopYouTube()
      return
    }
    if (!fits) {
      playbackSession.stopYouTube()
      return
    }
    if (!host.current)
      return
    // The API replaces this child with an iframe; React owns its wrapper only.
    const mount = document.createElement('div')
    host.current.appendChild(mount)
    setYouTubeHost(mount)
    const stop = () => playbackSession.stopYouTube()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden')
        stop()
    }
    const onResize = () => {
      if (!viewportFits())
        stop()
    }
    document.addEventListener('visibilitychange', onVisibility)
    document.addEventListener('astro:before-swap', stop)
    window.addEventListener('pagehide', stop)
    window.addEventListener('resize', onResize)
    // Local IFrame state only: catches pauses/seeks made in YouTube's own UI.
    const timer = window.setInterval(() => void playbackSession.syncFromLive(), 250)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      document.removeEventListener('astro:before-swap', stop)
      window.removeEventListener('pagehide', stop)
      window.removeEventListener('resize', onResize)
      setYouTubeHost(null)
      mount.remove()
    }
  }, [fits])

  if (!fits) {
    return <aside className="yt-player-size" role="status">영상을 표시하려면 가로 480px 이상의 화면이 필요해요. 창을 넓히거나 화면을 회전해 주세요.</aside>
  }
  return (
    <section className="yt-player-dock" aria-label="YouTube 플레이어">
      <header className="yt-player-header">
        <a className="yt-attribution" href="https://www.youtube.com/" target="_blank" rel="noopener noreferrer" aria-label="YouTube">
          <svg width="28" height="20" viewBox="0 0 28 20" aria-hidden="true">
<rect width="28" height="20" rx="5" fill="#f00" />
<path d="M11 5.5 20 10l-9 4.5Z" fill="#fff" />
          </svg>
          YouTube
        </a>
        <span>{provider.title}</span>
        <button type="button" onClick={() => playbackSession.stopYouTube()} aria-label="YouTube 재생 종료">닫기</button>
      </header>
      <div className="yt-player-frame" ref={host} />
      <div className="yt-player-controls">
        <button type="button" disabled={state.busy} onClick={() => void playbackSession.togglePlay()}>{state.playing ? '일시정지' : '재생'}</button>
        <input type="range" aria-label="YouTube 재생 위치" min="0" max={state.durationMs ?? 0} value={Math.min(state.anchor?.ms ?? 0, state.durationMs ?? 0)} disabled={!state.durationMs || state.busy} onChange={e => void playbackSession.seekTo(Number(e.target.value))} />
        <button type="button" onClick={onChooseVideo}>다른 영상 고르기</button>
      </div>
      {getLastErrorCode() !== null && <p role="alert">이 영상은 재생할 수 없어요. 다른 영상을 골라주세요.</p>}
    </section>
  )
}
