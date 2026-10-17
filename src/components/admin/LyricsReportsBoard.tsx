// FEAT-lyrics-match-correction Step 3b — the owner's queue of lyrics reports.
//
// Renders `GET /api/admin/lyrics/reports` (require_owner): every track with an open
// "가사가 틀려요" report, most reported first. Each row opens the 3a candidate panel for
// that track; "지금 가사가 맞아요" closes its reports without touching the lyrics (decision
// `keep`). Any other panel decision that settles what the track serves closes them too, so
// the list is re-read when the panel closes.
//
// `auto_resolved` means what the track serves changed since the latest report (a re-check
// switched it); the owner still confirms. Titles and artists are catalog text and are
// rendered as React text only.
import type { AdminLyricsReport, AdminLyricsReports } from '../member/lyrics/lyricsAdmin.api'
import { useCallback, useEffect, useState } from 'react'
import { decideLyrics, getLyricsReports, LyricsAdminError } from '../member/lyrics/lyricsAdmin.api'
import { LyricsCandidatePanel } from '../member/lyrics/LyricsCandidatePanel'

const STATUS_LABEL: Record<string, string> = {
  matched: '가사 연결됨',
  no_lyrics: '가사 없음',
  not_found: '후보 없음',
  ambiguous: '후보 모호',
  review_required: '검토 필요',
}

function statusText(status: string | null | undefined): string {
  return status ? (STATUS_LABEL[status] ?? status) : '평가 전'
}

function kst(at: string): string {
  return new Date(at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function loadError(e: unknown): string {
  if (e instanceof LyricsAdminError && e.status === 403)
    return '오너만 볼 수 있어요.'
  if (e instanceof LyricsAdminError && e.status === 0)
    return '네트워크 오류로 불러오지 못했어요.'
  return '신고 목록을 불러오지 못했어요.'
}

function ReportRow({ item, onOpen, onKeep, busy }: {
  item: AdminLyricsReport
  onOpen: () => void
  onKeep: () => void
  busy: boolean
}) {
  const changed = item.state === 'auto_resolved'
  return (
    <li className="lrq-row">
      <div className="lrq-main">
        <span className="lrq-track">{item.track_title}</span>
        {(item.track_artists ?? []).length > 0 && <span className="lrq-artists">{(item.track_artists ?? []).join(', ')}</span>}
        <span className="lrq-meta mono">
          신고
          {' '}
          {item.member_count}
          건
          {(item.system_reasons ?? []).length > 0 && ` · 시스템 ${(item.system_reasons ?? []).join(', ')}`}
          {' · 마지막 '}
          {kst(item.last_reported_at)}
        </span>
        <span className="lrq-meta mono">
          {'신고 때 '}
          {statusText(item.reported.match_status)}
          {item.reported.lrclib_id != null && ` #${item.reported.lrclib_id}`}
          {' → 지금 '}
          {statusText(item.current.match_status)}
          {item.current.lrclib_id != null && ` #${item.current.lrclib_id}`}
          {item.current.lock && ' · 잠김'}
        </span>
        {changed && <span className="lrq-changed">재검사 뒤 가사가 바뀌었어요 — 확인해 주세요</span>}
      </div>
      <div className="lrq-actions">
        <button type="button" className="auto-button" onClick={onOpen} disabled={busy}>후보 보기</button>
        <button type="button" className="auto-button" onClick={onKeep} disabled={busy}>지금 가사가 맞아요</button>
      </div>
    </li>
  )
}

export default function LyricsReportsBoard() {
  const [data, setData] = useState<AdminLyricsReports | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await getLyricsReports())
      setError(null)
    }
    catch (e) {
      setError(loadError(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const keep = useCallback(async (item: AdminLyricsReport) => {
    setBusy(item.spotify_track_id)
    setNotice(null)
    try {
      const res = await decideLyrics(item.spotify_track_id, 'keep')
      setNotice(res.outcome === 'applied' ?
        `「${item.track_title}」 신고 ${res.reports_resolved ?? 0}건을 닫았어요.` :
        `「${item.track_title}」에 열린 신고가 없어요.`)
    }
    catch {
      setNotice('신고를 닫지 못했어요. 잠시 후 다시 시도해 주세요.')
    }
    finally {
      setBusy(null)
      await load()
    }
  }, [load])

  return (
    <div className="auto lrq">
      <div className="auto-head">
        <h1 className="auto-title">가사 신고</h1>
      </div>
      {error && <p className="auto-status" role="alert">{error}</p>}
      {!error && data == null && <p className="auto-status" role="status">불러오는 중…</p>}
      {notice && <p className="auto-status" role="status">{notice}</p>}
      {!error && data != null && (
        (data.items ?? []).length === 0 ?
          <p className="auto-status">열린 신고가 없어요.</p> :
          (
              <>
                <p className="auto-status">
                  {`신고가 열린 곡 ${data.total_tracks}곡`}
                  {data.truncated && ` · 많이 신고된 ${(data.items ?? []).length}곡만 보여요`}
                </p>
                <ul className="lrq-list">
                  {(data.items ?? []).map(item => (
                    <ReportRow
	key={item.spotify_track_id}
	item={item}
	busy={busy === item.spotify_track_id}
	onOpen={() => setOpen(item.spotify_track_id)}
	onKeep={() => void keep(item)}
                    />
                  ))}
                </ul>
              </>
            )
      )}
      {open && (
        <div className="lrq-overlay">
          <LyricsCandidatePanel
	spotifyTrackId={open}
	onClose={() => {
              setOpen(null)
              void load()
            }}
	onChanged={() => void load()}
          />
        </div>
      )}
    </div>
  )
}
