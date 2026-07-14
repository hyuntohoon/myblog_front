// Shared sectioned research-note body — splitSections + sticky pill nav +
// per-section collapsible rendering (the structured reading view). Reused by the
// /write split doc (ResearchDoc) and the member bucket reading modal so both
// surfaces render the note identically. Styles live in the shared research.css
// (rsh-nav / rsh-sec* / rsh-prose.rsh-doc) so they apply on both pages.
import { useMemo, useRef, useState } from 'react'
import { renderMarkdown, splitSections } from '@lib/researchMarkdown'

export default function NoteBody({ md, onQuote }: { md: string, onQuote?: (text: string) => void }) {
	const sections = useMemo(() => splitSections(md), [md])
	const navSections = sections.filter(s => s.title != null)
	const [activeSec, setActiveSec] = useState<string | null>(null)
	// Collapsed section ids — open by default; collapse is an affordance for the
	// long info-dense note.
	const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
	const rootRef = useRef<HTMLDivElement>(null)

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
		setCollapsed((prev) => {
			if (!prev.has(id))
				return prev
			const next = new Set(prev)
			next.delete(id)
			return next
		})
		requestAnimationFrame(() => rootRef.current?.querySelector(`[data-sec="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
	}

	const renderOpts = onQuote ? { onQuote } : {}

	return (
		<div className="rsh-notebody" ref={rootRef}>
			{navSections.length > 1 && (
				<nav className="rsh-nav" aria-label="노트 섹션">
					{navSections.map(s => (
						<button key={s.id} type="button" className={activeSec === s.id ? 'on' : ''} onClick={() => jumpTo(s.id)}>{s.title}</button>
					))}
				</nav>
			)}
			{sections.map((s) => {
				// preamble (no `## ` heading) — render plainly, no collapse header
				if (s.title == null) {
					return (
						<div key={s.id} data-sec={s.id}>
							<div className="rsh-prose rsh-doc">{renderMarkdown(s.md, renderOpts)}</div>
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
						{open && <div className="rsh-prose rsh-doc rsh-sec-body">{renderMarkdown(body, renderOpts)}</div>}
					</section>
				)
			})}
		</div>
	)
}
