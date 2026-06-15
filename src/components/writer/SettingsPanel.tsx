import { useRef } from 'react'
import { SECTION_LABELS } from '../../lib/sections'
import { REVIEW_TAG_LABELS } from '../../lib/tags'
import { useDismissable } from '../../lib/useDismissable'
import GenrePicker from './GenrePicker'
import type { AlbumDetail } from './types'

interface Props {
  open: boolean
  onClose: () => void
  section: string
  tags: string[]
  genreIds: string[]
  publishDate: string
  subject: AlbumDetail | null
  body: string
  onSectionChange: (v: string) => void
  onToggleTag: (label: string) => void
  onToggleGenre: (id: string) => void
  onPublishDateChange: (v: string) => void
  onDraftSave: () => void
  onPublish: () => void
  onReset: () => void
  busy?: boolean
}

export default function SettingsPanel({
  open,
  onClose,
  section,
  tags,
  genreIds,
  publishDate,
  subject,
  body,
  onSectionChange,
  onToggleTag,
  onToggleGenre,
  onPublishDateChange,
  onDraftSave,
  onPublish,
  onReset,
  busy = false,
}: Props) {
  const panelRef = useRef<HTMLElement>(null)
  useDismissable(open, onClose, panelRef)
  return (
    <>
      <div className={`settings-backdrop${open ? ' open' : ''}`} onClick={onClose} />
      <aside ref={panelRef} role="dialog" aria-modal="true" aria-label="발행 설정" className={`settings-panel${open ? ' open' : ''}`}>
        <header className="set-head">
          <div className="set-title">발행 설정</div>
          <button type="button" className="set-close" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="set-body">
          <div className="set-block">
            <label className="set-l">섹션</label>
            <select className="set-select" aria-label="섹션" value={section} onChange={e => onSectionChange(e.target.value)}>
              {SECTION_LABELS.map(x => <option key={x}>{x}</option>)}
            </select>
          </div>

          <div className="set-block">
            <label className="set-l">리뷰 태그</label>
            <div className="set-tags" role="group" aria-label="리뷰 태그">
              {REVIEW_TAG_LABELS.map((label) => {
                const on = tags.includes(label)
                return (
                  <button
	key={label}
	type="button"
	className={`set-tag${on ? ' on' : ''}`}
	aria-pressed={on}
	onClick={() => onToggleTag(label)}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <GenrePicker value={genreIds} onToggle={onToggleGenre} />

          <div className="set-block">
            <label className="set-l">발행일</label>
            <input type="date" className="set-input" aria-label="발행일" value={publishDate} onChange={e => onPublishDateChange(e.target.value)} />
          </div>
        </div>

        <footer className="set-foot">
          <button type="button" className="set-link-danger" onClick={onReset}>초안 삭제</button>
          <div className="set-foot-spacer" />
          <button type="button" className="set-btn-ghost" onClick={onDraftSave} disabled={busy}>임시저장</button>
          <button
	type="button"
	className="set-btn-primary"
	onClick={onPublish}
	disabled={!subject || body.trim().length === 0 || busy}
          >
            {busy ? '발행 중…' : '발행 →'}
          </button>
        </footer>
      </aside>
    </>
  )
}
