import { useEffect } from 'react'
import type { PostListItem } from '../../scripts/write/api'
import { ResultRow } from '../search/atoms'

interface Props {
  // null = still loading; [] = loaded, none. The host (WriterApp) owns the fetch
  // so the chrome badge count and this list stay a single source of truth.
  drafts: PostListItem[] | null
  // The draft currently open in the editor (?id=), marked "현재" + non-navigable
  // so the inbox doesn't offer to reopen the page you're already on.
  currentPostId: string | null
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
export default function DraftsInbox({ drafts, currentPostId, onClose }: Props) {
  // esc closes (matches the ⌘K palette). Outside-click is handled by the scrim.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape')
        onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
                  <ResultRow
	key={d.id}
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
