// src/content/config.ts
import { glob } from 'astro/loaders'
import { defineCollection, z } from 'astro:content'
// STAB-5 Step 3: frontmatter `category` validates against the curated section
// labels (single source — `src/lib/sections.ts`), replacing the old decorative
// `categories.json` slug list. The `z.string()` fallback below keeps legacy
// frontmatter parseable, so this is a non-breaking swap.
import { SECTION_LABELS } from './lib/sections'

// zod enum에 배열을 안전하게 넣기
const zodEnum = <T>(arr: T[]): [T, ...T[]] => arr as [T, ...T[]]
const CATEGORIES = [...SECTION_LABELS]

/** ---------- 선택적: 음악 리뷰/평점 블록 ---------- */
const Rating = z.object({
	value: z.number().min(0).max(10), // 0~10 평점 (0~5도 허용)
	scale: z.union([z.literal(5), z.literal(10)]).default(5),
	label: z.string().optional(), // 코멘트(예: "재청취 강추")
})

const MusicLink = z.object({
	spotify: z.string().url().optional(),
	appleMusic: z.string().url().optional(),
	youtubeMusic: z.string().url().optional(),
	bandcamp: z.string().url().optional(),
})

const Track = z.object({
	title: z.string(),
	artists: z.array(z.string()).default([]),
	durationSec: z.number().int().positive().optional(),
	rating: z.number().min(0).max(10).optional(), // 트랙별 개별 평점(선택)
})

const MusicReview = z
	.object({
		subject: z.enum(['album', 'track']).default('album'), // 리뷰 대상
		title: z.string(), // 앨범/곡 제목
		artists: z.array(z.string()).default([]),
		releaseDate: z.coerce.date().optional(),
		genres: z.array(z.string()).default([]),
		// FEAT-view-redesign Step 5 follow-up: publish_service writes the
		// record label (e.g. "Half Light Recordings") for the hero meta row.
		label: z.string().optional(),
		cover: z
			.object({
				src: z.string(),
				alt: z.string().optional(),
				credit: z.string().optional(),
			})
			.optional(),
		links: MusicLink.optional(),
		// `rating` lives on the post (top-level `rating` + `ratingScale`) since
		// FEAT-view-redesign Step 4; keep it optional inside musicReview so
		// frontmatter parses cleanly when only the meta block is present.
		rating: Rating.optional(),
		favoriteTracks: z.array(z.string()).default([]),
		tracks: z.array(Track).default([]), // 앨범 리뷰일 때 트랙리스트
	})
	.strict()

/** ---------- 블로그 컬렉션 ---------- */
const blog = defineCollection({
	loader: glob({ pattern: '**/[^_]*.mdx', base: './content/blog' }),
	schema: z
		.object({
			// 기본 메타
			title: z.string().min(1, 'title is required'),
			slug: z
				.string()
				.regex(/^[a-z0-9-]+$/, 'slug must be kebab-case (a-z, 0-9, - only)'),

			// ✅ 선택 입력: 없으면 빈 문자열로
			description: z.string().default(''),

			// ✅ 문자열/숫자/ISO 모두 허용
			date: z.coerce.date(),

			// ✅ 옵션 + coerce
			lastUpdated: z.coerce.date().optional(),

			// ✅ 카테고리: 등록된 목록 or 자유 문자열 허용
			category: z
				.union([z.enum(zodEnum(CATEGORIES)), z.string().min(1)])
				.transform(v => String(v)),

			// STAB-5: review tags (cross-cutting M:N, written by the publish
			// service). Drives the /reviews tag filter + per-card tag badges.
			// Free strings (no enum) so frontmatter stays parseable if the seeded
			// vocabulary changes; the writer only emits seeded labels.
			tags: z.array(z.string()).default([]),

			// 초안 여부 (목록/검색 제외용)
			draft: z.boolean().default(false),

			// 표지 이미지 (선택)
			image: z.string().url().or(z.string()).optional(),

			// 검색/인덱싱 포함 여부
			searchIndex: z.boolean().default(true),

			// DB post id (publish_service writes `postId:` to frontmatter).
			// FEAT-post-edit-delete-ui Step 2: surfaced so the read page can
			// deep-link an author into the editor at /write?id=<postId>.
			postId: z.string().optional(),

			// 앨범 / 아티스트 참조용 ID 리스트
			albumIds: z.array(z.string()).default([]),
			artistIds: z.array(z.string()).default([]),

			// ✅ 앨범 커버 이미지 리스트 (대표 커버 포함)
			albumCover: z.string().optional(),

			// FEAT-view-redesign Step 4: top-level rating written by the publish
			// service. Range 0–5 (legacy posts on 0–10 scale handled via
			// `ratingScale` below; review-hero normalizes to 0–5 for partial-fill
			// star rendering).
			rating: z.number().min(0).max(10).optional(),
			ratingScale: z.union([z.literal(5), z.literal(10)]).default(5),

			// FEAT-writer-lowfreq-redesign Step 5: editor-set BEST NEW MUSIC.
			bestNew: z.boolean().default(false),

			// FEAT-view-redesign Step 5: writer's ★ picks (track IDs). The
			// read-page tracklist marks these as picks.
			recommendedTrackIds: z.array(z.string()).default([]),

			// ✅ 선택적: 음악 리뷰 / 평점 블록
			musicReview: MusicReview.optional(),
		})
		.transform(data => ({
			...data,
			// lastUpdated 없을 때 date로 대체
			lastUpdated: data.lastUpdated ?? data.date,
		})),
})

export const collections = { blog }
