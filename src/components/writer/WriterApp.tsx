import { useCallback, useEffect, useRef, useState } from 'react'
import WriterChrome from './WriterChrome'
import SubjectHero from './SubjectHero'
import CommandPalette from './CommandPalette'
import RecommendedTracksBlock from './RecommendedTracksBlock'
import BodyArea from './BodyArea'
import SettingsPanel from './SettingsPanel'
import PreviewView from './PreviewView'
import type { AlbumDetail, DraftPersist, SaveStatus, WriterView } from './types'
import { SECTION_LABELS } from '../../lib/sections'
import { REVIEW_TAG_LABELS } from '../../lib/tags'
import { fetchPostById, listDrafts, publishToGit, readErrorDetail, savePost, updatePost } from '../../scripts/write/api'
import { useAutoGrow } from './autoGrow'

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
  // Older drafts persisted dead keys (bestNew/genre/author/authorRole).
  // Partial<DraftPersist> silently drops them on read — no migration needed.
  // (`tags` is live again as of STAB-5 Step 4; the state init sanitizes any
  // stale legacy `tags` value to the seeded vocabulary.)
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? JSON.parse(raw) as Partial<DraftPersist> : {}
  }
  catch {
    return {}
  }
}

function TitleArea({ headline, setHeadline, dek, setDek, dim }: {
  headline: string
  setHeadline: (v: string) => void
  dek: string
  setDek: (v: string) => void
  dim: boolean
}) {
  const titleRef = useAutoGrow(headline)
  const dekRef = useAutoGrow(dek)
  return (
    <div className={`title-area${dim ? ' is-dim' : ''}`}>
      <textarea
	ref={titleRef}
	className="title-input"
	rows={1}
	placeholder="제목"
	value={headline}
	onChange={e => setHeadline(e.target.value)}
	spellCheck={false}
      />
      <textarea
	ref={dekRef}
	className="dek-input"
	rows={1}
	placeholder="부제"
	value={dek}
	onChange={e => setDek(e.target.value)}
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
  // Has the user typed their own title? Auto-fill (from the picked subject)
  // only runs while this is false, so it never clobbers a manual headline.
  // A restored draft with a non-empty title counts as user-owned.
  const titleDirty = useRef((saved.headline ?? '').trim() !== '')

  // Edit mode: populated when ?id= is in URL or after first DB save. Seeded
  // from the restored draft so reopening /write (localStorage, no ?id=) keeps
  // the existing row's id — without it the next save re-creates the row and the
  // backend rejects the duplicate slug with 409 (BUG-9 again, on the reload
  // path rather than the draft→publish path).
  const [dbPostId, setDbPostId] = useState<string | null>(saved.dbPostId ?? null)

  const [subject, setSubject] = useState<AlbumDetail | null>(saved.subject ?? null)
  const [score, setScore] = useState(saved.score ?? 0)
  const [headline, setHeadline] = useState(saved.headline ?? '')
  const [dek, setDek] = useState(saved.dek ?? '')
  const [body, setBody] = useState(saved.body ?? '')
  const [section, setSection] = useState(saved.section ?? SECTION_LABELS[0])
  // STAB-5 Step 4: selected review tags (labels). Multi-select, read-only vocab
  // (REVIEW_TAG_LABELS); empty = no tags. Backend rejects any non-seeded name —
  // so sanitize the restored draft to the known vocabulary (an older draft may
  // carry a stale `tags` key from a previous writer; see loadDraft note).
  const [tags, setTags] = useState<string[]>(
    (saved.tags ?? []).filter(t => REVIEW_TAG_LABELS.includes(t)),
  )
  const [publishDate, setPublishDate] = useState(saved.publishDate ?? todayISO())
  // In-flight guard (WR-1): drop a second concurrent write (double-click 발행, or
  // save→publish in the same tick) so it can't create a duplicate row / 409 on the
  // unique slug. `busy` also disables the buttons for feedback.
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const runExclusive = useCallback(async (fn: () => Promise<void>) => {
    if (busyRef.current)
      return
    busyRef.current = true
    setBusy(true)
    try {
      await fn()
    }
    finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [])
  const [recommendedTrackIds, setRecommendedTrackIds] = useState<string[]>(saved.recommendedTrackIds ?? [])
  // FEAT-writer-lowfreq-redesign Step 6: editor-set BEST NEW MUSIC. Seeds
  // from saved draft on mount; reseeds from fetched album.best_new on subject
  // pick (see onSubjectSelect below, fed by the command palette); reseeds from
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
    // the toggle off; SubjectHero hides the badge anyway.
    if (next.kind !== 'artist')
      setSubjectBestNew(next.best_new ?? false)
    else
      setSubjectBestNew(false)
    // Auto-fill the headline from the subject name (album title or, for artist
    // subjects, the artist name stored in `title`) — but only while the user
    // hasn't typed their own. Doesn't mark the title dirty, so switching the
    // subject keeps re-filling until the writer edits it.
    if (!titleDirty.current && next.title)
      setHeadline(next.title)
  }, [])

  // Wrap setHeadline so any manual edit marks the title user-owned. Clearing it
  // back to empty re-arms auto-fill for the next subject pick.
  const onHeadlineChange = useCallback((v: string) => {
    titleDirty.current = v.trim() !== ''
    setHeadline(v)
  }, [])

  const [view, setView] = useState<WriterView>('edit')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Dot starts green only if a real draft was restored (lastSaved present);
  // otherwise hollow "unsaved" — never claim a save that didn't happen.
  const [status, setStatus] = useState<SaveStatus>(saved.lastSaved ? 'saved' : 'dirty')
  const [lastSaved, setLastSaved] = useState(saved.lastSaved ?? '—')
  // Bumped on each manual 임시저장 so the chrome can replay its one-shot sync pulse.
  const [pulseKey, setPulseKey] = useState(0)
  const [toast, setToast] = useState('')

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // dirtyRef: unsaved edits since the last localStorage write. draftRef: the
  // latest content, refreshed every render, so the 30s autosave + tab-hide flush
  // read it without re-arming their timers on every keystroke.
  const dirtyRef = useRef(false)
  const draftRef = useRef<Omit<DraftPersist, 'lastSaved'>>(null!)
  draftRef.current = {
    subject,
    score,
    headline,
    dek,
    body,
    section,
    publishDate,
    recommendedTrackIds,
    tags,
    subjectBestNew,
    // Persist the DB id so a save→reload→continue cycle updates the row instead
    // of re-creating it. The 30s flush + tab-hide flush both read draftRef, so
    // they carry the id once a save has set it.
    dbPostId,
  }

  // STAB-5 Step 4: toggle a review tag. Functional updater so rapid successive
  // toggles (before a re-render) compose instead of clobbering a stale closure.
  const onToggleTag = useCallback((label: string) => {
    setTags(prev => prev.includes(label) ? prev.filter(t => t !== label) : [...prev, label])
  }, [])

  const flash = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current)
      clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2600)
  }, [])

  // ⌘K / Ctrl+K opens the search palette from anywhere in the writer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
      // Loading an existing post → its title is user-owned; don't let a later
      // subject pick overwrite it.
      titleDirty.current = (post.title ?? '').trim() !== ''
      setHeadline(post.title)
      setDek(post.description ?? '')
      setBody(post.body_mdx ?? '')
      setPublishDate(post.posted_date)
      setScore(post.rating ?? 0)
      if (post.category)
        setSection(post.category)
      // STAB-5 Step 4: seed the tag picker from the post's attached tags.
      setTags(post.tags ?? [])
      const loadedIds = post.recommended_track_ids ?? []
      if (loadedIds.length > 0)
        setRecommendedTrackIds(loadedIds)
      // Step 6: seed the BEST NEW toggle from the DB-joined value the backend
      // returns. Null when the post has no single album subject.
      if (typeof post.subject_best_new === 'boolean')
        setSubjectBestNew(post.subject_best_new)
    })
  }, [prefillAlbum])

  // Persist the current draft to localStorage. Called by the 30s timer, on tab
  // hide, and after a manual 임시저장. No-ops when nothing changed since the last
  // write, so the dot only flips to green when there is real work saved.
  const flushLocal = useCallback(() => {
    if (!dirtyRef.current)
      return
    const ts = nowTime()
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draftRef.current, lastSaved: ts }))
    }
    catch { /* quota */ }
    dirtyRef.current = false
    setLastSaved(ts)
    setStatus('saved')
  }, [])

  // Mark the draft dirty on any content change. The actual write runs on a calm
  // 30s cadence (below), not per keystroke — so the dot shows the hollow
  // "unsaved" state while typing and never churns a timestamp.
  useEffect(() => {
    if (!loaded.current)
      return
    dirtyRef.current = true
    setStatus('dirty')
  }, [subject, score, headline, dek, body, section, publishDate, recommendedTrackIds, tags, subjectBestNew])

  // Periodic autosave + safety flush when the tab is hidden/closed. Mounted once
  // (flushLocal is stable) so the 30s interval never resets mid-typing.
  useEffect(() => {
    const iv = setInterval(flushLocal, 30000)
    const onHide = () => {
      if (document.visibilityState === 'hidden')
        flushLocal()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flushLocal)
    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flushLocal)
    }
  }, [flushLocal])

  // Resolve which server row to write. Prefer the known id; otherwise re-link to
  // an existing OWN draft with the same title. Drafts saved before dbPostId was
  // persisted lose their id across a reload — without re-linking, the next
  // save/publish POSTs a duplicate that 409s on the unique slug (the bug). The
  // backend keeps one draft per slug/title, so a title match is unambiguous;
  // adopting it lets us UPDATE in place. null → no match → a genuinely new post.
  const resolveDbId = useCallback(async (): Promise<string | null> => {
    if (dbPostId)
      return dbPostId
    const title = headline.trim()
    if (!title)
      return null
    const mine = (await listDrafts()).find(d => d.title.trim() === title)
    return mine?.id ?? null
  }, [dbPostId, headline])

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
      tags,
      album_ids: albumIds,
      artist_ids: artistIds,
      rating: score > 0 ? score : null,
      recommended_track_ids: recommendedTrackIds,
      // FEAT-writer-lowfreq-redesign Step 6: send only when there's an album
      // subject — for artist-only subjects or no subject, the field has no
      // meaning and the backend would no-op anyway.
      subject_best_new: subject && !isArtistSubject ? subjectBestNew : null,
    }
    const createBody = { ...payload, album_cover_url: subject?.cover_url ?? null }
    const targetId = await resolveDbId()
    let created = !targetId
    let res = targetId ?
      await updatePost(targetId, payload) :
      await savePost(createBody)
    // Stale id — the draft was hard-deleted elsewhere (e.g. /drafts) while its
    // body lived on in localStorage. Drop the dead id and create a fresh row so
    // the restored draft still saves instead of dead-ending on 404.
    if (targetId && res.status === 404) {
      setDbPostId(null)
      created = true
      res = await savePost(createBody)
    }
    if (!res.ok) {
      if (res.status === 409) {
        flash(await readErrorDetail(res, '같은 제목의 글이 이미 있습니다. 제목을 바꿔주세요.'))
      }
      else {
        flash(`임시저장 실패 (${res.status})`)
      }
      return
    }
    // Capture the row id so the mirror below persists it. On the create path
    // draftRef.current still holds the pre-save id (null) this tick — setDbPostId
    // hasn't re-rendered yet — so write the fresh id explicitly. Without it a
    // save→reload before the next render loses the DB linkage and re-creates the
    // row (409, BUG-9).
    let savedId = targetId
    if (created) {
      const json = await res.json()
      savedId = json?.id ?? null
    }
    // Sync state when we created a row OR adopted an orphan by title, so the rest
    // of the session reuses the id instead of re-looking it up.
    if (savedId && savedId !== dbPostId)
      setDbPostId(savedId)
    // Mirror the server save into localStorage and confirm it on the dot: solid
    // green + a one-shot sync pulse. dirtyRef clears so the 30s timer won't
    // redundantly re-write the same content.
    const ts = nowTime()
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draftRef.current, dbPostId: savedId, lastSaved: ts }))
    }
    catch { /* quota */ }
    dirtyRef.current = false
    setLastSaved(ts)
    setStatus('saved')
    setPulseKey(k => k + 1)
    flash('임시저장 완료')
  }

  const onReset = () => {
    localStorage.removeItem(DRAFT_KEY)
    titleDirty.current = false
    // Drop the DB linkage too — a reset starts a brand-new post, so the next
    // save must create a row, not overwrite the previously-saved draft.
    setDbPostId(null)
    setSubject(null)
    setScore(0)
    setHeadline('')
    setDek('')
    setBody('')
    setRecommendedTrackIds([])
    setTags([])
    setSettingsOpen(false)
    flash('초안이 삭제되었습니다.')
  }

  const onPublish = async () => {
    if (!subject || !headline.trim() || body.trim().length === 0) {
      flash('작품 · 제목 · 본문이 모두 필요합니다')
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
    const createBody = {
      title: headline,
      description: dek,
      body_mdx: body,
      posted_date: publishDate,
      status: 'published' as const,
      album_ids: albumIds,
      artist_ids: artistIds,
      rating: score,
      tags,
      album_cover_url: subject.cover_url,
      recommended_track_ids: recommendedTrackIds,
      subject_best_new: !isArtistSubject ? subjectBestNew : null,
    }
    const targetId = await resolveDbId()
    let res = targetId ?
      await updatePost(targetId, {
        title: headline,
        description: dek,
        body_mdx: body,
        posted_date: publishDate,
        status: 'published',
        rating: score,
        tags,
        recommended_track_ids: recommendedTrackIds,
        // Step 6: same single-album-subject rule as draft path.
        subject_best_new: !isArtistSubject ? subjectBestNew : null,
      }) :
      await savePost(createBody)
    // Stale id (draft hard-deleted elsewhere) → 404 on update. Fall back to
    // creating the published row so publish doesn't dead-end. Same self-heal as
    // the draft path.
    if (targetId && res.status === 404) {
      setDbPostId(null)
      res = await savePost(createBody)
    }
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
    const postId: string = json.id ?? targetId ?? ''

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
      tags,
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
    titleDirty.current = false
    // Clear the DB id so a follow-up post (without a reload) creates a fresh row
    // instead of re-updating the one just published.
    setDbPostId(null)
    setSubject(null)
    setScore(0)
    setHeadline('')
    setDek('')
    setBody('')
    setRecommendedTrackIds([])
    setTags([])
    flash('발행 완료! 3–5분 후 반영됩니다')
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
	pulseKey={pulseKey}
	onOpenSearch={() => setPaletteOpen(true)}
	onSave={() => runExclusive(onSaveDraft)}
	onPublish={() => setSettingsOpen(true)}
	busy={busy}
      />

      {view === 'edit' ?
        (
          <>
            <SubjectHero
	subject={subject}
	score={score}
	onScoreChange={setScore}
	subjectBestNew={subjectBestNew}
	onSubjectBestNewChange={setSubjectBestNew}
	onOpenSearch={() => setPaletteOpen(true)}
            />
            <RecommendedTracksBlock
	subject={subject}
	value={recommendedTrackIds}
	onChange={setRecommendedTrackIds}
            />
            <main className="wr-doc">
              <TitleArea headline={headline} setHeadline={onHeadlineChange} dek={dek} setDek={setDek} dim={!subject} />
              <BodyArea body={body} setBody={setBody} dim={!subject} />
            </main>
          </>
        ) :
        (
          <main className="surface preview-surface">
            <PreviewView s={s} />
          </main>
        )}

      {paletteOpen && (
        <CommandPalette
	currentSubjectId={subject?.id ?? null}
	onPick={onSubjectSelect}
	onClose={() => setPaletteOpen(false)}
        />
      )}

      <SettingsPanel
	open={settingsOpen}
	onClose={() => setSettingsOpen(false)}
	section={section}
	tags={tags}
	publishDate={publishDate}
	subject={subject}
	body={body}
	onSectionChange={setSection}
	onToggleTag={onToggleTag}
	onPublishDateChange={setPublishDate}
	onDraftSave={() => runExclusive(onSaveDraft)}
	onPublish={() => runExclusive(onPublish)}
	onReset={onReset}
	busy={busy}
      />

      <Toast msg={toast} />
    </div>
  )
}
