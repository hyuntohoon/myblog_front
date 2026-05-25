import { useState } from 'react'
import { GENRES, SECTIONS } from './types'
import type { AlbumDetail } from './types'

interface Props {
  open: boolean
  onClose: () => void
  section: string
  genre: string
  publishDate: string
  tags: string[]
  author: string
  authorRole: string
  subject: AlbumDetail | null
  score: number
  headline: string
  body: string
  onSectionChange: (v: string) => void
  onGenreChange: (v: string) => void
  onPublishDateChange: (v: string) => void
  onTagsChange: (tags: string[]) => void
  onAuthorChange: (v: string) => void
  onAuthorRoleChange: (v: string) => void
  onDraftSave: () => void
  onPublish: () => void
  onReset: () => void
}

function TagsInput({ tags, onChange }: { tags: string[], onChange: (t: string[]) => void }) {
  const [draft, setDraft] = useState('')
  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      const t = draft.trim()
      if (t && !tags.includes(t))
        onChange([...tags, t])
      setDraft('')
    }
    else if (e.key === 'Backspace' && !draft && tags.length) {
      onChange(tags.slice(0, -1))
    }
  }
  return (
    <div className="tags-wrap">
      {tags.map((t, i) => (
        <span key={i} className="tag-chip">
          {t}
          <button type="button" onClick={() => onChange(tags.filter((_, j) => j !== i))}>✕</button>
        </span>
      ))}
      <input
	className="tags-input"
	placeholder={tags.length ? '' : '태그…'}
	value={draft}
	onChange={e => setDraft(e.target.value)}
	onKeyDown={onKey}
      />
    </div>
  )
}

function Check({ ok, label }: { ok: boolean, label: string }) {
  return (
    <div className={`check-row${ok ? ' ok' : ''}`}>
      <span className="check-mark">{ok ? '✓' : '○'}</span>
      <span>{label}</span>
    </div>
  )
}

export default function SettingsPanel({
  open,
onClose,
  section,
genre,
publishDate,
tags,
author,
authorRole,
  subject,
score,
headline,
body,
  onSectionChange,
onGenreChange,
onPublishDateChange,
onTagsChange,
  onAuthorChange,
onAuthorRoleChange,
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
              {SECTIONS.map(x => <option key={x}>{x}</option>)}
            </select>
          </div>

          <div className="set-row-2">
            <div className="set-block">
              <label className="set-l">장르</label>
              <select className="set-select" value={genre} onChange={e => onGenreChange(e.target.value)}>
                {GENRES.map(x => <option key={x}>{x}</option>)}
              </select>
            </div>
            <div className="set-block">
              <label className="set-l">발행일</label>
              <input type="date" className="set-input" value={publishDate} onChange={e => onPublishDateChange(e.target.value)} />
            </div>
          </div>

          <div className="set-block">
            <label className="set-l">태그</label>
            <TagsInput tags={tags} onChange={onTagsChange} />
            <div className="set-hint">엔터로 추가, ⌫로 삭제</div>
          </div>

          <div className="set-row-2">
            <div className="set-block">
              <label className="set-l">작성자</label>
              <input className="set-input" value={author} onChange={e => onAuthorChange(e.target.value)} placeholder="이름" />
            </div>
            <div className="set-block">
              <label className="set-l">역할</label>
              <input className="set-input" value={authorRole} onChange={e => onAuthorRoleChange(e.target.value)} placeholder="객원필자" />
            </div>
          </div>

          <div className="set-block set-checklist">
            <label className="set-l">발행 체크리스트</label>
            <Check ok={!!subject} label="작품 선택" />
            <Check ok={!!headline.trim()} label="헤드라인" />
            <Check ok={score > 0} label="평점" />
            <Check ok={body.trim().length >= 80} label={`본문 80자 이상 (현재 ${body.trim().length}자)`} />
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
	disabled={!subject || !headline.trim() || score <= 0 || body.trim().length < 80}
          >
            발행 →
          </button>
        </footer>
      </aside>
    </>
  )
}
