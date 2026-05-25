import type { SaveStatus, WriterView } from './types'

interface Props {
  status: SaveStatus
  lastSaved: string
  view: WriterView
  onViewChange: (v: WriterView) => void
  onSave: () => void
  onPublish: () => void
}

export default function WriterChrome({ status, lastSaved, view, onViewChange, onSave, onPublish }: Props) {
  return (
    <header className="wr-chrome">
      <div className="wr-chrome-l">
        <a href="/blog" className="wr-chrome-back">← 매거진</a>
        <span className="wr-chrome-sep">/</span>
        <span className="wr-chrome-crumb">새 리뷰</span>
      </div>

      <div className="wr-chrome-c">
        <span className="wr-chrome-logo">Lowfreq</span>
      </div>

      <div className="wr-chrome-r">
        <span className="wr-chrome-status">
          {status === 'saved' ? `저장됨 · ${lastSaved}` : '저장 중…'}
        </span>

        <div className="wr-view-toggle">
          <button
	className={view === 'edit' ? 'on' : ''}
	onClick={() => onViewChange('edit')}
          >
            작성
          </button>
          <button
	className={view === 'preview' ? 'on' : ''}
	onClick={() => onViewChange('preview')}
          >
            미리보기
          </button>
        </div>

        <button className="wr-chrome-btn" onClick={onSave}>
          저장
        </button>
        <button className="wr-chrome-btn primary" onClick={onPublish}>
          발행 →
        </button>
      </div>
    </header>
  )
}
