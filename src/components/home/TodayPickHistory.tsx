// FEAT-today-buckit Step 6 — history overlay for past "today's song" picks.
// Date-desc agenda of prior picks (public read, GET /api/todays-pick/history).
// OQ5 resolved: overlay modal (not a /today page). Each row opens the album
// overlay (openAlbum) — same dispatch as the home tile + TodayAlbumBuckit.
import { useEffect, useRef, useState } from 'react'
import { openAlbum } from '@lib/entityLinks'
import { useDismissable } from '@lib/useDismissable'
import { useScrollLock } from '@lib/useScrollLock'
import { Cover } from './ui'
import {  getTodaysPickHistory } from '@lib/todaysPick'
import type { DailyPick } from '@lib/todaysPick'

interface Props {
	onClose: () => void
}

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
								<button
									type="button"
									className="tsp-history-open"
									onClick={() => openAlbum({ albumId: p.album_id, title: p.title, artist: p.artist, cover: p.cover_url })}
								>
									<Cover label={p.title} src={p.cover_url} size={40} radius={3} />
									<span className="tsp-history-meta">
										<span className="serif italic">{p.title}</span>
										<span className="tsp-history-artist mono">{p.artist}</span>
									</span>
								</button>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</div>
	)
}
