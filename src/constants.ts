// src/constants.ts

/** Site metadata (필요 최소) */
export const SITE: Record<string, string> = {
	url: 'https://www.ratemymusic.blog',
	title: 'buckit',
	titleDefault: 'buckit',
	description: '앨범을 끝까지 듣고 쓰는 개인 음악 평론지 buckit — 음악을 듣고 · 쓰고 · 모으다. 정직한 앨범 평론과 장르별 탐색, 직접 고른 명반 컬렉션을 기록합니다.',
	lang: 'ko-KR',
	defaultOgImage: '', // no default OG asset yet — emit og:image only when a page supplies one (avoids 404 to /og-image.png)
	defaultAuthor: 'hyuntohoon',
}

interface Header {
	internal: Array<{ title: string, url: string }>
	external: Array<{
		title: string
		url: string
		props?: Record<string, unknown>
	}>
}

/** Header nav — public links only. Write is injected by header.astro (auth-controlled) */
export const HEADER: Header = {
	internal: [
		{ title: 'Reviews', url: '/reviews' },
		{ title: 'Best New Music', url: '/reviews?bnm=1' },
	],
	external: [],
}

/** Skip nav target id */
export const SKIP_NAV_ID = 'skip-to-content'

/** Markdown aside block types */
export type AsideType = 'note' | 'tip' | 'caution' | 'danger'
export const ASIDE_TYPES = ['note', 'tip', 'caution', 'danger'] as const satisfies readonly AsideType[]

/** Blog post tags: display name → URL slug */
export type FrontmatterTag = string
export const FRONTMATTER_TAGS = new Map<FrontmatterTag, string>()
