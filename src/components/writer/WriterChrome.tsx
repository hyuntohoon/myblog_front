import type { SaveStatus, WriterView } from './types'

interface Props {
  status: SaveStatus
  lastSaved: string
  pulseKey: number
  view: WriterView
  onViewChange: (v: WriterView) => void
  onOpenSearch: () => void
  onSave: () => void
  onPublish: () => void
}

export default function WriterChrome({ status, lastSaved, pulseKey, view, onViewChange, onOpenSearch, onSave, onPublish }: Props) {
  const saved = status === 'saved'
  // Text alternative for the color dot — keeps it from being color-only and
  // carries the timestamp as a hover tooltip instead of always-on chrome text.
  const dotLabel = saved ? `임시저장됨 · ${lastSaved}` : '저장되지 않음'
  return (
    <header className="chrome">
      <div className="chrome-l">
        <a className="chrome-back" href="/reviews">← 매거진</a>
        <span className="chrome-sep">/</span>
        <em className="chrome-logo">Lowfreq</em>
      </div>
      <div className="chrome-r">
        <button type="button" className="chrome-search" onClick={onOpenSearch}>
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
        <button className="chrome-btn" onClick={onSave}>임시저장</button>
        <button className="chrome-btn primary" onClick={onPublish}>발행</button>
      </div>
    </header>
  )
}
