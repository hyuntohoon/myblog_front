type Artist = { id: string; name: string; spotify_id?: string | null }
type Track = {
	id: string
	title: string
	track_no: number | null
	duration_sec: number | null
	spotify_id?: string | null
}
type Album = {
	id: string
	title: string
	release_date?: string | null
	cover_url?: string | null
	album_type?: string | null
	spotify_id?: string | null
}
type AlbumDetail = {
	album: Album
	artists: Artist[]
	tracks: Track[]
	meta?: Record<string, any>
}

const $ = (id: string): HTMLElement => {
	const el = document.getElementById(id)
	if (!el) throw new Error(`#${id} not found`)
	return el
}

const root = $('albumDetail')

const fmtDur = (s?: number | null) => {
	if (!s && s !== 0) return '-'
	const m = Math.floor(s / 60)
	const r = s % 60
	return `${m}:${String(r).padStart(2, '0')}`
}

const render = (d: AlbumDetail) => {
	const a = d.album
	const artists = d.artists || []
	const tracks = d.tracks || []

	root.innerHTML = `
    <div style="border:1px solid #e5e7eb; background:#fff; border-radius:12px; padding:16px; display:grid; gap:12px;">
      <div style="display:flex; gap:16px;">
        <img src="${a.cover_url ?? 'https://placehold.co/300x300?text=No+Cover'}" alt="${a.title}" width="140" height="140" style="border-radius:10px; object-fit:cover;" />
        <div style="display:grid; gap:6px;">
          <div style="font-size:1.25rem; font-weight:800;">${a.title}</div>
          <div style="color:#374151;">
            ${a.album_type ?? ''}${a.album_type ? ' · ' : ''}${a.release_date ?? ''}
          </div>
          <div style="color:#374151;">${artists.map((x) => x.name).join(', ')}</div>
          ${a.spotify_id ? `<a href="https://open.spotify.com/album/${a.spotify_id}" target="_blank" rel="noreferrer" style="color:#047857; font-weight:600;">Open in Spotify ↗</a>` : ''}
        </div>
      </div>
      <div>
        <div style="font-weight:700; margin:.25rem 0 .5rem;">Tracks</div>
        <ol style="list-style:none; padding:0; margin:0; display:grid; gap:4px;">
          ${tracks
						.map(
							(t) => `
            <li style="display:grid; grid-template-columns: 2ch 1fr 6ch; gap:8px; align-items:center; padding:6px 8px; border-radius:8px; border:1px solid #f3f4f6;">
              <span style="color:#6b7280;">${t.track_no ?? ''}</span>
              <span>${t.title}</span>
              <span style="text-align:right; color:#6b7280;">${fmtDur(t.duration_sec)}</span>
            </li>
          `
						)
						.join('')}
        </ol>
      </div>
    </div>
  `
}

// ✅ 검색바(Spotify)에서 dispatch한 이벤트 수신해서 렌더
window.addEventListener('album:detail', (e: Event) => {
	// @ts-ignore
	const payload = (e as CustomEvent).detail as AlbumDetail
	render(payload)
})
