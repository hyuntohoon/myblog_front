/**
 * "새 앨범" — new releases from the music catalog's last 30 days
 * (FEAT-release-calendar Track A Step 2). A DB-only public read of
 * GET /api/music/feed/new-releases (myblog_music); a horizontal cover strip
 * sitting between the Best New Music hero and 최신 평론 (owner placement
 * decision 2026-07-12).
 *
 * Clicking a cover opens the app-wide read-only album overlay
 * (ARCH-entity-interaction-unify · openAlbum — the AlbumOverlay host is
 * mounted in layout.astro, so no extra island is needed on home); the artist
 * name routes to the artist hub (artistHref). Covers prefetch album detail on
 * pointer intent (lib/albumDetail) so the overlay opens warm.
 *
 * Degradation is strict for this module: fetch failure, non-200, or 0 items
 * renders NOTHING — no skeleton, no reserved space (the Measure wrapper lives
 * inside this component so a null render leaves the home layout untouched).
 *
 * The `★ 평론` accent chip marks a release by an artist this site has
 * reviewed (`reviewed_artist`), echoing the hero's ★ Best New Music mark.
 */
import type { components } from '@lib/api.gen'
import { useEffect, useState } from 'react'
import { prefetchAlbumDetail } from '@lib/albumDetail'
import { artistHref, openAlbum } from '@lib/entityLinks'
import { Cover, SectionTitle } from './ui'

type NewReleaseItem = components['schemas']['Music_NewReleaseItem']
type NewReleasesResult = components['schemas']['Music_NewReleasesResult']

const WINDOW_DAYS = 30
const LIMIT = 12

// Hover / scroll states inline styles can't reach. Scoped to `.nrl-mod`
// (same strip idiom as TodayAlbumBuckit's `.otd-mod`).
const SCOPED_CSS = `
.nrl-mod .nrl-strip{display:flex;gap:clamp(14px,2vw,20px);overflow-x:auto;scroll-snap-type:x proximity;padding:2px 2px 14px;margin:0 -2px;scrollbar-width:none}
.nrl-mod .nrl-strip::-webkit-scrollbar{height:0}
.nrl-mod .nrl-card{flex:0 0 auto;width:clamp(128px,32vw,150px);scroll-snap-align:start;min-width:0}
.nrl-mod .nrl-open{display:block;width:100%;text-align:left;background:none;border:0;padding:0;cursor:pointer;color:inherit;font:inherit}
.nrl-mod .nrl-cover-wrap{position:relative;display:block;transition:transform .18s}
.nrl-mod .nrl-open:hover .nrl-cover-wrap{transform:translateY(-3px)}
.nrl-mod .nrl-open:focus-visible{outline:2px solid var(--color-accent);outline-offset:3px;border-radius:6px}
.nrl-mod .nrl-rev{position:absolute;left:7px;bottom:7px;padding:3px 7px;border-radius:999px;background:var(--color-accent);color:#fff;box-shadow:0 1px 3px rgba(0,0,0,.22)}
.nrl-mod .nrl-title{display:block;margin:9px 0 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color .16s}
.nrl-mod .nrl-open:hover .nrl-title{color:var(--color-accent)}
.nrl-mod .nrl-artist{display:inline-block;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom;color:var(--color-subtle);text-decoration:none}
.nrl-mod a.nrl-artist:hover{color:var(--color-text);text-decoration:underline}
.nrl-mod .nrl-date{display:block;margin-top:3px;color:var(--color-faded)}
@media (prefers-reduced-motion:reduce){.nrl-mod .nrl-cover-wrap{transition:none}}
`

function pad(n: number) {
	return String(n).padStart(2, '0')
}

/** "YYYY-MM-DD" → "MM.DD 발매" (a 30-day window never needs the year). */
function dateLabel(iso: string): string {
	const m = Number(iso.slice(5, 7))
	const d = Number(iso.slice(8, 10))
	if (!m || !d)
		return ''
	return `${pad(m)}.${pad(d)} 발매`
}

function CardItem({ it }: { it: NewReleaseItem }) {
	const primary = it.artists?.[0]
	const year = Number(it.release_date.slice(0, 4)) || null
	const others = (it.artists?.length ?? 0) - 1
	const artistLabel = primary ? (others > 0 ? `${primary.name} 외 ${others}` : primary.name) : ''
	return (
		<article className="nrl-card">
			<button
				type="button"
				className="nrl-open"
				title={`${it.title} · 앨범 보기`}
				aria-label={`${it.title}${artistLabel ? ` — ${artistLabel}` : ''} 앨범 보기${it.reviewed_artist ? ' (평론한 아티스트)' : ''}`}
				onPointerEnter={() => prefetchAlbumDetail(it.album_id)}
				onFocus={() => prefetchAlbumDetail(it.album_id)}
				onClick={() => openAlbum({ albumId: it.album_id, title: it.title, artist: primary?.name, cover: it.cover_url, year })}
			>
				<span className="nrl-cover-wrap">
					<Cover label={it.title} src={it.cover_url} square radius={4} />
					{it.reviewed_artist && (
						<span className="nrl-rev mono" style={{ fontSize: 10, letterSpacing: '.04em' }} aria-hidden="true">★ 평론</span>
					)}
				</span>
				<span className="nrl-title serif italic" style={{ fontSize: 15.5, fontWeight: 500, lineHeight: 1.15, color: 'var(--color-text)' }}>{it.title}</span>
			</button>
			{primary && (primary.id ?
				<a className="nrl-artist mono" style={{ fontSize: 11.5, letterSpacing: '.02em' }} href={artistHref(primary.id)} title={`${primary.name} 아티스트`}>{artistLabel}</a> :
				<span className="nrl-artist mono" style={{ fontSize: 11.5, letterSpacing: '.02em' }}>{artistLabel}</span>)}
			<span className="nrl-date mono" style={{ fontSize: 10.5, letterSpacing: '.03em' }}>{dateLabel(it.release_date)}</span>
		</article>
	)
}

export default function NewReleasesCard() {
	const [items, setItems] = useState<NewReleaseItem[] | null>(null)

	useEffect(() => {
		let alive = true
		const base = import.meta.env.PUBLIC_API_URL as string
		fetch(`${base}/api/music/feed/new-releases?days=${WINDOW_DAYS}&limit=${LIMIT}`)
			.then(r => (r.ok ? r.json() as Promise<NewReleasesResult> : null))
			.then((j) => {
				if (alive && j && Array.isArray(j.items) && j.items.length > 0)
					setItems(j.items)
			})
			.catch(() => {}) // hidden on failure — home keeps its prior layout
		return () => {
			alive = false
		}
	}, [])

	// Render NOTHING until a successful, non-empty feed response (no skeleton —
	// the home must degrade to exactly its prior layout).
	if (!items)
		return null

	return (
		<section className="nrl-mod">
			<style>{SCOPED_CSS}</style>
			<div style={{ maxWidth: 'var(--home-measure)', margin: '0 auto', padding: '56px clamp(16px, 4vw, 30px) 0' }}>
				<SectionTitle kicker={`NEW · 최근 ${WINDOW_DAYS}일`} title="새 앨범" />
				<div className="nrl-strip">
					{items.map(it => <CardItem key={it.album_id} it={it} />)}
				</div>
			</div>
		</section>
	)
}
