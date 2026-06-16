// FEAT-review-bucket-board Step 4 — "앨범 담기" modal. Album-only search built on
// the shared `useMusicSearch` core (same DB→Spotify-sync flow as the writer) and
// hands the resolved DB album id back to the board.
//
// recallTypes=['album','artist']: we render albums only, but REQUEST artist too
// so the DB endpoint's artist→album expansion fires — otherwise searching an
// artist by name (e.g. "방탄소년단", "씨잼") returns their discography as zero
// rows. See useMusicSearch for the why.
import type { ChangeEvent, KeyboardEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { AlbumHit } from '@lib/useMusicSearch'
import { useMusicSearch } from '@lib/useMusicSearch'
import { useDismissable } from '@lib/useDismissable'
import { ResultRow, SourceTag } from '@components/search/atoms'

const MUSIC = import.meta.env.PUBLIC_API_URL as string

export type AddOutcome =
	| { status: 'added', alreadyReviewed: boolean } |
	{ status: 'conflict' } |
	{ status: 'error', message: string }

interface Props {
  bucketName: string
  /** Resolve the picked album to a DB id and add it; board owns the API call. */
  onAdd: (album: { id: string, title: string }) => Promise<AddOutcome>
  onClose: () => void
  /**
   * DB album ids already in this bucket/list → those hits render as 담김
   *  (disabled). Only DB-id hits can be matched; Spotify-only hits resolve a DB
   *  id on pick, so the server's conflict path still catches those.
   */
  existingAlbumIds?: ReadonlySet<string>
}

export default function AddAlbumModal({ bucketName, onAdd, onClose, existingAlbumIds }: Props) {
  const search = useMusicSearch({ recallTypes: ['album', 'artist'] })
  const [pendingId, setPendingId] = useState<string | null>(null)
  // Pick-outcome message ("담았습니다" / conflict / error). Distinct from the
  // hook's search status so a successful add doesn't get clobbered by it.
  const [notice, setNotice] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  // ESC + focus trap + focus restore. autoFocus off — focus the search input
  // (below) rather than the hook's first focusable (the close button).
  useDismissable(true, onClose, modalRef, { autoFocus: false })

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Lock background page scroll while the modal is open — only the results area
  // scrolls (item 5). Self-restores on close.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // Auto-search: debounce the DB search as the query changes (same UX as the
  // header search). Spotify stays manual — it enqueues SQS + has a 3 s cooldown.
  useEffect(() => {
    if (!search.query.trim())
      return
    const id = setTimeout(() => void search.runDbSearch(), 200)
    return () => clearTimeout(id)
  }, [search.query, search.runDbSearch])

  function doSearch() {
    setNotice('')
    void search.runDbSearch()
  }

  function doSpotify() {
    setNotice('')
    void search.runSpotifySync()
  }

  function onQueryChange(e: ChangeEvent<HTMLInputElement>) {
    search.setQuery(e.target.value)
    if (notice)
      setNotice('')
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      doSearch()
    }
  }

  function clearSearch() {
    search.reset()
    setNotice('')
  }

  /** Resolve a Spotify-only hit to a DB album id (single attempt; absorb may lag). */
  async function resolveDbId(hit: AlbumHit): Promise<string | null> {
    if (hit.id)
      return hit.id
    if (!hit.spotifyId)
      return null
    try {
      const r = await fetch(`${MUSIC}/api/music/albums/by-spotify/${encodeURIComponent(hit.spotifyId)}`)
      if (!r.ok)
        return null
      const json = await r.json() as { album?: { id?: string } }
      return json.album?.id ?? null
    }
    catch {
      return null
    }
  }

  async function pick(hit: AlbumHit) {
    const key = hit.id ?? hit.spotifyId ?? hit.title
    setPendingId(key)
    setNotice('')
    try {
      const albumId = await resolveDbId(hit)
      if (!albumId) {
        setNotice('앨범을 다시 선택해주세요')
        return
      }
      const outcome = await onAdd({ id: albumId, title: hit.title })
      if (outcome.status === 'added')
        setNotice(outcome.alreadyReviewed ? `“${hit.title}” 담음 · 이미 리뷰한 앨범이에요` : `“${hit.title}” 담았습니다`)
      else if (outcome.status === 'conflict')
        setNotice(`“${hit.title}” 은 이미 이 버킷에 있어요`)
      else
        setNotice(outcome.message)
    }
    finally {
      setPendingId(null)
    }
  }

  const statusText = notice || search.status

  return (
    <div className="qb-modal-scrim qb-modal-scrim--add" onClick={onClose} role="presentation">
      <div ref={modalRef} className="qb-modal qb-modal--add" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="앨범 담기">
        <header className="qb-modal-head">
          <div>
            <p className="qb-modal-kicker">앨범 담기</p>
            <h2 className="qb-modal-title">{bucketName}</h2>
          </div>
          <button type="button" className="qb-modal-close" onClick={onClose} aria-label="닫기">✕</button>
        </header>

        <div className="qb-modal-searchrow">
          <div className="qb-modal-search">
            <span className="qb-modal-search-icon" aria-hidden="true">⌕</span>
            <input
	ref={inputRef}
	className="qb-modal-search-input"
	placeholder="리뷰할 앨범을 검색…"
	value={search.query}
	onChange={onQueryChange}
	onKeyDown={onKeyDown}
	autoComplete="off"
            />
            {search.query && <button type="button" className="qb-modal-search-clear" onClick={clearSearch}>✕</button>}
          </div>
          <button type="button" className="qb-modal-search-btn" onClick={doSearch} disabled={search.loading}>검색</button>
          <button
	type="button"
	className="qb-modal-spotify-btn"
	onClick={doSpotify}
	disabled={search.loading || search.spotifyCooldown}
	title={search.spotifyCooldown ? '잠시 후 다시 시도 (Spotify 쿨다운)' : 'Spotify에서 검색 + DB 동기화'}
          >
            Spotify 싱크
          </button>
        </div>

        {statusText && <p className="qb-modal-status">{statusText}</p>}

        <div className="qb-modal-results">
          {search.loading && <div className="qb-modal-empty">검색 중…</div>}
          {!search.loading && search.albums.map((hit) => {
            const key = hit.id ?? hit.spotifyId ?? hit.title
            const isSpotify = hit.source === 'spotify'
            const present = !!(hit.id && existingAlbumIds?.has(hit.id))
            const pendingThis = pendingId === key
            const trailing = present ?
              <span className="gs-row-tag is-on">담김 ✓</span> :
              pendingThis ?
                <span className="gs-row-tag">담는 중…</span> :
                isSpotify ?
                  <SourceTag /> :
                  <span className="gs-row-tag">담기 +</span>
            return (
              <ResultRow
	key={`${hit.source}:${key}`}
	name={hit.title}
	src={hit.cover}
	title={hit.title}
	sub={[hit.artist ?? '—', hit.year].filter(Boolean).join(' · ')}
	source={isSpotify ? 'spotify' : 'db'}
	trailing={trailing}
	extraClass={present ? 'is-present' : undefined}
	action={{ type: 'button', onClick: () => void pick(hit), disabled: pendingId !== null || present }}
              />
            )
          })}
          {!search.loading && search.hasMore.album > 0 && (
            <button
	type="button"
	className="qb-modal-more"
	onClick={() => void search.loadMore('album')}
	disabled={search.loadingMore !== null}
            >
              {search.loadingMore === 'album' ? '불러오는 중…' : '더 보기'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
