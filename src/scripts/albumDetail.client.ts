import type { components } from '../lib/api.gen'
import { requestPlayback } from '../lib/spotifyPlayback'

type AlbumDetail = components['schemas']['Music_AlbumDetail']
type Track = components['schemas']['Music_TrackOut']

// FEAT-view-redesign Step 5: read page tracklist. The full album tracklist
// renders flat (no toggle), with ★ on tracks that the writer picked. Picks
// come from the post's MDX frontmatter via #music-section[data-recommended-track-ids].
// No rating column or per-track meter — album-only rating is the product
// decision; see RFC Non-goals.

type AlbumDetailPayload = AlbumDetail

const root = document.getElementById('albumDetail')
const musicSection = document.getElementById('music-section')
let pickedTrackIds: Set<string> = new Set()
if (musicSection) {
  try {
    const raw = musicSection.dataset.recommendedTrackIds || '[]'
    const arr = JSON.parse(raw) as string[]
    pickedTrackIds = new Set(arr)
  }
  catch {
    pickedTrackIds = new Set()
  }
}

function fmtDur(s?: number | null): string {
  if (s == null || Number.isNaN(s))
    return ''
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function featNames(names?: string[] | null): string {
  if (!names || names.length === 0)
    return ''
  const joined = names.map(escapeHtml).join(', ')
  return ` <span class="lfq-tt-feat"><span class="lfq-tt-feat-mark">feat.</span> ${joined}</span>`
}

function buildTracklistHtml(tracks: Track[]): string {
  if (tracks.length === 0)
    return '<p class="lfq-tt-empty">트랙 정보가 아직 동기화되지 않았습니다.</p>'
  const rows = tracks
    .map((t) => {
      const id = t.id ?? ''
      const isPick = id && pickedTrackIds.has(id)
      const title = escapeHtml(t.title ?? '')
      const num = t.track_no ?? ''
      const dur = fmtDur(t.duration_sec)
      // FEAT-pocket-buckit Step 5b — per-track play (dormant until the owner
      // provisions Spotify streaming). Only when the track has a DB id to target.
      const playBtn = id ?
        `<button type="button" class="lfq-tt-play" data-track-id="${escapeHtml(id)}" data-track-title="${title}" aria-label="${title || '트랙'} 재생" title="재생 (Spotify Premium)">▶</button>` :
        '<span></span>'
      return `
        <li class="lfq-tt-row${isPick ? ' is-pick' : ''}">
          <span class="lfq-tt-no">${num}</span>
          <span class="lfq-tt-title">${title}${featNames(t.feat_artist_names)}${isPick ? ' <span class="lfq-tt-star" aria-label="추천 트랙">★</span>' : ''}</span>
          <span class="lfq-tt-dur">${dur}</span>
          ${playBtn}
        </li>
      `
    })
    .join('')
  return `<ol class="lfq-tt-list">${rows}</ol>`
}

function render(d: AlbumDetailPayload): void {
  if (!root)
    return
  const tracks = d.tracks ?? []
  root.innerHTML = buildTracklistHtml(tracks)
}

window.addEventListener('album:detail', (e: Event) => {
  const payload = (e as CustomEvent<AlbumDetailPayload>).detail
  render(payload)
})

// FEAT-pocket-buckit Step 5b — explicit per-track play. `requestPlayback` mints
// the token / pulls the SDK ONLY here, on a real click. On this public review
// page an anonymous (or dormant-503) play just shows a notice — no SDK load, no
// redirect (rule #9 + the SDK-must-not-load-on-page-load guarantee).
let noteTimer: number | undefined
function showPlayNote(msg: string): void {
  const section = root?.parentElement
  if (!section)
    return
  let note = section.querySelector<HTMLDivElement>('.lfq-tt-playnote')
  if (!note) {
    note = document.createElement('div')
    note.className = 'lfq-tt-playnote'
    note.setAttribute('role', 'status')
    section.appendChild(note)
  }
  note.textContent = msg
  void note.offsetWidth // restart the transition on repeat clicks
  note.classList.add('is-on')
  if (noteTimer !== undefined)
    window.clearTimeout(noteTimer)
  noteTimer = window.setTimeout(() => note?.classList.remove('is-on'), 5000)
}

root?.addEventListener('click', (e) => {
  const btn = (e.target as Element | null)?.closest<HTMLButtonElement>('.lfq-tt-play')
  if (!btn)
    return
  const trackId = btn.dataset.trackId
  if (!trackId)
    return
  void requestPlayback({ kind: 'track', trackId, title: btn.dataset.trackTitle }).then(o => showPlayNote(o.message))
})
