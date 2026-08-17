import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { PlaybackSessionState } from '@lib/playback/session'
import { useEffect, useRef, useState } from 'react'
import { playbackSession } from '@lib/playback/session'
import { useDismissable } from '@lib/useDismissable'
import {
  PlaybackDevicePicker,
  PlaybackLikeControl,
  PlaybackModeControls,
  seekPlayback,
  setPlaybackMode,
  togglePlaybackLiked,
  useSeekControl,
} from './PlaybackControls'
import { canControlPlayback, GLOBAL_PLAYBACK_PANEL_ID, PlaybackIdentity, PlaybackTransport, usePlaybackViewModel } from './PlaybackPanel'

export { GLOBAL_PLAYBACK_PANEL_ID }

/** `session.ts` reports something sounding, whether queue-matched or external. */
export function isGlobalPlaybackBarVisible(state: PlaybackSessionState): boolean {
  return state.currentItemId != null || state.external != null
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])
  return matches
}

function formatTime(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms))
    return '—'
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function QueueGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M2.5 4.5h9M2.5 9h9M2.5 13.5h6" strokeLinecap="round" />
      <path d="m12.5 11 3 2-3 2Z" fill="currentColor" stroke="none" />
    </svg>
  )
}

function CollapseGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M3.5 6.25 8 10.75l4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ExpandGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M3.5 9.75 8 5.25l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function VolumeGlyph({ percent }: { percent: number | null }) {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M3 7h3l3-2.8v9.6L6 11H3Z" strokeLinejoin="round" />
      {percent !== 0 && <path d="M11.5 6.2a4 4 0 0 1 0 5.6" strokeLinecap="round" />}
      {(percent ?? 0) > 55 && <path d="M13.8 4a7 7 0 0 1 0 10" strokeLinecap="round" />}
    </svg>
  )
}

function NarrowVolume({ percent, onSet }: {
  percent: number | null
  onSet: (command: Parameters<typeof setPlaybackMode>[0]) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismissable(open, () => setOpen(false), ref)
  if (percent == null)
    return null
  return (
    <div ref={ref} className="deck-volume-menu">
      <button
	type="button"
	className="deck-icon-button"
	aria-label="볼륨 조절"
	aria-expanded={open}
	title="볼륨"
	onClick={() => setOpen(value => !value)}
      >
        <VolumeGlyph percent={percent} />
      </button>
      {open && (
        <div className="deck-popover" role="group" aria-label="볼륨 조절">
          <PlaybackModeControls shuffle={null} repeat={null} volumePercent={percent} onSet={onSet} micro={false} />
        </div>
      )}
    </div>
  )
}

export interface GlobalPlaybackBarProps {
  playbackPanelOpen: boolean
  onOpenPlaybackPanel: () => void
}

export function GlobalPlaybackBar({ playbackPanelOpen, onOpenPlaybackPanel }: GlobalPlaybackBarProps) {
  const model = usePlaybackViewModel()
  const compactUtilities = useMediaQuery('(max-width: 1179px)')
  const mobile = useMediaQuery('(max-width: 767px)')
  const visible = isGlobalPlaybackBarVisible(model.state)
  const canControl = canControlPlayback(model.state)
  const durationMs = model.durationMs ?? 0
  const ratio = durationMs > 0 ? Math.min(1, Math.max(0, model.elapsedMs / durationMs)) : 0
  const [notice, setNotice] = useState<string | null>(null)
  const dragRef = useRef({ active: false, moved: false, suppressClick: false })

  // Collapse is scoped to the current playing stretch, not remembered across
  // sessions or even across a stop/start — once nothing is sounding, the next
  // track always opens expanded again.
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    if (!visible)
      setCollapsed(false)
  }, [visible])

  // Astro's ClientRouter wipes every attribute off <html> (style included) on
  // EVERY navigation (`swapRootAttributes`, stock and this site's own audio-
  // preserving override alike), so an imperative custom property set here is
  // silently gone right after the swap even though this island itself (and
  // `visible`/`mobile`/`collapsed`) never changed — nothing else ever re-applies
  // it. Redo the write on `astro:after-swap`, not just on the React deps that
  // normally drive it.
  useEffect(() => {
    const apply = () => {
      const value = visible && !collapsed ? `calc(${mobile ? 112 : 88}px + env(safe-area-inset-bottom))` : '0px'
      document.documentElement.style.setProperty('--global-player-h', value)
    }
    apply()
    document.addEventListener('astro:after-swap', apply)
    return () => {
      document.removeEventListener('astro:after-swap', apply)
      document.documentElement.style.setProperty('--global-player-h', '0px')
    }
  }, [mobile, visible, collapsed])

  useEffect(() => {
    if (!visible)
      return
    const trackId = playbackSession.currentSpotifyTrackId()
    if (trackId)
      playbackSession.loadLiked(trackId)
  }, [model.state.currentItemId, model.state.external?.spotifyTrackId, visible])

  const requestSeek = (ms: number) => {
    void seekPlayback(ms, setNotice)
  }
  const seekEnabled = canControl && model.state.capabilityTier === 'full' && !model.state.busy && durationMs > 0
  const seek = useSeekControl({
    enabled: seekEnabled,
    durationMs,
    elapsedMs: model.elapsedMs,
    onSeek: requestSeek,
  })
  const setMode = async (command: Parameters<typeof setPlaybackMode>[0]) => {
    await setPlaybackMode(command, setNotice)
  }
  const seekFromPointer = (clientX: number, element: HTMLElement) => {
    if (!seekEnabled)
      return
    const rect = element.getBoundingClientRect()
    if (rect.width > 0)
      requestSeek(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * durationMs)
  }
  const onSeekPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!seekEnabled)
      return
    dragRef.current = { active: true, moved: false, suppressClick: false }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const onSeekPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active)
      return
    dragRef.current.moved = true
    seekFromPointer(event.clientX, event.currentTarget)
  }
  const onSeekPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active)
      return
    if (dragRef.current.moved) {
      seekFromPointer(event.clientX, event.currentTarget)
      dragRef.current.suppressClick = true
    }
    dragRef.current.active = false
  }

  if (!visible)
    return null

  if (collapsed) {
    return (
      <button
	type="button"
	className="global-playback-pill"
	onClick={() => setCollapsed(false)}
	aria-label="재생 바 펼치기"
	title="재생 바 펼치기"
      >
        <PlaybackIdentity row={model.current} external={model.state.external} compact />
        <ExpandGlyph />
      </button>
    )
  }

  const progressStyle = { '--deck-progress': `${ratio * 100}%` } as CSSProperties
  const deviceName = model.state.device?.name ?? model.state.external?.deviceName ?? null

  return (
    <section className="global-playback-bar" role="region" aria-label="전역 재생 제어" data-mobile-layout="two-row" style={progressStyle}>
      <div
	ref={seek.ref}
	className="deck-signal-rail"
	role="slider"
	aria-label="재생 위치"
	aria-valuemin={0}
	aria-valuemax={durationMs}
	aria-valuenow={Math.round(model.elapsedMs)}
	aria-valuetext={`${formatTime(model.elapsedMs)} / ${formatTime(model.durationMs)}`}
	tabIndex={seekEnabled ? 0 : -1}
	onClick={(event) => {
          if (dragRef.current.suppressClick) {
            dragRef.current.suppressClick = false
            return
          }
          seek.onClick?.(event)
        }}
	onKeyDown={seek.onKeyDown}
	onPointerDown={onSeekPointerDown}
	onPointerMove={onSeekPointerMove}
	onPointerUp={onSeekPointerUp}
	onPointerCancel={() => { dragRef.current.active = false }}
      >
        <i />
      </div>

      <div className="global-playback-main">
        <div className="deck-identity-zone">
          <PlaybackIdentity row={model.current} external={model.state.external} compact />
          <span className="deck-hit-target deck-like">
            <PlaybackLikeControl
	state={model.state.liked}
	onToggle={() => { void togglePlaybackLiked(setNotice) }}
	size={32}
            />
          </span>
        </div>

        <div className="deck-transport-zone">
          <div className="deck-transport-line">
            <span className="deck-hit-target deck-mode-set">
              <PlaybackModeControls shuffle={model.state.shuffle} repeat={null} volumePercent={null} onSet={setMode} micro={false} />
            </span>
            <PlaybackTransport state={model.state} canControl={canControl} />
            <span className="deck-hit-target deck-mode-set">
              <PlaybackModeControls shuffle={null} repeat={model.state.repeat} volumePercent={null} onSet={setMode} micro={false} />
            </span>
            {!compactUtilities && model.state.volumePercent != null && (
              <span className="deck-wide-volume">
                <PlaybackModeControls shuffle={null} repeat={null} volumePercent={model.state.volumePercent} onSet={setMode} micro={false} />
              </span>
            )}
          </div>
          <div className="deck-time-line" aria-hidden="true">
            <span>{formatTime(model.elapsedMs)}</span>
            <span className="deck-center-progress" onClick={event => seekFromPointer(event.clientX, event.currentTarget)}><i /></span>
            <span>{formatTime(model.durationMs)}</span>
          </div>
        </div>

        <div className="deck-utility-zone" role="group" aria-label="재생 도구">
          <button
	type="button"
	className="deck-icon-button"
	aria-label="재생 대기열 열기"
	aria-expanded={playbackPanelOpen}
	aria-controls={GLOBAL_PLAYBACK_PANEL_ID}
	title="재생 대기열"
	onClick={onOpenPlaybackPanel}
          >
            <QueueGlyph />
          </button>
          <div className="deck-device-picker">
            <PlaybackDevicePicker
	name={deviceName}
	devices={model.state.devices}
	activeDeviceId={model.state.activeDeviceId}
	onRefresh={playbackSession.refreshDevices}
	onTransfer={playbackSession.transferTo}
	onSwitched={() => setNotice(null)}
            />
          </div>
          {compactUtilities && <NarrowVolume percent={model.state.volumePercent} onSet={setMode} />}
          <button
	type="button"
	className="deck-icon-button"
	aria-label="재생 바 접기"
	title="재생 바 접기"
	onClick={() => setCollapsed(true)}
          >
            <CollapseGlyph />
          </button>
        </div>
      </div>
      {notice && <div className="deck-alert" role="status">{notice}</div>}
    </section>
  )
}

export default GlobalPlaybackBar
