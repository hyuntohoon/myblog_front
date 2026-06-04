/**
 * Member dashboard data adapter (Step 1, frontend shell).
 *
 * The single seam between the dashboard islands and their data. Today:
 *   - REVIEWS + profile STATS are real (derived from the blog content
 *     collection, server-side in profile.astro).
 *   - everything else returns SAMPLE data (lib/member.sample.ts), shown with a
 *     "샘플" badge in the UI.
 *
 * Later RFC steps replace each `getX()` below with a real `apiFetch` call; the
 * islands import only from here, so they don't change. See
 * docs/rfcs/FEAT-member-dashboard.md.
 */
import * as sample from './member.sample'

export type { BucketNode, DistItem, LibraryStatus, NowPlaying, SampleAlbum, SampleTrack } from './member.sample'

export type MemberReviewType = '앨범 리뷰' | '칼럼' | '트랙 리뷰'

/** JSON-safe review shape passed from profile.astro to the island. */
export interface MemberReview {
	slug: string
	type: MemberReviewType
	/** Album title (or column headline). */
	album: string
	artist: string
	genre: string
	year: number | null
	/** Canonical 0–5 scale; null when unrated (columns). */
	rating: number | null
	/** ISO date string. */
	date: string
	excerpt: string
	cover: string | null
	/**
	 * DB album ids this post reviews (frontmatter). Lets the 라이브러리 reviewed
	 *  drawer correlate a reviewed album → its review pages (FEAT-member-dashboard
	 *  Step 2, D20). Empty for columns.
	 */
	albumIds: string[]
}

/** What the album-detail slide-over needs; emitted by any `onOpen` handler. */
export interface DetailTarget {
	album: string
	artist?: string
	track?: string
	genre?: string
	year?: number | null
	rating?: number | null
	/**
	 * Real-album marker. When true the slide-over renders the real metadata below
	 *  (cover, title, artist, year) and omits the sample tracklist/tags/"샘플" badge.
	 *  Set by surfaces backed by a real API (e.g. 최근 들은 앨범); sample placeholders
	 *  leave it unset and keep the sample slide-over.
	 */
	real?: boolean
	/** Real DB album id (when `real`). */
	albumId?: string
	/** Real cover image URL (when `real`); null falls back to the letter tile. */
	cover?: string | null
}

export interface MemberProfile {
	name: string
	handle: string
	tagline: string
	joined: string
	location: string
	stats: { reviews: number, albums: number, avgRating: number | null }
}

/**
 * Identity shown in the profile header. Single-author for now; multi-user
 *  accounts (FEAT-member-dashboard Step 6) will source this per-user.
 */
export const MEMBER_IDENTITY = {
	name: '김저음',
	handle: 'lowfreq',
	tagline: '베이스가 방을 흔들지 않으면 듣지 않는다.',
	joined: '2021.03',
	location: '서울',
} as const

export const REVIEW_TYPES: readonly ('전체' | MemberReviewType)[] = ['전체', '앨범 리뷰', '칼럼', '트랙 리뷰']

/**
 * Build profile stats from the (real) review list. Follower/following/list
 *  counts are intentionally absent — social needs the multi-user model.
 */
export function computeStats(reviews: MemberReview[]): MemberProfile['stats'] {
	const rated = reviews.filter(r => r.rating != null)
	const albums = new Set(reviews.filter(r => r.type !== '칼럼').map(r => `${r.album}|${r.artist}`))
	const avg = rated.length === 0 ? null : rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length
	return {
		reviews: reviews.length,
		albums: albums.size,
		avgRating: avg == null ? null : Math.round(avg * 10) / 10,
	}
}

/* ── sample-backed getters (the swap seam) ──────────────────────────────── */
export const SAMPLE_NOTICE = '샘플'
export const getNowPlaying = (): sample.NowPlaying => sample.NOW_PLAYING
export const getRecentAlbums = (): sample.SampleAlbum[] => sample.RECENT_ALBUMS
export const getRecentTracks = (): sample.SampleTrack[] => sample.RECENT_TRACKS
export const getLibrary = (): sample.SampleAlbum[] => sample.LIBRARY.map(a => ({ ...a }))
export const getGenres = (): sample.DistItem[] => sample.GENRES
export const getArtists = (): sample.DistItem[] => sample.ARTISTS
export const getActivity = (): number[] => sample.ACTIVITY
export const getBucketsInit = (): sample.BucketNode[] => sample.bucketsInit()
export const ADD_POOL = sample.ADD_POOL
export const albumDetail = sample.albumDetail

/* localStorage keys (Step 1 persistence; superseded by backend in later steps). */
export const BUCKETS_KEY = 'lf_buckets'
export const LIBRARY_KEY = 'lf_library'
export const OV_ROWS_KEY = 'lf_ov_rows'
export const OV_VIEWS_KEY = 'lf_ov_views'

/**
 * Count of albums across the (sample) nested bucket tree, read from
 *  localStorage so the overview shortcut matches the bucket tab.
 */
export function bucketCount(): number {
	let tree: sample.BucketNode[] | null = null
	try {
		const raw = localStorage.getItem(BUCKETS_KEY)
		if (raw)
			tree = JSON.parse(raw)
	}
	catch { /* ignore */ }
	if (!Array.isArray(tree))
		tree = sample.bucketsInit()
	let n = 0
	const walk = (arr: sample.BucketNode[]) => arr.forEach((b) => {
		n += b.albums.length
		walk(b.children)
	})
	walk(tree)
	return n
}
