// FEAT-review-bucket-board Step 5 — inline review-writing drawer. Lets the owner
// draft + publish a quick album review without leaving the board. Draft lives in
// localStorage under a per-item key (`bucket-draft:{item_id}`) so it never
// collides with the full editor's `lowfreq-draft`. Publish reuses the writer's
// savePost + publishToGit pipeline; on success the item is marked published and
// the board moves it into the "작성 완료" (is_done) bucket.
import { useEffect, useRef, useState } from 'react'
import DragRatingInput from '../writer/DragRatingInput'
import { publishToGit, readErrorDetail, savePost } from '../../scripts/write/api'
import * as api from './api'
import type { BucketItem } from './api'

const MUSIC = import.meta.env.PUBLIC_API_URL as string

interface AlbumDetail {
  title: string
  cover_url: string | null
  release_date: string | null
  artists: Array<{ id: string, name: string }>
}

interface DrawerDraft {
  headline: string
  dek: string
  body: string
  score: number
  lastSaved: string
}

interface Props {
  item: BucketItem
  bucketId: string
  onClose: () => void
  // Called after a successful publish so the board can mark the item published,
  // link the post, and move it into the done bucket. Persisting the post link
  // (status/post_id) is done here in the drawer; the board owns the bucket move.
  onPublished: (postId: string) => void
}

const BLOG_BASE = '/blog'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function nowTime() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function draftKey(itemId: string) {
  return `bucket-draft:${itemId}`
}

function loadDraft(itemId: string): Partial<DrawerDraft> {
  try {
    const raw = localStorage.getItem(draftKey(itemId))
    return raw ? JSON.parse(raw) as Partial<DrawerDraft> : {}
  }
  catch {
    return {}
  }
}

function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el)
    return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

export default function ReviewDrawer({ item, bucketId, onClose, onPublished }: Props) {
  const saved = loadDraft(item.id)

  const [headline, setHeadline] = useState(saved.headline ?? '')
  const [dek, setDek] = useState(saved.dek ?? '')
  const [body, setBody] = useState(saved.body ?? '')
  const [score, setScore] = useState(saved.score ?? 0)
  const [lastSaved, setLastSaved] = useState(saved.lastSaved ?? '—')

  const [detail, setDetail] = useState<AlbumDetail | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState(item.status === 'published')
  const [status, setStatus] = useState('')

  const loaded = useRef(false)
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function flash(msg: string) {
    setStatus(msg)
    if (statusTimer.current)
      clearTimeout(statusTimer.current)
    statusTimer.current = setTimeout(() => setStatus(''), 2600)
  }

  // Load the full album (artists carry the IDs that the publish payload needs;
  // the bucket item only has artist *names*). Cover/title fall back to the brief.
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const r = await fetch(`${MUSIC}/api/music/albums/${encodeURIComponent(item.album_id)}`)
        if (!r.ok)
          throw new Error(`HTTP ${r.status}`)
        const json = await r.json() as {
          album: { title: string, cover_url: string | null, release_date: string | null }
          artists?: Array<{ id: string, name: string }>
        }
        if (!alive)
          return
        setDetail({
          title: json.album.title,
          cover_url: json.album.cover_url,
          release_date: json.album.release_date,
          artists: json.artists ?? [],
        })
      }
      catch {
        /* fall back to the brief — publish can still proceed with album_id only */
      }
    })()
    return () => {
      alive = false
    }
  }, [item.album_id])

  // Autosave the draft 600ms after the last edit. Skips the very first render so
  // we don't immediately rewrite the loaded draft with empty defaults.
  useEffect(() => {
    if (!loaded.current) {
      loaded.current = true
      return
    }
    const id = setTimeout(() => {
      const ts = nowTime()
      const data: DrawerDraft = { headline, dek, body, score, lastSaved: ts }
      try {
        localStorage.setItem(draftKey(item.id), JSON.stringify(data))
        setLastSaved(ts)
      }
      catch { /* quota — drop silently */ }
    }, 600)
    return () => clearTimeout(id)
  }, [headline, dek, body, score, item.id])

  // Grow the body textarea to fit restored draft content on open.
  useEffect(() => {
    autoGrow(bodyRef.current)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape')
        onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const brief = item.album
  const title = detail?.title ?? brief.title
  const cover = detail?.cover_url ?? brief.cover_url ?? null
  const artistLine = detail?.artists.length ?
    detail.artists.map(a => a.name).join(', ') :
    (brief.artist_names?.join(', ') ?? null)
  const year = (detail?.release_date ?? brief.release_date)?.slice(0, 4) ?? null

  function saveDraftNow() {
    const ts = nowTime()
    const data: DrawerDraft = { headline, dek, body, score, lastSaved: ts }
    try {
      localStorage.setItem(draftKey(item.id), JSON.stringify(data))
      setLastSaved(ts)
      flash('임시저장 완료')
    }
    catch {
      flash('임시저장 실패 (저장 공간 초과)')
    }
  }

  function openFullEditor() {
    // The full editor reads its own `lowfreq-draft` and only prefills the album
    // from ?album=; the drawer draft stays under its own key so returning here
    // restores it. Save first so nothing typed is lost.
    saveDraftNow()
    window.location.href = `/write?album=${encodeURIComponent(item.album_id)}`
  }

  async function onPublish() {
    if (!headline.trim()) {
      flash('제목을 입력하세요.')
      return
    }
    if (body.trim().length === 0) {
      flash('본문을 입력하세요.')
      return
    }
    setPublishing(true)
    const albumIds = [item.album_id]
    const artistIds = detail?.artists.map(a => a.id).filter(Boolean) ?? []
    const coverUrl = detail?.cover_url ?? brief.cover_url ?? null
    const postedDate = todayISO()

    try {
      const res = await savePost({
        title: headline,
        description: dek,
        body_mdx: body,
        posted_date: postedDate,
        status: 'published',
        category: 'Reviews',
        album_ids: albumIds,
        artist_ids: artistIds,
        rating: score > 0 ? score : null,
        album_cover_url: coverUrl,
        recommended_track_ids: [],
        subject_best_new: null,
      })
      if (!res.ok) {
        flash(res.status === 409 ?
          await readErrorDetail(res, '같은 제목의 글이 이미 있습니다. 제목을 바꿔주세요.') :
          `발행 실패 (${res.status})`)
        return
      }
      const json = await res.json() as { id?: string, slug?: string }
      const newPostId = json.id ?? ''
      const slug = json.slug ?? json.id ?? ''

      const gitRes = await publishToGit({
        title: headline,
        body_mdx: body,
        slug,
        categoryName: 'Reviews',
        description: dek,
        posted_date: postedDate,
        album_ids: albumIds,
        artist_ids: artistIds,
        post_id: newPostId,
        album_cover_url: coverUrl,
        rating: score > 0 ? score : null,
        recommended_track_ids: [],
      })
      if (!gitRes.ok) {
        flash('글은 저장됐지만 Git 발행에 실패했습니다.')
        return
      }

      // Persist the post link on the item (status + post_id). The board move
      // into the done bucket is handled by onPublished.
      try {
        await api.updateItem(bucketId, item.id, { status: 'published', post_id: newPostId })
      }
      catch { /* board state still updates optimistically; reorder reconciles */ }

      try {
        localStorage.removeItem(draftKey(item.id))
      }
      catch { /* ignore */ }

      setPublished(true)
      onPublished(newPostId)
    }
    finally {
      setPublishing(false)
    }
  }

  return (
    <div className="qb-drawer-scrim" onClick={onClose} role="presentation">
      <aside
	className="qb-drawer"
	onClick={e => e.stopPropagation()}
	role="dialog"
	aria-modal="true"
	aria-label="평론 작성"
      >
        <button type="button" className="qb-detail-close" onClick={onClose} aria-label="닫기">✕</button>

        <header className="qb-drawer-hero">
          <div className="qb-drawer-cover">
            {cover ?
              <img src={cover} alt={title} /> :
              <span className="qb-detail-cover-ph">{(title || '?').slice(0, 2).toUpperCase()}</span>}
          </div>
          <div className="qb-drawer-heroinfo">
            <p className="qb-drawer-kicker">{published ? '발행됨' : '평론 작성'}</p>
            <h2 className="qb-drawer-albumtitle"><em>{title}</em></h2>
            <p className="qb-drawer-artist">
              {artistLine}
              {artistLine && year ? ' · ' : ''}
              {year}
            </p>
          </div>
        </header>

        {published ?
          (
            <div className="qb-drawer-publishedcard">
              <p className="qb-detail-section-label">발행 완료</p>
              <p className="qb-drawer-publishednote">이 앨범 평론이 발행되었습니다. 사이트 반영까지 약 3–5분 걸립니다.</p>
              <a className="qb-drawer-postlink" href={`${BLOG_BASE}/`}>
                블로그에서 보기 →
              </a>
            </div>
          ) :
          (
            <>
              <div className="qb-drawer-rating">
                <span className="qb-detail-section-label">평점</span>
                <DragRatingInput value={score} onChange={setScore} max={5} size={24} />
              </div>

              <div className="qb-drawer-fields">
                <input
	className="qb-drawer-headline"
	placeholder="제목"
	value={headline}
	onChange={e => setHeadline(e.target.value)}
	spellCheck={false}
                />
                <input
	className="qb-drawer-dek"
	placeholder="한 줄 요약 (선택)"
	value={dek}
	onChange={e => setDek(e.target.value)}
	spellCheck={false}
                />
                <textarea
	ref={bodyRef}
	className="qb-drawer-body"
	placeholder="이 앨범에 대한 생각을 적어보세요…"
	rows={6}
	value={body}
	onChange={(e) => {
                    setBody(e.target.value)
                    autoGrow(e.target)
                  }}
	spellCheck={false}
                />
              </div>
            </>
          )}

        <footer className="qb-drawer-foot">
          <div className="qb-drawer-status" aria-live="polite">
            {status || (published ? '' : `임시저장 ${lastSaved}`)}
          </div>
          <div className="qb-drawer-actions">
            <button type="button" className="qb-drawer-btn qb-drawer-btn-ghost" onClick={openFullEditor}>
              전체 편집기로 열기
            </button>
            {!published && (
              <>
                <button type="button" className="qb-drawer-btn qb-drawer-btn-secondary" onClick={saveDraftNow} disabled={publishing}>
                  임시저장
                </button>
                <button type="button" className="qb-drawer-btn qb-drawer-btn-primary" onClick={() => void onPublish()} disabled={publishing}>
                  {publishing ? '발행 중…' : '발행'}
                </button>
              </>
            )}
          </div>
        </footer>
      </aside>
    </div>
  )
}
