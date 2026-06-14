// Member dashboard — album detail / review modal (centered).
//
// One centered modal with three modes, derived from where it was opened
// (DetailTarget.writable) and whether the album already has a published review
// (matched against `reviews` by albumId):
//   · info  — non-writable surfaces (Spotify 라이브러리, 최근 들은, sample tracks):
//             cover + metadata + tracklist, read-only.
//   · write — a bucket album with no review yet: a body writing area + best-track
//             picks + optional rating, saved as a DRAFT (no publish here). Resumes
//             an existing draft (matched by title === album title) on open.
//   · edit  — a bucket album that already has a published review: read-only detail
//             with an "이미 발행됨" banner → 평론 보기 (/review/{slug}) + 수정 (/write?id).
//
// The 별점 input is a self-contained pointer strip reusing the member `Stars`
// visual (the writer's DragRatingInput lives behind write-only CSS tokens).
import type { AlbumDetail as AlbumDetailResp, MusicArtist, MusicTrack } from '@lib/albumDetail'
import type { DetailTarget, MemberReview } from '@lib/member'
import { useEffect, useRef, useState } from 'react'
import { fetchPostById, listDrafts, savePost, updatePost } from '../../scripts/write/api'
import { fetchAlbumDetail, getCachedAlbumDetail } from '@lib/albumDetail'
import { useDismissable } from '@lib/useDismissable'
import { AlbumArt, fmtTime, Stars } from './ui'

type Mode = 'info' | 'write' | 'edit'

export function AlbumDetail({ album, reviews, onClose }: { album: DetailTarget, reviews: MemberReview[], onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null)
  // ESC + focus trap + focus restore (mounted-when-open → open=true).
  useDismissable(true, onClose, cardRef)

  const published = album.albumId ? reviews.find(r => r.albumIds.includes(album.albumId!)) : undefined
  const mode: Mode = !album.writable ? 'info' : (published ? 'edit' : 'write')

  return (
    <div
	className="lf-scrim"
	style={{ justifyContent: 'center', alignItems: 'center', padding: 24 }}
	onClick={onClose}
	role="presentation"
    >
      <div
	ref={cardRef}
	className="lf-modal-card"
	onClick={e => e.stopPropagation()}
	role="dialog"
	aria-modal="true"
	aria-label="앨범 상세"
	style={{ position: 'relative', width: '100%', maxWidth: 600, maxHeight: '86vh', overflowY: 'auto', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 12, boxShadow: '0 34px 80px rgba(0,0,0,.42)', padding: '30px 30px 26px' }}
      >
        <button type="button" className="lf-iconbtn" onClick={onClose} aria-label="닫기" style={{ position: 'absolute', top: 16, right: 16, width: 30, height: 30, borderColor: 'var(--color-border-soft)', zIndex: 2 }}>✕</button>
        {album.albumId ? <RealBody album={album} mode={mode} published={published} /> : <MinimalBody album={album} />}
      </div>
    </div>
  )
}

// Real album: fetch DB metadata (cover/tracklist/artists), then render the
// mode-appropriate body. On fetch failure it degrades to a minimal card.
function RealBody({ album, mode, published }: { album: DetailTarget, mode: Mode, published?: MemberReview }) {
  const seed = album.albumId ? getCachedAlbumDetail(album.albumId) : null
  const [data, setData] = useState<AlbumDetailResp | null>(seed)
  const [state, setState] = useState<'loading' | 'ok' | 'error'>(seed ? 'ok' : 'loading')

  useEffect(() => {
    if (!album.albumId) {
      setState('error')
      return
    }
    let alive = true
    fetchAlbumDetail(album.albumId)
      .then((json) => {
        if (!alive)
          return
        if (json) {
          setData(json)
          setState('ok')
        }
        else {
          setState('error')
        }
      })
    return () => {
      alive = false
    }
  }, [album.albumId])

  const a = data?.album
  const metaParts: string[] = []
  if (a?.album_type)
    metaParts.push(a.album_type.toUpperCase())
  if (a?.release_date)
    metaParts.push(a.release_date)
  if (data?.tracks?.length)
    metaParts.push(`${data.tracks.length}곡`)
  if (a?.label)
    metaParts.push(a.label)

  return (
    <>
      <Header
	cover={a?.cover_url ?? album.cover}
	title={album.album}
	artist={album.artist}
	meta={metaParts}
	kicker={mode === 'write' ? '평론 작성' : '앨범'}
      />

      {mode === 'write' ?
        <WriteBody album={album} tracks={data?.tracks ?? []} artistIds={data?.artists.map(ar => ar.id) ?? []} tracksLoading={state === 'loading'} /> :
        state === 'loading' ?
          <div className="lf-meta" style={{ marginTop: 22, paddingTop: 20, borderTop: '1px solid var(--color-border-soft)' }}>불러오는 중…</div> :
          (state === 'error' || !data) ?
            (
              <div style={{ marginTop: 22, paddingTop: 20, borderTop: '1px solid var(--color-border-soft)' }}>
                <div className="lf-sans" style={{ fontSize: 13.5, color: 'var(--color-subtle)' }}>{album.year ? `${album.year}년 발매` : '상세 정보를 불러오지 못했습니다'}</div>
              </div>
            ) :
            mode === 'edit' ?
              <EditBody published={published} tracks={data.tracks} /> :
              <InfoBody artists={data.artists} tracks={data.tracks} year={album.year} />}
    </>
  )
}

// ── header (cover + title + meta) ────────────────────────────────────────────
function Header({ cover, title, artist, meta, kicker }: { cover?: string | null, title: string, artist?: string, meta: string[], kicker: string }) {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', paddingRight: 28 }}>
      <div style={{ width: 110, flex: '0 0 auto' }}><AlbumArt url={cover} label={title} size={110} /></div>
      <div style={{ minWidth: 0, flex: 1, paddingTop: 2 }}>
        <div className="lf-kicker" style={{ marginBottom: 5 }}>{kicker}</div>
        <h2 className="lf-serif lf-italic" style={{ fontSize: 25, fontWeight: 500, lineHeight: 1.14, margin: 0 }}>{title}</h2>
        {artist && <div className="lf-sans" style={{ fontSize: 13, color: 'var(--color-subtle)', marginTop: 6 }}>{artist}</div>}
        {meta.length > 0 && (
          <div className="lf-mono" style={{ fontSize: 10.5, letterSpacing: '0.04em', color: 'var(--color-faded)', marginTop: 10, lineHeight: 1.5 }}>{meta.join(' · ')}</div>
        )}
      </div>
    </div>
  )
}

// ── read-only tracklist (info / edit) ────────────────────────────────────────
function Tracklist({ tracks }: { tracks: MusicTrack[] }) {
  if (tracks.length === 0)
    return null
  return (
    <div style={{ marginTop: 22, paddingTop: 20, borderTop: '1px solid var(--color-border-soft)' }}>
      <div className="lf-meta" style={{ marginBottom: 10 }}>트랙리스트</div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {tracks.map(t => (
          <li key={t.id} style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--color-border-soft)' }}>
            <span className="lf-mono" style={{ fontSize: 11, color: 'var(--color-faded)', width: 22, textAlign: 'right', flex: '0 0 auto' }}>{t.track_no ?? '·'}</span>
            <span className="lf-serif" style={{ fontSize: 15, flex: 1, minWidth: 0 }}>
              {t.title}
              {t.feat_artist_names.length > 0 && (
                <span className="lf-sans" style={{ fontSize: 11.5, color: 'var(--color-faded)' }}>{` feat. ${t.feat_artist_names.join(', ')}`}</span>
              )}
            </span>
            {t.duration_sec != null && (
              <span className="lf-mono" style={{ fontSize: 11, color: 'var(--color-faded)', flex: '0 0 auto' }}>{fmtTime(t.duration_sec)}</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

// ── info mode body (artists + tracklist) ─────────────────────────────────────
function InfoBody({ artists, tracks, year }: { artists: MusicArtist[], tracks: MusicTrack[], year?: number | null }) {
  return (
    <>
      {artists.length > 0 && (
        <div style={{ marginTop: 22, paddingTop: 20, borderTop: '1px solid var(--color-border-soft)' }}>
          <div className="lf-meta" style={{ marginBottom: 12 }}>아티스트</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {artists.map(ar => (
              <div key={ar.id} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ width: 40, flex: '0 0 auto' }}><AlbumArt url={ar.photo_url} label={ar.name} size={40} /></div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="lf-serif" style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ar.name}</div>
                  {ar.genres.length > 0 && (
                    <div className="lf-mono" style={{ fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-faded)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{ar.genres.join(' · ')}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {tracks.length > 0 ?
<Tracklist tracks={tracks} /> :
(
        <div style={{ marginTop: 22, paddingTop: 20, borderTop: '1px solid var(--color-border-soft)' }}>
          <div className="lf-sans" style={{ fontSize: 13.5, color: 'var(--color-subtle)' }}>{year ? `${year}년 발매` : '발매 정보 없음'}</div>
        </div>
      )}
    </>
  )
}

// ── edit mode body (already published) ───────────────────────────────────────
function EditBody({ published, tracks }: { published?: MemberReview, tracks: MusicTrack[] }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 20, padding: '12px 14px', border: '1px solid var(--color-border)', borderRadius: 6, background: 'var(--color-paper)' }}>
        <span className="lf-meta" style={{ color: 'var(--color-accent)' }}>이미 발행된 평론</span>
        {published?.rating != null && <Stars score={published.rating} size={14} />}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {published?.slug && <a href={`/review/${published.slug}/`} className="lf-chip" style={{ textDecoration: 'none' }}>평론 보기</a>}
          {published?.postId && <a href={`/write?id=${published.postId}`} className="lf-chip" style={{ textDecoration: 'none' }}>수정</a>}
        </div>
      </div>
      <Tracklist tracks={tracks} />
    </>
  )
}

// ── write mode body (draft authoring) ────────────────────────────────────────
function WriteBody({ album, tracks, artistIds, tracksLoading }: { album: DetailTarget, tracks: MusicTrack[], artistIds: string[], tracksLoading: boolean }) {
  const [body, setBody] = useState('')
  const [score, setScore] = useState(0)
  const [picks, setPicks] = useState<Set<string>>(() => new Set())
  const [dbPostId, setDbPostId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [tracksOpen, setTracksOpen] = useState(true)
  const busyRef = useRef(false)

  // Resume an existing draft for this album (matched by title === album title,
  // the same heuristic the writer's resolveDbId uses — PostListItem has no
  // album_ids to match on). Best-effort; a miss just starts a fresh draft.
  useEffect(() => {
    let alive = true
    listDrafts()
      .then((drafts) => {
        const mine = drafts.find(d => d.title.trim() === album.album.trim())
        if (!mine)
          return null
        return fetchPostById(mine.id)
      })
      .then((post) => {
        if (!alive || !post)
          return
        setDbPostId(post.id)
        setBody(post.body_mdx ?? '')
        setScore(post.rating ?? 0)
        setPicks(new Set(post.recommended_track_ids ?? []))
      })
      .catch(() => { /* no draft / offline — start fresh */ })
    return () => {
      alive = false
    }
  }, [album.album])

  const togglePick = (id: string) => setPicks((prev) => {
    const n = new Set(prev)
    if (n.has(id))
      n.delete(id)
    else
      n.add(id)
    return n
  })

  const dirty = body.trim().length > 0 || score > 0 || picks.size > 0

  const onSave = async () => {
    if (busyRef.current || !dirty)
      return
    busyRef.current = true
    setSaving(true)
    const payload = {
      title: album.album,
      description: '',
      body_mdx: body || null,
      status: 'draft' as const,
      album_ids: album.albumId ? [album.albumId] : [],
      artist_ids: artistIds,
      rating: score > 0 ? score : null,
      recommended_track_ids: [...picks],
    }
    try {
      const res = dbPostId ?
        await updatePost(dbPostId, payload) :
        await savePost({ ...payload, album_cover_url: album.cover ?? null })
      if (!res.ok) {
        setSavedAt(res.status === 409 ? '같은 제목의 임시저장이 이미 있어요' : `저장 실패 (${res.status})`)
        return
      }
      if (!dbPostId) {
        const json = await res.json()
        if (json?.id)
          setDbPostId(json.id)
      }
      setSavedAt('임시저장됨')
    }
    catch {
      setSavedAt('저장 실패 — 네트워크')
    }
    finally {
      busyRef.current = false
      setSaving(false)
    }
  }

  const words = body.trim() ? body.trim().split(/\s+/).length : 0
  // Carry the draft into the full editor: resume the saved row when there is one,
  // else seed a fresh editor with this album prefilled.
  const fullHref = dbPostId ? `/write?id=${dbPostId}` : `/write?album=${album.albumId}`

  return (
    <>
      {/* body — the writing area is the point */}
      <div style={{ marginTop: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 9 }}>
          <span className="lf-meta">평론</span>
          {words > 0 && <span className="lf-mono" style={{ fontSize: 10, color: 'var(--color-faded)', marginLeft: 'auto' }}>{`${words} 단어`}</span>}
        </div>
        <div style={{ border: '1px solid var(--color-border)', background: 'var(--color-paper)', borderRadius: 4, padding: '13px 15px' }}>
          <textarea
	value={body}
	rows={6}
	placeholder="이 앨범에 대한 평론을 적어보세요."
	onChange={e => setBody(e.target.value)}
	style={{ width: '100%', resize: 'vertical', border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--font-serif)', color: 'var(--color-text)', fontSize: 15, lineHeight: 1.72 }}
          />
        </div>
      </div>

      {/* best-track picker — collapsible; the tracklist fills in when the detail
          fetch lands so a cache miss never blocks the body/별점 above */}
      {tracksLoading && tracks.length === 0 && (
        <div className="lf-meta" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--color-border-soft)' }}>베스트 트랙 불러오는 중…</div>
      )}
      {tracks.length > 0 && (
        <div style={{ marginTop: 14, borderTop: '1px solid var(--color-border-soft)' }}>
          <button
	type="button"
	onClick={() => setTracksOpen(o => !o)}
	style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 2px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
          >
            <span className="lf-meta">{`베스트 트랙 · ${tracks.length}곡`}</span>
            {picks.size > 0 && <span className="lf-mono" style={{ fontSize: 10.5, color: 'var(--color-accent)' }}>{`★ ${picks.size}`}</span>}
            <span className="lf-mono" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--color-subtle)' }}>{tracksOpen ? '닫기' : '고르기'}</span>
          </button>
          {tracksOpen && (
            <ol style={{ listStyle: 'none', margin: 0, padding: '0 0 6px' }}>
              {tracks.map((t) => {
                const on = picks.has(t.id)
                return (
                  <li key={t.id}>
                    <button
	type="button"
	onClick={() => togglePick(t.id)}
	style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '8px 4px', background: on ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)' : 'none', border: 'none', borderBottom: '1px solid var(--color-border-soft)', cursor: 'pointer', textAlign: 'left' }}
                    >
                      <span className="lf-mono" style={{ fontSize: 11, color: 'var(--color-faded)', width: 22, textAlign: 'right' }}>{String(t.track_no ?? 0).padStart(2, '0')}</span>
                      <span className="lf-serif" style={{ fontSize: 14.5, flex: 1, minWidth: 0, color: on ? 'var(--color-text)' : 'var(--color-text)' }}>{t.title}</span>
                      <span className="lf-mono" style={{ fontSize: 13, color: on ? 'var(--color-accent)' : 'var(--color-faded)' }}>{on ? '★' : '☆'}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      )}

      {/* rating — secondary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--color-border-soft)' }}>
        <span className="lf-meta">별점 · 선택</span>
        <RatingInput value={score} onChange={setScore} />
      </div>

      {/* actions — draft save (no publish) + full editor */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18 }}>
        <button
	type="button"
	onClick={onSave}
	className="lf-btn lf-btn-solid"
	style={{ flex: 1, opacity: dirty && !saving ? 1 : 0.5, pointerEvents: dirty && !saving ? 'auto' : 'none' }}
        >
          {saving ? '저장 중…' : '임시저장'}
        </button>
        <a href={fullHref} className="lf-mono" style={{ fontSize: 11, letterSpacing: '0.04em', color: 'var(--color-subtle)', textDecoration: 'none', whiteSpace: 'nowrap' }}>전체 에디터 →</a>
      </div>
      {savedAt && <div className="lf-mono" style={{ marginTop: 9, fontSize: 11, color: 'var(--color-faded)', textAlign: 'right' }}>{savedAt}</div>}
    </>
  )
}

// ── inline 별점 input — pointer strip over the member Stars visual ────────────
function RatingInput({ value, onChange }: { value: number, onChange: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<number | null>(null)
  const shown = preview ?? value

  const valueAt = (clientX: number): number => {
    const el = ref.current
    if (!el)
      return 0
    const r = el.getBoundingClientRect()
    const x = Math.max(0, Math.min(r.width, clientX - r.left))
    return Math.max(0, Math.min(5, Math.round((x / r.width) * 5 * 10) / 10))
  }

  useEffect(() => {
    if (!dragging)
      return
    const onMove = (e: PointerEvent) => setPreview(valueAt(e.clientX))
    const onUp = (e: PointerEvent) => {
      onChange(valueAt(e.clientX))
      setPreview(null)
      setDragging(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragging])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault()
      onChange(Math.max(0, Math.round((value - 0.5) * 10) / 10))
    }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      onChange(Math.min(5, Math.round((value + 0.5) * 10) / 10))
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <span
	ref={ref}
	role="slider"
	tabIndex={0}
	aria-valuemin={0}
	aria-valuemax={5}
	aria-valuenow={shown}
	aria-label={`별점 ${shown.toFixed(1)} / 5`}
	onPointerDown={(e) => {
          setDragging(true)
          setPreview(valueAt(e.clientX))
        }}
	onKeyDown={onKeyDown}
	style={{ cursor: 'pointer', touchAction: 'none', display: 'inline-flex' }}
      >
        <Stars score={shown} size={22} />
      </span>
      <span className="lf-mono" style={{ fontSize: 12, color: 'var(--color-faded)' }}>{shown > 0 ? `${shown.toFixed(1)}/5` : '—'}</span>
    </span>
  )
}

// ── minimal body (no real albumId — sample tracks / reviews) ─────────────────
function MinimalBody({ album }: { album: DetailTarget }) {
  return (
    <>
      <Header cover={album.cover} title={album.track || album.album} artist={album.artist} meta={[]} kicker={album.track ? '트랙' : '앨범'} />
      <div style={{ marginTop: 22, paddingTop: 20, borderTop: '1px solid var(--color-border-soft)' }}>
        {album.rating != null ?
          <Stars score={album.rating} size={18} /> :
          <span className="lf-unrated">미평가</span>}
        <div className="lf-sans" style={{ fontSize: 13.5, color: 'var(--color-subtle)', marginTop: 10, lineHeight: 1.7 }}>
          {[album.track ? `수록: ${album.album}` : null, album.genre || null, album.year ? `${album.year}년` : null].filter(Boolean).join(' · ') || '추가 정보 없음'}
        </div>
      </div>
    </>
  )
}
