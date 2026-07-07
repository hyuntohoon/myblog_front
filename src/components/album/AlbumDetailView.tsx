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
import { artistHref } from '@lib/entityLinks'
import { TrackRow } from '../shared/TrackRow'
import { AlbumArt, fmtTime } from '../member/ui'

// Static-lyrics entry (FEAT-lyrics-sheet). `meta` carries the header identity
// the lyrics read itself does not (title/artist/album/cover).
export type OnOpenLyrics = (spotifyTrackId: string, meta?: LyricsSheetMeta) => void
// Album-level identity for the lyrics header; the per-track title is added at
// each row.
export type AlbumLyricsMeta = Omit<LyricsSheetMeta, 'track'>

// ── header (cover + title + meta) ────────────────────────────────────────────
export function Header({ cover, title, artist, meta, kicker }: { cover?: string | null, title: string, artist?: string, meta: string[], kicker: string }) {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', paddingRight: 28 }}>
      <div style={{ width: 110, flex: '0 0 auto' }}><AlbumArt url={cover} label={title} size={110} /></div>
      <div style={{ minWidth: 0, flex: 1, paddingTop: 2 }}>
        <div className="kicker" style={{ marginBottom: 5 }}>{kicker}</div>
        <h2 className="serif italic" style={{ fontSize: 25, fontWeight: 500, lineHeight: 1.14, margin: 0 }}>{title}</h2>
        {artist && <div className="sans" style={{ fontSize: 13, color: 'var(--color-subtle)', marginTop: 6 }}>{artist}</div>}
        {meta.length > 0 && (
          <div className="mono" style={{ fontSize: 10.5, letterSpacing: '0.04em', color: 'var(--color-faded)', marginTop: 10, lineHeight: 1.5 }}>{meta.join(' · ')}</div>
        )}
      </div>
    </div>
  )
}

// ── read-only tracklist ──────────────────────────────────────────────────────
// Rows are the shared TrackRow (ARCH-entity-interaction-contract): the only
// action granted is `lyrics` (rows stay otherwise read-only), omitted for
// tracks without a spotify_id AND whenever onOpenLyrics is absent (public).
export function Tracklist({ tracks, onOpenLyrics, albumMeta }: { tracks: MusicTrack[], onOpenLyrics?: OnOpenLyrics, albumMeta?: AlbumLyricsMeta }) {
  if (tracks.length === 0)
    return null
  return (
    <div style={{ marginTop: 22, paddingTop: 20, borderTop: '1px solid var(--color-border-soft)' }}>
      <div className="meta" style={{ marginBottom: 10 }}>트랙리스트</div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
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
	actions={onOpenLyrics && sid ? { lyrics: () => onOpenLyrics(sid, { track: t.title, ...albumMeta }) } : {}}
	style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border-soft)' }}
            />
          )
        })}
      </ol>
    </div>
  )
}

// ── artists block ────────────────────────────────────────────────────────────
function Artists({ artists }: { artists: MusicArtist[] }) {
  if (artists.length === 0)
    return null
  return (
    <div style={{ marginTop: 22, paddingTop: 20, borderTop: '1px solid var(--color-border-soft)' }}>
      <div className="meta" style={{ marginBottom: 12 }}>아티스트</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {artists.map(ar => (
          <div key={ar.id} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ width: 40, flex: '0 0 auto' }}><AlbumArt url={ar.photo_url} label={ar.name} size={40} /></div>
            <div style={{ minWidth: 0, flex: 1 }}>
              {/* name links to the artist hub — the canonical artist detail surface. */}
              <div className="serif" style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <a className="lf-artist-link" href={artistHref(ar.id)} title="아티스트 허브">{ar.name}</a>
              </div>
              {ar.genres.length > 0 && (
                <div className="mono" style={{ fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-faded)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{ar.genres.join(' · ')}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
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
  /** Edit mode hides the artists block (the published banner takes the top). */
  hideArtists?: boolean
  /** Rendered right after the header (member edit mode: the published-review banner). */
  topSlot?: ReactNode
}

// Fetch DB metadata (cover/tracklist/artists) then render header + artists +
// tracklist. On fetch failure it degrades to header + a release-year line.
export function AlbumDetailView({ albumId, title, artist, cover, year, onOpenLyrics, hideArtists, topSlot }: AlbumDetailViewProps) {
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
  const metaParts: string[] = []
  if (a?.album_type)
    metaParts.push(a.album_type.toUpperCase())
  if (a?.release_date)
    metaParts.push(a.release_date)
  if (data?.tracks?.length)
    metaParts.push(`${data.tracks.length}곡`)
  if (a?.label)
    metaParts.push(a.label)

  const albumMeta: AlbumLyricsMeta = { artist, album: displayTitle, cover: a?.cover_url ?? cover }

  return (
    <>
      <Header cover={a?.cover_url ?? cover} title={displayTitle} artist={artist} meta={metaParts} kicker="앨범" />
      {topSlot}
      {state === 'loading' ?
        <div className="meta" style={{ marginTop: 22, paddingTop: 20, borderTop: '1px solid var(--color-border-soft)' }}>불러오는 중…</div> :
        (state === 'error' || !data) ?
          (
            <div style={{ marginTop: 22, paddingTop: 20, borderTop: '1px solid var(--color-border-soft)' }}>
              <div className="sans" style={{ fontSize: 13.5, color: 'var(--color-subtle)' }}>{year ? `${year}년 발매` : '상세 정보를 불러오지 못했습니다'}</div>
            </div>
          ) :
          (
            <>
              {!hideArtists && <Artists artists={data.artists} />}
              {data.tracks.length > 0 ?
                <Tracklist tracks={data.tracks} onOpenLyrics={onOpenLyrics} albumMeta={albumMeta} /> :
                (
                  <div style={{ marginTop: 22, paddingTop: 20, borderTop: '1px solid var(--color-border-soft)' }}>
                    <div className="sans" style={{ fontSize: 13.5, color: 'var(--color-subtle)' }}>{year ? `${year}년 발매` : '발매 정보 없음'}</div>
                  </div>
                )}
            </>
          )}
    </>
  )
}
