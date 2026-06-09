// Member dashboard — 라이브러리 tab (FEAT-member-dashboard Step 2 D18 / Step 3 D25).
// Three sources, all REAL (backend):
//   1) 들을 것 (to-listen): real queue — add (album search modal), remove,
//      drag-to-reorder. backend album_to_listen_items.
//   2) 평론한 앨범 (reviewed): real derived view — one card per album, click opens
//      a drawer listing that album's reviews (correlated to the member's posts).
//   3) 최근 들은 앨범 (Step 3, D25/D26): the distinct album set of Spotify
//      recently-played, from the worker-fed cache; "지금 새로고침" enqueues an
//      async re-sync (rule #9 — no synchronous Spotify call here).
import type { DetailTarget, MemberReview } from '@lib/member'
import { useEffect, useMemo, useRef, useState } from 'react'
import AddAlbumModal from './AddAlbumModal'
import type { AddOutcome } from './AddAlbumModal'
import {
  addToListen,
  listReviewed,
  listToListen,
  removeToListen,
  reorderToListen,

} from './library.api'
import type { ReviewedAlbum, ToListenItem } from './library.api'
import { listRecentlyListened, refreshRecent } from './spotify.api'
import type { RecentlyListenedItem } from './spotify.api'
import { AlbumArt, SectionTitle, Stars } from './ui'

/** Relative "when" label from an ISO timestamp (오늘 / 어제 / N일 전 / 날짜). */
function fmtWhen(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime()))
    return ''
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000)
  if (days <= 0)
    return '오늘'
  if (days === 1)
    return '어제'
  if (days < 7)
    return `${days}일 전`
  return then.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
}

/* ── 들을 것 (to-listen) ──────────────────────────────────────────────────── */

function ToListenSection() {
  const [items, setItems] = useState<ToListenItem[] | null>(null)
  const [err, setErr] = useState(false)
  const [adding, setAdding] = useState(false)
  const dragFrom = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    listToListen()
      .then(rows => alive && setItems(rows))
      .catch(() => alive && setErr(true))
    return () => {
      alive = false
    }
  }, [])

  async function onAdd(album: { id: string, title: string }): Promise<AddOutcome> {
    try {
      const { item, conflict } = await addToListen({ album_id: album.id })
      if (conflict)
        return { status: 'conflict' }
      if (item)
        setItems(prev => [...(prev ?? []), item])
      return { status: 'added', alreadyReviewed: false }
    }
    catch {
      return { status: 'error', message: '담기 실패' }
    }
  }

  async function remove(id: string) {
    const prev = items ?? []
    setItems(prev.filter(i => i.id !== id))
    try {
      await removeToListen(id)
    }
    catch {
      setItems(prev) // rollback on failure
    }
  }

  function onDrop(to: number) {
    const from = dragFrom.current
    dragFrom.current = null
    setDragOver(null)
    if (from == null || from === to || !items)
      return
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    const prev = items
    setItems(next)
    reorderToListen(next.map(i => i.id)).catch(() => setItems(prev))
  }

  function onDragOver(e: React.DragEvent, i: number) {
    e.preventDefault()
    setDragOver(i)
  }

  function onDragEnd() {
    dragFrom.current = null
    setDragOver(null)
  }

  const count = items?.length ?? 0

  return (
    <section style={{ marginBottom: 52 }}>
      <SectionTitle
	kicker={`${count}장`}
	title="들을 것"
	right={(
          <button type="button" className="lf-btn lf-btn-solid" onClick={() => setAdding(true)}>
            + 앨범 추가
          </button>
        )}
      />

      {items == null && !err && <div className="lf-meta" style={{ padding: '8px 0' }}>불러오는 중…</div>}
      {err && <div className="lf-panel" style={{ padding: 24, textAlign: 'center' }}><span className="lf-meta">목록을 불러오지 못했습니다</span></div>}

      {items != null && items.length === 0 && (
        <div className="lf-panel" style={{ padding: 40, textAlign: 'center' }}>
          <span className="lf-meta">앨범 없음</span>
        </div>
      )}

      {items != null && items.length > 0 && (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {items.map((it, i) => (
            <li
	key={it.id}
	draggable
	onDragStart={() => { dragFrom.current = i }}
	onDragOver={e => onDragOver(e, i)}
	onDragEnd={onDragEnd}
	onDrop={() => onDrop(i)}
	className="lf-panel"
	style={{
                display: 'grid',
                gridTemplateColumns: 'auto 22px 44px 1fr auto',
                alignItems: 'center',
                gap: 12,
                padding: '10px 12px',
                cursor: 'grab',
                borderTop: dragOver === i ? '2px solid var(--color-accent)' : '2px solid transparent',
              }}
            >
              <span className="lf-mono" aria-hidden="true" title="드래그로 순서 변경" style={{ color: 'var(--color-faded)', cursor: 'grab', fontSize: 14 }}>⠿</span>
              <span className="lf-mono" style={{ fontSize: 12, color: 'var(--color-subtle)', textAlign: 'right' }}>{i + 1}</span>
              <div style={{ width: 44 }}><AlbumArt url={it.album?.cover_url} label={it.album?.title ?? '?'} size={44} /></div>
              <div style={{ minWidth: 0 }}>
                <div className="lf-serif lf-italic" style={{ fontSize: 16, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.album?.title}</div>
                <div className="lf-mono" style={{ fontSize: 10.5, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 3 }}>
                  {(it.album?.artist_names ?? []).join(', ') || '—'}
                </div>
              </div>
              <button type="button" className="lf-chip" onClick={() => remove(it.id)} aria-label="목록에서 제거">제거</button>
            </li>
          ))}
        </ol>
      )}

      {adding && (
        <AddAlbumModal
	bucketName="들을 것"
	onAdd={onAdd}
	onClose={() => setAdding(false)}
        />
      )}
    </section>
  )
}

/* ── 평론한 앨범 (reviewed) ──────────────────────────────────────────────── */

function ReviewedDrawer({ album, reviews, onClose }: { album: ReviewedAlbum, reviews: MemberReview[], onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const title = album.album?.title ?? '앨범'
  const n = album.review_ids?.length ?? reviews.length

  return (
    <div
	role="presentation"
	onClick={onClose}
	style={{ position: 'fixed', inset: 0, zIndex: 'var(--z-nav)', background: 'color-mix(in srgb, var(--color-text) 28%, transparent)', display: 'flex', justifyContent: 'flex-end' }}
    >
      <div
	role="dialog"
	aria-modal="true"
	aria-label={`${title} 평론`}
	onClick={e => e.stopPropagation()}
	className="lf-rise"
	style={{ width: 'min(420px, 92vw)', height: '100%', background: 'var(--color-bg)', borderLeft: '1px solid var(--color-text)', padding: 26, overflowY: 'auto', boxShadow: '-20px 0 50px -24px rgba(0,0,0,.45)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', minWidth: 0 }}>
            <div style={{ width: 64, flexShrink: 0 }}><AlbumArt url={album.album?.cover_url} label={title} size={64} /></div>
            <div style={{ minWidth: 0 }}>
              <div className="lf-kicker" style={{ marginBottom: 5 }}>
{n}
개 평론
              </div>
              <h3 className="lf-serif lf-italic" style={{ margin: 0, fontSize: 21, lineHeight: 1.1 }}>{title}</h3>
              <div className="lf-mono" style={{ fontSize: 11, color: 'var(--color-subtle)', marginTop: 4 }}>{(album.album?.artist_names ?? []).join(', ')}</div>
            </div>
          </div>
          <button type="button" className="lf-chip" onClick={onClose} aria-label="닫기">✕</button>
        </div>

        {reviews.length === 0 && (
          <div className="lf-meta" style={{ padding: '14px 0' }}>이 앨범의 평론을 찾지 못했습니다.</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {reviews.map(r => (
            <a
	key={r.slug}
	href={`/blog/${r.slug}`}
	className="lf-panel"
	style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 13px', textDecoration: 'none', color: 'inherit' }}
            >
              <div className="lf-serif" style={{ fontSize: 15, lineHeight: 1.25 }}>{r.album}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {r.rating != null ? <Stars score={r.rating} size={12} /> : <span className="lf-unrated">미평가</span>}
                <span className="lf-mono" style={{ fontSize: 10.5, color: 'var(--color-subtle)' }}>{new Date(r.date).toLocaleDateString('ko-KR')}</span>
                <span className="lf-mono" style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--color-accent)' }}>보기 →</span>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

function ReviewedSection({ reviews }: { reviews: MemberReview[] }) {
  const [albums, setAlbums] = useState<ReviewedAlbum[] | null>(null)
  const [err, setErr] = useState(false)
  const [open, setOpen] = useState<ReviewedAlbum | null>(null)

  useEffect(() => {
    let alive = true
    listReviewed()
      .then(rows => alive && setAlbums(rows))
      .catch(() => alive && setErr(true))
    return () => {
      alive = false
    }
  }, [])

  // album_id → the member's posts that review it (for the drawer's links).
  const byAlbum = useMemo(() => {
    const m = new Map<string, MemberReview[]>()
    for (const r of reviews) {
      for (const aid of r.albumIds ?? []) {
        const arr = m.get(aid) ?? []
        arr.push(r)
        m.set(aid, arr)
      }
    }
    return m
  }, [reviews])

  const count = albums?.length ?? 0

  return (
    <section style={{ marginBottom: 52 }}>
      <SectionTitle kicker={`${count}장`} title="평론한 앨범" />

      {albums == null && !err && <div className="lf-meta" style={{ padding: '8px 0' }}>불러오는 중…</div>}
      {err && <div className="lf-panel" style={{ padding: 24, textAlign: 'center' }}><span className="lf-meta">목록을 불러오지 못했습니다</span></div>}

      {albums != null && albums.length === 0 && (
        <div className="lf-panel" style={{ padding: 40, textAlign: 'center' }}>
          <span className="lf-meta">앨범 없음</span>
        </div>
      )}

      {albums != null && albums.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px,1fr))', gap: '28px 20px' }}>
          {albums.map((a) => {
            const n = a.review_ids?.length ?? 0
            return (
              <button
	key={a.album_id}
	type="button"
	onClick={() => setOpen(a)}
	style={{ display: 'flex', flexDirection: 'column', gap: 9, background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }}
              >
                <div style={{ position: 'relative' }}>
                  <AlbumArt url={a.album?.cover_url} label={a.album?.title ?? '?'} />
                  {n > 1 && (
                    <span className="lf-mono" style={{ position: 'absolute', top: 0, right: 0, fontSize: 9, letterSpacing: '0.08em', color: '#fff', background: 'var(--color-accent)', padding: '3px 6px' }}>
                      {n}
개 평론
                    </span>
                  )}
                </div>
                <div>
                  <div className="lf-serif lf-italic" style={{ fontSize: 16, fontWeight: 500, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.album?.title}</div>
                  <div className="lf-mono" style={{ fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 3 }}>
                    {(a.album?.artist_names ?? []).join(', ') || '—'}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {open && (
        <ReviewedDrawer
	album={open}
	reviews={byAlbum.get(open.album_id) ?? []}
	onClose={() => setOpen(null)}
        />
      )}
    </section>
  )
}

/* ── 최근 들은 앨범 (Step 3, D25/D26 — worker-fed Spotify cache) ─────────────── */

const POLL_INTERVAL_MS = 1500
const POLL_MAX_ATTEMPTS = 10 // ~15s cap before assuming the cache was already fresh
const sleep = (ms: number) => new Promise<void>(r => window.setTimeout(r, ms))

/**
 * True once the cache's synced_at has moved past the click-time value (D31). A
 *  server-relative comparison, so it's immune to client↔server clock skew.
 */
function syncAdvanced(before: string | null, now: string | null): boolean {
  if (!now)
    return false
  if (!before)
    return true
  return new Date(now).getTime() > new Date(before).getTime()
}

function RecentListenedSection({ onOpen }: { onOpen: (t: DetailTarget) => void }) {
  const [items, setItems] = useState<RecentlyListenedItem[] | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [err, setErr] = useState(false)
  // 'idle' | 'pending' (refresh enqueued, polling the worker-fed cache).
  const [refreshState, setRefreshState] = useState<'idle' | 'pending'>('idle')
  // shown briefly when a refresh found the cache already fresh (server debounced).
  const [freshNote, setFreshNote] = useState(false)
  // LIB-2: mounted guard + freshNote timer handle — the onRefresh poll outlives
  // a tab remount (ProfileApp key={tab}); gate every setState and clear the timer.
  const alive = useRef(true)
  const freshTimer = useRef<number | null>(null)

  function load(isAlive: () => boolean = () => true) {
    return listRecentlyListened()
      .then((snap) => {
        if (isAlive()) {
          setItems(snap.items)
          setLastSyncedAt(snap.lastSyncedAt)
        }
      })
      .catch(() => isAlive() && setErr(true))
  }

  useEffect(() => {
    alive.current = true
    load(() => alive.current)
    return () => {
      alive.current = false
      if (freshTimer.current != null)
        window.clearTimeout(freshTimer.current)
    }
  }, [])

  async function onRefresh() {
    if (refreshState === 'pending')
      return
    const before = lastSyncedAt // server-relative anchor (skew-free)
    setErr(false)
    setFreshNote(false)
    setRefreshState('pending')
    try {
      await refreshRecent()
    }
    catch {
      if (alive.current) {
        setErr(true)
        setRefreshState('idle')
      }
      return
    }
    // Poll until the worker's synced_at advances past `before` (a real re-sync).
    // If it never does within the cap, the cache was < ~60s old and the worker
    // debounced the request (D31) — settle on current data with a neutral note,
    // not an error: the data genuinely is as fresh as it gets.
    for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
      await sleep(POLL_INTERVAL_MS)
      if (!alive.current)
        return // tab remounted mid-poll — stop touching the unmounted tree
      const snap = await listRecentlyListened().catch(() => null)
      if (!alive.current)
        return
      if (!snap)
        continue // transient; keep polling within the cap
      if (syncAdvanced(before, snap.lastSyncedAt)) {
        setItems(snap.items)
        setLastSyncedAt(snap.lastSyncedAt)
        setRefreshState('idle')
        return
      }
    }
    await load(() => alive.current)
    if (!alive.current)
      return
    setFreshNote(true)
    freshTimer.current = window.setTimeout(() => {
      if (alive.current)
        setFreshNote(false)
    }, 3000)
    setRefreshState('idle')
  }

  const count = items?.length ?? 0

  return (
    <section>
      <SectionTitle
	kicker={`${count}장`}
	title="최근 들은 앨범"
	right={(
          <button
	type="button"
	className="lf-btn"
	onClick={onRefresh}
	disabled={refreshState === 'pending'}
	aria-busy={refreshState === 'pending'}
          >
            {refreshState === 'pending' ? '동기화 중…' : '지금 새로고침'}
          </button>
        )}
      />

      {items == null && !err && <div className="lf-meta" style={{ padding: '8px 0' }}>불러오는 중…</div>}
      {err && <div className="lf-panel" style={{ padding: 24, textAlign: 'center' }}><span className="lf-meta">목록을 불러오지 못했습니다</span></div>}

      {freshNote && <div className="lf-meta" style={{ padding: '4px 0' }}>이미 최신 상태입니다</div>}

      {items != null && items.length === 0 && !err && (
        <div className="lf-panel" style={{ padding: 40, textAlign: 'center' }}>
          <span className="lf-meta">기록 없음</span>
        </div>
      )}

      {items != null && items.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px,1fr))', gap: '28px 20px' }}>
          {items.map((it) => {
            const album = it.album
            const title = album?.title ?? '앨범'
            const artist = (album?.artist_names ?? []).join(', ') || '—'
            return (
              <div
	key={it.album_id}
	style={{ display: 'flex', flexDirection: 'column', gap: 9, cursor: 'pointer' }}
	onClick={() => onOpen({
		album: title,
		artist,
		real: true,
		albumId: it.album_id,
		cover: album?.cover_url ?? null,
		year: album?.release_date ? Number(String(album.release_date).slice(0, 4)) || null : null,
	})}
              >
                <div style={{ position: 'relative' }}>
                  <AlbumArt url={album?.cover_url} label={title} />
                  <span className="lf-mono" style={{ position: 'absolute', bottom: 0, left: 0, fontSize: 9, letterSpacing: '0.06em', color: '#fff', background: 'color-mix(in srgb, var(--color-text) 78%, transparent)', padding: '3px 6px' }}>
                    {fmtWhen(it.last_played_at)}
                  </span>
                </div>
                <div>
                  <div className="lf-serif lf-italic" style={{ fontSize: 16, fontWeight: 500, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
                  <div className="lf-mono" style={{ fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 3 }}>{artist}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export function LibraryTab({ onOpen, reviews }: { onOpen: (t: DetailTarget) => void, reviews: MemberReview[] }) {
  return (
    <div>
      <ToListenSection />
      <ReviewedSection reviews={reviews} />
      <RecentListenedSection onOpen={onOpen} />
    </div>
  )
}
