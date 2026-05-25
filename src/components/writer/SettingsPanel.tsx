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
  onPublish: () => Promise<void>
}

function TagsInput({ tags, onChange }: { tags: string[], onChange: (t: string[]) => void }) {
  const [input, setInput] = useState('')

  function addTag() {
    const trimmed = input.trim().toLowerCase()
    if (!trimmed || tags.includes(trimmed))
      return
    onChange([...tags, trimmed])
    setInput('')
  }

  return (
    <div className="wr-tags-wrap">
      {tags.map(tag => (
        <span key={tag} className="wr-tag-chip">
          {tag}
          <button
	type="button"
	onClick={() => onChange(tags.filter(t => t !== tag))}
          >
            ×
          </button>
        </span>
      ))}
      <input
	type="text"
	className="wr-tags-input"
	value={input}
	placeholder="태그 추가…"
	onChange={e => setInput(e.target.value)}
	onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            addTag()
          }
          if (e.key === 'Backspace' && !input && tags.length) {
            onChange(tags.slice(0, -1))
          }
        }}
      />
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
}: Props) {
  const [publishing, setPublishing] = useState(false)

  const checks = [
    { label: '앨범 선택됨', ok: subject !== null },
    { label: '제목 입력됨', ok: headline.trim().length > 0 },
    { label: '평점 설정됨', ok: score > 0 },
    { label: '본문 80자 이상', ok: body.length >= 80 },
  ]
  const canPublish = checks.every(c => c.ok)

  async function handlePublish() {
    if (!canPublish || publishing)
      return
    setPublishing(true)
    try {
      await onPublish()
    }
    finally {
      setPublishing(false)
    }
  }

  return (
    <>
      {open && <div className="wr-settings-backdrop open" onClick={onClose} />}
      <div className={`wr-settings-panel${open ? ' open' : ''}`}>
        <div className="wr-set-head">
          <span className="wr-set-title">발행 설정</span>
          <button type="button" className="wr-set-close" onClick={onClose}>✕</button>
        </div>

        <div className="wr-set-body">
          <div className="wr-set-block">
            <label className="wr-set-l">섹션</label>
            <select
	className="wr-set-select"
	value={section}
	onChange={e => onSectionChange(e.target.value)}
            >
              {SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="wr-set-block">
            <label className="wr-set-l">장르</label>
            <select
	className="wr-set-select"
	value={genre}
	onChange={e => onGenreChange(e.target.value)}
            >
              {GENRES.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>

          <div className="wr-set-block">
            <label className="wr-set-l">발행일</label>
            <input
	type="date"
	className="wr-set-input"
	value={publishDate}
	onChange={e => onPublishDateChange(e.target.value)}
            />
          </div>

          <div className="wr-set-block">
            <label className="wr-set-l">태그</label>
            <TagsInput tags={tags} onChange={onTagsChange} />
          </div>

          <div className="wr-set-row-2">
            <div className="wr-set-block">
              <label className="wr-set-l">작성자</label>
              <input
	type="text"
	className="wr-set-input"
	value={author}
	placeholder="이름"
	onChange={e => onAuthorChange(e.target.value)}
              />
            </div>
            <div className="wr-set-block">
              <label className="wr-set-l">역할</label>
              <input
	type="text"
	className="wr-set-input"
	value={authorRole}
	placeholder="Staff Writer"
	onChange={e => onAuthorRoleChange(e.target.value)}
              />
            </div>
          </div>

          <div className="wr-set-checklist">
            {checks.map(c => (
              <div key={c.label} className={`wr-check-row${c.ok ? ' ok' : ''}`}>
                <span className="wr-check-mark">{c.ok ? '✓' : ''}</span>
                <span>{c.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="wr-set-foot">
          <button type="button" className="wr-set-btn-ghost" onClick={onDraftSave}>
            임시저장
          </button>
          <span className="wr-set-foot-spacer" />
          <button
	type="button"
	className="wr-set-btn-primary"
	disabled={!canPublish || publishing}
	onClick={handlePublish}
          >
            {publishing ? '발행 중…' : '발행 →'}
          </button>
        </div>
      </div>
    </>
  )
}
