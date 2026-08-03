import type { PointerEvent as ReactPointerEvent } from 'react'
import type { PlaybackEntryProps } from './PlaybackPanel'
import {
  PlaybackEntries,
  PlaybackIdentity,
  PlaybackNotices,
  PlaybackQueue,
  PlaybackTransport,
  usePlaybackViewModel,
} from './PlaybackPanel'

export interface PlaybackMiniProps extends PlaybackEntryProps {
  onExpand: () => void
  onClose: () => void
  onHeadPointerDown: (event: ReactPointerEvent) => void
  onHeadPointerMove: (event: ReactPointerEvent) => void
  onHeadPointerUp: (event: ReactPointerEvent) => void
}

/** The Playback Bucket's Pocket representation; it never creates a second session. */
export function PlaybackMini({
  onExpand,
  onClose,
  onHeadPointerDown,
  onHeadPointerMove,
  onHeadPointerUp,
  ...entries
}: PlaybackMiniProps) {
  const model = usePlaybackViewModel()
  const more = Math.max(0, model.queue.length - 3)
  return (
    <>
      <div className="pb-dhead pbp-mini-head" onPointerDown={onHeadPointerDown} onPointerMove={onHeadPointerMove} onPointerUp={onHeadPointerUp}>
        <span className="pb-dhandle">
          <span className="pb-dgrip" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          재생 대기열
        </span>
        <span className="pbp-mini-actions" onPointerDown={event => event.stopPropagation()}>
          <button type="button" onClick={onExpand} aria-label="확장 플레이어 열기">확장 ↗</button>
          <button type="button" onClick={onClose} aria-label="닫기">✕</button>
        </span>
      </div>
      <PlaybackIdentity row={model.current} compact />
      <PlaybackTransport state={model.state} />
      <PlaybackEntries current={model.current} state={model.state} {...entries} />
      <PlaybackNotices state={model.state} queue={model.queue} />
      <PlaybackQueue model={model} limit={3} />
      {more > 0 && <div className="pbp-mini-more">{`다음 ${more}곡 더`}</div>}
    </>
  )
}

export default PlaybackMini
