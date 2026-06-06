import type { SaveStatus, WriterView } from './types'

interface Props {
  status: SaveStatus
  lastSaved: string
  view: WriterView
  onViewChange: (v: WriterView) => void
  onOpenSearch: () => void
  onSave: () => void
  onPublish: () => void
}

export default function WriterChrome({ status, lastSaved, view, onViewChange, onOpenSearch, onSave, onPublish }: Props) {
  return (
    <header className="chrome">
      <div className="chrome-l">
        <a className="chrome-back" href="/blog">← 매거진</a>
        <span className="chrome-sep">/</span>
        <em className="chrome-logo">Lowfreq</em>
      </div>
      <div className="chrome-r">
        <button type="button" className="chrome-search" onClick={onOpenSearch}>
          <span className="chrome-search-ico" aria-hidden>⌕</span>
          <span className="chrome-search-label">작품 검색</span>
          <kbd className="chrome-kbd">⌘K</kbd>
        </button>
        <span className="chrome-status">
          {status === 'saved' ? `저장됨 · ${lastSaved}` : '작성중…'}
        </span>
        <div className="view-toggle">
          <button className={view === 'edit' ? 'on' : ''} onClick={() => onViewChange('edit')}>작성</button>
          <button className={view === 'preview' ? 'on' : ''} onClick={() => onViewChange('preview')}>미리보기</button>
        </div>
        <button className="chrome-btn" onClick={onSave}>저장</button>
        <button className="chrome-btn primary" onClick={onPublish}>발행</button>
      </div>
    </header>
  )
}
