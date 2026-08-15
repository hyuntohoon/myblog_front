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
 * spotifyPlayback.getStreamingToken). A 401 (hourly token expiry in a stale
 * tab) refreshes once via `refreshAccessToken()` and retries — refresh
 * failure stays hidden, never redirects.
 *
 * Degradation is strict (NewReleasesCard contract): logged out, fetch failure,
 * non-200, or 0 items renders NOTHING — no skeleton, no reserved space.
 */
import type { components } from '@lib/api.gen'
import { useEffect, useState } from 'react'
import { prefetchAlbumDetail } from '@lib/albumDetail'
import { getAuthHeader, isLoggedIn, refreshAccessToken } from '@lib/auth'
import { artistHref, openAlbum } from '@lib/entityLinks'
import type { AlbumCardData } from '@components/shared/AlbumCard'
import { unresolvedAlbumCardData } from '@components/shared/AlbumCard'
import HomeStrip from './HomeStrip'
import { CatalogAlbumCardAdapter } from '@components/shared/CatalogAlbumCardAdapter'
import { SectionTitle } from './ui'

type ReleaseFeedItem = components['schemas']['Backend_ReleaseFeedItem']
type ReleaseFeedResponse = components['schemas']['Backend_ReleaseFeedResponse']

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string | undefined
const LIMIT = 12

// Hover / scroll states inline styles can't reach. Scoped to `.fyr-mod`
// (same strip idiom as NewReleasesCard's `.nrl-mod`).
const SCOPED_CSS = `
.fyr-mod .fyr-card{flex:0 0 auto;width:clamp(128px,32vw,150px);scroll-snap-align:start;min-width:0}
.fyr-mod .fyr-card>.album-card{width:100%}
.fyr-mod .fyr-card .album-card__byline{margin-top:2px}
.fyr-mod .fyr-card .album-card__secondary{margin-top:3px;color:var(--color-faded)}
.fyr-mod .fyr-radar{color:var(--color-faded);text-decoration:none;transition:color .15s}
.fyr-mod .fyr-radar:hover{color:var(--color-accent)}
.fyr-mod .fyr-radar:focus-visible{outline:2px solid var(--color-accent);outline-offset:2px;border-radius:2px}
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

/**
 * Home adapter for the member release feed. A Spotify-only/unmatched release
 * still renders its full identity, but receives no `open` capability: the
 * album overlay requires a catalog id and the legacy card was intentionally
 * static in this state.
 */
export function ForYouReleaseAlbumCardAdapter({ it }: { it: ReleaseFeedItem }) {
	const year = Number(it.release_date.slice(0, 4)) || null
	const display = {
		title: it.title,
		artist: it.artist_name,
		artistId: it.artist_id,
		cover: it.cover_url ?? null,
		// The full date/type label remains below; avoid a duplicate year.
		year: null,
	}
	const data: AlbumCardData = it.album_id ?
		{ ...display, catalogAlbumId: it.album_id, spotifyAlbumId: null } :
		it.spotify_album_id ?
			unresolvedAlbumCardData(it.spotify_album_id, display) :
			{ ...display, catalogAlbumId: null, spotifyAlbumId: null }
	const open = it.album_id ?
		() => openAlbum({
			albumId: it.album_id!,
			title: it.title,
			artist: it.artist_name,
			cover: it.cover_url ?? undefined,
			year,
		}) :
		undefined

	return (
		<div
			className="fyr-card"
			title={open ? `${it.title} · 앨범 보기` : undefined}
			onPointerEnter={(event) => {
				if (it.album_id && (event.target as Element).closest('.album-card__open-hit'))
					prefetchAlbumDetail(it.album_id)
			}}
			onFocusCapture={(event) => {
				if (it.album_id && (event.target as Element).closest('.album-card__open-hit'))
					prefetchAlbumDetail(it.album_id)
			}}
		>
			<CatalogAlbumCardAdapter
				data={data}
				layout="grid"
				capabilities={{
					...(open ? { open } : {}),
					artistOpen: () => window.location.assign(artistHref(it.artist_id)),
				}}
				secondaryLine={(
					<span className="mono" style={{ fontSize: 10.5, letterSpacing: '.03em' }}>{dateLabel(it)}</span>
				)}
			/>
		</div>
	)
}

export default function ForYouReleasesCard() {
	const [items, setItems] = useState<ReleaseFeedItem[] | null>(null)

	useEffect(() => {
		if (!BASE || !isLoggedIn())
			return
		let alive = true
		const url = `${BASE}/api/me/release-feed?state=recent`
		const load = async () => {
			let res = await fetch(url, { headers: { ...getAuthHeader() } })
			// Stale-tab seam: access tokens expire hourly, and this strip
			// deliberately bypasses apiFetch (a passive strip must never
			// navigate). Without a retry the strip silently vanishes on any
			// tab older than the token — refresh once and re-fetch; on refresh
			// failure stay hidden, still no redirect.
			if (res.status === 401) {
				const refreshed = await refreshAccessToken()
				if (!refreshed)
					return
				res = await fetch(url, { headers: { Authorization: `Bearer ${refreshed}` } })
			}
			if (!res.ok)
				return
			const j = await res.json() as ReleaseFeedResponse
			if (alive && j && Array.isArray(j.recent) && j.recent.length > 0)
				setItems(j.recent.slice(0, LIMIT))
		}
		load().catch(() => {}) // hidden on failure — home keeps its prior layout
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
					{items.map(it => <ForYouReleaseAlbumCardAdapter key={`${it.artist_id}-${it.release_date}-${it.title}`} it={it} />)}
				</HomeStrip>
			</div>
		</section>
	)
}
