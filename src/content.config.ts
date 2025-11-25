// src/content/config.ts
import { glob } from 'astro/loaders'
import { defineCollection, z } from 'astro:content'
import CATEGORIES from './categories.json'

// zod enum에 배열을 안전하게 넣기
const zodEnum = <T>(arr: T[]): [T, ...T[]] => arr as [T, ...T[]]

/** ---------- 선택적: 음악 리뷰/평점 블록 ---------- */
const Rating = z.object({
	value: z.number().min(0).max(10), // 0~10 평점
	scale: z.literal(10).default(10), // 필요시 5점제로 바꿔도 됨
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
		cover: z
			.object({
				src: z.string(),
				alt: z.string().optional(),
				credit: z.string().optional(),
			})
			.optional(),
		links: MusicLink.optional(),
		rating: Rating, // ✅ 핵심: 평점
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
				.transform((v) => String(v)),

			// 초안 여부 (목록/검색 제외용)
			draft: z.boolean().default(false),

			// 표지 이미지 (선택)
			image: z.string().url().or(z.string()).optional(),

			// 검색/인덱싱 포함 여부
			searchIndex: z.boolean().default(true),

			// 앨범 / 아티스트 참조용 ID 리스트
			albumIds: z.array(z.string()).default([]),
			artistIds: z.array(z.string()).default([]),

			// ✅ 앨범 커버 이미지 리스트 (대표 커버 포함)
			albumCover: z.string().optional(),

			// ✅ 선택적: 음악 리뷰 / 평점 블록
			musicReview: MusicReview.optional(),
		})
		.transform((data) => ({
			...data,
			// lastUpdated 없을 때 date로 대체
			lastUpdated: data.lastUpdated ?? data.date,
		})),
})

export const collections = { blog }
