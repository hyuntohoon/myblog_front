import { useCallback, useEffect, useRef, useState } from 'react'
import WriterChrome from './WriterChrome'
import SubjectBlock from './SubjectBlock'
import BodyArea from './BodyArea'
import SettingsPanel from './SettingsPanel'
import PreviewView from './PreviewView'
import type { AlbumDetail, DraftPersist, SaveStatus, WriterView } from './types'
import { GENRES, SECTIONS } from './types'
import { publishToGit, savePost } from '../../scripts/write/api'

const DRAFT_KEY = 'lowfreq-draft'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function nowTime() {
  return new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

function loadDraft(): Partial<DraftPersist> {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw)
return {}
    return JSON.parse(raw) as Partial<DraftPersist>
  }
 catch {
    return {}
  }
}

export default function WriterApp() {
  const saved = loadDraft()

  const [subject, setSubject] = useState<AlbumDetail | null>(saved.subject ?? null)
  const [score, setScore] = useState(saved.score ?? 0)
  const [bestNew, setBestNew] = useState(saved.bestNew ?? false)
  const [headline, setHeadline] = useState(saved.headline ?? '')
  const [dek, setDek] = useState(saved.dek ?? '')
  const [body, setBody] = useState(saved.body ?? '')
  const [tags, setTags] = useState<string[]>(saved.tags ?? [])
  const [section, setSection] = useState(saved.section ?? SECTIONS[0])
  const [genre, setGenre] = useState(saved.genre ?? GENRES[0])
  const [publishDate, setPublishDate] = useState(saved.publishDate ?? todayISO())
  const [author, setAuthor] = useState(saved.author ?? '')
  const [authorRole, setAuthorRole] = useState(saved.authorRole ?? '')

  const [view, setView] = useState<WriterView>('edit')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [lastSaved, setLastSaved] = useState(saved.lastSaved ?? nowTime())
  const [toast, setToast] = useState('')

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    if (toastTimer.current)
clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 3000)
  }

  const persistDraft = useCallback(() => {
    const draft: DraftPersist = {
      subject,
score,
bestNew,
headline,
dek,
body,
tags,
      section,
genre,
publishDate,
author,
authorRole,
      lastSaved: nowTime(),
    }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    const t = nowTime()
    setLastSaved(t)
    setStatus('saved')
  }, [subject, score, bestNew, headline, dek, body, tags, section, genre, publishDate, author, authorRole])

  // autosave on any change
  useEffect(() => {
    setStatus('dirty')
    if (autosaveTimer.current)
clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(persistDraft, 600)
    return () => {
 if (autosaveTimer.current)
clearTimeout(autosaveTimer.current)
}
  }, [subject, score, bestNew, headline, dek, body, tags, section, genre, publishDate, author, authorRole, persistDraft])

  function handleManualSave() {
    persistDraft()
    showToast('임시저장 완료')
  }

  async function handlePublish() {
    if (!subject || !headline.trim() || score <= 0 || body.length < 80)
return

    const artistIds = subject.artists.map(a => a.id).filter(Boolean)
    const payload = {
      title: headline,
      description: dek,
      body_mdx: body,
      posted_date: publishDate,
      status: 'published' as const,
      album_ids: [subject.id],
      artist_ids: artistIds,
      rating: score,
      rating_scale: 5,
      album_cover_url: subject.cover_url,
    }

    const res = await savePost(payload)
    if (!res.ok) {
      const err = await res.text()
      showToast(`발행 실패: ${err}`)
      return
    }

    const json = await res.json()
    const slug: string = json.slug ?? json.id ?? ''
    const postId: string = json.id ?? ''

    const gitRes = await publishToGit({
      title: headline,
      body_mdx: body,
      slug,
      categoryName: section,
      description: dek,
      posted_date: publishDate,
      album_ids: [subject.id],
      artist_ids: artistIds,
      post_id: postId,
      album_cover_url: subject.cover_url,
      rating: score,
      rating_scale: 5,
    })

    if (!gitRes.ok) {
      showToast('저장 완료, Git 발행 실패')
      return
    }

    localStorage.removeItem(DRAFT_KEY)
    showToast('발행 완료!')
    setTimeout(() => {
      window.location.href = `/blog/${slug}`
    }, 1200)
  }

  const artistName = subject?.artists.map(a => a.name).join(', ') ?? ''
  const year = subject?.release_date?.slice(0, 4) ?? ''

  return (
    <div className="wr-root">
      <WriterChrome
	status={status}
	lastSaved={lastSaved}
	view={view}
	onViewChange={setView}
	onSave={handleManualSave}
	onPublish={() => setSettingsOpen(true)}
      />

      <main className="wr-surface">
        {view === 'preview' ?
          (
            <PreviewView
	subject={subject}
	score={score}
	bestNew={bestNew}
	headline={headline}
	dek={dek}
	body={body}
	author={author}
	authorRole={authorRole}
	publishDate={publishDate}
            />
          ) :
          (
          <>
            {/* Subject (album search + compact card) */}
            <SubjectBlock
	subject={subject}
	score={score}
	bestNew={bestNew}
	onSubjectSelect={setSubject}
	onScoreChange={setScore}
	onBestNewToggle={() => setBestNew(b => !b)}
	onClear={() => {
          setSubject(null)
          setScore(0)
          setBestNew(false)
        }}
            />

            {/* Title area */}
            <div className="wr-title-area">
              <input
	type="text"
	className="wr-title-input"
	value={headline}
	onChange={e => setHeadline(e.target.value)}
	placeholder="제목"
	autoComplete="off"
              />
              <input
	type="text"
	className="wr-dek-input"
	value={dek}
	onChange={e => setDek(e.target.value)}
	placeholder="부제 또는 한 줄 요약"
	autoComplete="off"
              />
            </div>

            {/* Byline */}
            <div className="wr-byline">
              {(artistName || subject?.title) && (
                <span>
                  {artistName && <em>{artistName}</em>}
                  {artistName && subject?.title && ' — '}
                  {subject?.title && <span>{subject.title}</span>}
                  {year && ` (${year})`}
                </span>
              )}
              <span>
                {author ? `By ${author}` : 'By'}
                {authorRole ? ` · ${authorRole}` : ''}
              </span>
              <span>{publishDate}</span>
            </div>

            {/* Body */}
            <BodyArea value={body} onChange={setBody} />
          </>
        )}
      </main>

      <SettingsPanel
	open={settingsOpen}
	onClose={() => setSettingsOpen(false)}
	section={section}
	genre={genre}
	publishDate={publishDate}
	tags={tags}
	author={author}
	authorRole={authorRole}
	subject={subject}
	score={score}
	headline={headline}
	body={body}
	onSectionChange={setSection}
	onGenreChange={setGenre}
	onPublishDateChange={setPublishDate}
	onTagsChange={setTags}
	onAuthorChange={setAuthor}
	onAuthorRoleChange={setAuthorRole}
	onDraftSave={handleManualSave}
	onPublish={handlePublish}
      />

      {toast && (
        <div className="wr-toast">{toast}</div>
      )}
    </div>
  )
}
