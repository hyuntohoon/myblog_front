/**
 * "오늘, 이 앨범들" — albums released on today's month/day in past years
 * (FEAT-today-buckit Step 2). A DB-only public read of
 * GET /api/music/albums/on-this-day (myblog_music); a horizontal cover strip
 * where the "N년 전" chip IS the point — the same calendar date seen back
 * through the catalog's years, newest anniversary first.
 *
 * Clicking a cover opens the app-wide read-only album overlay
 * (ARCH-entity-interaction-unify · openAlbum); the artist name routes to the
 * artist hub (artistHref). The section hides itself only on a confirmed-empty
 * response; a fetch error keeps the placeholder so the SSR'd layout never
 * collapses under the reader (FIX-home-module-cls).
 *
 * Self-contained: static styling is inline (matching the home modules) and the
 * hover/scroll rules ride a single scoped <style> keyed off `.otd-mod`.
 */
import { useEffect, useState } from 'react'
import { artistHref, openAlbum } from '@lib/entityLinks'
import HomeStrip from './HomeStrip'
import { CatalogAlbumCardAdapter } from '@components/shared/CatalogAlbumCardAdapter'
import { SectionTitle } from './ui'

interface OtdArtist { id: string, name: string, spotify_id: string | null }
interface OtdItem {
  album_id: string
  spotify_album_id: string | null
  title: string
  cover_url: string | null
  release_date: string
  years_ago: number
  artists: OtdArtist[]
}
interface OtdResult { items: OtdItem[], month: number, day: number, total: number }

const LIMIT = 10

function pad(n: number) {
  return String(n).padStart(2, '0')
}

// Hover / scroll states inline styles can't reach. Scoped to `.otd-mod`.
const SCOPED_CSS = `
.otd-mod .otd-skel{display:flex;gap:clamp(14px,2vw,20px);overflow-x:auto;padding:2px 2px 14px;margin:0 -2px}
.otd-mod .otd-card{flex:0 0 auto;width:clamp(128px,32vw,150px);scroll-snap-align:start;min-width:0}
.otd-mod .otd-card>.album-card{width:100%}
.otd-mod .otd-card .album-card__byline{margin-top:2px}
.otd-mod .otd-card .album-card__badge{padding:3px 7px;border-radius:999px;background:color-mix(in srgb,var(--color-bg) 82%,transparent);backdrop-filter:blur(3px);color:var(--color-text);box-shadow:0 1px 3px rgba(0,0,0,.18)}
.otd-mod .otd-skel-title{display:block;margin:9px 0 2px;line-height:1.15}
.otd-mod .otd-skel-artist{display:inline-block;margin-top:2px}
`

/** Public on-this-day adapter: open-only, with the anniversary in the badge slot. */
export function TodayAlbumCardAdapter({ it }: { it: OtdItem }) {
  const primary = it.artists[0]
  const year = Number(it.release_date.slice(0, 4)) || null
  return (
    <div className="otd-card" title={`${it.title} · 앨범 보기`}>
      <CatalogAlbumCardAdapter
	data={{
          catalogAlbumId: it.album_id,
          spotifyAlbumId: null,
          title: it.title,
          artist: primary?.name ?? null,
          artistId: primary?.id ?? null,
          cover: it.cover_url,
          // The legacy surface did not print the release year in its byline.
          year: null,
        }}
	layout="grid"
	capabilities={{
          open: () => openAlbum({ albumId: it.album_id, title: it.title, artist: primary?.name, cover: it.cover_url, year }),
          ...(primary?.id ? { artistOpen: () => window.location.assign(artistHref(primary.id)) } : {}),
        }}
	badge={<span className="mono" style={{ fontSize: 10.5, letterSpacing: '.02em' }}>{`${it.years_ago}년 전`}</span>}
      />
    </div>
  )
}

/**
 * Placeholder cards borrow the real card's classes and font styles so the
 * loading → ready swap moves nothing (FIX-home-module-cls; same principle as
 * BrowseGenres' skeleton): the title/artist rows are real line boxes with a
 * tinted inline bar riding the baseline, not free-height blocks.
 */
function Skeleton() {
  // Bar heights (0.72em/0.78em) must stay under the font's ascent: an empty
  // inline-block's baseline is its bottom edge, so a taller bar would push
  // the line box past the real text's and break the parity.
  const bar = (width: string, height: string) => (
    <span style={{ display: 'inline-block', width, height, borderRadius: 3, background: 'var(--color-border-soft)' }} />
  )
  return (
    <div className="otd-skel" aria-hidden="true" style={{ pointerEvents: 'none' }}>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="otd-card">
          <span style={{ display: 'block', width: '100%', aspectRatio: '1 / 1', borderRadius: 4, background: 'var(--color-border-soft)' }} />
          <span className="otd-skel-title serif italic" style={{ fontSize: 15.5, fontWeight: 500 }}>{bar('78%', '0.72em')}</span>
          <span className="otd-skel-artist mono" style={{ fontSize: 11.5, letterSpacing: '.02em' }}>{bar('52%', '0.78em')}</span>
        </div>
      ))}
    </div>
  )
}

export default function TodayAlbumBuckit() {
  const [data, setData] = useState<OtdResult | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let alive = true
    const base = import.meta.env.PUBLIC_API_URL as string
    fetch(`${base}/api/music/albums/on-this-day?limit=${LIMIT}`)
      .then(r => (r.ok ? r.json() as Promise<OtdResult> : null))
      .then((j) => {
        if (!alive)
          return
        if (j && Array.isArray(j.items)) {
          setData(j)
          setStatus('ready')
        }
        else {
          setStatus('error')
        }
      })
      .catch(() => {
        if (alive)
          setStatus('error')
      })
    return () => {
      alive = false
    }
  }, [])

  // Empty is the only state that removes the section (an honest, rare
  // collapse — the catalog usually has releases for any month/day). A fetch
  // ERROR keeps the skeleton instead of unmounting: transient Lambda
  // failures were yanking ~250px out of the viewport mid-read
  // (FIX-home-module-cls), and a quiet placeholder beats that jump.
  if (status === 'ready' && (!data || data.items.length === 0))
    return null

  const dateLabel = data ? `${pad(data.month)}.${pad(data.day)}` : ''

  return (
    <section className="otd-mod">
      <style>{SCOPED_CSS}</style>
      <SectionTitle kicker={dateLabel ? `이 날 · ${dateLabel}` : '이 날, 발매'} title="오늘, 이 앨범들" />
      {status === 'ready' && data ?
        (
          <HomeStrip>
            {data.items.map(it => <TodayAlbumCardAdapter key={it.album_id} it={it} />)}
          </HomeStrip>
        ) :
        <Skeleton />}
    </section>
  )
}
