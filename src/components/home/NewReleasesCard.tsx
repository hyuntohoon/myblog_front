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
 * Layout stability (FIX-home-module-cls): index.astro fetches the same feed at
 * build time and passes it as `initial`, so the section ships inside the
 * static HTML — mounting it after hydration was the largest layout shift on
 * the mobile home. The runtime fetch still runs and swaps items in place
 * (every card shares one fixed geometry, so a swap moves nothing), and a
 * failed or empty runtime response keeps whatever is already on screen —
 * this module never removes itself once rendered. Only when the build-time
 * fetch also came up empty does it fall back to the old contract: render
 * NOTHING until a successful non-empty response, then insert. Accepted
 * staleness tradeoff: on cached HTML from an old build with the runtime
 * fetch failing, the "최근 30일" label can sit over a snapshot that many
 * days older — a stable stale strip beats a mid-read collapse.
 *
 * The `★ 평론` accent chip marks a release by an artist this site has
 * reviewed (`reviewed_artist`), echoing the hero's ★ Best New Music mark.
 */
import type { components } from '@lib/api.gen'
import { useEffect, useState } from 'react'
import { prefetchAlbumDetail } from '@lib/albumDetail'
import { artistHref, openAlbum } from '@lib/entityLinks'
import HomeStrip from './HomeStrip'
import { Cover, SectionTitle } from './ui'

type NewReleaseItem = components['schemas']['Music_NewReleaseItem']
type NewReleasesResult = components['schemas']['Music_NewReleasesResult']

// Shared with index.astro's build-time fetch so both requests stay identical.
export const NRL_WINDOW_DAYS = 30
export const NRL_LIMIT = 12

// Hover / scroll states inline styles can't reach. Scoped to `.nrl-mod`
// (same strip idiom as TodayAlbumBuckit's `.otd-mod`).
const SCOPED_CSS = `
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
.nrl-mod .nrl-cal{color:var(--color-faded);text-decoration:none;transition:color .15s}
.nrl-mod .nrl-cal:hover{color:var(--color-accent)}
.nrl-mod .nrl-cal:focus-visible{outline:2px solid var(--color-accent);outline-offset:2px;border-radius:2px}
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
				{/* Decorative: the album art repeats the title rendered just below, and
				    when `cover_url` is null Cover falls back to 2-letter initials that
				    land INSIDE the button as visible text ("RE" + "Reality Awaits"),
				    which is not contained in aria-label — WCAG 2.5.3 (audit E-4).
				    Hiding it makes the button's visible text exactly the title, cover
				    or no cover. */}
				<span className="nrl-cover-wrap" aria-hidden="true">
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

export default function NewReleasesCard({ initial }: { initial?: NewReleaseItem[] }) {
	// Seeded from the build-time snapshot (SSR renders the full strip); the
	// runtime fetch below only ever replaces items in place.
	const [items, setItems] = useState<NewReleaseItem[] | null>(initial && initial.length > 0 ? initial : null)

	useEffect(() => {
		let alive = true
		const base = import.meta.env.PUBLIC_API_URL as string
		fetch(`${base}/api/music/feed/new-releases?days=${NRL_WINDOW_DAYS}&limit=${NRL_LIMIT}`)
			.then(r => (r.ok ? r.json() as Promise<NewReleasesResult> : null))
			.then((j) => {
				if (alive && j && Array.isArray(j.items) && j.items.length > 0)
					setItems(j.items)
			})
			.catch(() => {}) // keep whatever is on screen — never remove a rendered strip
		return () => {
			alive = false
		}
	}, [])

	// Nothing from build AND nothing from runtime yet: render NOTHING (legacy
	// degradation — the home keeps its prior layout rather than a dead skeleton).
	if (!items)
		return null

	return (
		<section className="nrl-mod">
			<style>{SCOPED_CSS}</style>
			<div style={{ maxWidth: 'var(--home-measure)', margin: '0 auto', padding: '56px clamp(16px, 4vw, 30px) 0' }}>
				<SectionTitle
					kicker={`NEW · 최근 ${NRL_WINDOW_DAYS}일`}
					title="새 앨범"
					right={(
						// Entry point to /releases/ (FEAT-release-calendar Step 7). Lives
						// inside this component so it inherits the degradation contract —
						// no card, no link.
						<a className="nrl-cal mono" style={{ fontSize: 11, letterSpacing: '.06em', whiteSpace: 'nowrap' }} href="/releases/">캘린더 →</a>
					)}
				/>
				<HomeStrip>
					{items.map(it => <CardItem key={it.album_id} it={it} />)}
				</HomeStrip>
			</div>
		</section>
	)
}
