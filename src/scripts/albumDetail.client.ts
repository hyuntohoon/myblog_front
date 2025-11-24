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

// ⭐ 선택 상태 저장
let selectedAlbumId: string | null = null

const render = (d: AlbumDetail) => {
	const a = d.album
	const artists = d.artists || []
	const tracks = d.tracks || []

	const isSelected = selectedAlbumId === a.id

	root.innerHTML = `
    <div style="border:1px solid #e5e7eb; background:#fff; border-radius:12px; padding:16px; display:grid; gap:12px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div style="display:flex; gap:16px;">
          <img src="${a.cover_url ?? 'https://placehold.co/300x300?text=No+Cover'}"
               alt="${a.title}"
               width="140" height="140"
               style="border-radius:10px; object-fit:cover;" />
          <div style="display:grid; gap:6px;">
            <div style="font-size:1.25rem; font-weight:800;">${a.title}</div>
            <div style="color:#374151;">
              ${a.album_type ?? ''}${a.album_type ? ' · ' : ''}${a.release_date ?? ''}
            </div>
            <div style="color:#374151;">${artists.map((x) => x.name).join(', ')}</div>
            ${
							a.spotify_id
								? `<a href="https://open.spotify.com/album/${a.spotify_id}" target="_blank" rel="noreferrer" style="color:#047857; font-weight:600;">Open in Spotify ↗</a>`
								: ''
						}
          </div>
        </div>

        <!-- ⭐ 선택 / 선택 해제 버튼 -->
        <button id="selectAlbumBtn"
          style="
            padding:6px 12px;
            border-radius:8px;
            border:1px solid #047857;
            background:${isSelected ? '#047857' : 'white'};
            color:${isSelected ? 'white' : '#047857'};
            font-weight:600;
          ">
          ${isSelected ? '선택 해제' : '이 앨범 선택'}
        </button>
      </div>

      <!-- ⭐ 상세는 선택상태와 상관없이 '자세히 보기'로 토글 가능 -->
      <div id="trackBlock" style="${isSelected ? 'display:none;' : ''}">
        <div style="font-weight:700; margin:.25rem 0 .5rem;">Tracks</div>
        <ol style="list-style:none; padding:0; margin:0; display:grid; gap:4px;">
          ${tracks
						.map(
							(t) => `
              <li style="display:grid; grid-template-columns: 2ch 1fr 6ch;
                 gap:8px; align-items:center; padding:6px 8px; border-radius:8px;
                 border:1px solid #f3f4f6;">
                <span style="color:#6b7280;">${t.track_no ?? ''}</span>
                <span>${t.title}</span>
                <span style="text-align:right; color:#6b7280;">${fmtDur(t.duration_sec)}</span>
              </li>
          `
						)
						.join('')}
        </ol>
      </div>

      <button id="toggleDetailBtn"
        style="margin-top:4px; padding:4px 8px; border-radius:6px; border:1px solid #ccc; font-size:0.875rem;">
        ${isSelected ? '자세히 보기' : '간단히 보기'}
      </button>
    </div>
  `

	// ⭐ 버튼 기능 연결
	const selectBtn = $('selectAlbumBtn')
	const detailBtn = $('toggleDetailBtn')
	const trackBlock = $('trackBlock')

	// 선택 / 선택 해제
	selectBtn.addEventListener('click', () => {
		const nowSelected = selectedAlbumId === a.id

		if (!nowSelected) {
			// 선택됨
			selectedAlbumId = a.id

			// 전역 이벤트 발행
			window.dispatchEvent(
				new CustomEvent('album:selected', {
					detail: {
						id: a.id,
						title: a.title,
						spotify_id: a.spotify_id,
						artists: artists.map((x) => ({
							id: x.id,
							name: x.name,
							spotify_id: x.spotify_id ?? null,
						})),
					},
				})
			)
		} else {
			// 선택 해제됨
			selectedAlbumId = null

			window.dispatchEvent(
				new CustomEvent('album:deselected', {
					detail: { id: a.id },
				})
			)
		}

		// UI 리렌더
		render(d)
	})

	// 상세/간단 토글
	detailBtn.addEventListener('click', () => {
		if (trackBlock.style.display === 'none') {
			trackBlock.style.display = 'block'
			detailBtn.textContent = '간단히 보기'
		} else {
			trackBlock.style.display = 'none'
			detailBtn.textContent = '자세히 보기'
		}
	})
}

// Spotify 검색에서 보내는 이벤트 처리
window.addEventListener('album:detail', (e: Event) => {
	const payload = (e as CustomEvent).detail as AlbumDetail
	render(payload)
})
