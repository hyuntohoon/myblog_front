// Read-only album-detail body, decoupled from member context
// (ARCH-entity-interaction-unify Step 1). Shared by BOTH the member modal
// (components/member/AlbumDetail — writable memo/edit stays there) and the
// app-wide public overlay (components/album/AlbumOverlay).
//
// Driven by public primitives (albumId + display identity), NOT DetailTarget.
// It imports no member-only module (no MemoWindow / bucketStore / lyrics sheet
// runtime) so it is safe in the public bundle. The lyrics affordance renders
// ONLY when `onOpenLyrics` is supplied — public surfaces omit it, preserving
// the FEAT-lyrics-viewer privacy boundary (no lyric entry on public routes).
import type { LyricsSheetMeta } from '../member/lyrics/LyricsSheet'
import type { AlbumDetail as AlbumDetailResp, MusicArtist, MusicTrack } from '@lib/albumDetail'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { fetchAlbumDetail, getCachedAlbumDetail } from '@lib/albumDetail'
import { memberRef } from '@lib/entityDrag'
import { artistHref } from '@lib/entityLinks'
import { TrackRow } from '../shared/TrackRow'
import { AlbumArt, fmtTime } from '../member/ui'
import AlbumRatingBlock from './AlbumRatingBlock'
import '../../styles/album-modal.css'

// Static-lyrics entry (FEAT-lyrics-sheet). `meta` carries the header identity
// the lyrics read itself does not (title/artist/album/cover).
export type OnOpenLyrics = (spotifyTrackId: string, meta?: LyricsSheetMeta) => void
// ARCH-entity-interaction-v2 Step 5 — the per-track ➕ 담기 grant (DB `t.id`,
// always present). Same gating shape as `OnOpenLyrics`: omitted ⇒ the row
// renders no add button. The host owns the actual bucket-picker flow
// (`AddToBucketMenu`) — this module stays free of member-only imports.
export type OnAddTrack = (trackId: string, title: string) => void
// ARCH-entity-interaction-v2 Step 5 — the per-track ▶ grant. Same gating shape
// as `OnAddTrack`: omitted ⇒ the row renders no play button. The host owns the
// actual play call (`playbackSession.replaceQueueAndPlay({kind:'track', ...})`,
// the same primitive the vanilla review page's per-track ▶ already uses) —
// this module stays free of the playback-session import.
export type OnPlayTrack = (trackId: string, title: string) => void
// Album-level identity for the lyrics header; the per-track title is added at
// each row.
export type AlbumLyricsMeta = Omit<LyricsSheetMeta, 'track'>

// ── header (cover + title + meta) ────────────────────────────────────────────
export function Header({ cover, title, artist, meta, kicker, actions, modalPlate = false }: { cover?: string | null, title: string, artist?: string, meta: string[], kicker: string, actions?: ReactNode, modalPlate?: boolean }) {
  if (!modalPlate) {
    return (
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', paddingRight: 28 }}>
        <div style={{ width: 110, flex: '0 0 auto' }}><AlbumArt url={cover} label={title} size={110} /></div>
        <div style={{ minWidth: 0, flex: 1, paddingTop: 2 }}>
          <div className="kicker" style={{ marginBottom: 5 }}>{kicker}</div>
          <h2 className="serif italic" style={{ fontSize: 25, fontWeight: 500, lineHeight: 1.14, margin: 0 }}>{title}</h2>
          {artist && <div className="sans" style={{ fontSize: 13, color: 'var(--color-subtle)', marginTop: 6 }}>{artist}</div>}
          {meta.length > 0 && <div className="mono" style={{ fontSize: 10.5, letterSpacing: '0.04em', color: 'var(--color-faded)', marginTop: 10, lineHeight: 1.5 }}>{meta.join(' · ')}</div>}
        </div>
      </div>
    )
  }
  return (
    <header className="album-modal__header">
      <div className="album-modal__cover"><AlbumArt url={cover} label={title} size={196} /></div>
      <div className="album-modal__identity">
        <div className="kicker album-modal__kicker">{kicker}</div>
        <h2 className="serif italic album-modal__title">{title}</h2>
        {artist && <div className="serif album-modal__artist">{artist}</div>}
        {meta.length > 0 && (
          <div className="sans album-modal__subline">{meta.join(' · ')}</div>
        )}
        {actions && <div className="album-modal__actions">{actions}</div>}
      </div>
    </header>
  )
}

// ── read-only tracklist ──────────────────────────────────────────────────────
// Rows are the shared TrackRow (ARCH-entity-interaction-contract): `lyrics`
// (omitted for tracks without a spotify_id AND whenever onOpenLyrics is
// absent — public) and, since Step 5, `add` (omitted whenever onAddTrack is
// absent — public omits it, same as lyrics: an anonymous reader has no
// bucket to add into) and `play` (omitted whenever onPlayTrack is absent —
// unlike `add`, BOTH hosts supply it: `AlbumOverlay` already offers an
// album-level ▶ to any logged-in visitor, so there is no semantic reason to
// withhold the track-level one). `drag` (`enableDrag`) is member-modal ONLY —
// `AlbumOverlay` omits it, same reasoning as `add`: a public visitor has no
// Pocket tray to drop onto in the first place.
export function Tracklist({ tracks, onOpenLyrics, onAddTrack, onPlayTrack, albumId, enableDrag, albumMeta }: { tracks: MusicTrack[], onOpenLyrics?: OnOpenLyrics, onAddTrack?: OnAddTrack, onPlayTrack?: OnPlayTrack, albumId?: string, enableDrag?: boolean, albumMeta?: AlbumLyricsMeta }) {
  if (tracks.length === 0)
    return null
  return (
    <section className="album-modal__tracklist">
      <div className="album-modal__section-head"><h3>수록곡</h3></div>
      <ol className="album-modal__tracks">
        {tracks.map((t) => {
          const sid = t.spotify_id
          return (
            <TrackRow
	key={t.id}
	as="li"
	no={t.track_no ?? '·'}
	title={t.title}
	titleSuffix={t.feat_artist_names.length > 0 ?
                <span className="sans" style={{ fontSize: 11.5, color: 'var(--color-faded)' }}>{` feat. ${t.feat_artist_names.join(', ')}`}</span> :
                undefined}
	cells={t.duration_sec != null ?
                <span className="mono" style={{ fontSize: 11, color: 'var(--color-faded)', flex: '0 0 auto' }}>{fmtTime(t.duration_sec)}</span> :
                undefined}
	actions={{
                ...(onOpenLyrics && sid ? { lyrics: () => onOpenLyrics(sid, { track: t.title, ...albumMeta }) } : {}),
                ...(onPlayTrack ? { play: () => onPlayTrack(t.id, t.title) } : {}),
                ...(onAddTrack ? { add: () => onAddTrack(t.id, t.title) } : {}),
                ...(enableDrag ? { drag: { ref: memberRef({ trackId: t.id, albumId: albumId ?? null }), origin: { kind: 'external' as const, copies: true } } } : {}),
              }}
	className="album-modal__track"
            />
          )
        })}
      </ol>
    </section>
  )
}

// ── artists block ────────────────────────────────────────────────────────────
// Hover affordance for the artist-hub link. Self-supplied (the SCOPED_CSS idiom
// the off-dashboard home islands use) because this component is mounted from
// layout.astro via AlbumOverlay — i.e. on every page — while the rule used to
// live in member/layout.css, which loads on /collection/ and /settings/ only.
// That mismatch was audit E-6, the 4th recurrence of the member.css trap: the
// rule must travel with whatever emits the class, not with the dashboard.
function Artists({ artists }: { artists: MusicArtist[] }) {
  if (artists.length === 0)
    return null
  return (
    <section className="album-modal__artists">
      <div className="album-modal__section-head"><h3>아티스트</h3></div>
      <div className="album-modal__artist-list">
        {artists.map(ar => (
          <div key={ar.id} className="album-modal__artist-row">
            <div className="album-modal__artist-photo"><AlbumArt url={ar.photo_url} label={ar.name} size={40} /></div>
            <div className="album-modal__artist-copy">
              {/* name links to the artist hub — the canonical artist detail surface. */}
              <div className="serif album-modal__artist-name">
                <a className="lf-artist-link" href={artistHref(ar.id)} title="아티스트 허브">{ar.name}</a>
              </div>
              {ar.genres.length > 0 && (
                <div className="mono album-modal__artist-genres">{ar.genres.join(' · ')}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export interface AlbumDetailViewProps {
  albumId: string
  /** Immediate display title (avoids a blank header pre-fetch). Falls back to fetched. */
  title?: string
  artist?: string
  cover?: string | null
  year?: number | null
  /** Member surfaces pass this to grant the per-track 가사 entry; public omits it. */
  onOpenLyrics?: OnOpenLyrics
  /** Member surfaces pass this to grant the per-track ➕ 담기 entry; public omits it. */
  onAddTrack?: OnAddTrack
  /** Both member and public (logged-in) surfaces pass this to grant the per-track ▶ entry. */
  onPlayTrack?: OnPlayTrack
  /** Member surfaces pass this to grant the per-track drag source; public `AlbumOverlay` omits it. */
  enableDrag?: boolean
  /** Edit mode hides the artists block (the published banner takes the top). */
  hideArtists?: boolean
  /** Rendered right after the header (member edit mode: the published-review banner). */
  topSlot?: ReactNode
  /** Reserved in the identity column (public overlay: album-level play). */
  headerActions?: ReactNode
  /**
   * False when `albumId` is a display-only fallback, not a real catalog id
   * (see OpenAlbumDetail.unresolved) — hides the rating/review write panel,
   * which PUTs against `albumId` and must never target a foreign-namespace id.
   * Defaults to true (every other caller passes a genuine DB id).
   */
  interactive?: boolean
}

// Fetch DB metadata (cover/tracklist/artists) then render header + artists +
// tracklist. On fetch failure it degrades to header + a release-year line.
export function AlbumDetailView({ albumId, title, artist, cover, year, onOpenLyrics, onAddTrack, onPlayTrack, enableDrag, hideArtists, topSlot, headerActions, interactive = true }: AlbumDetailViewProps) {
  const seed = getCachedAlbumDetail(albumId)
  const [data, setData] = useState<AlbumDetailResp | null>(seed)
  const [state, setState] = useState<'loading' | 'ok' | 'error'>(seed ? 'ok' : 'loading')

  useEffect(() => {
    let alive = true
    fetchAlbumDetail(albumId).then((json) => {
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
  }, [albumId])

  const a = data?.album
  const displayTitle = title || a?.title || ''
  const headerMeta: string[] = []
  const genres = Array.from(new Set((data?.artists ?? []).flatMap(ar => ar.genres)))
  if (genres.length)
    headerMeta.push(...genres.slice(0, 2))
  if (a?.album_type)
    headerMeta.push(a.album_type)
  if (a?.release_date)
    headerMeta.push(a.release_date.slice(0, 4))
  else if (year)
    headerMeta.push(String(year))

  const catalogLines: string[] = []
  if (a?.release_date)
    catalogLines.push(a.release_date)
  if (data?.tracks?.length) {
    const totalSeconds = data.tracks.reduce((sum, track) => sum + (track.duration_sec ?? 0), 0)
    catalogLines.push(`${data.tracks.length}곡${totalSeconds > 0 ? `, ${fmtTime(totalSeconds)}` : ''}`)
  }
  if (a?.label)
    catalogLines.push(a.label)

  const albumMeta: AlbumLyricsMeta = { artist, album: displayTitle, cover: a?.cover_url ?? cover }

  return (
    <div className="album-modal__detail">
      <div className={`album-modal__plate${!interactive && !topSlot ? ' album-modal__plate--identity-only' : ''}`}>
        <Header cover={a?.cover_url ?? cover} title={displayTitle} artist={artist} meta={headerMeta} kicker="앨범" actions={headerActions} modalPlate />
        {topSlot}
        {/* FEAT-multi-user Phase 1: public community rating + signed-in write panel.
            Renders on every album surface (public overlay + member modal) EXCEPT
            when albumId is a display-only fallback (interactive=false). */}
        {interactive && <AlbumRatingBlock albumId={albumId} />}
      </div>
      <div className="album-modal__body">
      {state === 'loading' ?
        <div className="meta album-modal__state">불러오는 중…</div> :
        (state === 'error' || !data) ?
          (
            <div className="album-modal__state">
              <div className="sans">{year ? `${year}년 발매` : '상세 정보를 불러오지 못했습니다'}</div>
            </div>
          ) :
          (
            <>
              {data.tracks.length > 0 ?
                <Tracklist tracks={data.tracks} onOpenLyrics={onOpenLyrics} onAddTrack={onAddTrack} onPlayTrack={onPlayTrack} albumId={albumId} enableDrag={enableDrag} albumMeta={albumMeta} /> :
                (
                  <div className="album-modal__state">
                    <div className="sans">{year ? `${year}년 발매` : '발매 정보 없음'}</div>
                  </div>
                )}
              {!hideArtists && <Artists artists={data.artists} />}
              {catalogLines.length > 0 && (
                <div className="sans album-modal__catalog" aria-label="앨범 정보">
                  {catalogLines.map(line => <div key={line}>{line}</div>)}
                </div>
              )}
            </>
          )}
      </div>
    </div>
  )
}
