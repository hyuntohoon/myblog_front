// /members/[handle] self-view dashboard — profile→member merge PR1 (OQ5
// Option 1). Re-hosts the /profile tabs 개요 / My Buckit / 분석 버킷 / 연동 on
// the member page when the AUTHED /api/me handle matches the page handle.
// MemberProfile gates the mount AND loads this module via React.lazy, so a
// logged-out visitor never downloads these dashboard chunks (privacy gate is
// the authed check; the lazy import is the bundle guard).
//
// Deliberately excluded in PR1:
//  - 평론 tab — its data is build-time getCollection('blog') and stays on
//    /profile until the PR2 runtime rebuild.
//  - Lyrics viewer/sheet overlays — the dock moves in PR3. No onOpenLyrics is
//    passed, and NowPlaying / LikedBoard / AlbumDetail hide their 가사 entries
//    when the handler is absent, so nothing renders dead.
import type { DetailTarget, MemberReview } from '@lib/member'
import type { ReactNode } from 'react'
import type { NpStyle } from './NowPlaying'
import { useEffect, useRef, useState } from 'react'
import { AlbumDetail } from './AlbumDetail'
import { BucketBoard } from './BucketBoard'
import { DENSITY_KEY, DENSITY_OPTS, NP_STYLE_KEY, NP_STYLE_OPTS, readPref, TabPanel } from './dashboardShared'
import { OverviewDash } from './OverviewDash'
import { SpotifyIntegrationTab } from './SpotifyIntegrationTab'
import { StatsTab } from './StatsTab'
import '@styles/member.css'
import '@styles/research.css'

// Runtime reviews for the member page arrive with PR2 (평론 rebuild). Until
// then the review-fed widgets (최근 평론 card, bucket review matching, the
// AlbumDetail 발행됨 link) see an empty list. Stable reference so downstream
// useMemo deps don't churn per render.
const NO_REVIEWS: MemberReview[] = []

/**
 * `tab` is the active dashboard tab id (overview|bucket|stats|integration) or
 * null while a non-dashboard view (the public 평가 list) is showing — panels
 * stay mounted but hidden, mirroring ProfileApp's keep-alive behavior.
 */
export default function SelfDashboard({ tab, onSelectTab }: { tab: string | null, onSelectTab: (id: string) => void }) {
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
		{ id: 'overview', node: <OverviewDash npStyle={npStyle} setNpStyle={setNpStyle} onOpen={openDetail} goBucket={() => onSelectTab('bucket')} reviews={NO_REVIEWS} /> },
		{ id: 'bucket', node: <BucketBoard onOpen={openDetail} reviews={NO_REVIEWS} active={tab === 'bucket'} /> },
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
			{detail && <AlbumDetail album={detail} reviews={NO_REVIEWS} onClose={() => setDetail(null)} onMemoSaved={onMemoSaved} />}
		</div>
	)
}
