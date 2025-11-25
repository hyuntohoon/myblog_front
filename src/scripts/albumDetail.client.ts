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

/**
 * 선택 가능 여부를 외부에서 제어할 수 있도록 확장
 * - 글쓰기 화면: selectable 생략(기본 true) → "이 앨범 선택" 버튼 노출 (현재 마크업은 없음)
 * - 글 보기 화면: selectable: false 로 넘기면 버튼 숨김
 */
type AlbumDetailPayload = AlbumDetail & {
	selectable?: boolean
}

const $ = (id: string): HTMLElement => {
	const el = document.getElementById(id)
	if (!el) throw new Error(`#${id} not found`)
	return el
}

const root = $('albumDetail')

// ----------------- 공통 util -----------------

const fmtDur = (s?: number | null) => {
	if (!s && s !== 0) return '-'
	const m = Math.floor(s / 60)
	const r = s % 60
	return `${m}:${String(r).padStart(2, '0')}`
}

const escapeHtml = (s: string) =>
	s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')

const formatReleaseDate = (dateStr?: string | null): string => {
	if (!dateStr) return ''
	const t = Date.parse(dateStr)
	if (isNaN(t)) return ''
	// 2025.11.25
	return new Date(t)
		.toLocaleDateString('ko-KR', {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
		})
		.replace(/\. /g, '.')
		.replace(/\.$/, '')
}

const getRating5 = (meta?: Record<string, any>): number | null => {
	if (!meta || meta.rating == null) return null
	const raw = Number(meta.rating)
	if (Number.isNaN(raw)) return null
	const v = raw > 5 ? raw / 2 : raw
	return Math.max(0, Math.min(5, v))
}

const buildRatingHtml = (rating5: number | null): string => {
	if (rating5 == null) return ''
	const full = Math.floor(rating5)
	const hasHalf = rating5 - full >= 0.5
	const total = 5

	const stars = Array.from({ length: total }, (_, i) => {
		const filled = i < full
		if (!filled && hasHalf && i === full) {
			return `<span style="font-size:0.9rem; color:#fdba74;">★</span>`
		}
		return `<span style="font-size:0.9rem; color:${
			filled ? '#f97316' : '#e5e7eb'
		};">★</span>`
	}).join('')

	return `<div style="margin-top:4px; display:flex; gap:2px; align-items:center;">${stars}</div>`
}

const buildTrackListHtml = (tracks: Track[]): string => {
	if (!tracks.length) return ''
	const items = tracks
		.map(
			(t) => `
      <li style="
        display:grid;
        grid-template-columns: 2ch 1fr 6ch;
        gap:8px;
        align-items:center;
        padding:4px 0;
      ">
        <span style="color:#9ca3af; font-size:0.8rem;">${t.track_no ?? ''}</span>
        <span style="font-size:0.9rem;">${escapeHtml(t.title)}</span>
        <span style="text-align:right; color:#9ca3af; font-size:0.8rem;">
          ${fmtDur(t.duration_sec)}
        </span>
      </li>
    `
		)
		.join('')

	return `
    <div id="trackWrapper" style="display:none; margin-top:8px;">
      <ol style="list-style:none; padding:0; margin:0; display:grid; gap:4px;">
        ${items}
      </ol>
    </div>
  `
}

// 선택 상태(글쓰기 화면에서만 의미 있음)
let selectedAlbumId: string | null = null

// ----------------- 마크업 빌더 -----------------

const buildAlbumDetailHtml = (d: AlbumDetailPayload): string => {
	const a = d.album
	const artists = d.artists || []
	const tracks = d.tracks || []
	const hasTracks = tracks.length > 0

	const fullDate = formatReleaseDate(a.release_date)
	const rating5 = getRating5(d.meta)
	const ratingBlock = buildRatingHtml(rating5)

	const artistText = artists.map((x) => x.name).join(', ')

	const toggleButtonHtml = hasTracks
		? `
      <button
        id="toggleDetailBtn"
        aria-label="toggle tracks"
        style="
          border:none;
          background:transparent;
          color:#9ca3af;
          font-size:1.2rem;
          width:24px;
          height:24px;
          display:flex;
          align-items:center;
          justify-content:center;
          cursor:pointer;
          transition:transform 0.2s;
          transform:rotate(0deg);
        "
      >
        ▽
      </button>
    `
		: ''

	const trackListHtml = hasTracks ? buildTrackListHtml(tracks) : ''

	return `
  <div style="padding-top:28px;">
    <!-- 한 행: 이미지 + 정보 (높이 고정 100) -->
    <div
      style="
        display:flex;
        align-items:center;
        gap:16px;
        height:100px;
      "
    >
      <!-- 앨범 커버 -->
      <div
        style="
          width:100px;
          height:100px;
          border-radius:12px;
          overflow:hidden;
          flex-shrink:0;
          background:url('${a.cover_url ?? 'https://placehold.co/300x300?text=No+Cover'}') center/cover no-repeat;
        "
        aria-label="${escapeHtml(a.title)}"
      ></div>

      <!-- 오른쪽 정보 -->
      <div style="flex:1; display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; flex-direction:column; justify-content:center; gap:2px; min-width:0;">
          <div style="
              font-size:1.05rem;
              font-weight:700;
              color:#111827;
              white-space:nowrap;
              overflow:hidden;
              text-overflow:ellipsis;
          ">
            ${escapeHtml(a.title)}
          </div>
          <div style="
              font-size:0.9rem;
              color:#6b7280;
              white-space:nowrap;
              overflow:hidden;
              text-overflow:ellipsis;
          ">
            ${escapeHtml(artistText)}
          </div>
          <div style="font-size:0.85rem; color:#9ca3af;">${fullDate || ''}</div>
          ${ratingBlock}
        </div>

        ${toggleButtonHtml}
      </div>
    </div>

    ${trackListHtml}
  </div>
  `
}

// ----------------- 이벤트 바인딩 -----------------

const bindSelectionHandler = (d: AlbumDetailPayload) => {
	// 지금은 선택 버튼 마크업이 없어서 항상 null일 거지만,
	// 나중에 글쓰기 화면에서 재활용할 수 있게 로직만 유지
	const selectBtn = document.getElementById(
		'selectAlbumBtn'
	) as HTMLButtonElement | null

	if (!selectBtn) return
	const a = d.album
	const artists = d.artists || []

	selectBtn.addEventListener('click', () => {
		const nowSelected = selectedAlbumId === a.id

		if (!nowSelected) {
			selectedAlbumId = a.id
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
			selectedAlbumId = null
			window.dispatchEvent(
				new CustomEvent('album:deselected', {
					detail: { id: a.id },
				})
			)
		}
	})
}

const bindTrackToggleHandler = () => {
	const toggleBtn = document.getElementById(
		'toggleDetailBtn'
	) as HTMLButtonElement | null
	const trackWrapper = document.getElementById(
		'trackWrapper'
	) as HTMLDivElement | null

	if (!toggleBtn || !trackWrapper) return

	toggleBtn.addEventListener('click', () => {
		const isHidden =
			trackWrapper.style.display === 'none' || trackWrapper.style.display === ''
		trackWrapper.style.display = isHidden ? 'block' : 'none'
		toggleBtn.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)'
	})
}

// ----------------- 메인 render -----------------

const render = (d: AlbumDetailPayload) => {
	root.innerHTML = buildAlbumDetailHtml(d)
	bindSelectionHandler(d)
	bindTrackToggleHandler()
}

// 이벤트 진입점: 어디서든 `album:detail`만 쏴주면 렌더됨
window.addEventListener('album:detail', (e: Event) => {
	const payload = (e as CustomEvent<AlbumDetailPayload>).detail
	render(payload)
})
