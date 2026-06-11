// FEAT-album-research-notes Step 5 — a tiny, dependency-free markdown renderer
// for the AI research note. We deliberately do NOT pull in react-markdown /
// marked: adding a runtime dep would touch the lockfile + node_modules (the
// front deploy has bitten us there before) for a single, well-known input
// shape. The note is produced by album-research-prompt v2 — headings, prose,
// bold, links, bullet/numbered lists, blockquotes, the literal [확인]/[미확인]
// markers (which are NOT links — no `](` follows — so they pass through as text).
//
// Safety: every node is built as a React element, so text is escaped by React
// (no dangerouslySetInnerHTML, no HTML injection). Links open in a new tab with
// rel="noopener noreferrer".
import type { ReactNode } from 'react'

// One pass over a line's inline spans: **bold**, `code`, [text](url), *em*, _em_.
// The link-URL fragment allows one level of balanced parens so Wikipedia-style
// destinations (…/Blonde_(Frank_Ocean_album)) aren't truncated at the inner ')'.
// The two branches are disjoint (non-paren char | a parenthesized group), so the
// '+' can't backtrack super-linearly.
const URL_FRAG = '(?:[^()\\s]|\\([^()\\s]*\\))+'
const INLINE = new RegExp(`(\\*\\*[^*]+\\*\\*)|(\`[^\`]+\`)|(\\[[^\\]]+\\]\\(${URL_FRAG}\\))|(\\*[^*]+\\*)|(_[^_]+_)`, 'g')
const LINK = new RegExp(`^\\[([^\\]]+)\\]\\((${URL_FRAG})\\)$`)

function inline(text: string, keyBase: string): ReactNode[] {
	const out: ReactNode[] = []
	let last = 0
	let i = 0
	INLINE.lastIndex = 0
	let m = INLINE.exec(text)
	while (m !== null) {
		const match = m[0]
		const offset = m.index
		if (offset > last)
			out.push(text.slice(last, offset))
		const key = `${keyBase}-${i}`
		i += 1
		if (match.startsWith('**')) {
			out.push(<strong key={key}>{match.slice(2, -2)}</strong>)
		}
		else if (match.startsWith('`')) {
			out.push(<code key={key} className="rsh-code">{match.slice(1, -1)}</code>)
		}
		else if (match.startsWith('[')) {
			const lm = LINK.exec(match)
			out.push(lm ?
				<a key={key} href={lm[2]} target="_blank" rel="noopener noreferrer" className="rsh-link">{lm[1]}</a> :
				match)
		}
		else {
			out.push(<em key={key}>{match.slice(1, -1)}</em>)
		}
		last = offset + match.length
		m = INLINE.exec(text)
	}
	if (last < text.length)
		out.push(text.slice(last))
	return out
}

const RE_HR = /^\s*([-*_])\1{2,}\s*$/
// group2 must start with a non-space so `\s+` and `.*` can't overlap (avoids
// super-linear backtracking). A bare `##` (no title) leaves group2 undefined.
const RE_HEADING = /^(#{1,6})\s+(\S.*)?$/
const RE_QUOTE = /^\s*>\s?/
const RE_UL = /^\s*[-*+]\s+/
const RE_OL = /^\s*\d+\.\s+/

function isStructural(line: string): boolean {
	return RE_HR.test(line) || RE_HEADING.test(line) || RE_QUOTE.test(line) || RE_UL.test(line) || RE_OL.test(line)
}

function heading(level: number, children: ReactNode, key: number): ReactNode {
	const cls = `rsh-h rsh-h${level}`
	if (level <= 1)
		return <h2 key={key} className={cls}>{children}</h2>
	if (level === 2)
		return <h3 key={key} className={cls}>{children}</h3>
	if (level === 3)
		return <h4 key={key} className={cls}>{children}</h4>
	return <h5 key={key} className={cls}>{children}</h5>
}

/** Render an album-research note (markdown string) to React nodes. */
export function renderMarkdown(md: string): ReactNode {
	const lines = md.replace(/\r\n/g, '\n').split('\n')
	const blocks: ReactNode[] = []
	let i = 0
	let key = 0
	while (i < lines.length) {
		const line = lines[i]
		if (!line.trim()) {
			i += 1
			continue
		}
		if (RE_HR.test(line)) {
			blocks.push(<hr key={key} className="rsh-hr" />)
			key += 1
			i += 1
			continue
		}
		const h = RE_HEADING.exec(line)
		if (h) {
			blocks.push(heading(Math.min(h[1].length, 4), inline(h[2] ?? '', `h${key}`), key))
			key += 1
			i += 1
			continue
		}
		if (RE_QUOTE.test(line)) {
			const buf: string[] = []
			while (i < lines.length && RE_QUOTE.test(lines[i])) {
				buf.push(lines[i].replace(RE_QUOTE, ''))
				i += 1
			}
			blocks.push(<blockquote key={key} className="rsh-quote">{inline(buf.join(' '), `q${key}`)}</blockquote>)
			key += 1
			continue
		}
		if (RE_UL.test(line)) {
			const items: string[] = []
			while (i < lines.length && RE_UL.test(lines[i])) {
				items.push(lines[i].replace(RE_UL, ''))
				i += 1
			}
			blocks.push(
				<ul key={key} className="rsh-ul">
					{items.map((it, j) => <li key={`u${key}-${j}`}>{inline(it, `u${key}-${j}`)}</li>)}
				</ul>,
			)
			key += 1
			continue
		}
		if (RE_OL.test(line)) {
			const items: string[] = []
			while (i < lines.length && RE_OL.test(lines[i])) {
				items.push(lines[i].replace(RE_OL, ''))
				i += 1
			}
			blocks.push(
				<ol key={key} className="rsh-ol">
					{items.map((it, j) => <li key={`o${key}-${j}`}>{inline(it, `o${key}-${j}`)}</li>)}
				</ol>,
			)
			key += 1
			continue
		}
		const para: string[] = []
		while (i < lines.length && lines[i].trim() && !isStructural(lines[i])) {
			para.push(lines[i])
			i += 1
		}
		blocks.push(<p key={key} className="rsh-p">{inline(para.join(' '), `p${key}`)}</p>)
		key += 1
	}
	return <>{blocks}</>
}
