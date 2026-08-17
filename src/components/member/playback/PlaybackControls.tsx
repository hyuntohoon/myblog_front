import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react'
import type { DeviceListOutcome, PlaybackDevice, PlaybackModeOutcome, PlayerCommandOutcome, RepeatMode, SetTrackLikedOutcome, TransferOutcome } from '@lib/spotifyPlayback'
import type { LikedState, PlaybackModeCommand } from '@lib/playback/session'
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { playbackSession } from '@lib/playback/session'
import { useDismissable } from '@lib/useDismissable'

export const playbackControlCopy = {
  unavailable: '이 계정/기기에선 재생 제어를 사용할 수 없어요',
  failed: '제어에 실패했어요. 잠시 후 다시 시도해 주세요',
  likeFailed: '좋아요 변경에 실패했어요. 잠시 후 다시 시도해 주세요',
  fixedVolume: '이 기기는 볼륨 조절을 지원하지 않아요',
  modeFailed: '설정을 바꾸지 못했어요. 잠시 후 다시 시도해 주세요',
} as const

type Notice = (message: string) => void

export async function seekPlayback(ms: number, onNotice: Notice, onReanchored?: () => void): Promise<PlayerCommandOutcome | null> {
  const result = await playbackSession.seekTo(ms, onReanchored)
  if (!result || result.ok)
    return result
  if (result.reason === 'no-capability')
    onNotice(playbackControlCopy.unavailable)
  else if (result.reason !== 'token')
    onNotice(playbackControlCopy.failed)
  return result
}

export async function setPlaybackMode(command: PlaybackModeCommand, onNotice: Notice): Promise<PlaybackModeOutcome | null> {
  const result = await playbackSession.setMode(command)
  if (!result || result.ok)
    return result
  if (result.reason === 'unsupported-on-device')
    onNotice(playbackControlCopy.fixedVolume)
  else if (result.reason !== 'no-capability')
    onNotice(playbackControlCopy.modeFailed)
  return result
}

export async function togglePlaybackLiked(onNotice: Notice): Promise<SetTrackLikedOutcome | null> {
  const result = await playbackSession.toggleLiked()
  if (result && !result.ok && result.reason !== 'library-scope-missing')
    onNotice(playbackControlCopy.likeFailed)
  return result
}

export function nextRepeatMode(repeat: RepeatMode): RepeatMode {
  return repeat === 'off' ? 'context' : repeat === 'context' ? 'track' : 'off'
}

function ShuffleGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <path d="M1 3.5h2.6l6.8 7h2.6M1 10.5h2.6l6.8-7h2.6" />
      <path d="M11.2 1.6 13 3.5l-1.8 1.9M11.2 8.6 13 10.5l-1.8 1.9" />
    </svg>
  )
}

function RepeatGlyph({ one }: { one: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <path d="M4.6 3h4.8a2.4 2.4 0 0 1 2.4 2.4v3.2a2.4 2.4 0 0 1-2.4 2.4H4.6a2.4 2.4 0 0 1-2.4-2.4V5.4A2.4 2.4 0 0 1 4.6 3Z" />
      <path d="M6.2 1.4 4.4 3l1.8 1.6" strokeLinecap="round" strokeLinejoin="round" />
      {one && <circle cx="7" cy="7" r="1.2" fill="currentColor" stroke="none" />}
    </svg>
  )
}

export function PlaybackModeControls({ shuffle, repeat, volumePercent, onSet, micro, hidden = false }: {
  shuffle: boolean | null
  repeat: RepeatMode | null
  volumePercent: number | null
  onSet: (command: PlaybackModeCommand) => Promise<void>
  micro: boolean
  /** Surface-owned responsive policy. The reusable control itself has no breakpoint. */
  hidden?: boolean
}) {
  if (hidden)
    return null
  const size = micro ? 22 : 26
  const repeatLabel = repeat === 'track' ? '한 곡 반복' : repeat === 'context' ? '전체 반복' : '반복 없음'
  const btn = (on: boolean): CSSProperties => ({
    width: size,
    height: size,
    display: 'grid',
    placeItems: 'center',
    borderRadius: size,
    border: '1px solid transparent',
    background: 'transparent',
    color: on ? 'var(--color-accent)' : 'var(--color-faded)',
    fontSize: micro ? 10 : 11,
    lineHeight: 1,
    cursor: 'pointer',
    padding: 0,
  })
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1, flex: '0 0 auto' }}>
      {shuffle != null && (
        <button
	type="button"
	onClick={() => { void onSet({ kind: 'shuffle', on: !shuffle }) }}
	aria-pressed={shuffle}
	aria-label={shuffle ? '셔플 끄기' : '셔플 켜기'}
	title={shuffle ? '셔플 켜짐' : '셔플 꺼짐'}
	style={btn(shuffle)}
        >
          <ShuffleGlyph />
        </button>
      )}
      {repeat != null && (
        <button
	type="button"
	onClick={() => { void onSet({ kind: 'repeat', mode: nextRepeatMode(repeat) }) }}
	aria-label={`반복 — 지금 ${repeatLabel}`}
	title={repeatLabel}
	style={btn(repeat !== 'off')}
        >
          <RepeatGlyph one={repeat === 'track'} />
        </button>
      )}
      {volumePercent != null && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 2 }}>
          <input
	type="range"
	min={0}
	max={100}
	value={volumePercent}
	aria-label="볼륨"
	onChange={(event) => { void onSet({ kind: 'volume', percent: Number(event.target.value) }) }}
	style={{ width: micro ? 46 : 62, accentColor: 'var(--color-accent)', cursor: 'pointer' }}
          />
        </span>
      )}
    </span>
  )
}

export function PlaybackLikeControl({ state, onToggle, size }: { state: LikedState, onToggle: () => void, size: number }) {
  const available = state === 'liked' || state === 'unliked'
  const liked = state === 'liked'
  const style: CSSProperties = { width: size, height: size, border: 'none', background: 'none', display: 'grid', placeItems: 'center', flex: '0 0 auto', padding: 0, color: liked ? 'var(--color-accent)' : 'var(--color-text)', fontSize: Math.round(size * 0.62), lineHeight: 1, textDecoration: 'none', opacity: state === 'loading' || state === 'unknown' ? 0.38 : 1 }
  if (state === 'scope-missing') {
    return (
      <a href="/members/?me&tab=integration" aria-label="좋아요 권한 재동의하기" title="좋아요 기능을 쓰려면 재동의가 필요해요" style={{ ...style, cursor: 'pointer', color: 'var(--color-faded)' }}>
        ♡
      </a>
    )
  }
  return (
    <button
	type="button"
	onClick={onToggle}
	disabled={!available}
	aria-label={liked ? '좋아요 취소' : '좋아요'}
	aria-pressed={available ? liked : undefined}
	title={liked ? '좋아요 취소' : '좋아요'}
	style={{ ...style, cursor: available ? 'pointer' : 'default' }}
    >
      {liked ? '♥' : '♡'}
    </button>
  )
}

export function useSeekControl({ enabled, durationMs, elapsedMs, onSeek }: {
  enabled: boolean
  durationMs: number
  elapsedMs: number
  onSeek: (ms: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const onClick = enabled ?
(event: MouseEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect()
    if (rect && rect.width > 0)
      onSeek(((event.clientX - rect.left) / rect.width) * durationMs)
  } :
undefined
  const onKeyDown = enabled ?
(event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onSeek(Math.max(0, elapsedMs - 5000))
    }
    else if (event.key === 'ArrowRight') {
      event.preventDefault()
      onSeek(Math.min(durationMs, elapsedMs + 5000))
    }
  } :
undefined
  return { ref, onClick, onKeyDown }
}

/**
 * Read at popover-open time from the anchor, so the portaled dropdown (which
 * escapes `.global-playback-bar`'s dark "deck" theme scope) still renders with
 * the right colors instead of falling back to the page's ambient theme.
 */
const DEVICE_POPOVER_THEME_VARS = ['--color-bg', '--color-border', '--color-border-soft', '--color-faded', '--color-accent', '--color-text'] as const

interface DevicePopoverPlacement {
  left: number
  width: number
  bottom: number
  theme: CSSProperties
  /**
   * `--deck-raised` when the anchor sits in the dark deck bar (a deliberate
   * lighter-than-bar elevation, previously an `!important` CSS override that
   * only matched while the listbox was DOM-nested under `.global-playback-bar`)
   * — falls back to `--color-bg` for the plain-theme NowPlaying picker.
   */
  background: string | undefined
}

export function PlaybackDevicePicker({ name, devices, activeDeviceId, onRefresh, onTransfer, onSwitched }: {
  name: string | null
  devices: PlaybackDevice[] | null
  activeDeviceId: string | null
  onRefresh: () => Promise<DeviceListOutcome>
  onTransfer: (deviceId: string, options?: { raiseInPageFirst?: boolean }) => Promise<TransferOutcome>
  onSwitched: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<DevicePopoverPlacement | null>(null)
  useDismissable(open, () => setOpen(false), listRef)

  // Portaled to <body> (see the popover below) so a queue panel opened at the
  // same time — a `.pbp-panel` fixed sibling of `.global-playback-bar` with a
  // higher z-index — can never trap this dropdown inside the bar's own
  // stacking context. Measured in viewport coordinates on open + kept in sync
  // while open, since the anchor is no longer this node's DOM parent.
  useLayoutEffect(() => {
    if (!open)
      return
    const measure = () => {
      const anchor = anchorRef.current
      if (!anchor)
        return
      const rect = anchor.getBoundingClientRect()
      const computed = getComputedStyle(anchor)
      const theme = {} as Record<string, string>
      for (const cssVar of DEVICE_POPOVER_THEME_VARS)
        theme[cssVar] = computed.getPropertyValue(cssVar)
      setPlacement({
        left: rect.left + 8,
        width: Math.max(0, rect.width - 16),
        bottom: window.innerHeight - rect.top + 4,
        theme: theme as CSSProperties,
        background: computed.getPropertyValue('--deck-raised').trim() || undefined,
      })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open])

  const openList = async () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    setError(null)
    const result = await onRefresh()
    if (!result.ok) {
      setError(result.reason === 'no-capability' ?
        '기기 목록은 Spotify Premium 계정에서 볼 수 있어요.' :
        '기기 목록을 가져오지 못했어요.')
    }
  }

  const pick = async (device: PlaybackDevice) => {
    if (busy)
      return
    setBusy(device.id)
    const result = await onTransfer(device.id)
    setBusy(null)
    if (!result.ok) {
      setError(result.reason === 'no-capability' ?
        '이 전환은 Spotify Premium 계정에서 사용할 수 있어요.' :
        '기기를 바꾸지 못했어요.')
      return
    }
    setOpen(false)
    onSwitched()
  }

  const pickThisBrowser = async () => {
    if (busy)
      return
    setBusy('in-page')
    const result = await onTransfer('', { raiseInPageFirst: true })
    setBusy(null)
    if (!result.ok) {
      setError(result.reason === 'no-capability' ?
        '이 브라우저 재생은 Spotify Premium 계정에서 사용할 수 있어요.' :
        '이 브라우저로 옮기지 못했어요.')
      return
    }
    setOpen(false)
    onSwitched()
  }

  const alreadyListed = devices?.some(device => device.isInPage) ?? false

  return (
    <div ref={anchorRef} style={{ position: 'relative' }}>
      <button
	type="button"
	onClick={() => { void openList() }}
	aria-expanded={open}
	aria-label={name === null ? '재생 기기 선택' : '재생 기기 바꾸기'}
	className="mono"
	style={{ width: '100%', textAlign: 'left', borderTop: '1px solid var(--color-border-soft)', borderLeft: 0, borderRight: 0, borderBottom: 0, background: 'transparent', padding: '7px 16px 8px', fontSize: 10.5, letterSpacing: '.03em', color: 'var(--color-faded)', display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, cursor: 'pointer' }}
      >
        <DeviceGlyph />
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
          {name === null ?
            '재생 기기 선택' :
(
            <>
{'Listening on '}
<span style={{ color: 'var(--color-subtle)' }}>{name}</span>
            </>
          )}
        </span>
        <span aria-hidden="true" style={{ marginLeft: 'auto', flex: '0 0 auto', opacity: 0.7 }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && placement && typeof document !== 'undefined' && createPortal(
        <div
	ref={listRef}
	role="listbox"
	aria-label="재생 기기"
	style={{ position: 'fixed', left: placement.left, width: placement.width, bottom: placement.bottom, zIndex: 'calc(var(--z-pocket, 70) + 6)', ...placement.theme, background: placement.background ?? 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 7, boxShadow: '0 18px 44px rgba(0,0,0,.32)', padding: 5, maxHeight: 240, overflowY: 'auto' }}
        >
          {devices == null && !error && <div className="mono" style={{ padding: '8px 9px', fontSize: 10.5, color: 'var(--color-faded)' }}>기기를 찾는 중…</div>}
          {error && <div className="mono" style={{ padding: '8px 9px', fontSize: 10.5, color: 'var(--color-accent)' }}>{error}</div>}
          {devices?.map(device => (
            <DeviceRow
	key={device.id}
	label={device.isInPage ? '이 브라우저 (음질 제한)' : device.name}
	sub={device.isInPage ? undefined : device.type}
	active={device.id === activeDeviceId}
	busy={busy === device.id}
	onClick={() => { void pick(device) }}
            />
          ))}
          {devices != null && !alreadyListed && (
            <DeviceRow
	label="이 브라우저 (음질 제한)"
	active={false}
	busy={busy === 'in-page'}
	onClick={() => { void pickThisBrowser() }}
            />
          )}
          {devices?.length === 0 && (
            <div className="mono" style={{ padding: '6px 9px 8px', fontSize: 10, color: 'var(--color-faded)', lineHeight: 1.5 }}>
              다른 기기가 없어요. Spotify 앱을 켜면 여기에 나타납니다.
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}

function DeviceGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" style={{ flex: '0 0 auto' }}>
      <rect x="3" y="0.5" width="6" height="11" rx="1.2" fill="none" stroke="currentColor" />
      <circle cx="6" cy="8.5" r="1.1" fill="currentColor" />
    </svg>
  )
}

function DeviceRow({ label, sub, active, busy, onClick }: { label: string, sub?: string, active: boolean, busy: boolean, onClick: () => void }) {
  return (
    <button
	type="button"
	role="option"
	aria-selected={active}
	onClick={onClick}
	disabled={busy}
	className="mono"
	style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', textAlign: 'left', padding: '7px 9px', border: 0, borderRadius: 5, background: active ? 'var(--color-border-soft)' : 'transparent', color: 'var(--color-text)', fontSize: 11, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.55 : 1 }}
    >
      <span aria-hidden="true" style={{ flex: '0 0 auto', width: 9, color: 'var(--color-accent)' }}>{active ? '●' : ''}</span>
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{label}</span>
      {sub && <span style={{ marginLeft: 'auto', flex: '0 0 auto', color: 'var(--color-faded)', fontSize: 9.5 }}>{sub}</span>}
      {busy && <span style={{ marginLeft: 'auto', flex: '0 0 auto', color: 'var(--color-faded)', fontSize: 9.5 }}>옮기는 중…</span>}
    </button>
  )
}
