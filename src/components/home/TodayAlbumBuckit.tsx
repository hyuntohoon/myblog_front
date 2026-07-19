/**
 * "오늘, 이 앨범들" — albums released on today's month/day in past years
 * (FEAT-today-buckit Step 2). A DB-only public read of
 * GET /api/music/albums/on-this-day (myblog_music); a horizontal cover strip
 * where the "N년 전" chip IS the point — the same calendar date seen back
 * through the catalog's years, newest anniversary first.
 *
 * Clicking a cover opens the app-wide read-only album overlay
 * (ARCH-entity-interaction-unify · openAlbum); the artist name routes to the
 * artist hub (artistHref). The section HIDES itself on empty/error, so the home
 * degrades to its prior layout — no runtime dependency for the rest of the page.
 *
 * Self-contained: static styling is inline (matching the home modules) and the
 * hover/scroll rules ride a single scoped <style> keyed off `.otd-mod`.
 */
import { useEffect, useState } from 'react'
import { artistHref, openAlbum } from '@lib/entityLinks'
import HomeStrip from './HomeStrip'
import { Cover, SectionTitle } from './ui'

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
.otd-mod .otd-skel{display:flex;gap:clamp(14px,2vw,20px);overflow:hidden;padding:2px 2px 14px;margin:0 -2px}
.otd-mod .otd-card{flex:0 0 auto;width:clamp(128px,32vw,150px);scroll-snap-align:start;min-width:0}
.otd-mod .otd-open{display:block;width:100%;text-align:left;background:none;border:0;padding:0;cursor:pointer;color:inherit;font:inherit}
.otd-mod .otd-cover-wrap{position:relative;display:block;transition:transform .18s}
.otd-mod .otd-open:hover .otd-cover-wrap{transform:translateY(-3px)}
.otd-mod .otd-open:focus-visible{outline:2px solid var(--color-accent);outline-offset:3px;border-radius:6px}
.otd-mod .otd-ago{position:absolute;left:7px;bottom:7px;padding:3px 7px;border-radius:999px;background:color-mix(in srgb,var(--color-bg) 82%,transparent);backdrop-filter:blur(3px);color:var(--color-text);box-shadow:0 1px 3px rgba(0,0,0,.18)}
.otd-mod .otd-title{display:block;margin:9px 0 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color .16s}
.otd-mod .otd-open:hover .otd-title{color:var(--color-accent)}
.otd-mod .otd-artist{display:inline-block;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom;color:var(--color-subtle);text-decoration:none}
.otd-mod .otd-artist:hover{color:var(--color-text);text-decoration:underline}
@media (prefers-reduced-motion:reduce){.otd-mod .otd-cover-wrap{transition:none}}
`

function Card({ it }: { it: OtdItem }) {
  const primary = it.artists[0]
  const year = Number(it.release_date.slice(0, 4)) || null
  return (
    <article className="otd-card">
      <button
	type="button"
	className="otd-open"
	title={`${it.title} · 앨범 보기`}
	onClick={() => openAlbum({ albumId: it.album_id, title: it.title, artist: primary?.name, cover: it.cover_url, year })}
      >
        <span className="otd-cover-wrap">
          <Cover label={it.title} src={it.cover_url} square radius={4} />
          <span className="otd-ago mono" style={{ fontSize: 10.5, letterSpacing: '.02em' }}>{`${it.years_ago}년 전`}</span>
        </span>
        <span className="otd-title serif italic" style={{ fontSize: 15.5, fontWeight: 500, lineHeight: 1.15, color: 'var(--color-text)' }}>{it.title}</span>
      </button>
      {primary && (primary.id ?
        <a className="otd-artist mono" style={{ fontSize: 11.5, letterSpacing: '.02em' }} href={artistHref(primary.id)} title={`${primary.name} 아티스트`}>{primary.name}</a> :
        <span className="otd-artist mono" style={{ fontSize: 11.5, letterSpacing: '.02em' }}>{primary.name}</span>)}
    </article>
  )
}

function Skeleton() {
  return (
    <div className="otd-skel" aria-hidden="true" style={{ pointerEvents: 'none' }}>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="otd-card">
          <span style={{ display: 'block', width: '100%', aspectRatio: '1 / 1', borderRadius: 4, background: 'var(--color-border-soft)' }} />
          <span style={{ display: 'block', width: '78%', height: 11, borderRadius: 3, background: 'var(--color-border-soft)', margin: '10px 0 6px' }} />
          <span style={{ display: 'block', width: '52%', height: 9, borderRadius: 3, background: 'var(--color-border-soft)' }} />
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

  // Hide on error or empty — the home degrades to its prior layout.
  if (status === 'error')
    return null
  if (status === 'ready' && (!data || data.items.length === 0))
    return null

  const dateLabel = data ? `${pad(data.month)}.${pad(data.day)}` : ''

  return (
    <section className="otd-mod">
      <style>{SCOPED_CSS}</style>
      <SectionTitle kicker={dateLabel ? `이 날 · ${dateLabel}` : '이 날, 발매'} title="오늘, 이 앨범들" />
      {status === 'loading' ?
        <Skeleton /> :
(
        <HomeStrip>
          {data!.items.map(it => <Card key={it.album_id} it={it} />)}
        </HomeStrip>
      )}
    </section>
  )
}
