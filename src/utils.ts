// src/utils.ts
import type { CollectionEntry } from 'astro:content'

/**
 * Returns a date in the format "MMM DD, YYYY"
 */
export function defaultDateFormat(date: Date): string {
	return date
		.toLocaleDateString('ko-KR', {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
		})
		.replace(/\. /g, '.')
		.replace(/\.$/, '')
}

/**
 * Returns a date in the format "YYYY"
 */
export function yearDateFormat(date: Date): string {
	return date.toLocaleDateString('en-US', { year: 'numeric' })
}

/**
 * Returns a date in ISO format
 */
export function isoDateFormat(date: Date): string {
	return date.toISOString()
}

/**
 * Convert frontmatter data into a frontmatter YAML string
 * @example
 *
 * ```ts
 * const output = frontmatterToString({ title: 'hello world', slug: 'hello-world' })
 * // --- title: hello world\nslug: hello-world\n---
 * ```
 */
export function frontmatterToString(data: Record<string, any>): string {
	const yaml = Object.entries(data)
		.map(([key, value]) => {
			if (Array.isArray(value)) {
				// 배열은 일반 리스트로 직렬화 (태그 전용 로직 제거)
				return `${key}:\n ${value.map(v => `- ${v}`).join('\n ')}`
			}
			return `${key}: ${JSON.stringify(value)}`
		})
		.join('\n')
	return `---\n${yaml}\n---\n\n`
}

/**
 * Sort the 'blog' collection DESC by date (최근 글 먼저)
 */
export function sortAsc(data: Array<CollectionEntry<'blog'>>) {
	return data.sort(
		(a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime(),
	)
}

/**
 * Capitalize the first letter of a string
 */
export function capitalize<T extends string>(str: T): Capitalize<T> {
	return (str.charAt(0).toUpperCase() + str.slice(1)) as Capitalize<T>
}
