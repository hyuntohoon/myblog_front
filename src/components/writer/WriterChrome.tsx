import type { SaveStatus, WriterView } from './types'

interface Props {
  status: SaveStatus
  lastSaved: string
  pulseKey: number
  view: WriterView
  onViewChange: (v: WriterView) => void
  onOpenSearch: () => void
  onOpenDrafts: () => void
  // status='draft' count, for the inbox trigger's "drafts waiting" chip. null
  // while the count is still loading (no chip rendered yet).
  draftCount: number | null
  onSave: () => void
  onPublish: () => void
  busy?: boolean
}

export default function WriterChrome({ status, lastSaved, pulseKey, view, onViewChange, onOpenSearch, onOpenDrafts, draftCount, onSave, onPublish, busy = false }: Props) {
  const saved = status === 'saved'
  // Text alternative for the color dot — keeps it from being color-only and
  // carries the timestamp as a hover tooltip instead of always-on chrome text.
  const dotLabel = saved ? `임시저장됨 · ${lastSaved}` : '저장되지 않음'
  return (
    <header className="chrome">
      <div className="chrome-l">
        <a className="chrome-back" href="/reviews">← 매거진</a>
        <span className="chrome-sep">/</span>
        <em className="chrome-logo">buckit</em>
      </div>
      <div className="chrome-r">
        <button type="button" className="chrome-drafts" onClick={onOpenDrafts} aria-label="임시 저장함" title="임시 저장함 — 저장된 초안 열기">
          <span className="chrome-drafts-ico" aria-hidden>🗂</span>
          <span className="chrome-drafts-label">임시 저장함</span>
          {draftCount != null && draftCount > 0 && <span className="chrome-drafts-count">{draftCount}</span>}
        </button>
        <button type="button" className="chrome-search" onClick={onOpenSearch} aria-label="작품 검색" title="작품 검색 (⌘K)">
          <span className="chrome-search-ico" aria-hidden>⌕</span>
          <span className="chrome-search-label">작품 검색</span>
          <kbd className="chrome-kbd">⌘K</kbd>
        </button>
        <span className="chrome-save">
          <span
	className={`save-dot${saved ? ' is-saved' : ''}`}
	role="img"
	aria-label={dotLabel}
	title={dotLabel}
          />
          {pulseKey > 0 && <span key={pulseKey} className="save-pulse" aria-hidden="true" />}
        </span>
        <div className="view-toggle">
          <button className={view === 'edit' ? 'on' : ''} onClick={() => onViewChange('edit')}>작성</button>
          <button className={view === 'preview' ? 'on' : ''} onClick={() => onViewChange('preview')}>미리보기</button>
        </div>
        <button type="button" className="chrome-btn" onClick={onSave} disabled={busy}>임시저장</button>
        <button className="chrome-btn primary" onClick={onPublish}>발행</button>
      </div>
    </header>
  )
}
