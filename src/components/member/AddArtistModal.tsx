// FEAT-my-buckit-artist Step 5 — "아티스트 담기" modal. The Artist-bucket counterpart
// of AddAlbumModal: artist-only search on the shared `useMusicSearch` core, handing
// the resolved DB artist id back to the board.
//
// recallTypes=['artist']: the unified endpoint runs artist-name/alias matching only
// when 'artist' is requested. A Spotify-only hit has no DB id yet (no resolve-by-
// spotify endpoint for artists), so it isn't directly addable — the "Spotify 싱크"
// button absorbs it into the DB (SQS), after which a re-search surfaces it with an id.
import type { ChangeEvent, KeyboardEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useMusicSearch } from '@lib/useMusicSearch'
import { useDismissable } from '@lib/useDismissable'
import { useScrollLock } from '@lib/useScrollLock'
import { ResultRow, SourceTag } from '@components/search/atoms'
import type { AddOutcome } from './AddAlbumModal'

interface Props {
  bucketName: string
  /** Resolve the picked artist to a DB id and add it; board owns the API call. */
  onAdd: (artist: { id: string, name: string }) => Promise<AddOutcome>
  onClose: () => void
  /**
   * DB artist ids already in this bucket → those hits render as 담김 (disabled).
   * Only DB-id hits can be matched; the server's partial-unique still catches dups.
   */
  existingArtistIds?: ReadonlySet<string>
}

export default function AddArtistModal({ bucketName, onAdd, onClose, existingArtistIds }: Props) {
  const search = useMusicSearch({ recallTypes: ['artist'] })
  const [pendingId, setPendingId] = useState<string | null>(null)
  // Pick-outcome message; distinct from the hook's search status so a successful
  // add doesn't get clobbered by it.
  const [notice, setNotice] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  useDismissable(true, onClose, modalRef, { autoFocus: false })

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Lock background page scroll while the modal is open — only the results scroll.
  useScrollLock()

  // Auto-search: debounce the DB search as the query changes. Spotify stays manual
  // (it enqueues SQS + has a 3 s cooldown).
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

  async function pick(hit: { id: string | null, name: string }) {
    if (!hit.id) {
      // Spotify-only hit — no DB id to add yet.
      setNotice('“Spotify 싱크” 후 다시 검색해주세요')
      return
    }
    const key = hit.id
    setPendingId(key)
    setNotice('')
    try {
      const outcome = await onAdd({ id: hit.id, name: hit.name })
      if (outcome.status === 'added')
        setNotice(`“${hit.name}” 담았습니다`)
      else if (outcome.status === 'conflict')
        setNotice(`“${hit.name}” 은 이미 이 버킷에 있어요`)
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
      <div ref={modalRef} className="qb-modal qb-modal--add" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="아티스트 담기">
        <header className="qb-modal-head">
          <div>
            <p className="qb-modal-kicker">아티스트 담기</p>
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
	placeholder="아티스트를 검색…"
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
          {!search.loading && search.artists.map((hit) => {
            const key = hit.id ?? hit.spotifyId ?? hit.name
            const isSpotify = hit.source === 'spotify'
            const present = !!(hit.id && existingArtistIds?.has(hit.id))
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
	name={hit.name}
	src={hit.cover}
	title={hit.name}
	sub="아티스트"
	source={isSpotify ? 'spotify' : 'db'}
	trailing={trailing}
	extraClass={present ? 'is-present' : undefined}
	action={{ type: 'button', onClick: () => void pick(hit), disabled: pendingId !== null || present }}
              />
            )
          })}
          {!search.loading && search.hasMore.artist > 0 && (
            <button
	type="button"
	className="qb-modal-more"
	onClick={() => void search.loadMore('artist')}
	disabled={search.loadingMore !== null}
            >
              {search.loadingMore === 'artist' ? '불러오는 중…' : '더 보기'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
