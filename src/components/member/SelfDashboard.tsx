// /members/[handle] self-view dashboard — profile→member merge PR1+PR2 (OQ5
// Option 1). Re-hosts the /profile tabs 개요 / 평론 / My Buckit / 분석 버킷 /
// 연동 on the member page when the AUTHED /api/me handle matches the page
// handle. MemberProfile gates the mount AND loads this module via React.lazy,
// so a logged-out visitor never downloads these dashboard chunks (privacy gate
// is the authed check; the lazy import is the bundle guard).
//
// 평론 data (PR2) is runtime-sourced, split by who the member is:
//   - owner (handle === OWNER_HANDLE): the blog 평론 live in the build-time
//     content collection → fetched from the prerendered /profile-reviews.json
//     (same MemberReview[] the /profile island gets as props). Fetched lazily
//     here — this module only mounts after the authed self check — so the
//     public bundle/waterfall doesn't grow.
//   - any other member: their 평가 rows (already fetched by MemberProfile via
//     GET /api/members/{handle}) are mapped to a minimal MemberReview shape.
//     Those rows have no MDX post behind them → slug stays '' and ReviewsTab /
//     AlbumDetail degrade their post-linked actions (보기 → album overlay; no
//     수정/삭제).
//
// Deliberately excluded until PR3: lyrics viewer/sheet overlays (the dock).
// No onOpenLyrics is passed, and NowPlaying / LikedBoard / AlbumDetail hide
// their 가사 entries when the handler is absent, so nothing renders dead.
import type { DetailTarget, MemberReview } from '@lib/member'
import type { ReactNode } from 'react'
import type { MemberReview as PublicMemberReview } from '../album/reviews.api'
import type { NpStyle } from './NowPlaying'
import { useEffect, useMemo, useRef, useState } from 'react'
import { OWNER_HANDLE } from '@lib/member'
import { AlbumDetail } from './AlbumDetail'
import { BucketBoard } from './BucketBoard'
import { DENSITY_KEY, DENSITY_OPTS, NP_STYLE_KEY, NP_STYLE_OPTS, readPref, TabPanel } from './dashboardShared'
import { OverviewDash } from './OverviewDash'
import { ReviewsTab } from './ReviewsTab'
import { SpotifyIntegrationTab } from './SpotifyIntegrationTab'
import { StatsTab } from './StatsTab'
import '@styles/member.css'
import '@styles/research.css'

// Stable empty list so downstream useMemo deps don't churn per render while
// the owner JSON (or the public profile feed) is still loading.
const NO_REVIEWS: MemberReview[] = []

/**
 * Map one public album-review row (GET /api/members/{handle}) to the minimal
 * MemberReview the dashboard consumers tolerate. No MDX post behind it →
 * slug '' + no postId, which the consumers treat as "review without a post
 * page" (ReviewsTab degrades 보기/수정/삭제; AlbumDetail's 발행 배너 shows the
 * rating but no 평론 보기 link).
 */
function toMemberReview(r: PublicMemberReview): MemberReview {
	return {
		slug: '',
		type: '앨범 리뷰',
		album: r.album_title,
		artist: '',
		genre: '',
		year: null,
		rating: Number(r.rating),
		date: r.created_at,
		excerpt: r.comment ?? '',
		cover: r.album_cover_url ?? null,
		albumIds: [r.album_id],
	}
}

/**
 * `tab` is the active dashboard tab id (overview|reviews|bucket|stats|
 * integration) or null while a non-dashboard view (the public 평가 list) is
 * showing — panels stay mounted but hidden, mirroring ProfileApp's keep-alive
 * behavior. `handle` is the page handle MemberProfile already proved equal to
 * the authed getMe().handle; `publicReviews` is the member's public feed it
 * already fetched (undefined while loading).
 */
export default function SelfDashboard({ handle, publicReviews, tab, onSelectTab }: { handle: string, publicReviews?: PublicMemberReview[], tab: string | null, onSelectTab: (id: string) => void }) {
	// Tabs visited at least once — mounted lazily on first visit, then kept
	// mounted (hidden, not unmounted) so a re-visit never refetches.
	const [visited, setVisited] = useState<Set<string>>(() => new Set(tab ? [tab] : []))
	useEffect(() => {
		if (!tab)
			return
		setVisited((v) => {
			if (v.has(tab))
				return v
			const next = new Set(v)
			next.add(tab)
			return next
		})
	}, [tab])

	// PR2 — runtime 평론. Owner: fetch the prerendered JSON once (this module
	// mounts only after the authed self check, so the fetch is inherently
	// self-gated; the JSON itself is public build output). Any failure → empty
	// list, same fail-safe as an empty collection.
	const isOwner = handle === OWNER_HANDLE
	const [ownerReviews, setOwnerReviews] = useState<MemberReview[] | null>(null)
	useEffect(() => {
		if (!isOwner)
			return
		let alive = true
		fetch('/profile-reviews.json')
			.then(res => (res.ok ? res.json() : []))
			.then((data) => {
				if (alive)
					setOwnerReviews(Array.isArray(data) ? data : [])
			})
			.catch(() => {
				if (alive)
					setOwnerReviews([])
			})
		return () => {
			alive = false
		}
	}, [isOwner])
	const reviews = useMemo<MemberReview[]>(() => {
		if (isOwner)
			return ownerReviews ?? NO_REVIEWS
		return publicReviews?.length ? publicReviews.map(toMemberReview) : NO_REVIEWS
	}, [isOwner, ownerReviews, publicReviews])

	const [npStyle, setNpStyle] = useState<NpStyle>(() => readPref(NP_STYLE_KEY, NP_STYLE_OPTS, 'banner'))
	useEffect(() => {
		try {
			localStorage.setItem(NP_STYLE_KEY, npStyle)
		}
		catch { /* ignore */ }
	}, [npStyle])
	// Same density the member set on /profile; read-only here (no settings menu
	// on the member page in PR1 — the ⚙ layout machinery stays on /profile).
	const [density] = useState(() => readPref(DENSITY_KEY, DENSITY_OPTS.map(o => o.v), 'regular'))

	const [detail, setDetail] = useState<DetailTarget | null>(null)
	// Latest in-session memo edits keyed by bucket-item id — same stale-snapshot
	// merge as ProfileApp (see its memoEdits comment / AlbumDetail.useBucketMemo).
	const memoEdits = useRef<Map<string, { note: string | null, prepTonight: boolean }>>(new Map())
	const onMemoSaved = (itemId: string, memo: { note: string | null, prepTonight: boolean }) => {
		memoEdits.current.set(itemId, memo)
	}
	const openDetail = (a: DetailTarget) => {
		const edit = a.itemId ? memoEdits.current.get(a.itemId) : undefined
		setDetail(edit ? { ...a, note: edit.note, prepTonight: edit.prepTonight } : a)
	}

	const panels: { id: string, node: ReactNode }[] = [
		{ id: 'overview', node: <OverviewDash npStyle={npStyle} setNpStyle={setNpStyle} onOpen={openDetail} goBucket={() => onSelectTab('bucket')} reviews={reviews} /> },
		{ id: 'reviews', node: <ReviewsTab reviews={reviews} onOpen={openDetail} /> },
		{ id: 'bucket', node: <BucketBoard onOpen={openDetail} reviews={reviews} active={tab === 'bucket'} /> },
		{ id: 'stats', node: <StatsTab onOpen={openDetail} /> },
		{ id: 'integration', node: <SpotifyIntegrationTab /> },
	]

	return (
		<div className="member-root" data-density={density} style={{ marginTop: 26 }}>
			{panels.map(p => (
				visited.has(p.id) ?
					<TabPanel key={p.id} active={p.id === tab}>{p.node}</TabPanel> :
					null
			))}
			{detail && <AlbumDetail album={detail} reviews={reviews} onClose={() => setDetail(null)} onMemoSaved={onMemoSaved} />}
		</div>
	)
}
