import { useCallback, useEffect, useRef, useState } from 'react'
import WriterChrome from './WriterChrome'
import SubjectBlock from './SubjectBlock'
import BodyArea from './BodyArea'
import SettingsPanel from './SettingsPanel'
import PreviewView from './PreviewView'
import type { AlbumDetail, DraftPersist, SaveStatus, WriterView } from './types'
import { GENRES, SECTIONS } from './types'
import { fetchPostById, publishToGit, savePost, updatePost } from '../../scripts/write/api'

const DRAFT_KEY = 'lowfreq-draft'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function nowTime() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function loadDraft(): Partial<DraftPersist> {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? JSON.parse(raw) as Partial<DraftPersist> : {}
  }
  catch {
    return {}
  }
}

function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

function TitleArea({ headline, setHeadline, dek, setDek, dim }: {
  headline: string
  setHeadline: (v: string) => void
  dek: string
  setDek: (v: string) => void
  dim: boolean
}) {
  return (
    <div className={`title-area${dim ? ' is-dim' : ''}`}>
      <textarea
	className="title-input"
	rows={1}
	placeholder="제목"
	value={headline}
	onChange={(e) => {
          setHeadline(e.target.value)
          autoGrow(e.target)
        }}
	onFocus={e => autoGrow(e.target)}
	spellCheck={false}
      />
      <textarea
	className="dek-input"
	rows={1}
	placeholder="부제 또는 한 줄 요약"
	value={dek}
	onChange={(e) => {
          setDek(e.target.value)
          autoGrow(e.target)
        }}
	onFocus={e => autoGrow(e.target)}
	spellCheck={false}
      />
    </div>
  )
}

function ByLine({ author, role, date }: { author: string, role: string, date: string }) {
  return (
    <div className="byline">
      <span className="byline-by">By</span>
      <span className="byline-author">{author || '—'}</span>
      {role && (
<span className="byline-role">
·
{role}
</span>
)}
      <span className="byline-sep">·</span>
      <span>{date}</span>
    </div>
  )
}

function Toast({ msg }: { msg: string }) {
  if (!msg)
    return null
  return <div className="toast">{msg}</div>
}

export default function WriterApp() {
  const saved = loadDraft()
  const loaded = useRef(false)

  // Edit mode: populated when ?id= is in URL or after first DB save
  const [dbPostId, setDbPostId] = useState<string | null>(null)

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
  const [lastSaved, setLastSaved] = useState(saved.lastSaved ?? '—')
  const [toast, setToast] = useState('')

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flash = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current)
      clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2600)
  }, [])

  // Load draft from DB when ?id= is present in URL
  useEffect(() => {
    loaded.current = true
    const params = new URLSearchParams(window.location.search)
    const id = params.get('id')
    if (!id)
      return
    fetchPostById(id).then((post) => {
      if (!post)
        return
      setDbPostId(post.id)
      setHeadline(post.title)
      setDek(post.description ?? '')
      setBody(post.body_mdx ?? '')
      setPublishDate(post.posted_date)
      setScore(post.rating ?? 0)
      if (post.category)
        setSection(post.category)
    })
  }, [])

  // Autosave
  useEffect(() => {
    if (!loaded.current)
      return
    setStatus('dirty')
    const id = setTimeout(() => {
      const ts = nowTime()
      const data: DraftPersist = {
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
lastSaved: ts,
      }
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(data))
      }
      catch { /* quota */ }
      setLastSaved(ts)
      setStatus('saved')
    }, 600)
    return () => clearTimeout(id)
  }, [subject, score, bestNew, headline, dek, body, tags, section, genre, publishDate, author, authorRole])

  const onSaveDraft = async () => {
    if (!headline.trim()) {
      flash('제목을 입력하세요.')
      return
    }
    const artistIds = subject?.artists.map(a => a.id).filter(Boolean) ?? []
    const payload = {
      title: headline,
      description: dek,
      body_mdx: body || null,
      posted_date: publishDate,
      status: 'draft' as const,
      category: section || null,
      album_ids: subject ? [subject.id] : [],
      artist_ids: artistIds,
      rating: score > 0 ? score : null,
    }
    const res = dbPostId ?
      await updatePost(dbPostId, payload) :
      await savePost({ ...payload, album_cover_url: subject?.cover_url ?? null })
    if (!res.ok) {
      flash(`임시저장 실패 (${res.status})`)
      return
    }
    if (!dbPostId) {
      const json = await res.json()
      setDbPostId(json.id)
    }
    flash('임시저장 완료')
  }

  const onReset = () => {
    localStorage.removeItem(DRAFT_KEY)
    setSubject(null)
    setScore(0)
    setBestNew(false)
    setHeadline('')
    setDek('')
    setBody('')
    setTags([])
    setSettingsOpen(false)
    flash('초안이 삭제되었습니다.')
  }

  const onPublish = async () => {
    if (!subject || !headline.trim() || score <= 0 || body.trim().length < 80) {
      flash('발행 조건이 충족되지 않았습니다.')
      return
    }
    const artistIds = subject.artists.map(a => a.id).filter(Boolean)
    const res = await savePost({
      title: headline,
      description: dek,
      body_mdx: body,
      posted_date: publishDate,
      status: 'published',
      album_ids: [subject.id],
      artist_ids: artistIds,
      rating: score,
      album_cover_url: subject.cover_url,
    })
    if (!res.ok) {
      flash(`발행 실패: ${res.status}`)
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
    })
    if (!gitRes.ok) {
      flash('저장 완료, Git 발행 실패')
      return
    }

    // Astro rebuilds the static site on the new GitHub commit (~3–5 min).
    // The /blog/{slug} URL 404s until that finishes, so we do not auto-redirect.
    // Reset the form to prevent accidental re-publish, and tell the user where
    // to look once the build completes.
    localStorage.removeItem(DRAFT_KEY)
    setSubject(null)
    setScore(0)
    setBestNew(false)
    setHeadline('')
    setDek('')
    setBody('')
    setTags([])
    flash('발행 완료! 사이트 반영까지 약 3–5분 — /blog 에서 확인하세요.')
    setSettingsOpen(false)
  }

  const s = { subject, score, bestNew, headline, dek, body, tags, section, genre, publishDate, author, authorRole }

  return (
    <div className="page">
      <WriterChrome
	view={view}
	onViewChange={setView}
	status={status}
	lastSaved={lastSaved}
	onSave={onSaveDraft}
	onPublish={() => setSettingsOpen(true)}
      />

      {view === 'edit' ?
        (
          <main className="surface">
            <SubjectBlock
	subject={subject}
	score={score}
	bestNew={bestNew}
	onSubjectSelect={setSubject}
	onScoreChange={setScore}
	onBestNewToggle={() => setBestNew(b => !b)}
            />
            <TitleArea headline={headline} setHeadline={setHeadline} dek={dek} setDek={setDek} dim={!subject} />
            <ByLine author={author} role={authorRole} date={publishDate} />
            <BodyArea body={body} setBody={setBody} dim={!subject} />
          </main>
        ) :
        (
          <main className="surface preview-surface">
            <PreviewView s={s} />
          </main>
        )}

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
	onDraftSave={onSaveDraft}
	onPublish={onPublish}
	onReset={onReset}
      />

      <Toast msg={toast} />
    </div>
  )
}
