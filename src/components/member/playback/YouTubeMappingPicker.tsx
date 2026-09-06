import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDismissable } from '@lib/useDismissable'
import { changeYouTubeMapping, searchYouTubeCandidates } from '@lib/youtubeMapping'
import type { YouTubeCandidates } from '@lib/youtubeMapping'
import '@styles/youtube-mapping.css'

export interface YouTubeMappingPickerProps {
  trackId: string
  trackTitle: string
  hasMapping?: boolean
  onClose: () => void
  onChanged?: (change: 'confirmed' | 'deleted') => void
}

function duration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds))
    return '길이 정보 없음'
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

function delta(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds))
    return '차이 확인 불가'
  return seconds === 0 ? '길이 같음' : `${Math.abs(seconds)}초 차이`
}

/** Mounted only while open. The keyed child resets selection when the track changes. */
export function YouTubeMappingPicker(props: YouTubeMappingPickerProps) {
  return <Picker key={props.trackId} {...props} />
}

function Picker({ trackId, trackTitle, hasMapping = true, onClose, onChanged }: YouTubeMappingPickerProps) {
  const [result, setResult] = useState<YouTubeCandidates | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const alive = useRef(false)
  const mutation = useRef<AbortController | null>(null)
  const titleId = useId()
  const helpId = useId()
  useDismissable(true, onClose, root, { lockScroll: true })

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      mutation.current?.abort()
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void searchYouTubeCandidates(trackId, controller.signal).then((value) => {
      if (controller.signal.aborted)
        return
      if (typeof value === 'string')
        setError(value)
      else
        setResult(value)
    }).catch(() => {
      if (!controller.signal.aborted)
        setError('후보를 불러오지 못했어요. 다시 시도해 주세요.')
    }).finally(() => {
      if (!controller.signal.aborted)
        setLoading(false)
    })
    return () => controller.abort()
  }, [trackId, attempt])

  async function save(videoId: string | null) {
    if (mutation.current || (videoId !== null && !result?.candidates?.some(candidate => candidate.video_id === videoId && candidate.embeddable && candidate.channel_title?.trim())))
      return
    const controller = new AbortController()
    mutation.current = controller
    setSaving(true)
    setError(null)
    try {
      const message = await changeYouTubeMapping(trackId, videoId, controller.signal)
      if (!alive.current)
        return
      if (message) {
        setError(message)
        return
      }
      onChanged?.(videoId === null ? 'deleted' : 'confirmed')
      onClose()
    }
    catch {
      if (alive.current)
        setError('변경 내용을 저장하지 못했어요. 다시 시도해 주세요.')
    }
    finally {
      mutation.current = null
      if (alive.current)
        setSaving(false)
    }
  }

  if (typeof document === 'undefined')
    return null
  return createPortal(
    <div className="yt-mapping-scrim" role="presentation" onClick={event => event.target === event.currentTarget && onClose()}>
      <div ref={root} className="yt-mapping" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={helpId}>
        <header className="yt-mapping-header">
          <div>
            <h2 id={titleId}>YouTube 영상 고르기</h2>
            <p className="yt-mapping-track">{trackTitle}</p>
          </div>
          <button type="button" className="yt-mapping-close" onClick={onClose} aria-label="영상 선택 닫기">×</button>
        </header>
        <p id={helpId} className="yt-mapping-help">재생시간이 같아도 다른 영상일 수 있어요. 채널명과 제목을 보고 공식 음원인지, 가사·커버·연주 버전인지 확인한 뒤 직접 골라 주세요.</p>
        {result && (
<p className="yt-mapping-reference">
{`원곡 길이 ${duration(result.track_duration_sec)}`}
</p>
)}
        {loading && <p role="status">YouTube 후보를 불러오는 중…</p>}
        {error && <p className="yt-mapping-error" role="alert">{error}</p>}
        {!loading && !result && <button type="button" className="yt-mapping-secondary" onClick={() => setAttempt(value => value + 1)}>다시 불러오기</button>}
        {!loading && result && !result.candidates?.length && <p role="status">후보를 찾지 못했어요. Spotify로 계속 들을 수 있어요.</p>}
        <div className="yt-mapping-candidates" role="radiogroup" aria-label="영상 후보">
          {result?.candidates?.map(candidate => (
            <label className="yt-mapping-candidate" key={candidate.video_id}>
              <input type="radio" name={titleId} value={candidate.video_id} checked={selected === candidate.video_id} disabled={saving || !candidate.embeddable || !candidate.channel_title?.trim()} onChange={() => setSelected(candidate.video_id)} />
              {candidate.thumbnail_url && <img src={candidate.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" />}
              <span className="yt-mapping-details">
                <span className="yt-mapping-title">{candidate.title ?? '제목 정보 없음'}</span>
                <span className="yt-mapping-channel">
{`채널: ${candidate.channel_title?.trim() || '채널을 확인할 수 없어 선택할 수 없어요'}`}
                </span>
                <span className="yt-mapping-duration">
{duration(candidate.duration_sec)}
{' '}
·
{' '}
{delta(candidate.duration_delta_sec)}
                </span>
                {!candidate.embeddable && <span>여기서 재생할 수 없는 영상</span>}
              </span>
            </label>
          ))}
        </div>
        <footer className="yt-mapping-actions">
          {hasMapping && <button type="button" className="yt-mapping-secondary" disabled={saving} onClick={() => void save(null)}>이 영상 아님</button>}
          <button type="button" className="yt-mapping-confirm" disabled={!selected || saving || loading} onClick={() => selected && void save(selected)}>{saving ? '저장 중…' : '이 영상으로 확정'}</button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
