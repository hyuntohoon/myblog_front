// astro.config.mjs
import mdx from '@astrojs/mdx'
import react from '@astrojs/react'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { imageService } from '@unpic/astro/service'
import expressiveCode from 'astro-expressive-code'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypeExternalLinks from 'rehype-external-links'
import rehypeSlug from 'rehype-slug'
import remarkDirective from 'remark-directive'
import remarkSmartypants from 'remark-smartypants'
import { toString } from 'hast-util-to-string'
import { h, s } from 'hastscript'
import remarkSandpack from '@lekoarts/remark-sandpack'

// ✅ 여기! 정렬 규칙에 맞춰 `envField`가 `fontProviders`보다 먼저 오도록
import { defineConfig, envField, fontProviders } from 'astro/config'

import { SITE } from './src/constants'
import { remarkAsides } from './src/remark'
import { pagefindIntegration } from './src/utils'

export default defineConfig({
	experimental: {
		fonts: [
			{
				provider: fontProviders.google(),
				name: 'IBM Plex Sans',
				weights: ['400', '500', '600'],
				subsets: ['latin'],
				cssVariable: '--font-plex-sans',
			},
		],
	},
	output: 'static',
	trailingSlash: 'always',
	site: SITE.url,
	integrations: [
		expressiveCode(),
		mdx(),
		sitemap(),
		pagefindIntegration(),
		react(),
	],
	vite: {
		plugins: [tailwindcss()],
	},
	image: {
		service: imageService(),
	},
	devToolbar: { enabled: false },

	// ✅ 타입 안전 env 스키마
	env: {
		schema: {
			// 클라이언트/서버 모두 접근 가능한 공개 문자열
			API_URL: envField.string({
				context: 'client',
				access: 'public',
			}),
		},
	},

	markdown: {
		// @ts-expect-error: Astro types don't match remark plugin
		remarkPlugins: [
			[remarkSmartypants, { backticks: false }],
			remarkDirective,
			remarkAsides,
			[remarkSandpack, { componentName: ['Playground'] }],
		],
		rehypePlugins: [
			rehypeSlug,
			[
				rehypeExternalLinks,
				{
					target: '_blank',
					rel: ['nofollow'],
					content: { type: 'text', value: ' (opens in a new window)' },
					properties: { className: ['external_link'] },
					contentProperties: { className: ['sr-only'] },
				},
			],
			[
				rehypeAutolinkHeadings,
				{
					behavior: 'after',
					group() {
						return h('.markdown-heading')
					},
					headingProperties() {
						return { tabIndex: -1 }
					},
					properties(node) {
						return {
							ariaLabel: `Permalink: ${toString(node)}`,
							className: 'anchor',
						}
					},
					content() {
						return h(
							'svg',
							{
								className: 'anchor-icon',
								viewBox: '0 0 16 16',
								ariaHidden: true,
							},
							[
								s('path', {
									d: 'm7.775 3.275 1.25-1.25a3.5 3.5 0 1 1 4.95 4.95l-2.5 2.5a3.5 3.5 0 0 1-4.95 0 .751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018 1.998 1.998 0 0 0 2.83 0l2.5-2.5a2.002 2.002 0 0 0-2.83-2.83l-1.25 1.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042Zm-4.69 9.64a1.998 1.998 0 0 0 2.83 0l1.25-1.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042l-1.25 1.25a3.5 3.5 0 1 1-4.95-4.95l2.5-2.5a3.5 3.5 0 0 1 4.95 0 .751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018 1.998 1.998 0 0 0-2.83 0l-2.5 2.5a1.998 1.998 0 0 0 0 2.83Z',
								}),
							]
						)
					},
				},
			],
		],
	},
})
