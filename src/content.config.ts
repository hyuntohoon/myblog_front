// src/content/config.ts
import { glob } from 'astro/loaders'
import { defineCollection, z } from 'astro:content'
import CATEGORIES from './categories.json'

// zod enum에 배열을 안전하게 넣기
const zodEnum = <T>(arr: T[]): [T, ...T[]] => arr as [T, ...T[]]

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

			// ✅ 카테고리: 목록에 있으면 enum으로 검증,
			//    목록에 없어도 임시로 문자열을 허용해 개발 막힘 방지
			category: z
				.union([z.enum(zodEnum(CATEGORIES)), z.string().min(1)])
				.transform((v) => String(v)),

			// 초안 여부(목록/검색에서 제외할 때 사용)
			draft: z.boolean().default(false),

			// 표지/이미지(선택)
			image: z.string().url().or(z.string()).optional(),

			// 검색/인덱싱 포함 여부
			searchIndex: z.boolean().default(true),

			// (향후 확장) 글에서 참조할 앨범 ID들
			albumIds: z.array(z.string()).default([]),
		})
		.transform((data) => ({
			...data,
			// lastUpdated가 없으면 date로 대체
			lastUpdated: data.lastUpdated ?? data.date,
		})),
})

export const collections = { blog }
