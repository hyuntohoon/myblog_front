import { SECTION_LABELS } from '../../lib/sections'
import type { AlbumDetail } from './types'

interface Props {
  open: boolean
  onClose: () => void
  section: string
  publishDate: string
  subject: AlbumDetail | null
  body: string
  onSectionChange: (v: string) => void
  onPublishDateChange: (v: string) => void
  onDraftSave: () => void
  onPublish: () => void
  onReset: () => void
}

export default function SettingsPanel({
  open,
  onClose,
  section,
  publishDate,
  subject,
  body,
  onSectionChange,
  onPublishDateChange,
  onDraftSave,
  onPublish,
  onReset,
}: Props) {
  return (
    <>
      <div className={`settings-backdrop${open ? ' open' : ''}`} onClick={onClose} />
      <aside className={`settings-panel${open ? ' open' : ''}`}>
        <header className="set-head">
          <div className="set-title">발행 설정</div>
          <button type="button" className="set-close" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="set-body">
          <div className="set-block">
            <label className="set-l">섹션</label>
            <select className="set-select" value={section} onChange={e => onSectionChange(e.target.value)}>
              {SECTION_LABELS.map(x => <option key={x}>{x}</option>)}
            </select>
          </div>

          <div className="set-block">
            <label className="set-l">발행일</label>
            <input type="date" className="set-input" value={publishDate} onChange={e => onPublishDateChange(e.target.value)} />
          </div>
        </div>

        <footer className="set-foot">
          <button type="button" className="set-link-danger" onClick={onReset}>초안 삭제</button>
          <div className="set-foot-spacer" />
          <button type="button" className="set-btn-ghost" onClick={onDraftSave}>임시저장</button>
          <button
	type="button"
	className="set-btn-primary"
	onClick={onPublish}
	disabled={!subject || body.trim().length === 0}
          >
            발행 →
          </button>
        </footer>
      </aside>
    </>
  )
}
