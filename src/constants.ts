// src/constants.ts

/** Site metadata (필요 최소) */
export const SITE: Record<string, string> = {
	url: 'http://localhost:4321', // RSS 등에서 사용
	title: 'RAMAMU',
	titleDefault: 'Rate Your Music',
	lang: 'ko-KR',
	defaultOgImage: '/og-image.png',
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

/** Header nav (Blog/Write만) */
export const HEADER: Header = {
	internal: [
		{ title: 'Home', url: '/blog' },
		{ title: 'Write', url: '/write' },
		{ title: 'Rate', url: '/review' },
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
