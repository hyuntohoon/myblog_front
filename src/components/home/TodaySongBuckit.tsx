/**
 * "오늘의 곡" — the owner-curated song-of-the-day tile (FEAT-today-buckit Step 6).
 * A runtime read of GET /api/todays-pick (public); shows the single pick's
 * identity only (cover + title + artist — no impression text, owner decision).
 *
 * Clicking the cover/title opens the app-wide read-only album overlay
 * (ARCH-entity-interaction-unify · openAlbum, via the pick's album_id). The
 * artist is denormalized text (no DB id in the row), so it renders as a static
 * label, not an artist-hub link.
 *
 * Owner control is INLINE (OQ6 decision): the OWNER sees "올리기/바꾸기/삭제"
 * affordances right on the tile. The server's require_owner is the real gate
 * (fail-closed); the client hint is isOwnerUser() — post multi-user, any member
 * is "logged in", so isLoggedIn alone rendered owner controls that 403'd on
 * click (audit 2026-07-14). On a no-pick day: owner sees an empty-state prompt,
 * visitors AND members see nothing (the section hides — RFC: quiet no-pick days).
 *
 * "지난 추천곡" in the header opens the history overlay (OQ5 = modal).
 * Self-contained styling mirrors TodayAlbumBuckit (scoped .tsp-mod <style>).
 */
import { useEffect, useState } from 'react'
import { openAlbum } from '@lib/entityLinks'
import { isOwnerUser } from '@lib/owner'
import { Cover, SectionTitle } from './ui'
import {  deleteTodaysPick, getTodaysPick, putTodaysPick  } from '@lib/todaysPick'
import type { DailyPick, UpsertTodaysPick } from '@lib/todaysPick'
import TodaySongPicker from './TodaySongPicker'
import TodayPickHistory from './TodayPickHistory'

// Scoped hover/active rules (inline styles can't reach :hover). Keyed off .tsp-mod.
const SCOPED_CSS = `
.tsp-mod .tsp-card{display:flex;align-items:center;gap:clamp(14px,2.4vw,20px)}
.tsp-mod .tsp-open{display:flex;align-items:center;gap:clamp(14px,2.4vw,20px);background:none;border:0;padding:0;cursor:pointer;color:inherit;font:inherit;text-align:left;transition:opacity .16s}
.tsp-mod .tsp-open:hover{opacity:.78}
.tsp-mod .tsp-open:focus-visible{outline:2px solid var(--color-accent);outline-offset:3px;border-radius:6px}
.tsp-mod .tsp-title{display:block;margin:0 0 3px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tsp-mod .tsp-artist{display:block;color:var(--color-subtle);max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tsp-mod .tsp-actions{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto;flex:0 0 auto}
.tsp-mod .tsp-btn{font:inherit;font-size:12px;letter-spacing:.02em;padding:6px 11px;border-radius:999px;border:1px solid var(--color-border-soft);background:var(--color-bg);color:var(--color-subtle);cursor:pointer;transition:background .15s,color .15s,border-color .15s}
.tsp-mod .tsp-btn:hover{color:var(--color-text);border-color:var(--color-border);background:var(--color-border-soft)}
.tsp-mod .tsp-btn--danger:hover{color:#c0392b;border-color:color-mix(in srgb,#c0392b 40%,var(--color-border-soft))}
.tsp-mod .tsp-btn:disabled{opacity:.5;cursor:default}
.tsp-mod .tsp-empty{display:flex;align-items:center;gap:14px;justify-content:space-between;flex-wrap:wrap}
.tsp-mod .tsp-empty-msg{color:var(--color-subtle);font-size:14px}
.tsp-mod .tsp-history-link{background:none;border:0;padding:0;font:inherit;font-size:12px;letter-spacing:.02em;color:var(--color-subtle);cursor:pointer}
.tsp-mod .tsp-history-link:hover{color:var(--color-text);text-decoration:underline}
@media (prefers-reduced-motion:reduce){.tsp-mod .tsp-open{transition:none}}
`

function Skeleton() {
	return (
		<div className="tsp-card" aria-hidden="true" style={{ pointerEvents: 'none' }}>
			<span style={{ width: 88, height: 88, borderRadius: 4, background: 'var(--color-border-soft)' }} />
			<span style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
				<span style={{ width: 180, height: 14, borderRadius: 3, background: 'var(--color-border-soft)' }} />
				<span style={{ width: 120, height: 11, borderRadius: 3, background: 'var(--color-border-soft)' }} />
			</span>
		</div>
	)
}

export default function TodaySongBuckit() {
	const [pick, setPick] = useState<DailyPick | null>(null)
	const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
	const [pickerOpen, setPickerOpen] = useState(false)
	const [historyOpen, setHistoryOpen] = useState(false)
	const [busy, setBusy] = useState(false)
	// Owner hint — resolved CLIENT-side only (token/localStorage are undefined
	// during SSR). The server's require_owner is the real gate; isOwnerUser()
	// (cached getMe → OWNER_HANDLE) keeps the controls off MEMBER screens too —
	// isLoggedIn alone showed members buttons that 403'd (audit 2026-07-14).
	// Until resolved we render as a non-owner (no buttons) — fail-closed.
	const [isOwner, setIsOwner] = useState(false)

	useEffect(() => {
		let alive = true
		void isOwnerUser().then(v => alive && setIsOwner(v))
		void getTodaysPick().then((p) => {
			if (!alive)
				return
			setPick(p)
			setStatus('ready')
		}).catch(() => {
			if (alive)
				setStatus('error')
		})
		return () => {
			alive = false
		}
	}, [])

	// Hide on error — the home degrades silently (same posture as TodayAlbumBuckit).
	if (status === 'error')
		return null
	// No pick + not owner: hide entirely (RFC — quiet on no-pick days for visitors).
	if (status === 'ready' && !pick && !isOwner)
		return null

	async function handlePick(payload: UpsertTodaysPick): Promise<boolean> {
		const saved = await putTodaysPick(payload)
		if (saved) {
			setPick(saved)
			setPickerOpen(false)
			return true
		}
		return false
	}

	// Queue promote already posted the pick server-side (atomic with the queue-row
	// delete) — just adopt the returned pick and close, same finish as handlePick.
	function handlePromoted(saved: DailyPick) {
		setPick(saved)
		setPickerOpen(false)
	}

	async function handleDelete() {
		setBusy(true)
		try {
			const ok = await deleteTodaysPick()
			if (ok)
				setPick(null)
		}
		finally {
			setBusy(false)
		}
	}

	return (
		<section className="tsp-mod">
			<style>{SCOPED_CSS}</style>
			<SectionTitle
				kicker="오늘, 한 곡"
				title="오늘의 곡"
				right={<button type="button" className="tsp-history-link" onClick={() => setHistoryOpen(true)}>지난 추천곡 →</button>}
			/>
			{status === 'loading' && <Skeleton />}
			{status === 'ready' && pick && (
				<div className="tsp-card">
					<button
						type="button"
						className="tsp-open"
						title={`${pick.title} · 앨범 보기`}
						onClick={() => openAlbum({ albumId: pick.album_id, title: pick.title, artist: pick.artist, cover: pick.cover_url })}
					>
						<Cover label={pick.title} src={pick.cover_url} size={88} radius={4} />
						<span style={{ minWidth: 0 }}>
							<span className="tsp-title serif italic" style={{ fontSize: 21, fontWeight: 500, lineHeight: 1.15, color: 'var(--color-text)' }}>{pick.title}</span>
							<span className="tsp-artist mono" style={{ fontSize: 12.5, letterSpacing: '.02em' }}>{pick.artist}</span>
						</span>
					</button>
					{isOwner && (
						<span className="tsp-actions">
							<button type="button" className="tsp-btn" onClick={() => setPickerOpen(true)} disabled={busy}>오늘 곡 바꾸기</button>
							<button type="button" className="tsp-btn tsp-btn--danger" onClick={() => void handleDelete()} disabled={busy}>삭제</button>
						</span>
					)}
				</div>
			)}
			{status === 'ready' && !pick && isOwner && (
				<div className="tsp-empty">
					<span className="tsp-empty-msg">오늘의 곡을 올려보세요.</span>
					<button type="button" className="tsp-btn" onClick={() => setPickerOpen(true)}>곡 올리기 +</button>
				</div>
			)}
			{pickerOpen && <TodaySongPicker onPick={handlePick} onPromoted={handlePromoted} onClose={() => setPickerOpen(false)} />}
			{historyOpen && <TodayPickHistory onClose={() => setHistoryOpen(false)} />}
		</section>
	)
}
