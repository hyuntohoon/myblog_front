// FEAT-lyrics-match-correction Step 3a — the owner's lyrics candidate panel.
//
// Opened from the lyrics viewer ("다른 가사"), owner only. Lists every LRCLIB candidate the
// last explicit re-check judged — source, a short preview, and why it won or lost — next to
// what the track serves now and whether it is locked. From here the owner picks one (locked
// against every automatic job), marks "가사 없음", rejects a candidate for good, or unlocks.
//
// Everything shown comes from crowd uploads (title, artist, preview), so it is rendered as
// React text only — never as HTML.
//
// The server is the real gate (require_owner); the viewer only mounts this for the owner.
import type { KeyboardEvent } from 'react'
import type { AdminLyricsAction, AdminLyricsCandidate, AdminLyricsCandidates, AdminLyricsCurrent } from './lyricsAdmin.api'
import { useCallback, useEffect, useRef, useState } from 'react'
import { decideLyrics, getLyricsCandidates, LyricsAdminError, refreshLyricsCandidates } from './lyricsAdmin.api'

// Worker jobs (refresh, pick) land asynchronously: poll the GET until they show.
export const POLL_INTERVAL_MS = 3000
export const POLL_ATTEMPTS = 20

export const VERDICT_LABEL: Record<string, string> = {
  picked: '자동 선택',
  same_body: '선택과 같은 본문',
  outvoted: '다수 본문에 밀림',
  version_mismatch: '다른 버전',
  fuzzy_title: '제목 유사 · 자동 불가',
  no_body: '본문 없음',
  undecided: '자동 결정 보류',
  artist_mismatch: '아티스트 불일치',
  title_mismatch: '제목 불일치',
  duration_mismatch: '길이 불일치',
  rejected: '거부됨',
}

const STATUS_LABEL: Record<string, string> = {
  matched: '가사 연결됨',
  no_lyrics: '가사 없음',
  not_found: '후보 없음',
  ambiguous: '후보 모호',
  review_required: '검토 필요',
}

const ERROR_LABEL: Record<string, string> = {
  not_a_candidate: '저장된 후보 목록에 없는 가사예요. 후보를 새로 가져온 뒤 다시 골라 주세요.',
  rejected: '거부한 후보는 고를 수 없어요.',
}

function errorText(e: unknown): string {
  if (e instanceof LyricsAdminError) {
    if (e.code && ERROR_LABEL[e.code])
      return ERROR_LABEL[e.code]
    if (e.status === 403)
      return '오너만 쓸 수 있어요.'
    if (e.status === 503)
      return '잠시 후 다시 시도해 주세요.'
    if (e.status === 0)
      return '네트워크 오류'
    return `요청 실패 (HTTP ${e.status})`
  }
  return '요청 실패'
}

function mmss(sec: number | null | undefined): string {
  if (sec == null)
    return '–:––'
  const s = Math.round(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function lockText(current: AdminLyricsCurrent): string {
  if (current.lock === 'manual')
    return '잠김 · 직접 고름'
  if (current.lock === 'manual_fix')
    return '잠김 · 수동 수정'
  return '자동'
}

function fetchedText(at: string | null | undefined): string {
  if (!at)
    return '저장된 후보 없음'
  const d = new Date(at)
  return `후보 ${d.toLocaleDateString('ko-KR')} ${d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준`
}

export function LyricsCandidatePanel({ spotifyTrackId, onClose, onChanged }: {
  spotifyTrackId: string
  onClose: () => void
  /** The served lyric (may have) changed: the viewer reloads its document. */
  onChanged: () => void
}) {
  const [data, setData] = useState<AdminLyricsCandidates | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // Two-step confirm for the decisions that are hard to undo: "reject:<id>" | "no_lyrics".
  const [arming, setArming] = useState<string | null>(null)
  const alive = useRef(true)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (pollTimer.current)
        clearTimeout(pollTimer.current)
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const next = await getLyricsCandidates(spotifyTrackId)
      if (alive.current) {
        setData(next)
        setError(null)
      }
      return next
    }
    catch (e) {
      if (alive.current)
        setError(errorText(e))
      return null
    }
  }, [spotifyTrackId])

  useEffect(() => {
    void load()
  }, [load])

  /** Poll until `done(next)` or the attempts run out; resolves to whether it landed. */
  const pollUntil = useCallback((done: (next: AdminLyricsCandidates) => boolean): Promise<boolean> => {
    return new Promise((resolve) => {
      let left = POLL_ATTEMPTS
      const tick = async () => {
        if (!alive.current)
          return resolve(false)
        const next = await load()
        if (next && done(next))
          return resolve(true)
        if (--left <= 0)
          return resolve(false)
        pollTimer.current = setTimeout(() => void tick(), POLL_INTERVAL_MS)
      }
      pollTimer.current = setTimeout(() => void tick(), POLL_INTERVAL_MS)
    })
  }, [load])

  const refresh = useCallback(async () => {
    const before = data?.fetched_at ?? null
    setBusy('refresh')
    setNotice('후보를 새로 가져오는 중…')
    setError(null)
    try {
      const res = await refreshLyricsCandidates(spotifyTrackId)
      if (!res.enqueued) {
        setNotice('큐가 설정되지 않은 환경이에요 (로컬).')
        return
      }
      const landed = await pollUntil(next => (next.fetched_at ?? null) !== before)
      if (!alive.current)
        return
      setNotice(landed ? '후보를 새로 가져왔어요.' : '아직 결과가 없어요. 잠시 후 다시 열어 주세요.')
      if (landed)
        onChanged()
    }
    catch (e) {
      if (alive.current) {
        setError(errorText(e))
        setNotice(null)
      }
    }
    finally {
      if (alive.current)
        setBusy(null)
    }
  }, [data?.fetched_at, onChanged, pollUntil, spotifyTrackId])

  const decide = useCallback(async (action: AdminLyricsAction, lrclibId?: number) => {
    setBusy(`${action}:${lrclibId ?? ''}`)
    setArming(null)
    setError(null)
    setNotice(null)
    try {
      const res = await decideLyrics(spotifyTrackId, action, lrclibId)
      if (!alive.current)
        return
      if (res.outcome === 'enqueued') {
        setNotice('가사를 가져오는 중…')
        const landed = await pollUntil(next => next.current.lock === 'manual' && next.current.lrclib_id === lrclibId)
        if (!alive.current)
          return
        setNotice(landed ? '이 가사로 고정했어요.' : '아직 반영되지 않았어요. 잠시 후 다시 열어 주세요.')
      }
      else {
        setNotice(res.outcome === 'no_change' ?
'바뀐 것이 없어요.' :
{
          no_lyrics: '가사 없음으로 고정했어요.',
          reject: res.recheck_enqueued ? '거부했어요. 내린 뒤 다시 찾는 중이에요.' : '거부했어요.',
          unlock: '잠금을 풀었어요. 자동으로 다시 확인해요.',
          pick: '',
        }[action])
        await load()
      }
      onChanged()
    }
    catch (e) {
      if (alive.current)
        setError(errorText(e))
    }
    finally {
      if (alive.current)
        setBusy(null)
    }
  }, [load, onChanged, pollUntil, spotifyTrackId])

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation() // the viewer's own key handling must not see panel keys
    if (e.key === 'Escape')
      onClose()
  }

  const current = data?.current
  // Defaulted lists are optional in the generated schema.
  const candidates = data?.candidates ?? []
  const artists = data?.track_artists ?? []
  const locked = current?.lock != null

  return (
    <div className="lyv-cand" role="dialog" aria-modal="true" aria-label="가사 후보" onKeyDown={onKeyDown}>
      <div className="lyv-cand-head">
        <div className="lyv-cand-title">
          <span className="lyv-cand-eyebrow mono">가사 후보</span>
          <span className="lyv-cand-track">{data?.track_title ?? '…'}</span>
          {artists.length > 0 && <span className="lyv-cand-artists">{artists.join(', ')}</span>}
        </div>
        <button type="button" className="lyv-btn" onClick={onClose} aria-label="후보 닫기" autoFocus>✕</button>
      </div>

      {current && (
        <div className="lyv-cand-current">
          <div className="lyv-cand-current-line">
            <span>{current.match_status ? STATUS_LABEL[current.match_status] ?? current.match_status : '평가 기록 없음'}</span>
            {current.lrclib_id != null && (
<span className="mono">
#
{current.lrclib_id}
</span>
)}
            <span className={locked ? 'lyv-cand-lock is-locked mono' : 'lyv-cand-lock mono'}>{lockText(current)}</span>
            {current.reason === 'owner_rejected' && <span className="mono">거부 후 재검색 대기</span>}
          </div>
          <div className="lyv-cand-actions">
            {arming === 'no_lyrics' ?
              (
                <button type="button" className="lyv-cand-btn is-danger" disabled={busy != null} onClick={() => void decide('no_lyrics')}>
                  가사 없음으로 고정 — 확인
                </button>
              ) :
              (
                <button type="button" className="lyv-cand-btn" disabled={busy != null} onClick={() => setArming('no_lyrics')}>
                  가사 없음
                </button>
              )}
            {locked && (
              <button type="button" className="lyv-cand-btn" disabled={busy != null} onClick={() => void decide('unlock')}>
                잠금 해제
              </button>
            )}
          </div>
        </div>
      )}

      <div className="lyv-cand-meta">
        <span className="mono">{data ? fetchedText(data.fetched_at) : ''}</span>
        {data?.stale && <span className="lyv-cand-stale mono">갱신 필요</span>}
        <button type="button" className="lyv-cand-btn" disabled={busy != null || !data} onClick={() => void refresh()}>
          {busy === 'refresh' ? '가져오는 중…' : '후보 새로 가져오기'}
        </button>
      </div>

      <div className="lyv-cand-status" aria-live="polite">
        {error && <p className="lyv-cand-error">{error}</p>}
        {!error && notice && <p className="lyv-cand-notice">{notice}</p>}
      </div>

      <ol className="lyv-cand-list">
        {data && candidates.length === 0 && (
          <li className="lyv-cand-empty">저장된 후보가 없어요. "후보 새로 가져오기"를 눌러 주세요.</li>
        )}
        {candidates.map(c => (
          <CandidateRow
	key={c.lrclib_id}
	c={c}
	busy={busy}
	arming={arming}
	servedLocked={c.current && current?.lock === 'manual'}
	onArm={setArming}
	onDecide={decide}
          />
        ))}
      </ol>
    </div>
  )
}

function CandidateRow({ c, busy, arming, servedLocked, onArm, onDecide }: {
  c: AdminLyricsCandidate
  busy: string | null
  arming: string | null
  servedLocked: boolean
  onArm: (key: string | null) => void
  onDecide: (action: AdminLyricsAction, lrclibId?: number) => Promise<void>
}) {
  const rejectKey = `reject:${c.lrclib_id}`
  return (
    <li className={c.current ? 'lyv-cand-item is-current' : c.rejected ? 'lyv-cand-item is-rejected' : 'lyv-cand-item'}>
      <div className="lyv-cand-item-head">
        <span className={`lyv-cand-verdict mono is-${c.verdict}`}>{VERDICT_LABEL[c.verdict] ?? c.verdict}</span>
        {c.current && <span className="lyv-cand-badge mono">현재</span>}
        {c.cluster_size != null && c.cluster_size > 1 && <span className="lyv-cand-badge mono">{`같은 본문 ${c.cluster_size}`}</span>}
        <span className="lyv-cand-id mono">
#
{c.lrclib_id}
        </span>
      </div>
      <div className="lyv-cand-src">
        <span className="lyv-cand-src-title">{c.title}</span>
        <span className="lyv-cand-src-sub">
          {c.artist}
          {c.album ? ` · ${c.album}` : ''}
          {` · ${mmss(c.duration_sec)}`}
          {c.instrumental ? ' · 연주곡' : c.has_synced ? ' · 싱크' : c.has_plain ? ' · 텍스트' : ''}
        </span>
      </div>
      {c.preview && <p className="lyv-cand-preview">{c.preview}</p>}
      <div className="lyv-cand-actions">
        <button
	type="button"
	className="lyv-cand-btn is-primary"
	disabled={busy != null || c.rejected || servedLocked}
	onClick={() => void onDecide('pick', c.lrclib_id)}
        >
          {busy === `pick:${c.lrclib_id}` ? '가져오는 중…' : servedLocked ? '고정됨' : '이 가사로 고정'}
        </button>
        {!c.rejected && (arming === rejectKey ?
          (
            <button type="button" className="lyv-cand-btn is-danger" disabled={busy != null} onClick={() => void onDecide('reject', c.lrclib_id)}>
              {c.current ? '거부하고 내리기 — 확인' : '거부 — 확인'}
            </button>
          ) :
          (
            <button type="button" className="lyv-cand-btn" disabled={busy != null} onClick={() => onArm(rejectKey)}>
              거부
            </button>
          ))}
      </div>
    </li>
  )
}
