// FEAT-lyrics-match-correction Step 3b — "가사가 틀려요", any signed-in member.
// POST /api/lyrics/{id}/report records the report (and may enqueue a re-check); it never
// changes the lyrics. Its own JWT route, so it rides apiFetch (Bearer + refresh-once).
import { apiFetch } from '@lib/api'
import type { components } from '@lib/api.gen'

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string

export type LyricsReportResult = components['schemas']['Backend_LyricsReportResult']

/** How a report ended, as the viewer's confirmation line words it. */
export type ReportOutcome = 'reported' | 'already_reported' | 'limit' | 'error'

export async function reportLyrics(spotifyTrackId: string): Promise<ReportOutcome> {
  let res: Response | null | undefined
  try {
    res = await apiFetch(`${BASE}/api/lyrics/${encodeURIComponent(spotifyTrackId)}/report`, { method: 'POST' })
  }
  catch {
    return 'error'
  }
  if (!res)
    return 'error'
  if (res.status === 429)
    return 'limit'
  if (!res.ok)
    return 'error'
  try {
    const body = await res.json() as LyricsReportResult
    return body.outcome === 'already_reported' ? 'already_reported' : 'reported'
  }
  catch {
    return 'error'
  }
}
