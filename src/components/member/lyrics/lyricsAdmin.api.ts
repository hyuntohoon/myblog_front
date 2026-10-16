// FEAT-lyrics-match-correction Step 3a — the owner's lyrics candidate panel.
// Three owner-only routes (require_owner + their own JWT routes). Lyric previews share the
// corpus's never-public bar, so these ride apiFetch (Bearer + refresh-once) only.
import { apiFetch } from '@lib/api'
import type { components } from '@lib/api.gen'

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string

export type AdminLyricsCandidates = components['schemas']['Backend_AdminLyricsCandidates']
export type AdminLyricsCandidate = components['schemas']['Backend_AdminLyricsCandidate']
export type AdminLyricsCurrent = components['schemas']['Backend_AdminLyricsCurrent']
export type AdminLyricsDecisionResult = components['schemas']['Backend_AdminLyricsDecisionResult']
export type AdminLyricsAction = components['schemas']['Backend_AdminLyricsDecisionRequest']['action']

/** A failed panel request, with the backend's short reason when it gave one. */
export class LyricsAdminError extends Error {
  constructor(readonly status: number, readonly code: string | null) {
    super(code ? `HTTP ${status}: ${code}` : `HTTP ${status}`)
  }
}

function url(spotifyTrackId: string, path: string): string {
  return `${BASE}/api/admin/lyrics/${encodeURIComponent(spotifyTrackId)}/${path}`
}

async function readJson<T>(res: Response | null | undefined): Promise<T> {
  if (!res)
    throw new LyricsAdminError(0, null)
  if (!res.ok) {
    let code: string | null = null
    try {
      const body = await res.json() as { detail?: unknown }
      if (typeof body.detail === 'string')
        code = body.detail
    }
    catch {}
    throw new LyricsAdminError(res.status, code)
  }
  return res.json() as Promise<T>
}

export async function getLyricsCandidates(spotifyTrackId: string): Promise<AdminLyricsCandidates> {
  return readJson(await apiFetch(url(spotifyTrackId, 'candidates'), { method: 'GET' }))
}

export async function refreshLyricsCandidates(spotifyTrackId: string): Promise<{ enqueued: boolean }> {
  return readJson(await apiFetch(url(spotifyTrackId, 'candidates/refresh'), { method: 'POST' }))
}

export async function decideLyrics(
  spotifyTrackId: string,
  action: AdminLyricsAction,
  lrclibId?: number,
): Promise<AdminLyricsDecisionResult> {
  const body = lrclibId == null ? { action } : { action, lrclib_id: lrclibId }
  return readJson(await apiFetch(url(spotifyTrackId, 'decision'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}
