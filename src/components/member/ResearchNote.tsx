// FEAT-album-research-notes Step 5 — the shared research-note panel, used by
// BOTH the BucketBoard cover slide-over (/profile) and the /write margin rail.
// The note belongs to the album, so both surfaces drive the same store
// (lib/research.ts, keyed by album_id) — open it in one place and the other
// reflects it. Styled with the global --color-* tokens + .rsh-* classes
// (src/styles/research.css), which load on both pages.
//
// States: never-researched → 조사하기 button · queued/running → live caption +
// (for a refine-in-flight) the prior note kept visible · done → collapsed-by-
// default markdown + 재조사 split (보강 = refine / 처음부터 = restart-confirm) ·
// failed → error + 다시 시도 (the prior note, if any, stays — refine never blanks).
import { useState } from 'react'
import NoteBody from '@components/research/NoteBody'
import { renderMarkdown } from '@lib/researchMarkdown'
import { RESEARCH_STATUS_LABEL, researchStatusColor, useResearch } from '@lib/research'
import type { ResearchStatus } from '@lib/research'

function StatusBadge({ status }: { status: ResearchStatus | null }) {
	if (!status)
		return null
	const color = researchStatusColor(status)
	return (
		<span className="rsh-badge" style={{ color }}>
			<span className={`rsh-dot${status === 'running' || status === 'queued' ? ' rsh-dot--pulse' : ''}`} style={{ background: color }} />
			{RESEARCH_STATUS_LABEL[status]}
		</span>
	)
}

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
	/**
	 * 'panel' = collapsible slide-over body · 'rail' = compact /write margin column
	 * · 'doc' = always-open structured reading view (the bucket reading modal): the
	 * note renders via NoteBody (sections + pill nav + collapsible) instead of one
	 * flat blob, and there is no collapse header (the modal owns the title/close).
	 */
	variant?: 'panel' | 'rail' | 'doc'
	/** Lazy-load the note on mount. Default true (both live surfaces want it). */
	auto?: boolean
}

export default function ResearchNote({ albumId, variant = 'panel', auto = true }: Props) {
	const { note, status, loading, error, loaded, trigger, refine, restart, reload } = useResearch(albumId, { auto })
	const docMode = variant === 'doc'
	// Collapsed by default (RFC) — the note can be long; the gist is the badge.
	// In doc mode the body is always open (the modal is a dedicated reading view).
	const [open, setOpen] = useState(false)
	const isOpen = docMode || open
	const [action, setAction] = useState<null | 'refine' | 'restart'>(null)
	const [instr, setInstr] = useState('')

	const md = note?.result_md ?? null
	const busy = loading

	// ── first paint, before the GET resolves ──
	if (!loaded && !note && loading) {
		return (
			<div className={`rsh rsh--${variant}`}>
				<div className="rsh-loading">조사 정보를 불러오는 중…</div>
			</div>
		)
	}

	// ── never researched ──
	if (loaded && !note) {
		return (
			<div className={`rsh rsh--${variant}`}>
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

	const headInner = (
		<span className="rsh-head-l">
			<span className="rsh-kicker">리서치 노트</span>
			<StatusBadge status={status} />
			{note.refine_count > 0 && (
				<span className="rsh-refcount">{`보강 ${note.refine_count}회`}</span>
			)}
		</span>
	)

	return (
		<div className={`rsh rsh--${variant}`}>
			{docMode ?
				<div className="rsh-head rsh-head--static">{headInner}</div> :
				(
					<button type="button" className="rsh-head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
						{headInner}
						<span className={`rsh-chevron${open ? ' is-open' : ''}`} aria-hidden="true">▾</span>
					</button>
				)}

			{/* live caption — shown even while collapsed so progress is never hidden */}
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

			{isOpen && (
				<div className="rsh-body">
					{md ?
						(docMode ?
							<NoteBody md={md} /> :
							<div className="rsh-prose">{renderMarkdown(md)}</div>) :
						<p className="rsh-caption">{active ? '결과가 생성되면 여기에 표시됩니다.' : '내용이 없습니다.'}</p>}

					{(note.model || note.finished_at) && (
						<div className="rsh-meta">
							{note.model && <span>{note.model}</span>}
							{note.finished_at && <span>{fmtDate(note.finished_at)}</span>}
							{note.prompt_version && <span>{note.prompt_version}</span>}
						</div>
					)}

					{/* actions */}
					{action === null && (
						<div className="rsh-actions">
							{status === 'failed' && (
								<button type="button" className="rsh-btn rsh-btn-primary" disabled={busy} onClick={() => void trigger()}>다시 시도</button>
							)}
							{status === 'done' && (
								<>
									<button type="button" className="rsh-btn" disabled={busy} onClick={() => setAction('refine')}>보강</button>
									<button type="button" className="rsh-btn rsh-btn-danger" disabled={busy} onClick={() => setAction('restart')}>처음부터</button>
								</>
							)}
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
				</div>
			)}
		</div>
	)
}
