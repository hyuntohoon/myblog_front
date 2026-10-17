// FEAT-lyrics-match-correction Step 3b — the member report call's outcome mapping.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reportLyrics } from './lyricsReport.api'

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@lib/api', () => ({ apiFetch }))

function res(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status })
}

beforeEach(() => {
  apiFetch.mockReset()
})

describe('reportLyrics', () => {
  it('posts to the member route', async () => {
    apiFetch.mockResolvedValue(res(200, { outcome: 'reported' }))
    expect(await reportLyrics('a/b')).toBe('reported')
    expect(apiFetch.mock.calls[0][0]).toMatch(/\/api\/lyrics\/a%2Fb\/report$/)
    expect(apiFetch.mock.calls[0][1]).toEqual({ method: 'POST' })
  })

  it.each([
    [res(200, { outcome: 'already_reported' }), 'already_reported'],
    [res(429, { detail: 'x' }), 'limit'],
    [res(409, { detail: 'not_reportable' }), 'error'],
    [res(500), 'error'],
    [null, 'error'],
  ])('maps %#', async (r, outcome) => {
    apiFetch.mockResolvedValue(r)
    expect(await reportLyrics('sid')).toBe(outcome)
  })

  it('a network failure is an error, never a throw', async () => {
    apiFetch.mockRejectedValue(new TypeError('offline'))
    expect(await reportLyrics('sid')).toBe('error')
  })
})
