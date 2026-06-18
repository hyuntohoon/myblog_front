import { useEffect, useState } from 'react'
import type { PostListItem } from '../../scripts/write/api'
import { hardDeletePost } from '../../scripts/write/api'
import { ResultRow } from '../search/atoms'

interface Props {
  // null = still loading; [] = loaded, none. The host (WriterApp) owns the fetch
  // so the chrome badge count and this list stay a single source of truth.
  drafts: PostListItem[] | null
  // The draft currently open in the editor (?id=), marked "현재" + non-navigable
  // so the inbox doesn't offer to reopen the page you're already on.
  currentPostId: string | null
  // Called after a row is hard-deleted server-side (204). The host reloads the
  // draft list (single source of truth for this list + the chrome badge) and, if
  // the deleted row was the open draft, drops the editor's stale DB linkage.
  onDeleted: (id: string) => void
  onClose: () => void
}

// posted_date is an ISO date (YYYY-MM-DD); show it in the editorial dot style.
function fmtDate(iso: string): string {
  return (iso ?? '').slice(0, 10).replace(/-/g, '.')
}

// FEAT-editor-buckit Stage 2 Step 6 — '임시 저장함' inbox. Lists status='draft'
// posts (the nightly skeleton lands as one; manual drafts show too) and opens
// each in the editor via a full nav to /write?id=<post-id>, which WriterApp
// already loads on mount (fetchPostById). Frontend-only — no backend/contract
// change; reuses the unused listDrafts() + the shared search-row atom.
export default function DraftsInbox({ drafts, currentPostId, onDeleted, onClose }: Props) {
  // Delete is a two-click arm→confirm (hard delete is irreversible, and the
  // project bans window.confirm/alert): first click arms the row, second runs it.
  // confirmId = the armed row, deletingId = the row whose DELETE is in flight
  // (button disabled so a double-click can't fire two requests), errId = the row
  // whose last delete failed (shown inline).
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [errId, setErrId] = useState<string | null>(null)

  // esc disarms an armed row first, else closes (matches the ⌘K palette).
  // Outside-click is handled by the scrim.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape')
        return
      if (confirmId)
        setConfirmId(null)
      else
        onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmId, onClose])

  async function runDelete(id: string) {
    setDeletingId(id)
    setErrId(null)
    const res = await hardDeletePost(id)
    if (res.ok) {
      setConfirmId(null)
      onDeleted(id) // host reloads the list → the row drops out
    }
    else {
      setErrId(id) // leave it armed so a retry is one click away
    }
    setDeletingId(null)
  }

  // First click arms; a click on an armed row confirms. Arming one row disarms
  // any other (single armed row at a time).
  function onTrash(id: string) {
    if (deletingId)
      return
    if (confirmId === id)
      void runDelete(id)
    else
      setConfirmId(id)
  }

  const count = drafts?.length ?? 0

  return (
    <div className="wr-drafts-scrim" onClick={onClose} role="presentation">
      <div className="wr-drafts" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="임시 저장함">
        <header className="wr-drafts-head">
          <div className="wr-drafts-titlewrap">
            <span className="wr-drafts-ico" aria-hidden>🗂</span>
            <span className="wr-drafts-title serif">임시 저장함</span>
            {count > 0 && <span className="wr-drafts-count mono">{count}</span>}
          </div>
          <button type="button" className="wr-drafts-close" onClick={onClose} aria-label="닫기">✕</button>
        </header>

        <div className="wr-drafts-body wr-scroll">
          {drafts === null ?
            <div className="wr-drafts-msg mono">불러오는 중…</div> :
            drafts.length === 0 ?
              <div className="wr-drafts-msg mono">임시 저장 없음</div> :
              drafts.map((d) => {
                const isCurrent = currentPostId != null && d.id === currentPostId
                const title = d.title?.trim() || '(제목 없음)'
                const sub = [fmtDate(d.posted_date), d.category].filter(Boolean).join(' · ')
                return (
                  // Wrapper so the delete control is a SIBLING of the .gs-row
                  // anchor — a <button> nested inside the row's <a> is invalid
                  // markup and would steal the open-the-draft click.
                  <div className="wr-draft-row" key={d.id}>
                    <ResultRow
	name={title}
	src={d.album_cover_url}
	title={title}
	sub={sub}
	trailing={isCurrent ?
                        <span className="gs-row-tag is-on">현재</span> :
                        <span className="gs-row-tag gs-row-go">열기 →</span>}
	extraClass={isCurrent ? 'is-current' : undefined}
	action={isCurrent ?
                        { type: 'static' } :
                        { type: 'navigate', href: `/write?id=${encodeURIComponent(d.id)}` }}
                    />
                    <button
	type="button"
	className={`wr-draft-del${confirmId === d.id ? ' is-armed' : ''}${errId === d.id ? ' is-failed' : ''}`}
	onClick={() => onTrash(d.id)}
	disabled={deletingId === d.id}
	aria-label={confirmId === d.id ? `${title} 삭제 확인` : `${title} 삭제`}
	title={confirmId === d.id ? '한 번 더 눌러 삭제' : '삭제'}
                    >
                      {deletingId === d.id ?
                        '…' :
                        errId === d.id ?
                          '실패' :
                          confirmId === d.id ?
                            '삭제?' :
                            '🗑'}
                    </button>
                  </div>
                )
              })}
        </div>

        <footer className="wr-drafts-foot mono">
밤새 키운 골격이 여기에 도착합니다 ·
<b>esc</b>
{' '}
닫기
        </footer>
      </div>
    </div>
  )
}
