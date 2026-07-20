// FEAT-today-buckit Step 6 — history overlay for past "today's song" picks.
// Date-desc agenda of prior picks (public read, GET /api/todays-pick/history).
// OQ5 resolved: overlay modal (not a /today page). Each row opens the album
// overlay (openAlbum) — same dispatch as the home tile + TodayAlbumBuckit.
import { useEffect, useRef, useState } from 'react'
import { openAlbum } from '@lib/entityEvents'
import { artistHref } from '@lib/entityLinks'
import { useDismissable } from '@lib/useDismissable'
import { useScrollLock } from '@lib/useScrollLock'
import { Cover } from './ui'
import {  getTodaysPickHistory } from '@lib/todaysPick'
import type { DailyPick } from '@lib/todaysPick'
// qb-* modal shell — home page never loads member.css. See TodaySongPicker.
import '@styles/modal.css'

interface Props {
	onClose: () => void
}

// Row visuals for the history agenda. These .tsp-history-* classes were used by
// the markup below since Step 6 but never actually defined in any stylesheet —
// the rows rendered as a bare bulleted <ul>. Self-contained here (same posture
// as TodaySongBuckit's SCOPED_CSS) rather than in member.css, which the home
// page never loads. min-width:0 on the flex children is load-bearing: real pick
// titles are long and nowrap, and without it they blow the modal open.
const HISTORY_CSS = `
.tsp-history-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.tsp-history-row{display:flex;align-items:center;gap:12px;padding:6px 8px;border-radius:4px}
.tsp-history-row:hover{background:var(--color-paper)}
.tsp-history-date{flex:0 0 auto;width:34px;font-size:11px;letter-spacing:.02em;color:var(--color-faded);text-align:right}
.tsp-history-open{flex:1;min-width:0;display:flex;align-items:center;gap:12px;color:inherit;text-align:left}
.tsp-history-album-open{display:block;min-width:0;padding:0;background:none;border:0;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:opacity .16s}
.tsp-history-album-open:hover{opacity:.78}
.tsp-history-album-open:focus-visible{outline:2px solid var(--color-accent);outline-offset:2px;border-radius:4px}
.tsp-history-meta{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.tsp-history-meta>*{display:block;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tsp-history-meta>.serif{font-size:15px;line-height:1.25;color:var(--color-text)}
.tsp-history-artist{font-size:11.5px;letter-spacing:.02em;color:var(--color-subtle)}
.tsp-history-meta>a{text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--color-faded)}
@media (prefers-reduced-motion:reduce){.tsp-history-album-open{transition:none}}
`

function fmtDate(iso: string): string {
	// pick_date is a date-only ISO (YYYY-MM-DD). Render as M.D.
	const d = new Date(`${iso}T00:00:00`)
	if (Number.isNaN(d.getTime()))
		return iso
	return `${d.getMonth() + 1}.${d.getDate()}`
}

export default function TodayPickHistory({ onClose }: Props) {
	const [items, setItems] = useState<DailyPick[] | null>(null)
	const [error, setError] = useState(false)
	const modalRef = useRef<HTMLDivElement>(null)

	useDismissable(true, onClose, modalRef)
	useScrollLock()

	useEffect(() => {
		let alive = true
		void getTodaysPickHistory(50).then((rows) => {
			if (!alive)
				return
			setItems(rows)
			setError(false)
		}).catch(() => {
			if (alive)
				setError(true)
		})
		return () => {
			alive = false
		}
	}, [])

	return (
		<div className="qb-modal-scrim qb-modal-scrim--add" onClick={onClose} role="presentation">
			<div ref={modalRef} className="qb-modal qb-modal--add" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="지난 추천곡">
				<style>{HISTORY_CSS}</style>
				<header className="qb-modal-head">
					<div>
						<p className="qb-modal-kicker">오늘의 곡</p>
						<h2 className="qb-modal-title">지난 추천곡</h2>
					</div>
					<button type="button" className="qb-modal-close" onClick={onClose} aria-label="닫기">✕</button>
				</header>

				<div className="qb-modal-results">
					{error && <div className="qb-modal-empty">불러오지 못했어요.</div>}
					{items !== null && items.length === 0 && <div className="qb-modal-empty">아직 올린 추천곡이 없어요.</div>}
					{items !== null && items.length > 0 && (
						<ul className="tsp-history-list">
							{items.map(p => (
								<li key={p.id} className="tsp-history-row">
									<span className="tsp-history-date mono">{fmtDate(p.pick_date)}</span>
									<div className="tsp-history-open">
										<button
											type="button"
											className="tsp-history-album-open"
											onClick={() => openAlbum({ albumId: p.album_id, title: p.title, artist: p.artist, cover: p.cover_url })}
											aria-label={`${p.title} 앨범 상세 보기`}
										>
											<Cover label={p.title} src={p.cover_url} size={40} radius={3} />
										</button>
										<div className="tsp-history-meta">
											<button
												type="button"
												className="tsp-history-album-open serif italic"
												onClick={() => openAlbum({ albumId: p.album_id, title: p.title, artist: p.artist, cover: p.cover_url })}
											>
												{p.title}
											</button>
											{p.artist_id ?
												<a href={artistHref(p.artist_id)} className="tsp-history-artist mono">{p.artist}</a> :
												<span className="tsp-history-artist mono">{p.artist}</span>}
										</div>
									</div>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</div>
	)
}
