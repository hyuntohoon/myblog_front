// src/pages/rss.xml.ts
import type { APIContext } from 'astro'
import rss from '@astrojs/rss'
import { getCollection } from 'astro:content'
import { SITE } from '@constants'

export const prerender = true

export async function GET(context: APIContext) {
	const posts = (await getCollection('blog'))
		.filter(e => !e.data.draft)
		.sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime())

	return rss({
		title: SITE.title,
		description: 'buckit',
		// context.site is derived from `site` in astro.config (SITE.url).
		site: context.site ?? SITE.url,
		items: posts.map(e => ({
			title: e.data.title,
			pubDate: new Date(e.data.date),
			description: e.data.description ?? '',
			link: `/blog/${e.data.slug ?? e.id}/`,
		})),
		customData: `<language>${SITE.lang}</language>`,
	})
}
