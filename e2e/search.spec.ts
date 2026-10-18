import { kindOfBlueDetail, unifiedMiles } from './data'
import { expect, test } from './fixtures'

const UNIFIED = '/api/music/search/unified'

test('header search on the home page lands on /search with the query\'s results', async ({ page, api }) => {
	api.on('GET', UNIFIED, { json: unifiedMiles })
	await page.goto('/')

	// Desktop viewport: the header field is inline (the 검색 열기 trigger is the mobile entry).
	const field = page.getByRole('combobox', { name: '검색' })
	await field.fill('miles')
	await field.press('Enter')

	await expect(page).toHaveURL(/\/search\/?\?q=miles$/)
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('‘miles’')
	await expect(page.getByRole('status').filter({ hasText: '총' })).toHaveText('총 3건')
	await expect(page.getByRole('heading', { name: 'Kind of Blue' })).toBeVisible()
	await expect(page.getByRole('heading', { name: 'Miles Davis' })).toBeVisible()
})

test('result filters narrow the page to one kind', async ({ page, api }) => {
	api.on('GET', UNIFIED, { json: unifiedMiles })
	await page.goto('/search/?q=miles')

	const filters = page.getByRole('group', { name: '결과 유형 필터' })
	await expect(filters.getByRole('button', { name: /^전체/ })).toHaveAttribute('aria-pressed', 'true')
	// No 평론 index in the API-free build, so that pill is disabled, not hidden.
	await expect(filters.getByRole('button', { name: /^평론/ })).toBeDisabled()

	await filters.getByRole('button', { name: /^트랙/ }).click()
	await expect(filters.getByRole('button', { name: /^트랙/ })).toHaveAttribute('aria-pressed', 'true')
	await expect(page.getByText('So What')).toBeVisible()
	await expect(page.getByRole('heading', { name: 'Kind of Blue' })).toHaveCount(0)
	await expect(page.getByRole('heading', { name: 'Miles Davis' })).toHaveCount(0)
})

test('a failed search says so — not "no results" — and 다시 시도 recovers', async ({ page, api }) => {
	let fail = true
	api.on('GET', UNIFIED, () => (fail ? { status: 500, json: { detail: 'boom' } } : { json: unifiedMiles }))
	await page.goto('/search/?q=miles')

	await expect(page.getByRole('status').filter({ hasText: '검색' })).toHaveText('검색을 불러오지 못했습니다')
	await expect(page.getByText('검색어 문제가 아닙니다')).toBeVisible()
	await expect(page.getByText('일치하는 결과가 없습니다')).toHaveCount(0)

	fail = false
	await page.getByRole('button', { name: '다시 시도' }).first().click()
	await expect(page.getByRole('status').filter({ hasText: '총' })).toHaveText('총 3건')
	await expect(page.getByText('검색 결과를 불러오지 못했습니다')).toHaveCount(0)
	expect(api.callsTo(UNIFIED)).toHaveLength(2)
})

test('an album result opens the album overlay with its tracklist, and ✕ closes it', async ({ page, api }) => {
	api.on('GET', UNIFIED, { json: unifiedMiles })
	api.on('GET', `/api/music/albums/${kindOfBlueDetail.album.id}`, { json: kindOfBlueDetail })
	await page.goto('/search/?q=miles')

	await page.getByRole('button', { name: /Kind of Blue.*상세/ }).first().click()

	const dialog = page.getByRole('dialog', { name: '앨범 상세' })
	await expect(dialog).toBeVisible()
	await expect(dialog.getByText('Freddie Freeloader')).toBeVisible()
	await expect(dialog.getByText('Blue in Green')).toBeVisible()

	await dialog.getByRole('button', { name: '닫기' }).click()
	await expect(dialog).toHaveCount(0)
})
