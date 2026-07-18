/**
 * 발매 레이더 — FEAT-personal-release-tracking Step 5 (/radar).
 *
 * The member-scoped personal release feed: only artists the member explicitly
 * tracks. Extends the 발매 캘린더's shared display core (releaseShared.tsx) —
 * same rcal-* visual system, same EventRow/EventCard/LedgerDay pieces — and
 * layers radar-only UI (rr-*) on top:
 *
 *   · Upcoming = an appears-only-when-present strip (owner OQ1 decision
 *     2026-07-18, backed by H1 "thin-but-usable"): when no tracked artist has
 *     an announced release the section vanishes entirely — never a fake-empty
 *     tab. Recently Released (rolling 30 d, server-defined) is the default
 *     surface, rendered as ledger days WITHOUT the calendar's past-fade (the
 *     recent feed IS the content here, not context).
 *   · Tracked-artist management is incidental, not a settings screen (RFC
 *     stance): one collapsible panel with the tracked list, DB artist search
 *     (catalog-anchored — tracking requires a DB artist id, so no Spotify
 *     candidate path), and Buckit snapshot import (preview → confirm; the
 *     tracked list stays independent after import).
 *
 * All reads/writes ride apiFetch (JWT; 401 → refresh → login redirect with
 * returnTo captured by goLogin). Not logged in → an honest gate card.
 */
import type { components } from '@lib/api.gen'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@lib/api'
import { goLogin, isLoggedIn } from '@lib/auth'
import { listBuckets } from '@lib/buckets'
import { useMusicSearch } from '@lib/useMusicSearch'
import type { ReleaseDayGroup, ReleaseEventLike } from './releaseShared'
import { EventCard, LedgerDay, MONTH_EN, RELEASE_BASE_CSS } from './releaseShared'

type FeedResponse = components['schemas']['Backend_ReleaseFeedResponse']
type FeedItem = components['schemas']['Backend_ReleaseFeedItem']
type TrackedArtist = components['schemas']['Backend_TrackedArtistResponse']
type Candidate = components['schemas']['Backend_TrackedArtistCandidate']

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string

// Radar-only additions layered on the shared base (strip grid, manage panel,
// chips). Chips guard against prod-realistic long nowrap artist names
// (min-width:0 + ellipsis — feedback-ui-repro-realistic-data).
const RADAR_CSS = `
.rr-sec{margin-top:44px;display:flex;align-items:baseline;gap:14px;border-bottom:1px solid var(--color-border);padding-bottom:8px}
.rr-sec .m-num{font-size:26px;font-weight:500;color:var(--color-text)}
.rr-sec .m-meta{font-size:10.5px;color:var(--color-faded);letter-spacing:.08em}
.rr-strip{margin-top:18px;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}
.rr-gate{margin-top:44px;border:1px solid var(--color-border);padding:26px 24px;text-align:center}
.rr-gate p{font-size:12px;color:var(--color-subtle);letter-spacing:.03em;line-height:1.8;margin:0 0 16px}
.rr-gate button{background:var(--color-text);color:var(--color-bg);border:0;font-size:11.5px;letter-spacing:.08em;padding:8px 22px;border-radius:999px;cursor:pointer}
.rr-manage{margin-top:34px;border:1px solid var(--color-border-soft);border-radius:6px;padding:16px 18px}
.rr-manage-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.rr-manage-head .t{font-size:11px;letter-spacing:.08em;color:var(--color-subtle)}
.rr-manage-head button{background:none;border:0;padding:0;cursor:pointer;font-size:10.5px;letter-spacing:.08em;color:var(--color-faded)}
.rr-manage-head button:hover{color:var(--color-text)}
.rr-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.rr-chip{display:flex;align-items:center;gap:7px;border:1px solid var(--color-border-soft);border-radius:999px;padding:3px 10px 3px 4px;max-width:220px}
.rr-chip img,.rr-chip .ph{width:22px;height:22px;border-radius:50%;object-fit:cover;flex:none;background:var(--color-paper)}
.rr-chip .ph{display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--color-faded)}
.rr-chip .nm{font-size:11.5px;color:var(--color-text);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rr-chip button{background:none;border:0;padding:0 0 0 2px;cursor:pointer;font-size:12px;color:var(--color-faded);flex:none}
.rr-chip button:hover{color:var(--color-accent)}
.rr-row{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}
.rr-row input,.rr-row select{flex:1;min-width:0;background:none;border:1px solid var(--color-border);border-radius:4px;padding:7px 10px;font-size:12px;color:var(--color-text)}
.rr-row button{background:none;border:1px solid var(--color-border);font-size:11px;letter-spacing:.06em;padding:6px 14px;border-radius:999px;cursor:pointer;flex:none}
.rr-row button:hover:not(:disabled){border-color:var(--color-text)}
.rr-row button:disabled{opacity:.4;cursor:default}
.rr-hits{margin-top:10px;display:flex;flex-direction:column;gap:2px}
.rr-hit{display:flex;align-items:center;gap:10px;padding:6px 4px;border-bottom:1px dotted var(--color-border-soft)}
.rr-hit img,.rr-hit .ph{width:26px;height:26px;border-radius:50%;object-fit:cover;flex:none;background:var(--color-paper)}
.rr-hit .ph{display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--color-faded)}
.rr-hit .nm{font-size:12.5px;color:var(--color-text);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.rr-hit button{background:none;border:1px solid var(--color-border);font-size:10.5px;letter-spacing:.06em;padding:3px 11px;border-radius:999px;cursor:pointer;flex:none}
.rr-hit button:hover:not(:disabled){border-color:var(--color-text)}
.rr-hit button:disabled{opacity:.4;cursor:default}
.rr-cands{margin-top:10px;display:flex;flex-direction:column;gap:2px;max-height:280px;overflow-y:auto}
.rr-cand{display:flex;align-items:center;gap:10px;padding:5px 4px;font-size:12px;color:var(--color-text)}
.rr-cand input{flex:none}
.rr-cand .nm{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rr-cand .done{font-size:10px;color:var(--color-faded);letter-spacing:.06em;flex:none}
.rr-status{margin-top:12px;font-size:10.5px;color:var(--color-faded);letter-spacing:.04em;line-height:1.7}
.rr-month{margin-top:26px;padding-bottom:6px;border-bottom:1px solid var(--color-border);font-size:10.5px;letter-spacing:.1em;color:var(--color-faded)}
.rr-sub{margin-top:18px;font-size:10px;letter-spacing:.12em;color:var(--color-faded);text-transform:uppercase}
@media (max-width:640px){
  .rr-strip{grid-template-columns:1fr}
}
`

/** Group an already-sorted feed slice into ledger days (order preserved). */
function groupByDate(items: FeedItem[]): ReleaseDayGroup[] {
	const out: ReleaseDayGroup[] = []
	for (const it of items) {
		const last = out[out.length - 1]
		if (last && last.date === it.release_date)
			last.events.push(it as ReleaseEventLike)
		else
			out.push({ date: it.release_date, events: [it as ReleaseEventLike] })
	}
	return out
}

function Avatar({ url, name, className }: { url: string | null | undefined, name: string, className?: string }) {
	return url ?
		<img className={className} src={url} alt="" loading="lazy" /> :
		<span className={`ph${className ? ` ${className}` : ''}`} aria-hidden="true">{name.slice(0, 1)}</span>
}

// ── tracked-artist management (incidental panel, not a settings screen) ─────

function ManagePanel({ tracked, onChanged }: {
	tracked: TrackedArtist[]
	onChanged: () => void
}) {
	const search = useMusicSearch({ recallTypes: ['artist'], pageLimit: 8 })
	const [busy, setBusy] = useState(false)
	const [status, setStatus] = useState('')
	const [buckets, setBuckets] = useState<{ id: string, name: string }[] | null>(null)
	const [bucketId, setBucketId] = useState('')
	const [cands, setCands] = useState<Candidate[] | null>(null)
	const [picked, setPicked] = useState<Set<string>>(new Set())

	const trackedIds = useMemo(() => new Set(tracked.map(t => t.artist_id)), [tracked])

	useEffect(() => {
		void listBuckets().then((roots) => {
			const flat: { id: string, name: string }[] = []
			const walk = (nodes: typeof roots, depth: number) => {
				for (const b of nodes) {
					flat.push({ id: b.id, name: `${'  '.repeat(depth)}${b.name}` })
					walk(b.children, depth + 1)
				}
			}
			walk(roots, 0)
			setBuckets(flat)
		})
	}, [])

	const addArtists = useCallback(async (ids: string[], label: string) => {
		if (ids.length === 0 || busy)
			return
		setBusy(true)
		setStatus('추가 중…')
		try {
			const res = await apiFetch(`${BASE}/api/me/tracked-artists`, {
				method: 'POST',
				body: JSON.stringify({ artist_ids: ids }),
			})
			if (res?.status === 429) {
				setStatus('오늘 추가 한도에 도달했어요 — 내일 다시 시도해 주세요.')
				return
			}
			if (!res || !res.ok) {
				setStatus('추가에 실패했습니다. 잠시 후 다시 시도해 주세요.')
				return
			}
			const j = await res.json() as { added?: number, already_tracked?: number }
			setStatus(`${label}: ${j.added ?? 0}명 추가${j.already_tracked ? ` · ${j.already_tracked}명은 이미 추적 중` : ''}`)
			onChanged()
		}
		finally {
			setBusy(false)
		}
	}, [busy, onChanged])

	const removeArtist = useCallback(async (artistId: string, name: string) => {
		const res = await apiFetch(`${BASE}/api/me/tracked-artists/${artistId}`, { method: 'DELETE' })
		if (res && (res.ok || res.status === 404)) {
			setStatus(`${name} 추적 해제`)
			onChanged()
		}
		else {
			setStatus('해제에 실패했습니다.')
		}
	}, [onChanged])

	const previewBucket = useCallback(async () => {
		if (!bucketId || busy)
			return
		setBusy(true)
		setStatus('버킷에서 아티스트를 찾는 중…')
		setCands(null)
		try {
			const res = await apiFetch(`${BASE}/api/me/tracked-artists/preview`, {
				method: 'POST',
				body: JSON.stringify({ bucket_id: bucketId }),
			})
			if (!res || !res.ok) {
				setStatus('버킷 미리보기에 실패했습니다.')
				return
			}
			const j = await res.json() as { candidates?: Candidate[] }
			const list = j.candidates ?? []
			setCands(list)
			setPicked(new Set(list.filter(c => !c.already_tracked).map(c => c.artist_id)))
			setStatus(list.length === 0 ? '이 버킷에서 아티스트를 찾지 못했습니다.' : `후보 ${list.length}명 — 추가할 아티스트를 고르세요.`)
		}
		finally {
			setBusy(false)
		}
	}, [bucketId, busy])

	return (
		<div className="rr-manage">
			<p className="rr-sub mono">아티스트 검색으로 추가</p>
			<form
				className="rr-row"
				onSubmit={(e) => {
					e.preventDefault()
					void search.runDbSearch()
				}}
			>
				<input
					type="search"
					value={search.query}
					placeholder="아티스트 이름 (카탈로그 검색)"
					aria-label="추적할 아티스트 검색"
					onChange={e => search.setQuery(e.target.value)}
				/>
				<button type="submit" className="mono" disabled={busy || search.loading}>검색</button>
			</form>
			{search.status && <p className="rr-status mono">{search.status}</p>}
			{search.artists.length > 0 && (
				<div className="rr-hits">
					{search.artists.filter(a => a.id).map(a => (
						<div key={a.id} className="rr-hit">
							<Avatar url={a.cover} name={a.name} />
							<span className="nm">{a.name}</span>
							<button
								type="button"
								className="mono"
								disabled={busy || trackedIds.has(a.id!)}
								onClick={() => void addArtists([a.id!], a.name)}
							>
								{trackedIds.has(a.id!) ? '추적 중' : '+ 추적'}
							</button>
						</div>
					))}
				</div>
			)}

			<p className="rr-sub mono">버킷에서 가져오기</p>
			<div className="rr-row">
				<select value={bucketId} aria-label="가져올 버킷" onChange={e => setBucketId(e.target.value)}>
					<option value="">버킷 선택…</option>
					{(buckets ?? []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
				</select>
				<button type="button" className="mono" disabled={!bucketId || busy} onClick={() => void previewBucket()}>미리보기</button>
			</div>
			{cands && cands.length > 0 && (
				<>
					<div className="rr-cands">
						{cands.map(c => (
							<label key={c.artist_id} className="rr-cand">
								<input
									type="checkbox"
									checked={c.already_tracked || picked.has(c.artist_id)}
									disabled={c.already_tracked}
									onChange={(e) => {
										setPicked((prev) => {
											const next = new Set(prev)
											if (e.target.checked)
												next.add(c.artist_id)
											else next.delete(c.artist_id)
											return next
										})
									}}
								/>
								<Avatar url={c.photo_url} name={c.name} className="ph" />
								<span className="nm">{c.name}</span>
								{c.already_tracked && <span className="done mono">추적 중</span>}
							</label>
						))}
					</div>
					<div className="rr-row">
						<button
							type="button"
							className="mono"
							disabled={busy || picked.size === 0}
							onClick={() => {
								void addArtists([...picked], '버킷 가져오기').then(() => setCands(null))
							}}
						>
							{`선택한 ${picked.size}명 추적`}
						</button>
					</div>
				</>
			)}

			{status && <p className="rr-status mono" role="status">{status}</p>}

			{tracked.length > 0 && (
				<>
					<p className="rr-sub mono">{`추적 중 · ${tracked.length}`}</p>
					<div className="rr-chips">
						{tracked.map(t => (
							<span key={t.artist_id} className="rr-chip">
								<Avatar url={t.photo_url} name={t.name} />
								<span className="nm">{t.name}</span>
								<button
									type="button"
									aria-label={`${t.name} 추적 해제`}
									title="추적 해제"
									onClick={() => void removeArtist(t.artist_id, t.name)}
								>
									×
								</button>
							</span>
						))}
					</div>
				</>
			)}
		</div>
	)
}

// ── page island ─────────────────────────────────────────────────────────────

export default function ReleaseRadar() {
	// null until the client checks localStorage — SSR renders the chrome only.
	const [authed, setAuthed] = useState<boolean | null>(null)
	const [feed, setFeed] = useState<FeedResponse | null>(null)
	const [feedStatus, setFeedStatus] = useState<'loading' | 'ok' | 'error'>('loading')
	const [tracked, setTracked] = useState<TrackedArtist[] | null>(null)
	const [manageOpen, setManageOpen] = useState(false)
	const [retryTick, setRetryTick] = useState(0)

	useEffect(() => {
		setAuthed(isLoggedIn())
	}, [])

	const loadAll = useCallback(async () => {
		const [feedRes, trackedRes] = await Promise.all([
			apiFetch(`${BASE}/api/me/release-feed`),
			apiFetch(`${BASE}/api/me/tracked-artists`),
		])
		if (feedRes?.ok)
			setFeed(await feedRes.json() as FeedResponse)
		if (trackedRes?.ok)
			setTracked(await trackedRes.json() as TrackedArtist[])
		setFeedStatus(feedRes?.ok ? 'ok' : 'error')
	}, [])

	useEffect(() => {
		if (!authed)
			return
		setFeedStatus('loading')
		void loadAll()
	}, [authed, loadAll, retryTick])

	// A fresh radar (nothing tracked yet) opens straight into management —
	// the empty feed alone would be a dead end.
	useEffect(() => {
		if (tracked && tracked.length === 0)
			setManageOpen(true)
	}, [tracked])

	const upcoming = feed?.upcoming ?? []
	const recent = feed?.recent ?? []
	const recentDays = useMemo(() => groupByDate(recent), [recent])

	return (
		<div className="rcal-wrap">
			<style>{RELEASE_BASE_CSS + RADAR_CSS}</style>
			<p className="rcal-kicker mono">Release Radar · 추적 기반</p>
			<h1 className="rcal-h1 serif italic">발매 레이더</h1>
			<p className="rcal-lede mono">
				내가 추적하는 아티스트의 발매만 모아 보는 개인 피드.
				<br />
				예정 정보는 관측 시점의 발표이며, 카탈로그 확인 후 ★ 확정으로 표시됩니다.
				<br />
				<a href="/releases/">전체 발매 캘린더 →</a>
			</p>

			{authed === false && (
				<div className="rr-gate">
					<p>
						발매 레이더는 로그인한 멤버의 추적 목록으로 만들어집니다.
						<br />
						로그인하면 이 페이지로 바로 돌아와요.
					</p>
					<button type="button" className="mono" onClick={() => void goLogin(true)}>로그인</button>
				</div>
			)}

			{authed && (
				<>
					<div className="rr-manage-head" style={{ marginTop: 30 }}>
						<span className="t mono">{tracked ? `추적 아티스트 ${tracked.length}명` : '추적 아티스트'}</span>
						<button type="button" className="mono" onClick={() => setManageOpen(o => !o)}>
							{manageOpen ? '관리 닫기 ×' : '아티스트 관리 +'}
						</button>
					</div>
					{manageOpen && tracked && <ManagePanel tracked={tracked} onChanged={() => void loadAll()} />}

					{feedStatus === 'loading' && <p className="rcal-note mono">불러오는 중…</p>}
					{feedStatus === 'error' && (
						<div className="rcal-err">
							<p className="mono">발매 피드를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
							<button type="button" className="mono" onClick={() => setRetryTick(t => t + 1)}>다시 시도</button>
						</div>
					)}

					{feedStatus === 'ok' && tracked && tracked.length === 0 && (
						<p className="rcal-note mono">
							아직 추적하는 아티스트가 없습니다 — 위에서 아티스트를 추가하면 발매 소식이 여기 모입니다.
						</p>
					)}

					{/* Upcoming: appears only when present (OQ1) — no empty-tab fake. */}
					{feedStatus === 'ok' && upcoming.length > 0 && (
						<section aria-label="예정된 발매">
							<div className="rr-sec">
								<span className="m-num serif italic">예정</span>
								<span className="m-meta mono">{`UPCOMING · ${upcoming.length}`}</span>
							</div>
							<div className="rr-strip">
								{upcoming.map(ev => <EventCard key={`${ev.artist_id}:${ev.title}`} ev={ev as ReleaseEventLike} showDate />)}
							</div>
						</section>
					)}

					{feedStatus === 'ok' && tracked && tracked.length > 0 && (
						<section aria-label="최근 발매">
							<div className="rr-sec">
								<span className="m-num serif italic">최근 발매</span>
								<span className="m-meta mono">{`LAST 30 DAYS · ${recent.length}`}</span>
							</div>
							{recent.length === 0 ?
								(
									<p className="rcal-note mono">
										최근 30일 안에 추적 아티스트의 발매가 없었습니다.
										{upcoming.length === 0 && ' 발표된 예정 발매도 아직 없어요 — 아티스트를 더 추가해 보세요.'}
									</p>
								) :
								recentDays.map((day, i) => {
									// The rolling 30 d window always straddles a month boundary —
									// a bare day numeral would be ambiguous, so mark the crossing.
									const prev = recentDays[i - 1]
									const crossed = prev && prev.date.slice(0, 7) !== day.date.slice(0, 7)
									return (
										<Fragment key={day.date}>
											{crossed && <div className="rr-month mono">{`${Number(day.date.slice(5, 7))}월 · ${MONTH_EN[Number(day.date.slice(5, 7)) - 1]}`}</div>}
											<LedgerDay day={day} past={false} />
										</Fragment>
									)
								})}
						</section>
					)}
				</>
			)}

			<p className="rcal-foot mono">
				관측 소스 — MusicBrainz 릴리스 그룹 · iTunes 프리오더 · Spotify 카탈로그 확정.
				<br />
				예정/불확실 배지는 아직 카탈로그로 확인되지 않은 발표라는 뜻입니다. ★ 확정 항목은 앨범 상세로 열립니다.
			</p>
		</div>
	)
}
