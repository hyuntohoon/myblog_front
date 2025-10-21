// src/constants.ts
type MapKey<T extends Map<any, any>> = T extends Map<infer K, any> ? K : never

/** Site metadata (필요 최소) */
export const SITE: Record<string, string> = {
	url: 'http://localhost:4321', // RSS 등에서 사용
	title: 'Test Blog',
	titleDefault: 'Astro Theme: Minimal Blog',
	lang: 'en-US',
	defaultOgImage: '/og-image.png',
	defaultAuthor: 'LekoArts',
}

interface Header {
	internal: Array<{ title: string; url: string }>
	external: Array<{
		title: string
		url: string
		props?: Record<string, unknown>
	}>
}

/** Header nav (Blog/Write만) */
export const HEADER: Header = {
	internal: [
		{ title: 'Blog', url: '/blog/' },
		{ title: 'Write', url: '/write/' },
	],
	external: [],
}

/** Skip nav target id */
export const SKIP_NAV_ID = 'skip-to-content'
