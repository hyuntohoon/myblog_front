// /write split-view research document — the right pane of the editor|doc split
// (Claude Design handoff 2026-06-11, option D "분할 보기" — the owner-picked
// layout, enlarged doc typography). Renders the album research note as a real
// reading document: sticky h2-section pill nav (click → smooth scroll), doc
// head (title + status row + ＋보강/재조사 actions + album facts), and the note
// body at document scale with hover "❝ 인용" buttons that quote a block into
// the draft body. Status behavior matches ResearchNote (the BucketBoard /
// narrow-drawer panel): empty → 조사하기, queued/running → live caption +
// poll, failed → retry (prior note kept), refine keeps the note.
import { useMemo, useRef, useState } from 'react'
import { renderMarkdown, splitSections } from '@lib/researchMarkdown'
import { RESEARCH_STATUS_LABEL, researchStatusColor, useResearch } from '@lib/research'
import type { AlbumDetail } from './types'

function fmtDate(iso: string | null | undefined): string {
	if (!iso)
		return ''
	const d = new Date(iso)
	if (Number.isNaN(d.getTime()))
		return ''
	return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

interface Props {
	albumId: string
	subject: AlbumDetail | null
	/** Quote a note block into the draft body (plain text, markers stripped). */
	onQuote: (text: string) => void
}

export default function ResearchDoc({ albumId, subject, onQuote }: Props) {
	const { note, status, loading, error, loaded, trigger, refine, restart, reload } = useResearch(albumId, { auto: true })
	const [action, setAction] = useState<null | 'refine' | 'restart'>(null)
	const [instr, setInstr] = useState('')
	const [activeSec, setActiveSec] = useState<string | null>(null)
	// Collapsed section ids (open by default — the doc pane is for reading; collapse
	// is an affordance for the long info-dense note).
	const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
	const rootRef = useRef<HTMLDivElement>(null)

	const md = note?.result_md ?? null
	const sections = useMemo(() => (md ? splitSections(md) : []), [md])
	const navSections = sections.filter(s => s.title != null)
	const busy = loading

	const toggleSec = (id: string) => setCollapsed((prev) => {
		const next = new Set(prev)
		if (next.has(id))
			next.delete(id)
		else
			next.add(id)
		return next
	})

	const jumpTo = (id: string) => {
		setActiveSec(id)
		// expand the target if collapsed, then scroll once it's laid out
		setCollapsed((prev) => {
			if (!prev.has(id))
				return prev
			const next = new Set(prev)
			next.delete(id)
			return next
		})
		requestAnimationFrame(() => rootRef.current?.querySelector(`[data-sec="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
	}

	// ── first paint, before the GET resolves ──
	if (!loaded && !note && loading) {
		return (
			<div className="wr-rdoc">
				<div className="rsh-loading">조사 정보를 불러오는 중…</div>
			</div>
		)
	}

	// ── never researched ──
	if (loaded && !note) {
		return (
			<div className="wr-rdoc">
				<div className="wr-rdoc-head">
					<h2 className="wr-rdoc-title">{`리서치 노트${subject ? ` — ${subject.title}` : ''}`}</h2>
				</div>
				{error ?
					(
						<div className="rsh-empty">
							<p className="rsh-empty-msg">조사 정보를 불러오지 못했습니다.</p>
							<button type="button" className="rsh-btn" onClick={() => void reload()}>다시 시도</button>
						</div>
					) :
					(
						<div className="rsh-empty">
							<p className="rsh-empty-msg">아직 이 앨범의 조사 노트가 없습니다.</p>
							<button type="button" className="rsh-btn rsh-btn-primary" disabled={busy} onClick={() => void trigger()}>
								{busy ? '대기열에 추가 중…' : '🔎 조사하기'}
							</button>
							<p className="rsh-empty-hint">웹을 조사해 크레딧·샘플·계보 등 근거를 모읍니다. 보통 3–8분.</p>
						</div>
					)}
			</div>
		)
	}

	if (!note)
		return null

	const active = status === 'queued' || status === 'running'
	const refineInFlight = active && note.refine_count > 0 && !!md
	const dotColor = researchStatusColor(status)
	const metaParts = [
		note.refine_count > 0 ? `보강 ${note.refine_count}회` : null,
		fmtDate(note.finished_at) || null,
		note.model ?? null,
	].filter(Boolean)
	const facts: [string, string][] = []
	if (subject) {
		const artist = subject.artists.map(a => a.name).join(', ')
		if (artist)
			facts.push(['아티스트', artist])
		if (subject.release_date)
			facts.push(['발매', subject.release_date])
		if (subject.tracks.length > 0)
			facts.push(['형식', `${subject.tracks.length}트랙`])
	}
	if (note.prompt_version)
		facts.push(['프롬프트', note.prompt_version])

	return (
		<div className="wr-rdoc" ref={rootRef}>
			{navSections.length > 1 && (
				<nav className="wr-rdoc-nav" aria-label="노트 섹션">
					{navSections.map(s => (
						<button key={s.id} type="button" className={activeSec === s.id ? 'on' : ''} onClick={() => jumpTo(s.id)}>{s.title}</button>
					))}
				</nav>
			)}

			<div className="wr-rdoc-head">
				<div className="wr-rdoc-head-top">
					<h2 className="wr-rdoc-title">{`리서치 노트${subject ? ` — ${subject.title}` : ''}`}</h2>
					{action === null && (
						<div className="wr-rdoc-actions">
							{status === 'failed' && (
								<button type="button" className="wr-rdoc-act" disabled={busy} onClick={() => void trigger()}>다시 시도</button>
							)}
							{status === 'done' && (
								<>
									<button type="button" className="wr-rdoc-act" disabled={busy} onClick={() => setAction('refine')}>＋ 보강</button>
									<button type="button" className="wr-rdoc-act danger" disabled={busy} onClick={() => setAction('restart')}>재조사</button>
								</>
							)}
						</div>
					)}
				</div>

				<div className="wr-rdoc-status">
					<span className="wr-rdoc-dot" style={{ background: dotColor }} aria-hidden="true" />
					<span className="wr-rdoc-status-l" style={{ color: dotColor }}>{status ? RESEARCH_STATUS_LABEL[status] : ''}</span>
					{metaParts.length > 0 && <span className="wr-rdoc-status-m">{metaParts.join(' · ')}</span>}
				</div>

				{active && (
					<div className="rsh-caption rsh-caption--run">
						{refineInFlight ? '기존 노트에 보강 조사 중…' : '웹을 조사하고 있습니다… 보통 3–8분 걸립니다.'}
					</div>
				)}
				{status === 'failed' && (
					<div className="rsh-caption rsh-caption--fail">
						{`조사에 실패했습니다${note.error ? ` · ${note.error}` : ''}`}
					</div>
				)}

				{action === 'refine' && (
					<div className="rsh-refine">
						<label className="rsh-field-l">더 조사할 내용</label>
						<textarea
							className="rsh-textarea"
							rows={3}
							autoFocus
							placeholder="예: 샘플 출처를 더 확인해줘 / 프로듀서 크레딧을 보강해줘"
							value={instr}
							onChange={e => setInstr(e.target.value)}
						/>
						<div className="rsh-actions">
							<button
								type="button"
								className="rsh-btn-ghost"
								onClick={() => {
									setAction(null)
									setInstr('')
								}}
							>
								취소
							</button>
							<button
								type="button"
								className="rsh-btn rsh-btn-primary"
								disabled={busy || !instr.trim()}
								onClick={() => {
									void refine(instr.trim())
									setAction(null)
									setInstr('')
								}}
							>
								보강 요청
							</button>
						</div>
					</div>
				)}

				{action === 'restart' && (
					<div className="rsh-confirm">
						<p className="rsh-confirm-msg">기존 노트를 지우고 처음부터 다시 조사합니다. 되돌릴 수 없습니다.</p>
						<div className="rsh-actions">
							<button type="button" className="rsh-btn-ghost" onClick={() => setAction(null)}>취소</button>
							<button
								type="button"
								className="rsh-btn rsh-btn-danger"
								disabled={busy}
								onClick={() => {
									void restart()
									setAction(null)
								}}
							>
								처음부터 다시
							</button>
						</div>
					</div>
				)}

				{facts.length > 0 && (
					<dl className="wr-rdoc-facts">
						{facts.map(([k, v]) => (
							<div className="wr-rdoc-fact" key={k}>
								<dt>{k}</dt>
								<dd>{v}</dd>
							</div>
						))}
					</dl>
				)}
			</div>

			{md ?
				sections.map((s) => {
					// preamble (no `## ` heading) — render plainly, no collapse header
					if (s.title == null) {
						return (
							<div key={s.id} data-sec={s.id}>
								<div className="rsh-prose rsh-doc">{renderMarkdown(s.md, { onQuote })}</div>
							</div>
						)
					}
					const open = !collapsed.has(s.id)
					// body = section md minus its own "## title" line (rendered by the header)
					const body = s.md.replace(/^[^\n]*\n?/, '')
					return (
						<section key={s.id} data-sec={s.id} className="rsh-sec">
							<button
								type="button"
								className={`rsh-sec-head${open ? ' is-open' : ''}`}
								aria-expanded={open}
								onClick={() => toggleSec(s.id)}
							>
								<span className="rsh-sec-chev" aria-hidden="true">▸</span>
								<span className="rsh-sec-title">{s.title}</span>
							</button>
							{open && <div className="rsh-prose rsh-doc rsh-sec-body">{renderMarkdown(body, { onQuote })}</div>}
						</section>
					)
				}) :
				<p className="rsh-caption">{active ? '결과가 생성되면 여기에 표시됩니다.' : '내용이 없습니다.'}</p>}
		</div>
	)
}
