/**
 * "나를 위한 새 앨범" — latest releases from the member's tracked artists
 * (FEAT-for-you-releases Step 1; Spotify "New Releases for You" analog).
 * Sits directly below the catalog-wide 새 앨범 strip; personalized where that
 * one is global.
 *
 * Data: GET /api/me/release-feed?state=recent (backend, member-authed) — the
 * tracked-artist feed's recent bucket (30d, newest-first, albums + singles/EPs
 * soft-grouped by source). Items enriched with catalog album_id + cover_url
 * where the confirmed Spotify album exists in the catalog; covers without a
 * catalog album render the label fallback and don't open the overlay.
 *
 * Auth: `isLoggedIn()` gate + plain fetch with `getAuthHeader()` — NOT
 * `apiFetch`, whose failed-refresh path redirects to login; a passive home
 * strip must never navigate the page away (same seam rationale as
 * spotifyPlayback.getStreamingToken).
 *
 * Degradation is strict (NewReleasesCard contract): logged out, fetch failure,
 * non-200, or 0 items renders NOTHING — no skeleton, no reserved space.
 */
import type { components } from '@lib/api.gen'
import { useEffect, useState } from 'react'
import { prefetchAlbumDetail } from '@lib/albumDetail'
import { getAuthHeader, isLoggedIn } from '@lib/auth'
import { artistHref, openAlbum } from '@lib/entityLinks'
import HomeStrip from './HomeStrip'
import { Cover, SectionTitle } from './ui'

type ReleaseFeedItem = components['schemas']['Backend_ReleaseFeedItem']
type ReleaseFeedResponse = components['schemas']['Backend_ReleaseFeedResponse']

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string | undefined
const LIMIT = 12

// Hover / scroll states inline styles can't reach. Scoped to `.fyr-mod`
// (same strip idiom as NewReleasesCard's `.nrl-mod`).
const SCOPED_CSS = `
.fyr-mod .fyr-card{flex:0 0 auto;width:clamp(128px,32vw,150px);scroll-snap-align:start;min-width:0}
.fyr-mod .fyr-open{display:block;width:100%;text-align:left;background:none;border:0;padding:0;cursor:pointer;color:inherit;font:inherit}
.fyr-mod .fyr-static{display:block;width:100%;text-align:left;color:inherit}
.fyr-mod .fyr-cover-wrap{position:relative;display:block;transition:transform .18s}
.fyr-mod .fyr-open:hover .fyr-cover-wrap{transform:translateY(-3px)}
.fyr-mod .fyr-open:focus-visible{outline:2px solid var(--color-accent);outline-offset:3px;border-radius:6px}
.fyr-mod .fyr-title{display:block;margin:9px 0 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color .16s}
.fyr-mod .fyr-open:hover .fyr-title{color:var(--color-accent)}
.fyr-mod .fyr-artist{display:inline-block;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom;color:var(--color-subtle);text-decoration:none}
.fyr-mod a.fyr-artist:hover{color:var(--color-text);text-decoration:underline}
.fyr-mod .fyr-date{display:block;margin-top:3px;color:var(--color-faded)}
.fyr-mod .fyr-radar{color:var(--color-faded);text-decoration:none;transition:color .15s}
.fyr-mod .fyr-radar:hover{color:var(--color-accent)}
.fyr-mod .fyr-radar:focus-visible{outline:2px solid var(--color-accent);outline-offset:2px;border-radius:2px}
@media (prefers-reduced-motion:reduce){.fyr-mod .fyr-cover-wrap{transition:none}}
`

function pad(n: number) {
	return String(n).padStart(2, '0')
}

/** "YYYY-MM-DD" → "MM.DD 발매" (+ release-type tag for singles/EPs). */
function dateLabel(it: ReleaseFeedItem): string {
	const m = Number(it.release_date.slice(5, 7))
	const d = Number(it.release_date.slice(8, 10))
	if (!m || !d)
		return ''
	const type = it.release_type === 'single' ? ' · 싱글' : it.release_type === 'ep' ? ' · EP' : ''
	return `${pad(m)}.${pad(d)} 발매${type}`
}

function CardItem({ it }: { it: ReleaseFeedItem }) {
	const year = Number(it.release_date.slice(0, 4)) || null
	const cover = (
		<>
			<span className="fyr-cover-wrap">
				<Cover label={it.title} src={it.cover_url ?? null} square radius={4} />
			</span>
			<span className="fyr-title serif italic" style={{ fontSize: 15.5, fontWeight: 500, lineHeight: 1.15, color: 'var(--color-text)' }}>{it.title}</span>
		</>
	)
	return (
		<article className="fyr-card">
			{it.album_id ?
				(
					<button
						type="button"
						className="fyr-open"
						title={`${it.title} · 앨범 보기`}
						aria-label={`${it.title} — ${it.artist_name} 앨범 보기`}
						onPointerEnter={() => prefetchAlbumDetail(it.album_id!)}
						onFocus={() => prefetchAlbumDetail(it.album_id!)}
						onClick={() => openAlbum({ albumId: it.album_id!, title: it.title, artist: it.artist_name, cover: it.cover_url ?? undefined, year })}
					>
						{cover}
					</button>
				) :
				<span className="fyr-static">{cover}</span>}
			<a className="fyr-artist mono" style={{ fontSize: 11.5, letterSpacing: '.02em' }} href={artistHref(it.artist_id)} title={`${it.artist_name} 아티스트`}>{it.artist_name}</a>
			<span className="fyr-date mono" style={{ fontSize: 10.5, letterSpacing: '.03em' }}>{dateLabel(it)}</span>
		</article>
	)
}

export default function ForYouReleasesCard() {
	const [items, setItems] = useState<ReleaseFeedItem[] | null>(null)

	useEffect(() => {
		if (!BASE || !isLoggedIn())
			return
		let alive = true
		fetch(`${BASE}/api/me/release-feed?state=recent`, { headers: { ...getAuthHeader() } })
			.then(r => (r.ok ? r.json() as Promise<ReleaseFeedResponse> : null))
			.then((j) => {
				if (alive && j && Array.isArray(j.recent) && j.recent.length > 0)
					setItems(j.recent.slice(0, LIMIT))
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
		<section className="fyr-mod">
			<style>{SCOPED_CSS}</style>
			<div style={{ maxWidth: 'var(--home-measure)', margin: '0 auto', padding: '56px clamp(16px, 4vw, 30px) 0' }}>
				<SectionTitle
					kicker="FOR YOU · 팔로우 아티스트"
					title="나를 위한 새 앨범"
					right={(
						// Entry point to the personal radar (tracked-artist management
						// lives there). Inside this component so it inherits the
						// degradation contract — no card, no link.
						<a className="fyr-radar mono" style={{ fontSize: 11, letterSpacing: '.06em', whiteSpace: 'nowrap' }} href="/radar/">레이더 →</a>
					)}
				/>
				<HomeStrip>
					{items.map(it => <CardItem key={`${it.artist_id}-${it.release_date}-${it.title}`} it={it} />)}
				</HomeStrip>
			</div>
		</section>
	)
}
