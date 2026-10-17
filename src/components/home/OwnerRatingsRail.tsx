/**
 * "최근 평가" — the owner's latest 평가 (stars + one-liner) on home
 * (FEAT-public-surfaces-before-first-review Step 2). A 평가 surface, labelled
 * as one: it never feeds the hero, 최신 평론, Canon or /reviews (owner
 * decision 2026-10-17 keeps those 평론-only).
 *
 * Source is the public GET /api/members/{OWNER_HANDLE} feed (newest first).
 * Same layout-stability contract as the 새 앨범 strip (FIX-home-module-cls):
 * index.astro seeds `initial` at build time so the rail SSRs, the runtime
 * fetch swaps items in place so a new 평가 shows up without a redeploy, and a
 * failed runtime fetch keeps whatever is on screen. A successful response
 * with zero 평가 hides the rail; with no seed and no runtime data it renders
 * NOTHING.
 */
import type { components } from '@lib/api.gen'
import { useEffect, useState } from 'react'
import { prefetchAlbumDetail } from '@lib/albumDetail'
import { artistHref, openAlbum } from '@lib/entityLinks'
import { OWNER_HANDLE } from '@lib/member'
import HomeStrip from './HomeStrip'
import { CatalogAlbumCardAdapter } from '@components/shared/CatalogAlbumCardAdapter'
import { SectionTitle, Stars } from './ui'

type MemberRating = components['schemas']['Backend_MemberRatingResponse']
type MemberProfile = components['schemas']['Backend_MemberProfileResponse']

// Shared with index.astro's build-time seed so both trim identically.
export const ORR_LIMIT = 8

export const OWNER_MEMBER_HREF = `/members/?u=${encodeURIComponent(OWNER_HANDLE)}`

// Same strip idiom as `.nrl-mod` (NewReleasesCard).
const SCOPED_CSS = `
.orr-mod .orr-card{flex:0 0 auto;width:clamp(128px,32vw,150px);scroll-snap-align:start;min-width:0}
.orr-mod .orr-card>.album-card{width:100%}
.orr-mod .orr-card .album-card__byline{margin-top:2px}
.orr-mod .orr-card .album-card__secondary{margin-top:5px;display:flex;flex-direction:column;align-items:flex-start;gap:3px}
.orr-mod .orr-line{font-size:12.5px;line-height:1.4;color:var(--color-subtle);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.orr-mod .orr-all{color:var(--color-faded);text-decoration:none;transition:color .15s}
.orr-mod .orr-all:hover{color:var(--color-accent)}
.orr-mod .orr-all:focus-visible{outline:2px solid var(--color-accent);outline-offset:2px;border-radius:2px}
`

/** Profile response → the rail's items (newest first, trimmed). */
export function ownerRatingItems(profile: MemberProfile | null | undefined): MemberRating[] | null {
	if (!profile || !Array.isArray(profile.reviews))
		return null
	return profile.reviews.slice(0, ORR_LIMIT)
}

export function OwnerRatingAlbumCardAdapter({ it }: { it: MemberRating }) {
	const open = () => openAlbum({
		albumId: it.album_id,
		title: it.album_title,
		artist: it.artist_name ?? undefined,
		cover: it.album_cover_url ?? null,
		year: null,
	})
	const comment = it.comment?.trim()

	return (
		<div
			className="orr-card"
			title={`${it.album_title} · 앨범 보기`}
			onPointerEnter={(event) => {
				if ((event.target as Element).closest('.album-card__open-hit'))
					prefetchAlbumDetail(it.album_id)
			}}
			onFocusCapture={(event) => {
				if ((event.target as Element).closest('.album-card__open-hit'))
					prefetchAlbumDetail(it.album_id)
			}}
		>
			<CatalogAlbumCardAdapter
				data={{
					catalogAlbumId: it.album_id,
					spotifyAlbumId: null,
					title: it.album_title,
					artist: it.artist_name ?? null,
					artistId: it.artist_id ?? null,
					cover: it.album_cover_url ?? null,
					year: null,
				}}
				layout="grid"
				capabilities={{
					open,
					...(it.artist_id ? { artistOpen: () => window.location.assign(artistHref(it.artist_id!)) } : {}),
				}}
				secondaryLine={(
					<>
						<Stars rating={it.rating} size={14} />
						{comment && <span className="orr-line serif">{comment}</span>}
					</>
				)}
			/>
		</div>
	)
}

export default function OwnerRatingsRail({ initial }: { initial?: MemberRating[] }) {
	const [items, setItems] = useState<MemberRating[] | null>(initial && initial.length > 0 ? initial : null)

	useEffect(() => {
		let alive = true
		const base = import.meta.env.PUBLIC_BACKEND_API_URL as string
		fetch(`${base}/api/members/${encodeURIComponent(OWNER_HANDLE)}`)
			.then(r => (r.ok ? r.json() as Promise<MemberProfile> : null))
			.then((j) => {
				const next = ownerRatingItems(j)
				if (alive && next)
					setItems(next.length > 0 ? next : null)
			})
			.catch(() => {}) // keep whatever is on screen
		return () => {
			alive = false
		}
	}, [])

	if (!items)
		return null

	return (
		<section className="orr-mod">
			<style>{SCOPED_CSS}</style>
			<div style={{ maxWidth: 'var(--home-measure)', margin: '0 auto', padding: '56px clamp(16px, 4vw, 30px) 0' }}>
				<SectionTitle
					kicker="RATINGS · 평가"
					title="최근 평가"
					right={<a className="orr-all mono" style={{ fontSize: 11, letterSpacing: '.06em', whiteSpace: 'nowrap' }} href={OWNER_MEMBER_HREF}>전체 평가 →</a>}
				/>
				<HomeStrip>
					{items.map(it => <OwnerRatingAlbumCardAdapter key={it.id} it={it} />)}
				</HomeStrip>
			</div>
		</section>
	)
}
