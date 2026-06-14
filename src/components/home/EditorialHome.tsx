/**
 * Editorial home shell (FEAT-home-redesign, Work A — 홈 레이아웃 골격).
 *
 * Two lanes:
 *  - Writer strip: a thin band pinned under the header, visible only when logged
 *    in (auth-gated, client-side). Bucket + draft counts + "새 평론 쓰기".
 *  - Reader module stack: BNM hero (real, Work B) + Latest / Genres / Numbers
 *    (placeholders until their designs land). Reader-personalizable — drag
 *    reorder + hide/restore behind a "홈 편집" toggle, persisted to localStorage.
 *
 * Empty state (0 reviews — current reality after STAB-5) collapses to a single
 * editorial card and foregrounds the writer lane. Header/Footer come from
 * layout.astro; the design's own masthead/footer are prototype-only.
 */
import { isLoggedIn } from '@lib/auth'
import { bucketCount } from '@lib/member'
import type { ReviewCard } from '@lib/reviews'
import type { ReactElement } from 'react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import BnmHero from './BnmHero'
import type { BnmPick } from './BnmHero'
import BrowseGenres from './BrowseGenres'
import LatestReviews from './LatestReviews'
import { SectionTitle } from './ui'

const WRITE_URL = '/write'
const DRAFTS_URL = '/drafts'
const BUCKET_URL = '/profile'

interface Stats {
	reviews: number
	albums: number
	genres: number
	lastUpdated: string
}

interface Props {
	bnm: BnmPick[]
	reviews: ReviewCard[]
	stats: Stats
	draftCount: number
}

const ORDER_KEY = 'lfh_order'
const HIDDEN_KEY = 'lfh_hidden'

/* ── writer strip (auth-gated band under the header) ──────────── */
function WriterStrip({ bucket, drafts, emphasis }: { bucket: number, drafts: number, emphasis: boolean }) {
	return (
		<div style={{ background: 'var(--color-paper)', borderBottom: '1px solid var(--color-border)', borderLeft: emphasis ? '3px solid var(--color-accent)' : undefined }}>
			<div style={{ maxWidth: 'var(--home-measure)', margin: '0 auto', padding: '9px clamp(14px, 4vw, 44px)', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
				<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
					<span style={{ width: 6, height: 6, borderRadius: 6, background: 'var(--color-accent)', flex: '0 0 auto' }} />
					<span className="kicker" style={{ color: 'var(--color-text)', letterSpacing: '.14em', whiteSpace: 'nowrap' }}>작가 책상</span>
				</span>
				<a href={BUCKET_URL} className="mono" style={{ fontSize: 12, letterSpacing: '.03em', color: 'var(--color-subtle)', whiteSpace: 'nowrap' }}>
					버킷에 담은 앨범
{' '}
<b className="serif" style={{ fontStyle: 'normal', fontSize: 15, color: 'var(--color-text)' }}>{bucket}</b>
장
				</a>
				<a href={DRAFTS_URL} className="mono" style={{ fontSize: 12, letterSpacing: '.03em', color: 'var(--color-subtle)', whiteSpace: 'nowrap' }}>
					이어쓸 초안
{' '}
<b className="serif" style={{ fontStyle: 'normal', fontSize: 15, color: 'var(--color-text)' }}>{drafts}</b>
개
				</a>
				<a href={WRITE_URL} className="btn btn-accent" style={{ marginLeft: 'auto', flexShrink: 0, whiteSpace: 'nowrap' }}>
					＋ 새 평론 쓰기
				</a>
			</div>
		</div>
	)
}

/* ── placeholder module (Latest / Genres / Numbers — designs pending) ─ */
function PlaceholderModule({ kicker, title, right }: { kicker: string, title: string, right?: string }) {
	return (
		<section>
			<SectionTitle kicker={kicker} title={title} right={right ? <span className="btn" style={{ pointerEvents: 'none', opacity: 0.6 }}>{right}</span> : undefined} />
			<div className="panel" style={{ padding: '34px 26px', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 120, background: 'var(--color-paper)' }}>
				<span className="serif italic" style={{ fontSize: 16, color: 'var(--color-faded)' }}>이 모듈은 곧 추가됩니다 · 디자인 작업 중</span>
			</div>
		</section>
	)
}

/* ── empty state (0 reviews) ──────────────────────────────────── */
function EmptyState({ authed, bucket }: { authed: boolean, bucket: number }) {
	return (
		<section style={{ padding: '30px 0 8px' }}>
			<div className="panel" style={{ background: 'var(--color-paper)', padding: 'clamp(34px, 6vw, 72px) clamp(26px, 5vw, 60px)', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 20, maxWidth: 760 }}>
				<span className="kicker" style={{ color: 'var(--color-accent)' }}>첫 평론을 준비 중</span>
				<h1 className="serif" style={{ fontSize: 'clamp(30px, 4.2vw, 48px)', fontWeight: 500, lineHeight: 1.08, letterSpacing: '-.02em', margin: 0, textWrap: 'balance' }}>
					첫 평론이
{' '}
<span className="italic">이 자리에</span>
{' '}
실립니다.
				</h1>
				<p className="serif" style={{ fontSize: 18, lineHeight: 1.6, color: 'var(--color-subtle)', margin: 0, maxWidth: '42ch', textWrap: 'pretty' }}>
					{authed ?
(
						<>
들은 앨범을 버킷에 모으고, 한 장을 골라 평론을 쓰면 홈이 채워집니다. 지금 버킷에
<b style={{ color: 'var(--color-text)' }}>
{bucket}
장
</b>
이 대기 중입니다.
      </>
					) :
						<>이 평론지는 한 사람이 씁니다. 곧 첫 글이 올라올 예정이에요.</>}
				</p>
				{authed && (
					<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
						<a href={WRITE_URL} className="btn btn-accent">＋ 첫 평론 쓰기</a>
						<a href={BUCKET_URL} className="btn">
버킷 열기 ·
{bucket}
장
      </a>
					</div>
				)}
			</div>
		</section>
	)
}

export default function EditorialHome({ bnm, reviews, stats, draftCount }: Props) {
	const empty = stats.reviews === 0
	const hasHero = bnm.length > 0

	// Module registry. 'hero' is only available when there are BNM picks within
	// the rolling window; otherwise it drops out and Latest rises to the top.
	const modules: Record<string, { label: string, render: () => ReactElement }> = {
		hero: { label: 'BNM 히어로', render: () => <BnmHero picks={bnm} /> },
		latest: { label: '최신 평론', render: () => <LatestReviews reviews={reviews} /> },
		genres: { label: '장르로 탐색', render: () => <BrowseGenres /> },
		numbers: { label: 'By the numbers', render: () => <PlaceholderModule kicker="BY THE NUMBERS · 모듈 ④" title="숫자로 보는 평론지" /> },
	}
	const baseOrder = (hasHero ? ['hero', 'latest', 'genres', 'numbers'] : ['latest', 'genres', 'numbers'])
		.filter(id => id in modules)

	const [mounted, setMounted] = useState(false)
	const [authed, setAuthed] = useState(false)
	const [bucket, setBucket] = useState(0)
	const [order, setOrder] = useState<string[]>(baseOrder)
	const [hidden, setHidden] = useState<string[]>([])
	const [editing, setEditing] = useState(false)
	const [drag, setDrag] = useState<{ id: string, y: number, at: number } | null>(null)

	const cellRefs = useRef<Record<string, HTMLDivElement | null>>({})
	const dragData = useRef<{ id: string, lastAt: number | null } | null>(null)
	// `hidden` mirrored into a ref so the once-registered drag listeners + the
	// keyboard reorder read the live value, never a stale closure (reviewer MED-3).
	const hiddenRef = useRef<string[]>(hidden)
	useEffect(() => {
		hiddenRef.current = hidden
	}, [hidden])

	// Client-only state (avoids SSR/hydration mismatch).
	useEffect(() => {
		setMounted(true)
		setAuthed(isLoggedIn())
		setBucket(bucketCount())
		try {
			const o = JSON.parse(localStorage.getItem(ORDER_KEY) || 'null')
			if (Array.isArray(o)) {
				const f = o.filter((x: string) => baseOrder.includes(x))
				baseOrder.forEach((m) => {
 if (!f.includes(m))
f.push(m)
})
				setOrder(f)
			}
			const h = JSON.parse(localStorage.getItem(HIDDEN_KEY) || 'null')
			if (Array.isArray(h))
				setHidden(h.filter((x: string) => baseOrder.includes(x)))
		}
		catch { /* ignore */ }
	}, [])

	useEffect(() => {
		if (!mounted)
			return
		try {
			localStorage.setItem(ORDER_KEY, JSON.stringify(order))
		}
		catch { /* ignore */ }
	}, [order, mounted])
	useEffect(() => {
		if (!mounted)
			return
		try {
			localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden))
		}
		catch { /* ignore */ }
	}, [hidden, mounted])

	const visible = order.filter(m => !hidden.includes(m))

	const computeTarget = (py: number) => {
		const tops = visible.map((m) => {
			const el = cellRefs.current[m]
			if (!el)
				return Number.POSITIVE_INFINITY
			const r = el.getBoundingClientRect()
			return r.top + r.height / 2
		})
		let idx = tops.length
		for (let i = 0; i < tops.length; i++) {
			if (py < tops[i]) {
				idx = i
				break
			}
		}
		return idx
	}
	const onMove = (e: PointerEvent) => {
		const d = dragData.current
		if (!d)
			return
		setDrag({ id: d.id, y: e.clientY, at: computeTarget(e.clientY) })
	}
	const onUp = () => {
		const d = dragData.current
		window.removeEventListener('pointermove', onMove)
		window.removeEventListener('pointerup', onUp)
		document.body.style.userSelect = ''
		document.body.style.cursor = ''
		if (d && d.lastAt != null) {
			setOrder((prev) => {
				const vis = prev.filter(m => !hiddenRef.current.includes(m))
				const from = vis.indexOf(d.id)
				let to = d.lastAt as number
				if (to > from)
					to--
				vis.splice(from, 1)
				vis.splice(to, 0, d.id)
				const result: string[] = []
				let vi = 0
				prev.forEach((m) => {
					result.push(hiddenRef.current.includes(m) ? m : vis[vi++])
				})
				return result
			})
		}
		dragData.current = null
		setDrag(null)
	}
	const onDragStart = (e: React.PointerEvent, mid: string) => {
		if (e.button !== 0)
			return
		e.preventDefault()
		dragData.current = { id: mid, lastAt: null }
		document.body.style.userSelect = 'none'
		document.body.style.cursor = 'grabbing'
		window.addEventListener('pointermove', onMove)
		window.addEventListener('pointerup', onUp)
	}
	if (drag && dragData.current)
		dragData.current.lastAt = drag.at

	const hide = (mid: string) => setHidden(h => [...h, mid])
	const restore = (mid: string) => setHidden(h => h.filter(x => x !== mid))
	// Keyboard reorder (drag handle is pointer-only; reviewer MED-2). Arrow up/down
	// moves a module one slot among the visible set.
	const moveModule = (mid: string, dir: -1 | 1) => {
		setOrder((prev) => {
			const vis = prev.filter(m => !hiddenRef.current.includes(m))
			const from = vis.indexOf(mid)
			const to = from + dir
			if (from < 0 || to < 0 || to >= vis.length)
				return prev
			vis.splice(from, 1)
			vis.splice(to, 0, mid)
			const result: string[] = []
			let vi = 0
			prev.forEach((m) => {
				result.push(hiddenRef.current.includes(m) ? m : vis[vi++])
			})
			return result
		})
	}
	const reset = () => {
		setOrder(baseOrder)
		setHidden([])
	}

	return (
		<div>
			{mounted && authed && <WriterStrip bucket={bucket} drafts={draftCount} emphasis={empty} />}

			<main style={{ maxWidth: 'var(--home-measure)', margin: '0 auto', padding: '26px clamp(14px, 4vw, 44px) 80px' }}>
				{empty ?
					(
						<EmptyState authed={mounted && authed} bucket={bucket} />
					) :
					(
						<>
							<div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 14, borderBottom: '1px solid var(--color-border)', marginBottom: editing ? 18 : 8 }}>
								<span className="kicker" style={{ letterSpacing: '.18em', whiteSpace: 'nowrap' }}>독자 맞춤 홈</span>
								<span className="meta" style={{ color: 'var(--color-faded)', whiteSpace: 'nowrap' }}>
모듈
{visible.length}
        </span>
								<button
									type="button"
									onClick={() => setEditing(e => !e)}
									className="chip"
									data-on={editing}
									title="홈 화면 맞춤설정"
									style={{ marginLeft: 'auto' }}
								>
									{editing ? '완료' : '홈 편집'}
								</button>
							</div>

							{editing && (
								<div className="panel" style={{ margin: '0 0 18px', padding: '13px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', background: 'var(--color-paper)' }}>
									<span className="sans" style={{ fontSize: 13, color: 'var(--color-subtle)' }}>⠿ 핸들을 끌어 순서를 바꾸고, ✕로 모듈을 숨기세요. 작가 책상은 재배치할 수 없습니다.</span>
									<button type="button" className="btn" onClick={reset} style={{ marginLeft: 'auto' }}>기본값으로</button>
								</div>
							)}

							{visible.length === 0 ?
								(
									<div className="panel" style={{ padding: '40px 26px', textAlign: 'center', background: 'var(--color-paper)' }}>
										<p className="serif italic" style={{ fontSize: 18, color: 'var(--color-subtle)', margin: 0 }}>모든 모듈을 숨겼습니다. 아래에서 복원하세요.</p>
									</div>
								) :
								(
									<div style={{ display: 'flex', flexDirection: 'column', gap: 60, position: 'relative' }}>
										{visible.map((mid, i) => (
											<Fragment key={mid}>
												{editing && drag && drag.at === i && <div className="lf-drop-line" />}
												<div ref={(el) => { cellRefs.current[mid] = el }} style={{ position: 'relative', paddingTop: editing ? 46 : 0, opacity: drag && drag.id === mid ? 0.32 : 1, transition: 'opacity .15s' }}>
													{editing && (
														<div style={{ position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--color-paper)', border: '1px solid var(--color-border)', borderRadius: 4 }}>
															<span
																role="button"
																tabIndex={0}
																aria-label={`${modules[mid].label} 모듈 순서 변경 — 방향키 위/아래`}
																onPointerDown={e => onDragStart(e, mid)}
																onKeyDown={(e) => {
																	if (e.key === 'ArrowUp') {
																		e.preventDefault()
																		moveModule(mid, -1)
																	}
																	else if (e.key === 'ArrowDown') {
																		e.preventDefault()
																		moveModule(mid, 1)
																	}
																}}
																className="drag-handle mono"
																style={{ fontSize: 15, color: 'var(--color-faded)', userSelect: 'none' }}
																title="드래그 또는 방향키로 순서 변경"
															>
																⠿
															</span>
															<span className="mono" style={{ fontSize: 11, fontWeight: 500, letterSpacing: '.1em', textTransform: 'uppercase' }}>{modules[mid].label}</span>
															<button type="button" className="iconbtn danger" onClick={() => hide(mid)} title="홈에서 숨기기" style={{ marginLeft: 'auto' }}>✕</button>
														</div>
													)}
													{modules[mid].render()}
												</div>
											</Fragment>
										))}
										{editing && drag && drag.at === visible.length && <div className="lf-drop-line" />}
									</div>
								)}

							{editing && hidden.length > 0 && (
								<div className="panel" style={{ marginTop: 40, padding: 18, background: 'var(--color-paper)' }}>
									<div className="meta" style={{ marginBottom: 12 }}>숨긴 모듈 · 클릭하여 복원</div>
									<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
										{hidden.map(m => (
<button type="button" key={m} className="chip" onClick={() => restore(m)}>
＋
{modules[m].label}
</button>
))}
									</div>
								</div>
							)}
						</>
					)}
			</main>

			{drag && dragData.current && createPortal(
				<div style={{ position: 'fixed', left: 0, right: 0, top: drag.y - 16, zIndex: 1000, pointerEvents: 'none', display: 'flex', justifyContent: 'center' }}>
					<span className="mono" style={{ padding: '8px 16px', background: 'var(--color-text)', color: 'var(--color-bg)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', boxShadow: '0 18px 40px -14px rgba(0,0,0,.5)' }}>{modules[drag.id].label}</span>
				</div>,
				document.body,
			)}
		</div>
	)
}
