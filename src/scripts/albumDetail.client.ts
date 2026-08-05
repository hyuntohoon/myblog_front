import type { components } from '../lib/api.gen'
import { PB_ADD_TRACK_EVENT } from '../lib/pocketBuckit/events'
import { playbackSession } from '../lib/playback/session'
import { queueTrack } from '../lib/spotifyPlayback'

type AlbumDetail = components['schemas']['Music_AlbumDetail']
type Track = components['schemas']['Music_TrackOut']

// FEAT-view-redesign Step 5: read page tracklist. The full album tracklist
// renders flat (no toggle), with ★ on tracks that the writer picked. Picks
// come from the post's MDX frontmatter via #music-section[data-recommended-track-ids].
// No rating column or per-track meter — album-only rating is the product
// decision; see RFC Non-goals.

type AlbumDetailPayload = AlbumDetail

// Step 3 (ClientRouter): #albumDetail is a fresh node on every navigation, so
// the binding moves from module scope into an astro:page-load init (below).
// The window-level album:detail listener stays module-scoped (bound once).
let root: HTMLElement | null = null
let pickedTrackIds: Set<string> = new Set()

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
      // FEAT-member-player Step 6c — per-track "다음에 듣기". This is the ONLY place
      // 6c can live: the RFC filed it as riding 6b's surfaces, but those are all
      // album-level and `POST /me/player/queue` takes a track or episode uri only.
      const queueBtn = id ?
        `<button type="button" class="lfq-tt-queue" data-queue-track-id="${escapeHtml(id)}" data-queue-track-title="${title}" aria-label="${title || '트랙'} 다음에 듣기" title="다음에 듣기">＋▶</button>` :
        '<span></span>'
      // FEAT-pocket-buckit Step 6 — per-track "담기" (track-as-bucket-member). Adds
      // item_type='track' via the ReviewTrackAdder island (event bridge below).
      const addBtn = id ?
        `<button type="button" class="lfq-tt-add" data-add-track-id="${escapeHtml(id)}" data-add-track-title="${title}" aria-label="${title || '트랙'} 버킷에 담기" title="버킷에 담기">＋</button>` :
        '<span></span>'
      return `
        <li class="lfq-tt-row${isPick ? ' is-pick' : ''}">
          <span class="lfq-tt-no">${num}</span>
          <span class="lfq-tt-title">${title}${featNames(t.feat_artist_names)}${isPick ? ' <span class="lfq-tt-star" aria-label="추천 트랙">★</span>' : ''}</span>
          <span class="lfq-tt-dur">${dur}</span>
          ${playBtn}
          ${queueBtn}
          ${addBtn}
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

// FEAT-pocket-buckit Step 5b — explicit per-track play. The Step 5 ladder mints
// the token / pulls the SDK ONLY here, on a real click. On this public review
// page an anonymous (or dormant-503) play just shows a notice — no SDK load, no
// redirect (rule #9 + the SDK-must-not-load-on-page-load guarantee).
let noteTimer: number | undefined
function showPlayNote(msg: string, undo: (() => void) | null = null): void {
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
  // Step 6b: ▶ replaces the playback queue, so the note carries the same 되돌리기
  // affordance the React surfaces show. Vanilla DOM here — no island to bridge to
  // on this page — so the button is built by hand rather than dispatched.
  if (undo) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'lfq-tt-playundo'
    button.textContent = '되돌리기'
    button.addEventListener('click', () => {
      button.disabled = true
      undo()
    }, { once: true })
    note.appendChild(button)
  }
  void note.offsetWidth // restart the transition on repeat clicks
  note.classList.add('is-on')
  if (noteTimer !== undefined)
    window.clearTimeout(noteTimer)
  noteTimer = window.setTimeout(() => note?.classList.remove('is-on'), 5000)
}

function onRootClick(e: Event): void {
  const target = e.target as Element | null
  const playBtn = target?.closest<HTMLButtonElement>('.lfq-tt-play')
  if (playBtn) {
    const trackId = playBtn.dataset.trackId
    if (trackId) {
      // Step 6b: the track ▶ replaces the playback queue with this one track and
      // plays it — the owner's "it has to work from a track too". Same session
      // entry as the album ▶, so there is still exactly one play path.
      void playbackSession.replaceQueueAndPlay({ kind: 'track', trackId, title: playBtn.dataset.trackTitle })
        .then((o) => {
          const undo = o.undo
          showPlayNote(o.message, undo ? () => void undo().then(u => showPlayNote(u.message)) : null)
        })
    }
    return
  }
  // FEAT-member-player Step 6c — 다음에 듣기. Deliberately NOT laddered like play():
  // queueing onto a device that is not playing is meaningless, so a 404 stays a 404
  // and says "start playing first" instead of raising an in-page device to hold a
  // queue nobody is listening to.
  const queueBtn = target?.closest<HTMLButtonElement>('.lfq-tt-queue')
  if (queueBtn) {
    const trackId = queueBtn.dataset.queueTrackId
    if (trackId) {
      const label = queueBtn.dataset.queueTrackTitle
      void queueTrack({ trackId, title: label }).then(o =>
        showPlayNote(o.ok ? `대기열에 넣었어요${label ? ` — ${label}` : ''}` : o.message))
    }
    return
  }
  // FEAT-pocket-buckit Step 6 — per-track "담기" → hand off to the ReviewTrackAdder
  // island, which owns the AddToBucketMenu (picker + the logged-out pb:resume → Cognito
  // handoff). Vanilla DOM here can't mount React, so this is an event bridge (same
  // shape as `album:detail`).
  const addBtn = target?.closest<HTMLButtonElement>('.lfq-tt-add')
  if (addBtn) {
    const trackId = addBtn.dataset.addTrackId
    if (trackId)
      window.dispatchEvent(new CustomEvent(PB_ADD_TRACK_EVENT, { detail: { trackId, title: addBtn.dataset.addTrackTitle } }))
  }
}

// Re-bind to the new page's nodes on every navigation. astro:page-load fires on
// the initial load as well, and each #albumDetail node only ever sees one
// page-load, so this cannot double-bind.
document.addEventListener('astro:page-load', () => {
  root = document.getElementById('albumDetail')
  const musicSection = document.getElementById('music-section')
  pickedTrackIds = new Set()
  if (musicSection) {
    try {
      const raw = musicSection.dataset.recommendedTrackIds || '[]'
      pickedTrackIds = new Set(JSON.parse(raw) as string[])
    }
    catch {
      pickedTrackIds = new Set()
    }
  }
  root?.addEventListener('click', onRootClick)
})
