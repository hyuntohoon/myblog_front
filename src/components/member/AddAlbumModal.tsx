// FEAT-review-bucket-board Step 4 — "앨범 담기" modal. Album-only unified search
// (reuses the music service search endpoints, same DB→Spotify-sync flow as the
// writer's SubjectBlock) and hands the resolved DB album id back to the board.
import type { KeyboardEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '@lib/api'
import type { components } from '@lib/api.gen'

type UnifiedSearchResult = components['schemas']['Music_UnifiedSearchResult']
type CandidateSearchResult = components['schemas']['Music_CandidateSearchResult']

const MUSIC = import.meta.env.PUBLIC_API_URL as string

export type AddOutcome =
	| { status: 'added', alreadyReviewed: boolean } |
	{ status: 'conflict' } |
	{ status: 'error', message: string }

interface AlbumHit {
  id: string | null
  title: string
  artist: string | null
  cover: string | null
  year: string | null
  spotifyId: string | null
  source: 'db' | 'spotify'
}

interface Props {
  bucketName: string
  /** Resolve the picked album to a DB id and add it; board owns the API call. */
  onAdd: (album: { id: string, title: string }) => Promise<AddOutcome>
  onClose: () => void
}

const SPOTIFY_COOLDOWN_MS = 3000

export default function AddAlbumModal({ bucketName, onAdd, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<AlbumHit[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(false)
  const cooldownRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape')
        onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function runDbSearch() {
    const q = query.trim()
    if (!q)
      return
    setLoading(true)
    setStatus('')
    setHits([])
    try {
      const r = await fetch(
        `${MUSIC}/api/music/search/unified?q=${encodeURIComponent(q)}&type=album&limit=20&offset=0`,
      )
      if (!r.ok)
        throw new Error(`HTTP ${r.status}`)
      const data = await r.json() as UnifiedSearchResult
      const albums: AlbumHit[] = (data.albums ?? []).map(a => ({
        id: a.id ?? null,
        title: a.title ?? '',
        artist: a.artist_name ?? null,
        cover: a.cover_url ?? null,
        year: a.release_date ? a.release_date.slice(0, 4) : null,
        spotifyId: a.spotify_id ?? null,
        source: 'db' as const,
      }))
      setHits(albums)
      if (albums.length === 0)
        setStatus('DB에 결과가 없습니다. Spotify 싱크를 눌러보세요.')
    }
    catch {
      setStatus('검색 실패')
    }
    finally {
      setLoading(false)
    }
  }

  async function runSpotifySync() {
    const q = query.trim()
    if (!q || cooldownRef.current)
      return
    cooldownRef.current = true
    setCooldown(true)
    setTimeout(() => {
      cooldownRef.current = false
      setCooldown(false)
    }, SPOTIFY_COOLDOWN_MS)
    setLoading(true)
    setStatus('Spotify에서 검색하고 DB 동기화를 시작합니다…')
    setHits([])
    try {
      const r = await apiFetch(`${MUSIC}/api/music/search/candidates?q=${encodeURIComponent(q)}&type=album&limit=20`)
      if (!r || !r.ok)
        throw new Error(`HTTP ${r?.status}`)
      const data = await r.json() as CandidateSearchResult
      const albums: AlbumHit[] = (data.albums ?? []).map(a => ({
        id: null,
        title: a.title ?? '',
        artist: a.artist_name ?? null,
        cover: a.cover_url ?? null,
        year: a.release_date ? a.release_date.slice(0, 4) : null,
        spotifyId: a.spotify_id ?? null,
        source: 'spotify' as const,
      }))
      setHits(albums)
      setStatus(albums.length === 0 ? 'Spotify에서도 결과가 없습니다.' : 'Spotify 결과 (DB 동기화 백그라운드 진행 중)')
    }
    catch {
      setStatus('Spotify 싱크 실패')
    }
    finally {
      setLoading(false)
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void runDbSearch()
    }
  }

  function clearSearch() {
    setQuery('')
    setHits([])
    setStatus('')
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
    setStatus('')
    try {
      const albumId = await resolveDbId(hit)
      if (!albumId) {
        setStatus('앨범 동기화가 아직 완료되지 않았습니다. 잠시 후 다시 선택해주세요.')
        return
      }
      const outcome = await onAdd({ id: albumId, title: hit.title })
      if (outcome.status === 'added')
        setStatus(outcome.alreadyReviewed ? `“${hit.title}” 담음 · 이미 리뷰한 앨범이에요` : `“${hit.title}” 담았습니다`)
      else if (outcome.status === 'conflict')
        setStatus(`“${hit.title}” 은 이미 이 버킷에 있어요`)
      else
        setStatus(outcome.message)
    }
    finally {
      setPendingId(null)
    }
  }

  return (
    <div className="qb-modal-scrim" onClick={onClose} role="presentation">
      <div className="qb-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="앨범 담기">
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
	value={query}
	onChange={e => setQuery(e.target.value)}
	onKeyDown={onKeyDown}
	autoComplete="off"
            />
            {query && <button type="button" className="qb-modal-search-clear" onClick={clearSearch}>✕</button>}
          </div>
          <button type="button" className="qb-modal-search-btn" onClick={() => void runDbSearch()} disabled={loading}>검색</button>
          <button
	type="button"
	className="qb-modal-spotify-btn"
	onClick={() => void runSpotifySync()}
	disabled={loading || cooldown}
	title={cooldown ? '잠시 후 다시 시도 (Spotify 쿨다운)' : 'Spotify에서 검색 + DB 동기화'}
          >
            Spotify 싱크
          </button>
        </div>

        {status && <p className="qb-modal-status">{status}</p>}

        <div className="qb-modal-results">
          {loading && <div className="qb-modal-empty">검색 중…</div>}
          {!loading && hits.map((hit) => {
            const key = hit.id ?? hit.spotifyId ?? hit.title
            return (
              <button
	key={`${hit.source}:${key}`}
	type="button"
	className={`qb-hit${hit.source === 'spotify' ? ' is-spotify' : ''}`}
	onClick={() => void pick(hit)}
	disabled={pendingId !== null}
              >
                <span className="qb-hit-cover">
                  {hit.cover ?
                    <img src={hit.cover} alt={hit.title} loading="lazy" decoding="async" /> :
                    <span className="qb-hit-cover-ph">{(hit.title || '?').slice(0, 2).toUpperCase()}</span>}
                </span>
                <span className="qb-hit-text">
                  <span className="qb-hit-title"><em>{hit.title}</em></span>
                  <span className="qb-hit-sub">
                    {hit.artist ?? '—'}
                    {hit.year ? ` · ${hit.year}` : ''}
                  </span>
                </span>
                <span className={`qb-hit-src${hit.source === 'spotify' ? ' spotify' : ''}`}>
                  {pendingId === key ? '담는 중…' : hit.source === 'spotify' ? 'SPOTIFY' : 'DB'}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
