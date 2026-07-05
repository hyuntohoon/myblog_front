// astro.config.mjs
import mdx from '@astrojs/mdx'
import react from '@astrojs/react'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import AstroPWA from '@vite-pwa/astro'
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
	build: { format: 'directory' },
	site: SITE.url,

	integrations: [
		expressiveCode(),
		mdx(),
		sitemap({
			// Exclude the legacy /blog/* redirect stubs (noindex) from the sitemap;
			// the real review pages live at /review/* (FEAT-blog-to-review-migration).
			filter: page => !/\/(?:drafts|write|admin|test|blog)\//.test(page),
		}),
		react(),
		// FEAT-mobile-web-app Step 4 — installable PWA. Cache policy (RFC OQ3):
		// precache = app shell (home + reviews index HTML, hashed assets) only;
		// runtime = visited /review/* HTML (NetworkFirst, small cap) + covers
		// (SWR, capped). /api/* is NEVER cached: no runtimeCaching entry matches
		// it, precache can't contain it, and navigateFallback stays off (MPA —
		// an app-shell fallback would serve home for every offline route).
		// Rollback: deploy a kill-switch SW (self.registration.unregister()),
		// never plain removal — see RFC Step 4.
		AstroPWA({
			registerType: 'autoUpdate',
			manifest: {
				name: 'buckit — 음악을 듣고 · 쓰고 · 모으다',
				short_name: 'buckit',
				description: '음악 리뷰와 컬렉션 — buckit',
				lang: 'ko',
				start_url: '/',
				scope: '/',
				display: 'standalone',
				background_color: '#141312',
				theme_color: '#141312',
				icons: [
					{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
					{ src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
					{ src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
				],
			},
			workbox: {
				// Shell only — NOT '**/*.html' (the whole site would grow unbounded
				// into every client's precache as reviews accumulate).
				globPatterns: [
					'index.html',
					'reviews/index.html',
					'404.html',
					'_astro/**/*.{js,css,woff2}',
					'favicon.svg',
					'pwa-192x192.png',
					'pwa-512x512.png',
					'maskable-icon-512x512.png',
				],
				navigateFallback: null,
				runtimeCaching: [
					{
						// Visited review pages readable offline (RFC OQ3: small cap).
						// Same-origin path match only — a bare /\/review\//-style regex
						// runs against the FULL url and could catch foreign origins.
						urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/review/'),
						handler: 'NetworkFirst',
						options: {
							cacheName: 'review-pages',
							expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 14 },
							cacheableResponse: { statuses: [200] },
						},
					},
					{
						// Album/artist cover art (Spotify CDN) — capped SWR.
						urlPattern: /^https:\/\/i\.scdn\.co\/.*/,
						handler: 'StaleWhileRevalidate',
						options: {
							cacheName: 'cover-images',
							expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
							cacheableResponse: { statuses: [0, 200] },
						},
					},
				],
			},
		}),
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
			PUBLIC_API_URL: envField.string({
				context: 'client',
				access: 'public',
			}),
			PUBLIC_BACKEND_API_URL: envField.string({
				context: 'client',
				access: 'public',
			}),
		},
	},

	markdown: {
		remarkPlugins: [

			[remarkSmartypants as any, { backticks: false }],
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

					properties(node: any) {
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
							],
						)
					},
				},
			],
		],
	},
})
