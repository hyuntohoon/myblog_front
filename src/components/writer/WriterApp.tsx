import { useCallback, useEffect, useRef, useState } from 'react'
import WriterChrome from './WriterChrome'
import SubjectBlock from './SubjectBlock'
import RecommendedTracksBlock from './RecommendedTracksBlock'
import BodyArea from './BodyArea'
import SettingsPanel from './SettingsPanel'
import PreviewView from './PreviewView'
import type { AlbumDetail, DraftPersist, SaveStatus, WriterView } from './types'
import { SECTION_LABELS } from '../../lib/sections'
import { fetchPostById, publishToGit, readErrorDetail, savePost, updatePost } from '../../scripts/write/api'

const DRAFT_KEY = 'lowfreq-draft'
const MUSIC = import.meta.env.PUBLIC_API_URL as string

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function nowTime() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function loadDraft(): Partial<DraftPersist> {
  // Older drafts persisted dead keys (bestNew/tags/genre/author/authorRole).
  // Partial<DraftPersist> silently drops them on read — no migration needed.
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
  const [headline, setHeadline] = useState(saved.headline ?? '')
  const [dek, setDek] = useState(saved.dek ?? '')
  const [body, setBody] = useState(saved.body ?? '')
  const [section, setSection] = useState(saved.section ?? SECTION_LABELS[0])
  const [publishDate, setPublishDate] = useState(saved.publishDate ?? todayISO())
  const [recommendedTrackIds, setRecommendedTrackIds] = useState<string[]>(saved.recommendedTrackIds ?? [])
  // FEAT-writer-lowfreq-redesign Step 6: editor-set BEST NEW MUSIC. Seeds
  // from saved draft on mount; reseeds from fetched album.best_new on subject
  // pick (handled inside SubjectBlock via the seed callback); reseeds from
  // post.subject_best_new on edit-mode load below.
  const [subjectBestNew, setSubjectBestNew] = useState<boolean>(saved.subjectBestNew ?? false)

  // Album switch invalidates any previously-picked tracks (they belonged to the
  // old album). Clear silently — the user is starting fresh under the new subject.
  const onSubjectSelect = useCallback((next: AlbumDetail) => {
    setSubject((prev) => {
      if (prev && prev.id !== next.id)
        setRecommendedTrackIds([])
      return next
    })
    // Step 6: seed the BEST NEW toggle from the newly-picked album's flag.
    // For artist subjects (kind='artist') there's no album-level flag — leave
    // the toggle off; SubjectBlock hides the pill anyway.
    if (next.kind !== 'artist')
      setSubjectBestNew(next.best_new ?? false)
    else
      setSubjectBestNew(false)
  }, [])

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

  // FEAT-review-bucket-board Step 5: prefill the album subject from ?album=<id>
  // when arriving from the queue's "전체 편집기로 열기". Only the album is seeded;
  // the writer's own `lowfreq-draft` body/score are left untouched.
  const prefillAlbum = useCallback(async (albumId: string) => {
    try {
      const r = await fetch(`${MUSIC}/api/music/albums/${encodeURIComponent(albumId)}`)
      if (!r.ok)
        return
      const json = await r.json() as {
        album: { id: string, title: string, cover_url: string | null, release_date: string | null, best_new?: boolean }
        artists?: Array<{ id: string, name: string }>
        tracks?: Array<{ id: string, title: string, track_no: number | null }>
      }
      onSubjectSelect({
        id: json.album.id,
        title: json.album.title,
        cover_url: json.album.cover_url,
        release_date: json.album.release_date,
        artists: (json.artists ?? []).map(a => ({ id: a.id, name: a.name })),
        tracks: (json.tracks ?? []).map(t => ({ id: t.id, title: t.title, track_no: t.track_no })),
        kind: 'album',
        best_new: json.album.best_new ?? false,
      })
    }
    catch { /* leave the form empty — user can search manually */ }
  }, [onSubjectSelect])

  // Load draft from DB when ?id= is present; otherwise prefill from ?album=.
  useEffect(() => {
    loaded.current = true
    const params = new URLSearchParams(window.location.search)
    const id = params.get('id')
    if (!id) {
      const albumParam = params.get('album')
      if (albumParam)
        void prefillAlbum(albumParam)
      return
    }
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
      const loadedIds = post.recommended_track_ids ?? []
      if (loadedIds.length > 0)
        setRecommendedTrackIds(loadedIds)
      // Step 6: seed the BEST NEW toggle from the DB-joined value the backend
      // returns. Null when the post has no single album subject.
      if (typeof post.subject_best_new === 'boolean')
        setSubjectBestNew(post.subject_best_new)
    })
  }, [prefillAlbum])

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
        headline,
        dek,
        body,
        section,
        publishDate,
        recommendedTrackIds,
        subjectBestNew,
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
  }, [subject, score, headline, dek, body, section, publishDate, recommendedTrackIds, subjectBestNew])

  const onSaveDraft = async () => {
    if (!headline.trim()) {
      flash('제목을 입력하세요.')
      return
    }
    // FEAT-writer-lowfreq-redesign Step 4: when the subject is an artist
    // (drill-in "이 아티스트를 리뷰 →"), send album_ids=[] + artist_ids=[id].
    // For album subjects (the common path), behavior is unchanged.
    const isArtistSubject = subject?.kind === 'artist'
    const artistIds = isArtistSubject ?
      (subject ? [subject.id] : []) :
      (subject?.artists.map(a => a.id).filter(Boolean) ?? [])
    const albumIds = subject && !isArtistSubject ? [subject.id] : []
    const payload = {
      title: headline,
      description: dek,
      body_mdx: body || null,
      posted_date: publishDate,
      status: 'draft' as const,
      category: section || null,
      album_ids: albumIds,
      artist_ids: artistIds,
      rating: score > 0 ? score : null,
      recommended_track_ids: recommendedTrackIds,
      // FEAT-writer-lowfreq-redesign Step 6: send only when there's an album
      // subject — for artist-only subjects or no subject, the field has no
      // meaning and the backend would no-op anyway.
      subject_best_new: subject && !isArtistSubject ? subjectBestNew : null,
    }
    const res = dbPostId ?
      await updatePost(dbPostId, payload) :
      await savePost({ ...payload, album_cover_url: subject?.cover_url ?? null })
    if (!res.ok) {
      if (res.status === 409) {
        flash(await readErrorDetail(res, '같은 제목의 글이 이미 있습니다. 제목을 바꿔주세요.'))
      }
      else {
        flash(`임시저장 실패 (${res.status})`)
      }
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
    setHeadline('')
    setDek('')
    setBody('')
    setRecommendedTrackIds([])
    setSettingsOpen(false)
    flash('초안이 삭제되었습니다.')
  }

  const onPublish = async () => {
    if (!subject || body.trim().length === 0) {
      flash('발행 조건이 충족되지 않았습니다. (작품과 본문이 필요합니다)')
      return
    }
    const isArtistSubject = subject.kind === 'artist'
    const artistIds = isArtistSubject ?
      [subject.id] :
      subject.artists.map(a => a.id).filter(Boolean)
    const albumIds = isArtistSubject ? [] : [subject.id]
    // If a draft was saved first (dbPostId set), upgrade that row to
    // status="published" instead of creating a new one — otherwise the second
    // row collides on the unique slug and the backend returns 409 (BUG-9).
    const res = dbPostId ?
      await updatePost(dbPostId, {
        title: headline,
        description: dek,
        body_mdx: body,
        posted_date: publishDate,
        status: 'published',
        rating: score,
        recommended_track_ids: recommendedTrackIds,
        // Step 6: same single-album-subject rule as draft path.
        subject_best_new: !isArtistSubject ? subjectBestNew : null,
      }) :
      await savePost({
        title: headline,
        description: dek,
        body_mdx: body,
        posted_date: publishDate,
        status: 'published',
        album_ids: albumIds,
        artist_ids: artistIds,
        rating: score,
        album_cover_url: subject.cover_url,
        recommended_track_ids: recommendedTrackIds,
        subject_best_new: !isArtistSubject ? subjectBestNew : null,
      })
    if (!res.ok) {
      if (res.status === 409) {
        flash(await readErrorDetail(res, '같은 제목의 글이 이미 있습니다. 제목을 바꿔주세요.'))
      }
      else {
        flash(`발행 실패: ${res.status}`)
      }
      return
    }

    const json = await res.json()
    const slug: string = json.slug ?? json.id ?? ''
    const postId: string = json.id ?? dbPostId ?? ''

    const gitRes = await publishToGit({
      title: headline,
      body_mdx: body,
      slug,
      categoryName: section,
      description: dek,
      posted_date: publishDate,
      album_ids: albumIds,
      artist_ids: artistIds,
      post_id: postId,
      album_cover_url: subject.cover_url,
      rating: score,
      recommended_track_ids: recommendedTrackIds,
    })
    if (!gitRes.ok) {
      flash('저장 완료, Git 발행 실패')
      return
    }

    // Astro rebuilds the static site on the new GitHub commit (~3–5 min), so
    // /blog/{slug} 404s during that window. Redirect to the /blog list page
    // instead — it works immediately and the new post appears once the build
    // completes. Reset state so the form is empty if the user navigates back.
    localStorage.removeItem(DRAFT_KEY)
    setSubject(null)
    setScore(0)
    setHeadline('')
    setDek('')
    setBody('')
    setRecommendedTrackIds([])
    flash('발행 완료! 사이트 반영까지 약 3–5분 — /blog 에서 확인하세요.')
    setSettingsOpen(false)
    setTimeout(() => {
      window.location.href = '/blog/'
    }, 1800)
  }

  const s = { subject, score, headline, dek, body, publishDate, subjectBestNew }

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
	onSubjectSelect={onSubjectSelect}
	onScoreChange={setScore}
	subjectBestNew={subjectBestNew}
	onSubjectBestNewChange={setSubjectBestNew}
            />
            <RecommendedTracksBlock
	subject={subject}
	value={recommendedTrackIds}
	onChange={setRecommendedTrackIds}
            />
            <TitleArea headline={headline} setHeadline={setHeadline} dek={dek} setDek={setDek} dim={!subject} />
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
	publishDate={publishDate}
	subject={subject}
	body={body}
	onSectionChange={setSection}
	onPublishDateChange={setPublishDate}
	onDraftSave={onSaveDraft}
	onPublish={onPublish}
	onReset={onReset}
      />

      <Toast msg={toast} />
    </div>
  )
}
